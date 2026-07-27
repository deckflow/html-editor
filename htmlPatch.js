import { parseDocument } from "htmlparser2";
import { selectAll } from "css-select";
import { patchTableElementHtml } from "./tablePatch.js";

const allowedStyleProperties = new Set([
  "box-sizing",
  "color",
  "display",
  "font-size",
  "font-style",
  "font-weight",
  "left",
  "letter-spacing",
  "line-height",
  "max-width",
  "overflow-wrap",
  "position",
  "text-align",
  "text-decoration-line",
  "top",
  "width",
]);

const inlineTextStyleProperties = new Set([
  "color",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-decoration-line",
]);

const safeInlineHtmlTags = new Set([
  "span", "strong", "b", "em", "i", "u", "s", "small", "code", "kbd", "samp",
  "var", "mark", "sub", "sup", "time", "abbr", "cite", "q",
]);

const unsafePreservedHtmlTags = new Set([
  "script", "style", "template", "noscript", "iframe", "object", "embed", "svg", "canvas",
]);

function isElementNode(node) {
  return node?.type === "tag" || node?.type === "script" || node?.type === "style";
}

function walkElements(nodes, visit) {
  for (const node of nodes || []) {
    if (isElementNode(node)) {
      if (visit(node) === true) return node;
      const found = walkElements(node.children, visit);
      if (found) return found;
    }
  }
  return null;
}

function findById(document, id) {
  return walkElements(document.children, (node) => node.attribs?.id === id);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeTextContent(node) {
  if (node?.type === "text") return node.data || "";
  return (node?.children || []).map(nodeTextContent).join("");
}

function elementChildren(node) {
  return (node?.children || []).filter(isElementNode);
}

function findByDomPath(document, domPath) {
  if (!Array.isArray(domPath) || domPath.some((index) => !Number.isInteger(index) || index < 0)) {
    return null;
  }
  const body = walkElements(document.children, (node) => node.name === "body");
  if (!body) return null;

  let current = body;
  for (const index of domPath) {
    current = elementChildren(current)[index];
    if (!current) return null;
  }
  return current;
}

function matchesFingerprint(node, target) {
  if (typeof target.originalText !== "string") return true;
  return normalizeText(nodeTextContent(node)) === normalizeText(target.originalText);
}

function findTargetElement(document, target = {}) {
  const candidates = [];
  // selectorIndex and domPath disambiguate invalid HTML containing duplicate ids;
  // plain id lookup is retained only as the final compatibility fallback.
  if (target.selector) {
    try {
      const matches = selectAll(target.selector, document.children);
      candidates.push(matches[target.selectorIndex ?? 0] ?? null);
    } catch {
      candidates.push(null);
    }
  }

  candidates.push(findByDomPath(document, target.domPath));
  if (target.id) candidates.push(findById(document, target.id));
  const directMatch = candidates.find((node) => node && matchesFingerprint(node, target));
  if (directMatch) return directMatch;

  // 浏览器可能补全 body/tbody 等源码中不存在的包装节点，导致 selector 和
  // domPath 都失效。只有“标签 + 文本指纹”在源码中唯一时才允许回退。
  if (!/^[a-z][a-z0-9-]*$/i.test(target.tagName || "") || typeof target.originalText !== "string") {
    return null;
  }
  const fingerprintMatches = selectAll(target.tagName, document.children).filter((node) =>
    matchesFingerprint(node, target),
  );
  return fingerprintMatches.length === 1 ? fingerprintMatches[0] : null;
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSafeInlineStyleValue(property, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (property === "color") {
    return /^#[0-9a-f]{3,8}$/i.test(normalized)
      || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(normalized);
  }
  if (property === "font-size") return /^\d+(?:\.\d+)?px$/.test(normalized);
  if (property === "font-style") return /^(normal|italic)$/.test(normalized);
  if (property === "font-weight") return /^(normal|bold|[1-9]00)$/.test(normalized);
  if (property === "letter-spacing") return /^-?\d+(?:\.\d+)?px$/.test(normalized);
  if (property === "line-height") return /^\d+(?:\.\d+)?$/.test(normalized);
  if (property === "text-decoration-line") {
    return /^(none|underline|line-through|underline line-through|line-through underline)$/.test(normalized);
  }
  return false;
}

function isSafeInlineAttribute(name) {
  const normalized = String(name || "").toLowerCase();
  return ["class", "title", "lang", "dir", "role", "data-local-text-key"].includes(normalized)
    || normalized.startsWith("aria-");
}

// 字符级样式允许受控语义内联标签和白名单 style。解析后重新序列化，
// script、事件属性、URL 属性以及未知标签仍会拒绝整个 patch。
function sanitizeInlineHtml(value) {
  const fragment = parseDocument(String(value || ""), { decodeEntities: true });

  function sanitizeNodes(nodes) {
    let html = "";
    for (const node of nodes || []) {
      if (node.type === "text") {
        html += escapeText(node.data || "");
        continue;
      }
      if (!isElementNode(node) || !safeInlineHtmlTags.has(node.name)) return null;
      const attributes = Object.keys(node.attribs || {});
      if (attributes.some((name) => name.toLowerCase() !== "style" && !isSafeInlineAttribute(name))) {
        return null;
      }
      const declarations = parseStyle(node.attribs?.style || "");
      const safeDeclarations = [];
      for (const declaration of declarations) {
        const property = declaration.property.toLowerCase();
        if (!inlineTextStyleProperties.has(property)
          || !isSafeInlineStyleValue(property, declaration.value)) return null;
        safeDeclarations.push(`${property}: ${declaration.value}`);
      }
      const children = sanitizeNodes(node.children);
      if (children == null) return null;
      const safeAttributes = attributes
        .filter((name) => name.toLowerCase() !== "style")
        .map((name) => ` ${name}="${escapeAttribute(node.attribs[name])}"`)
        .join("");
      const styleAttribute = safeDeclarations.length === 0
        ? ""
        : ` style="${escapeAttribute(safeDeclarations.join("; "))}"`;
      html += `<${node.name}${safeAttributes}${styleAttribute}>${children}</${node.name}>`;
    }
    return html;
  }

  return sanitizeNodes(fragment.children);
}

function isEditorTextSpan(node) {
  return node?.name === "span" && typeof node.attribs?.["data-local-text-key"] === "string";
}

function validateEditorTextSpan(node) {
  const attributes = Object.keys(node.attribs || {});
  if (attributes.some((name) => !["style", "data-local-text-key"].includes(name.toLowerCase()))) {
    return false;
  }
  for (const declaration of parseStyle(node.attribs?.style || "")) {
    const property = declaration.property.toLowerCase();
    if (!inlineTextStyleProperties.has(property)
      || !isSafeInlineStyleValue(property, declaration.value)) return false;
  }
  return true;
}

function structureTokens(nodes) {
  const tokens = [];

  function pushText() {
    if (tokens[tokens.length - 1] !== "#text") tokens.push("#text");
  }

  function visit(node) {
    if (node.type === "text") {
      pushText();
      return true;
    }
    if (node.type === "comment") {
      tokens.push(`#comment:${node.data || ""}`);
      return true;
    }
    if (!isElementNode(node) || unsafePreservedHtmlTags.has(node.name)) return false;
    if (isEditorTextSpan(node)) {
      if (!validateEditorTextSpan(node)) return false;
      return (node.children || []).every(visit);
    }
    const attributes = Object.entries(node.attribs || {})
      .map(([name, attributeValue]) => [name.toLowerCase(), attributeValue])
      .sort(([left], [right]) => left.localeCompare(right));
    tokens.push(`<${node.name}:${JSON.stringify(attributes)}>`);
    if (!(node.children || []).every(visit)) return false;
    tokens.push(`</${node.name}>`);
    return true;
  }

  return (nodes || []).every(visit) ? tokens : null;
}

// 对任意作者 HTML，只允许保留原有标签/属性并新增受控文字 span。把编辑器
// span 视作透明节点后，结构 token 必须与源码完全一致，链接和自定义元素不会丢失。
function preserveStructuredInlineHtml(sourceNode, value) {
  const proposed = parseDocument(String(value || ""), { decodeEntities: true });
  const sourceTokens = structureTokens(sourceNode.children);
  const proposedTokens = structureTokens(proposed.children);
  if (!sourceTokens || !proposedTokens
    || JSON.stringify(sourceTokens) !== JSON.stringify(proposedTokens)) return null;
  return String(value || "");
}

function parseStyle(styleText) {
  const declarations = [];
  for (const rawPart of String(styleText || "").split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const colonIndex = part.indexOf(":");
    if (colonIndex < 0) continue;
    const property = part.slice(0, colonIndex).trim();
    const value = part.slice(colonIndex + 1).trim();
    if (!property) continue;
    declarations.push({ property, value });
  }
  return declarations;
}

function patchStyleText(styleText, property, value) {
  const normalizedProperty = String(property || "").trim().toLowerCase();
  if (!allowedStyleProperties.has(normalizedProperty)) return null;

  const declarations = parseStyle(styleText);
  const existing = declarations.find(
    (declaration) => declaration.property.toLowerCase() === normalizedProperty,
  );

  if (value == null || value === "") {
    const next = declarations.filter(
      (declaration) => declaration.property.toLowerCase() !== normalizedProperty,
    );
    return next.map((declaration) => `${declaration.property}: ${declaration.value}`).join("; ");
  }

  if (existing) {
    existing.value = String(value);
  } else {
    declarations.push({ property: normalizedProperty, value: String(value) });
  }
  return declarations.map((declaration) => `${declaration.property}: ${declaration.value}`).join("; ");
}

function findOpenTagEnd(html) {
  let quote = null;
  for (let index = 0; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function readStyleFromOpeningTag(openingTag) {
  const match = openingTag.match(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
  if (!match) return "";
  const raw = match[1];
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function patchOpeningTagStyle(elementHtml, property, value) {
  const openEnd = findOpenTagEnd(elementHtml);
  if (openEnd < 0) return null;

  const openingTag = elementHtml.slice(0, openEnd + 1);
  const rest = elementHtml.slice(openEnd + 1);
  const currentStyle = readStyleFromOpeningTag(openingTag);
  const nextStyle = patchStyleText(currentStyle, property, value);
  if (nextStyle == null) return null;

  const styleAttrPattern = /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  const escapedStyle = escapeAttribute(nextStyle);

  if (styleAttrPattern.test(openingTag)) {
    const nextOpeningTag = nextStyle
      ? openingTag.replace(styleAttrPattern, ` style="${escapedStyle}"`)
      : openingTag.replace(styleAttrPattern, "");
    return `${nextOpeningTag}${rest}`;
  }

  if (!nextStyle) return elementHtml;

  const insertAt = openingTag.endsWith("/>") ? openingTag.length - 2 : openingTag.length - 1;
  const nextOpeningTag = `${openingTag.slice(0, insertAt)} style="${escapedStyle}"${openingTag.slice(insertAt)}`;
  return `${nextOpeningTag}${rest}`;
}

function patchOpeningTagId(elementHtml, id) {
  const normalizedId = String(id || "").trim();
  const openEnd = findOpenTagEnd(elementHtml);
  if (!normalizedId || openEnd < 0) return null;

  const openingTag = elementHtml.slice(0, openEnd + 1);
  const rest = elementHtml.slice(openEnd + 1);
  const idAttrPattern = /\sid\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  const idAttribute = ` id="${escapeAttribute(normalizedId)}"`;

  if (idAttrPattern.test(openingTag)) {
    return `${openingTag.replace(idAttrPattern, idAttribute)}${rest}`;
  }

  const insertAt = openingTag.endsWith("/>") ? openingTag.length - 2 : openingTag.length - 1;
  return `${openingTag.slice(0, insertAt)}${idAttribute}${openingTag.slice(insertAt)}${rest}`;
}

function hasElementChildren(node) {
  return (node.children || []).some(isElementNode);
}

function findClosingTagStart(elementHtml, tagName) {
  const closeTagPattern = new RegExp(`</\\s*${tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>\\s*$`, "i");
  const match = elementHtml.match(closeTagPattern);
  return match?.index ?? -1;
}

function patchTextContent(elementHtml, node, value) {
  if (hasElementChildren(node)) return null;

  const openEnd = findOpenTagEnd(elementHtml);
  const closeStart = findClosingTagStart(elementHtml, node.name);
  if (openEnd < 0 || closeStart < 0 || closeStart < openEnd) return null;

  return `${elementHtml.slice(0, openEnd + 1)}${escapeText(value ?? "")}${elementHtml.slice(closeStart)}`;
}

function patchInnerHtml(elementHtml, node, value) {
  const safeHtml = sanitizeInlineHtml(value) ?? preserveStructuredInlineHtml(node, value);
  if (safeHtml == null) return null;
  const openEnd = findOpenTagEnd(elementHtml);
  const closeStart = findClosingTagStart(elementHtml, node.name);
  if (openEnd < 0 || closeStart < 0 || closeStart < openEnd) return null;
  return `${elementHtml.slice(0, openEnd + 1)}${safeHtml}${elementHtml.slice(closeStart)}`;
}

function resolveNodePath(root, nodePath) {
  if (!Array.isArray(nodePath) || nodePath.some((index) => !Number.isInteger(index) || index < 0)) {
    return null;
  }
  let current = root;
  for (const index of nodePath) {
    current = current?.children?.[index];
    if (!current) return null;
  }
  return current;
}

function patchTextNodes(elementHtml, root, operations) {
  const replacements = [];
  for (const operation of operations) {
    const textNode = resolveNodePath(root, operation.nodePath);
    if (textNode?.type !== "text" || !Number.isInteger(textNode.startIndex)
      || !Number.isInteger(textNode.endIndex)) return null;
    if (typeof operation.originalValue === "string" && textNode.data !== operation.originalValue) {
      return null;
    }
    const start = textNode.startIndex - root.startIndex;
    const end = textNode.endIndex - root.startIndex + 1;
    if (start < 0 || end < start || end > elementHtml.length) return null;
    replacements.push({ start, end, value: escapeText(operation.value ?? "") });
  }

  replacements.sort((left, right) => right.start - left.start);
  let next = elementHtml;
  let previousStart = elementHtml.length;
  for (const replacement of replacements) {
    if (replacement.end > previousStart) return null;
    next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
    previousStart = replacement.start;
  }
  return next;
}

function patchElementHtml(elementHtml, node, operations) {
  const textNodeOperations = operations.filter((operation) => operation.type === "text-node-content");
  if (textNodeOperations.length > 0
    && operations.some((operation) => ["text-content", "inner-html", "duplicate-element", "delete-element"]
      .includes(operation.type))) return null;
  let next = textNodeOperations.length > 0
    ? patchTextNodes(elementHtml, node, textNodeOperations)
    : elementHtml;
  if (next == null) return null;

  for (const [index, operation] of operations.entries()) {
    if (operation.type === "text-node-content") continue;
    if (operation.type === "text-content") {
      const patched = patchTextContent(next, node, operation.value);
      if (patched == null) return null;
      next = patched;
      continue;
    }

    if (operation.type === "inline-style") {
      const patched = patchOpeningTagStyle(next, operation.property, operation.value);
      if (patched == null) return null;
      next = patched;
      continue;
    }

    if (operation.type === "inner-html") {
      const patched = patchInnerHtml(next, node, operation.value);
      if (patched == null) return null;
      next = patched;
      continue;
    }

    if (String(operation.type || "").startsWith("table-")
      && operations.length === 1
      && node.name === "table") {
      return patchTableElementHtml(next, node, operation);
    }

    // Structural operations replace the resolved source range and therefore
    // must be the final operation in one patch request.
    if (operation.type === "duplicate-element" && index === operations.length - 1) {
      const clone = patchOpeningTagId(next, operation.newId);
      return clone == null ? null : `${next}${clone}`;
    }

    if (operation.type === "delete-element" && index === operations.length - 1) {
      return "";
    }

    return null;
  }

  return next;
}

export function patchElementInHtml(source, target, operations = []) {
  const document = parseDocument(source, {
    // 浏览器 textContent 会解码 &amp; 等实体；这里同步解码，指纹才能一致。
    // htmlparser2 仍保留基于原始 source 的 startIndex/endIndex。
    decodeEntities: true,
    withStartIndices: true,
    withEndIndices: true,
  });
  const element = findTargetElement(document, target);
  if (!element || !Number.isInteger(element.startIndex) || !Number.isInteger(element.endIndex)) {
    return { html: source, matched: false, changed: false };
  }

  const duplicate = operations.find((operation) => operation.type === "duplicate-element");
  if (duplicate && findById(document, String(duplicate.newId || "").trim())) {
    return { html: source, matched: false, changed: false };
  }

  const originalElementHtml = source.slice(element.startIndex, element.endIndex + 1);
  const nextElementHtml = patchElementHtml(originalElementHtml, element, operations);
  if (nextElementHtml == null) {
    return { html: source, matched: false, changed: false };
  }

  const html =
    source.slice(0, element.startIndex) + nextElementHtml + source.slice(element.endIndex + 1);
  return {
    html,
    matched: true,
    changed: html !== source,
  };
}

// Apply a complete pending queue before writing anything to disk. A failed
// operation returns the original source so callers can keep Save atomic.
export function patchElementsInHtml(source, patches = []) {
  let html = source;
  let changed = false;

  for (const [index, patch] of patches.entries()) {
    if (!patch?.target || !Array.isArray(patch.operations)) {
      return { html: source, matched: false, changed: false, failedIndex: index };
    }
    const result = patchElementInHtml(html, patch.target, patch.operations);
    if (!result.matched) {
      return { html: source, matched: false, changed: false, failedIndex: index };
    }
    html = result.html;
    changed = changed || result.changed;
  }

  return { html, matched: true, changed };
}
