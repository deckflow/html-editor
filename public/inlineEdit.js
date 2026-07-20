export function applyInlineEditAttributes(el, { preserveMarkup = false } = {}) {
  el.setAttribute("contenteditable", preserveMarkup ? "true" : "plaintext-only");
  el.setAttribute("spellcheck", "false");
  el.setAttribute("data-local-editor-editing", "true");
}

export function removeInlineEditAttributes(el) {
  el.removeAttribute("contenteditable");
  el.removeAttribute("spellcheck");
  el.removeAttribute("data-local-editor-editing");
}

const inlineEditAttributeNames = [
  "contenteditable",
  "spellcheck",
  "data-local-editor-editing",
];

export function captureInlineEditAttributes(el) {
  return Object.fromEntries(
    inlineEditAttributeNames.map((name) => [
      name,
      { present: el.hasAttribute(name), value: el.getAttribute(name) },
    ]),
  );
}

export function restoreInlineEditAttributes(el, snapshot) {
  for (const name of inlineEditAttributeNames) {
    const saved = snapshot?.[name];
    if (saved?.present) el.setAttribute(name, saved.value ?? "");
    else el.removeAttribute(name);
  }
}

export function normalizeInlineEditText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTextChunks(chunks) {
  let hasVisibleText = false;
  let previousEndsWithSpace = false;
  const normalized = Array.from(chunks || [], (chunk) => {
    let value = String(chunk || "").replace(/\s+/g, " ");
    if (!hasVisibleText) value = value.trimStart();
    if (previousEndsWithSpace && value.startsWith(" ")) value = value.slice(1);
    if (value) hasVisibleText = true;
    previousEndsWithSpace = value.endsWith(" ");
    return value;
  });
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (!normalized[index]) continue;
    normalized[index] = normalized[index].trimEnd();
    break;
  }
  return normalized;
}

// 老版本调整宽度时没有保存 overflow-wrap。再次编辑这类固定宽度文本时，
// 补上明确的断行规则，保证 contenteditable 移除前后的排版一致。
export function shouldEnsureFixedWidthWrap(el) {
  return Boolean(el?.style?.width) && !String(el?.style?.overflowWrap || "").trim();
}

export function isTextHorizontallyOverflowing(el) {
  const clientWidth = Number(el?.clientWidth) || 0;
  const scrollWidth = Number(el?.scrollWidth) || 0;
  return clientWidth > 0 && scrollWidth > clientWidth + 1;
}

// input[type="color"] 只接受 #rrggbb；浏览器的 computedStyle.color
// 通常返回 rgb()/rgba()，这里统一转成颜色控件可直接使用的格式。
export function cssColorToHex(value, fallback = "#000000") {
  const normalized = String(value || "").trim().toLowerCase();
  const shortHex = normalized.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return `#${[...shortHex[1]].map((digit) => digit + digit).join("")}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;

  const rgb = normalized.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!rgb) return fallback;
  const hex = rgb.slice(1, 4).map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel))))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${hex.join("")}`;
}

export function isSimpleTextElement(el) {
  return Boolean(el?.textContent?.trim()) && (el.children?.length || 0) === 0;
}

// 与 HyperFrames 的 text-bearing capability 类似：先区分“可编辑文字字段”
// 和 article/section/details 这类结构容器，再由点击节点向上解析真实文字目标。
// preferred root 可以容纳编辑器生成的安全 span；leaf tags 用于已有语义内联标签。
const preferredTextRootTags = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "a", "button", "li", "label",
  "blockquote", "pre", "figcaption", "caption", "dt", "dd", "th", "td",
  "legend", "output", "summary", "code",
  "div",
]);

const safeInlineSemanticTags = new Set([
  "span", "strong", "b", "em", "i", "u", "s", "small", "code", "kbd", "samp",
  "var", "mark", "sub", "sup", "time", "abbr", "cite", "q",
]);

const textBearingLeafTags = new Set([
  ...preferredTextRootTags,
  "span", "div", "strong", "b", "em", "i", "u", "s", "small",
  "kbd", "samp", "var", "mark", "sub", "sup", "time", "abbr", "cite", "q",
]);

const nonEditableTextTags = new Set([
  "html", "body", "head", "main", "section", "article", "aside", "nav",
  "header", "footer", "details", "script", "style", "link", "meta", "template",
  "img", "video", "audio", "canvas", "svg", "input", "textarea", "select", "option",
]);

export function isEditableTextRoot(el) {
  if (!el?.textContent?.trim()) return false;
  const children = Array.from(el.children || []);
  if (children.length === 0) return true;
  return children.every((child) => {
    if (String(child.tagName || "").toUpperCase() !== "SPAN") return false;
    const attributeNames = child.getAttributeNames?.() || [];
    if (attributeNames.some((name) =>
      !["style", "data-local-text-key"].includes(name.toLowerCase()))) return false;
    return isEditableTextRoot(child);
  });
}

function isSafeInlineSemanticTree(el) {
  const tagName = String(el?.tagName || "").toLowerCase();
  if (!safeInlineSemanticTags.has(tagName)) return false;
  return Array.from(el.children || []).every(isSafeInlineSemanticTree);
}

// Mixed content 对应 HyperFrames 的多个 textFields：容器必须含直属可见文本，
// 其余子元素只能是安全的语义内联树，避免把 card/section 误判成一段文字。
export function isEditableMixedTextRoot(el) {
  if (!el?.textContent?.trim()) return false;
  const hasDirectText = Array.from(el.childNodes || []).some(
    (node) => node.nodeType === 3 && node.textContent?.trim(),
  );
  const children = Array.from(el.children || []);
  const hasStableTextFields = children.some((child) =>
    child.hasAttribute?.("data-local-text-key")
      || child.querySelector?.("[data-local-text-key]"),
  );
  return children.length > 0
    && (hasDirectText || hasStableTextFields)
    && children.every(isSafeInlineSemanticTree);
}

export function resolveEditableTextTarget(target) {
  if (!target || target.nodeType !== 1) return null;

  // 优先选择外层文字块，使编辑器生成的 span 仍归属于原段落；code 和 summary
  // 也属于独立文字根，因此 article > code、details > summary 可以直接编辑。
  let current = target;
  while (current && current.nodeType === 1) {
    const tagName = String(current.tagName || "").toLowerCase();
    if (preferredTextRootTags.has(tagName)
      && (isEditableTextRoot(current) || isEditableMixedTextRoot(current))) return current;
    current = current.parentElement;
  }

  // 外层文字块包含既有语义标签时，退回最近的纯文字叶子，保留原来的
  // b/strong/code 等标签，而不是把父容器 textContent 整体覆盖。
  current = target;
  while (current && current.nodeType === 1) {
    const tagName = String(current.tagName || "").toLowerCase();
    if (nonEditableTextTags.has(tagName)) {
      current = current.parentElement;
      continue;
    }
    if (textBearingLeafTags.has(tagName) && isSimpleTextElement(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function preservesTextWhitespace(el) {
  const tagName = String(el?.tagName || "").toUpperCase();
  return ["PRE", "CODE", "KBD", "SAMP"].includes(tagName);
}

// 记录元素相对 body 的元素索引路径。路径只统计 element children，
// 与浏览器的 parent.children 以及服务端 htmlparser2 的元素节点遍历保持一致。
function domPathFromBody(el) {
  const body = el?.ownerDocument?.body;
  if (!body || el === body) return el === body ? [] : null;

  const path = [];
  let node = el;
  while (node && node !== body) {
    const parent = node.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children || []).indexOf(node);
    if (index < 0) return null;
    path.unshift(index);
    node = parent;
  }
  return node === body ? path : null;
}

// 任意 HTML 不一定提供 id，因此 target 同时携带多个定位信号：
// id/selector 用于快速定位，domPath 用于回退，originalText 用于防止误写。
export function createElementTarget(el, selector) {
  const target = { tagName: String(el.tagName || "").toLowerCase() };
  if (el.id) target.id = el.id;
  if (selector) {
    target.selector = selector;
    try {
      target.selectorIndex = Array.from(el.ownerDocument.querySelectorAll(selector)).indexOf(el);
    } catch {
      target.selectorIndex = -1;
    }
  }

  const domPath = domPathFromBody(el);
  if (domPath) target.domPath = domPath;
  target.originalText = normalizeInlineEditText(el.textContent);
  return target;
}

export function shouldCommitInlineEdit(event) {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}

export function shouldCancelInlineEdit(event) {
  return event.key === "Escape";
}
