const INLINE_STYLE_PROPERTIES = new Set([
  "color",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-decoration-line",
]);

const SEMANTIC_INLINE_TAGS = new Set([
  "strong", "b", "em", "i", "u", "s", "small", "code", "kbd", "samp", "var",
  "mark", "sub", "sup", "time", "abbr", "cite", "q",
]);

let generatedKeySequence = 0;

// 与 HyperFrames Studio 的 data-hf-text-key 类似，字段 key 会被写入 HTML，
// 让一次选区拆分后的文字片段在失焦、重选和保存后仍有稳定身份。
function nextTextFieldKey() {
  generatedKeySequence += 1;
  return `local-text-${Date.now().toString(36)}-${generatedKeySequence}`;
}

function escapeText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sameField(field, value, key, inlineStyles = field.inlineStyles) {
  return { ...field, key, value, inlineStyles: { ...inlineStyles } };
}

function stylesWithChanges(styles, changes) {
  const next = { ...styles };
  for (const { property, value } of changes || []) {
    if (!INLINE_STYLE_PROPERTIES.has(property)) continue;
    if (value == null || value === "") delete next[property];
    else next[property] = String(value);
  }
  return next;
}

export function splitTextFieldsForStyle(
  fields,
  selectionStart,
  selectionEnd,
  changes,
  createKey = nextTextFieldKey,
) {
  // 原生 Range 只在入口处被换算成 [start, end)；后续样式更新只操作字段数据。
  // 被选中的片段保留原 key，拆出的前后片段领取新 key，避免 toggle 时重新定位失败。
  const start = Math.max(0, Math.min(selectionStart, selectionEnd));
  const end = Math.max(start, Math.max(selectionStart, selectionEnd));
  const nextFields = [];
  const selectedKeys = [];
  let cursor = 0;

  for (const field of fields || []) {
    const value = String(field.value || "");
    const fieldStart = cursor;
    const fieldEnd = fieldStart + value.length;
    const overlapStart = Math.max(start, fieldStart);
    const overlapEnd = Math.min(end, fieldEnd);
    cursor = fieldEnd;

    if (overlapStart >= overlapEnd) {
      nextFields.push(sameField(field, value, field.key));
      continue;
    }

    const localStart = overlapStart - fieldStart;
    const localEnd = overlapEnd - fieldStart;
    const before = value.slice(0, localStart);
    const selected = value.slice(localStart, localEnd);
    const after = value.slice(localEnd);

    if (before) nextFields.push(sameField(field, before, createKey()));
    nextFields.push(
      sameField(field, selected, field.key, stylesWithChanges(field.inlineStyles, changes)),
    );
    selectedKeys.push(field.key);
    if (after) nextFields.push(sameField(field, after, createKey()));
  }

  return { fields: nextFields, selectedKeys };
}

export function serializeTextFields(fields) {
  // 始终输出同级 span，不输出嵌套 span。这样 text-decoration 等不可被子元素
  // `none` 抵消的继承/绘制规则不会造成“状态已取消但视觉仍存在”。
  return (fields || []).map((field) => {
    const style = Object.entries(field.inlineStyles || {})
      .filter(([property, value]) => INLINE_STYLE_PROPERTIES.has(property) && value !== "")
      .map(([property, value]) => `${property}: ${value}`)
      .join("; ");
    const styleAttribute = style ? ` style="${escapeAttribute(style)}"` : "";
    let html = `<span data-local-text-key="${escapeAttribute(field.key)}"${styleAttribute}>`
      + `${escapeText(field.value)}</span>`;
    for (const wrapper of [...(field.semanticWrappers || [])].reverse()) {
      if (!SEMANTIC_INLINE_TAGS.has(wrapper.tagName)) continue;
      const attributes = (wrapper.attributes || [])
        .map(({ name, value }) => ` ${name}="${escapeAttribute(value)}"`)
        .join("");
      html = `<${wrapper.tagName}${attributes}>${html}</${wrapper.tagName}>`;
    }
    return html;
  }).join("");
}

function isSafeWrapperAttribute(name) {
  const normalized = String(name || "").toLowerCase();
  return ["class", "title", "lang", "dir", "role"].includes(normalized)
    || normalized.startsWith("aria-");
}

function readSemanticWrappers(node, root) {
  const wrappers = [];
  let current = node?.parentElement;
  while (current && current !== root) {
    const tagName = current.tagName.toLowerCase();
    if (SEMANTIC_INLINE_TAGS.has(tagName)) {
      wrappers.unshift({
        tagName,
        attributes: Array.from(current.attributes || [])
          .filter((attribute) => isSafeWrapperAttribute(attribute.name))
          .map((attribute) => ({ name: attribute.name, value: attribute.value })),
      });
    }
    current = current.parentElement;
  }
  return wrappers;
}

function readInlineStyles(element, root) {
  const ancestors = [];
  let current = element?.parentElement;
  while (current && current !== root) {
    ancestors.unshift(current);
    current = current.parentElement;
  }

  const styles = {};
  for (const ancestor of ancestors) {
    for (let index = 0; index < ancestor.style.length; index += 1) {
      const property = ancestor.style.item(index);
      if (INLINE_STYLE_PROPERTIES.has(property)) {
        styles[property] = ancestor.style.getPropertyValue(property).trim();
      }
    }
  }
  return styles;
}

export function collectFormattingTextFields(element) {
  // 兼容第一次编辑的纯文本，以及已经由编辑器生成的字段 span。
  // 遇到旧版本产生的嵌套 span 时会合并祖先内联样式，下一次提交后自动扁平化。
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, doc.defaultView.NodeFilter.SHOW_TEXT);
  const fields = [];
  const usedKeys = new Set();
  let textIndex = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.data) continue;
    const keyOwner = node.parentElement?.closest?.("[data-local-text-key]");
    let key = keyOwner && element.contains(keyOwner)
      ? keyOwner.getAttribute("data-local-text-key")
      : `text-node:${textIndex}`;
    if (!key || usedKeys.has(key)) key = nextTextFieldKey();
    usedKeys.add(key);
    fields.push({
      key,
      value: node.data,
      inlineStyles: readInlineStyles(node, element),
      semanticWrappers: readSemanticWrappers(node, element),
    });
    textIndex += 1;
  }
  return fields;
}

function rangeOffset(element, container, offset) {
  const measure = element.ownerDocument.createRange();
  measure.selectNodeContents(element);
  measure.setEnd(container, offset);
  const length = measure.toString().length;
  measure.detach?.();
  return length;
}

function restoreRange(element, selectedKeys) {
  const selectedElements = Array.from(element.querySelectorAll("[data-local-text-key]"))
    .filter((field) => selectedKeys.includes(field.getAttribute("data-local-text-key")));
  if (selectedElements.length === 0) return null;

  const first = selectedElements[0];
  const last = selectedElements[selectedElements.length - 1];
  const firstText = first.firstChild || first;
  const lastText = last.lastChild || last;
  const range = element.ownerDocument.createRange();
  range.setStart(firstText, 0);
  range.setEnd(lastText, lastText.nodeType === 3 ? lastText.data.length : lastText.childNodes.length);
  const selection = element.ownerDocument.defaultView.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

export function applyRangeStylesAsTextFields(element, range, changes) {
  if (!element || !range || range.collapsed) return null;
  if (!element.contains(range.commonAncestorContainer)) return null;

  // Range 只提供本次用户意图；DOM 重建后立即创建新 Range，旧引用不进入状态或历史。
  const fields = collectFormattingTextFields(element);
  const start = rangeOffset(element, range.startContainer, range.startOffset);
  const end = rangeOffset(element, range.endContainer, range.endOffset);
  const next = splitTextFieldsForStyle(fields, start, end, changes);
  if (next.selectedKeys.length === 0) return null;

  element.innerHTML = serializeTextFields(next.fields);
  const nextRange = restoreRange(element, next.selectedKeys);
  return {
    fields: next.fields,
    selectedKeys: next.selectedKeys,
    html: element.innerHTML,
    range: nextRange,
  };
}
