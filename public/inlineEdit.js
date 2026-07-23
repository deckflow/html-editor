import {
  isEditableMixedTextRoot,
  isEditableTextRoot,
  resolveEditableTextTarget,
} from "./textFieldModel.js?v=editor-interactions-v4";

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
export {
  isEditableMixedTextRoot,
  isEditableTextRoot,
  resolveEditableTextTarget,
} from "./textFieldModel.js?v=editor-interactions-v4";
