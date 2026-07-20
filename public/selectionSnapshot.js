export const TEXT_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration-line",
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rectangle(rect) {
  return {
    x: Number(rect?.left) || 0,
    y: Number(rect?.top) || 0,
    width: Number(rect?.width) || 0,
    height: Number(rect?.height) || 0,
  };
}

function readStyleDeclaration(style) {
  const values = {};
  for (let index = 0; index < (style?.length || 0); index += 1) {
    const property = style.item(index);
    if (property) values[property] = style.getPropertyValue(property).trim();
  }
  return values;
}

function readComputedStyles(element) {
  const computed = element?.ownerDocument?.defaultView?.getComputedStyle(element);
  return Object.fromEntries(
    TEXT_STYLE_PROPERTIES.map((property) => [property, computed?.getPropertyValue(property)?.trim() || ""]),
  );
}

const safeInlineTextTags = new Set([
  "span", "strong", "b", "em", "i", "u", "s", "small", "code", "kbd", "samp",
  "var", "mark", "sub", "sup", "time", "abbr", "cite", "q",
]);

function isSafeInlineTextElement(element) {
  const tagName = String(element?.tagName || "").toLowerCase();
  if (!safeInlineTextTags.has(tagName)) return false;
  return Array.from(element.children || []).every(isSafeInlineTextElement);
}

function fieldForElement(element, index, source) {
  const tagName = String(element.tagName || "span").toLowerCase();
  return {
    key: element.getAttribute?.("data-local-text-key") || `${source}:${index}:${tagName}`,
    value: element.textContent || "",
    tagName,
    source,
    inlineStyles: readStyleDeclaration(element.style),
    computedStyles: readComputedStyles(element),
  };
}

export function collectTextFields(element) {
  if (!element?.textContent?.trim()) return [];
  const children = Array.from(element.children || []);
  if (children.length === 0) return [fieldForElement(element, 0, "self")];
  if (!children.every(isSafeInlineTextElement)) return [];

  const fields = [];
  let index = 0;
  for (const node of Array.from(element.childNodes || [])) {
    if (node.nodeType === 3 && node.textContent?.trim()) {
      fields.push({
        key: `text-node:${index}`,
        value: node.textContent,
        tagName: "#text",
        source: "text-node",
        inlineStyles: {},
        computedStyles: {},
      });
      index += 1;
      continue;
    }
    if (node.nodeType === 1 && isSafeInlineTextElement(node)) {
      fields.push(fieldForElement(node, index, "child"));
      index += 1;
    }
  }
  return fields;
}

export function createSelectionKey(path, target = {}) {
  const identity = target.id
    ? `id:${target.id}`
    : target.hfId
      ? `hf:${target.hfId}`
      : target.selector
        ? `selector:${target.selector}`
        : `path:${JSON.stringify(target.domPath || [])}`;
  return `${path || "index.html"}|${identity}|${target.selectorIndex ?? 0}`;
}

export function resolveRangeStyleElement(range, selected) {
  if (!selected) return null;
  let node = range?.startContainer || selected;
  if (node === selected && node.childNodes?.length) {
    const offset = Math.max(0, Math.min(Number(range?.startOffset) || 0, node.childNodes.length - 1));
    node = node.childNodes[offset] || node;
  }
  while (node && node.nodeType !== 1) node = node.parentElement;
  return node && selected.contains?.(node) ? node : selected;
}

export function rangeBelongsToElement(range, element) {
  if (!range || range.collapsed || !element?.isConnected) return false;
  const common = range.commonAncestorContainer || range.startContainer;
  return Boolean(common && element.contains?.(common));
}

function buildRangeStyle(range, element) {
  if (!rangeBelongsToElement(range, element)) return null;
  const styleElement = resolveRangeStyleElement(range, element);
  return {
    styles: readComputedStyles(styleElement),
    boundingBox: rectangle(range.getBoundingClientRect?.()),
  };
}

export function buildSelectionSnapshot({ path, element, target, selector, range = null }) {
  if (!element?.isConnected) return null;
  return {
    key: createSelectionKey(path, target),
    element,
    target,
    selector,
    boundingBox: rectangle(element.getBoundingClientRect?.()),
    textContent: normalizeText(element.textContent),
    inlineStyles: readStyleDeclaration(element.style),
    computedStyles: readComputedStyles(element),
    textFields: collectTextFields(element),
    rangeStyle: buildRangeStyle(range, element),
  };
}
