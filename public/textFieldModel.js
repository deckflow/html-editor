const excludedTextTags = new Set([
  "html", "body", "head", "script", "style", "link", "meta", "template", "noscript",
  "iframe", "object", "embed", "canvas", "svg", "img", "video", "audio", "source",
  "track", "input", "textarea", "select", "option",
]);

const editorAttributeNames = new Set([
  "contenteditable",
  "spellcheck",
  "data-local-editor-editing",
  "data-local-editor-selected",
]);

function tagNameOf(element) {
  return String(element?.tagName || "").toLowerCase();
}

function nodeText(node) {
  return String(node?.data ?? node?.textContent ?? "");
}

function childNodesOf(node) {
  return Array.from(node?.childNodes || []);
}

export function isExcludedTextElement(element) {
  return !element || (element.nodeType != null && element.nodeType !== 1)
    || excludedTextTags.has(tagNameOf(element));
}

export function hasDirectVisibleText(element) {
  if (isExcludedTextElement(element)) return false;
  return childNodesOf(element).some((node) => node.nodeType === 3 && nodeText(node).trim());
}

function hasExcludedAncestor(node, root) {
  let current = node?.parentElement;
  while (current && current !== root) {
    if (isExcludedTextElement(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function fieldSource(root, textNode) {
  if ((root.children?.length || 0) === 0) return "self";
  return textNode.parentElement === root ? "text-node" : "child";
}

// HyperFrames 将选中元素的文字拆成 self / child / text-node 字段。这里不再
// 猜测标签语义，而是遍历真实 Text Node；nodePath 同时作为浏览器和服务端的定位契约。
export function collectEditableTextFields(root) {
  if (isExcludedTextElement(root)) return [];
  const fields = [];

  function visit(node, path) {
    if (node.nodeType === 3) {
      const value = nodeText(node);
      if (!value.trim() || hasExcludedAncestor(node, root)) return;
      const source = fieldSource(root, node);
      fields.push({
        key: `${source}:${path.join(".")}`,
        source,
        value,
        nodePath: path,
        tagName: source === "text-node" ? "#text" : tagNameOf(node.parentElement || root),
      });
      return;
    }
    if (node.nodeType !== 1 || (node !== root && isExcludedTextElement(node))) return;
    const childNodes = childNodesOf(node);
    // DOM test doubles and lightweight adapters may expose textContent without
    // materializing Text nodes. Use the path a real DOM text child would have.
    if (childNodes.length === 0 && String(node.textContent || "").trim()) {
      const textPath = [...path, 0];
      const source = node === root ? "self" : "child";
      fields.push({
        key: `${source}:${textPath.join(".")}`,
        source,
        value: String(node.textContent),
        nodePath: textPath,
        tagName: tagNameOf(node),
      });
      return;
    }
    childNodes.forEach((child, index) => visit(child, [...path, index]));
  }

  const rootChildren = childNodesOf(root);
  if (rootChildren.length === 0 && String(root.textContent || "").trim()) {
    fields.push({
      key: "self:0",
      source: "self",
      value: String(root.textContent),
      nodePath: [0],
      tagName: tagNameOf(root),
    });
  } else {
    rootChildren.forEach((child, index) => visit(child, [index]));
  }
  return fields;
}

function isGeneratedTextFieldRoot(element) {
  const children = Array.from(element?.children || []);
  return children.length > 0 && children.every((child) =>
    child.hasAttribute?.("data-local-text-key")
      || Boolean(child.querySelector?.("[data-local-text-key]"))
      || (tagNameOf(child) === "span"
        && (child.getAttributeNames?.() || []).every((name) =>
          ["style", "data-local-text-key"].includes(name.toLowerCase()))),
  );
}

export function isEditableTextRoot(element) {
  if (isExcludedTextElement(element) || !String(element.textContent || "").trim()) return false;
  return (element.children?.length || 0) === 0 || isGeneratedTextFieldRoot(element);
}

export function isEditableMixedTextRoot(element) {
  if (isExcludedTextElement(element) || !String(element.textContent || "").trim()) return false;
  return ((element.children?.length || 0) > 0 && hasDirectVisibleText(element))
    || isGeneratedTextFieldRoot(element);
}

// 混合文字根优先于它的内联子节点，和 HyperFrames 的一个 selection + 多个
// textFields 模型一致；若没有混合根，则最近的任意纯文字叶子就是编辑目标。
export function resolveEditableTextTarget(start) {
  if (!start || start.nodeType !== 1) return null;

  let current = start;
  while (current && current.nodeType === 1) {
    if (isEditableMixedTextRoot(current)) return current;
    current = current.parentElement;
  }

  current = start;
  while (current && current.nodeType === 1) {
    if (isEditableTextRoot(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function stableAttributes(element) {
  return Array.from(element?.attributes || [])
    .filter((attribute) => !editorAttributeNames.has(attribute.name.toLowerCase()))
    .map((attribute) => [attribute.name.toLowerCase(), attribute.value])
    .sort(([left], [right]) => left.localeCompare(right));
}

// 文案编辑只允许改变 Text Node 内容。提交前后结构签名不同，说明浏览器的
// contenteditable 插入了标签或删除了节点，此时必须拒绝保存，避免破坏任意 HTML。
export function textStructureSignature(root) {
  function describe(node) {
    if (node.nodeType === 3) return "#text";
    if (node.nodeType === 8) return `#comment:${node.data || ""}`;
    if (node.nodeType !== 1) return `#node:${node.nodeType}`;
    const attributes = JSON.stringify(stableAttributes(node));
    return `<${tagNameOf(node)}${attributes}>${childNodesOf(node).map(describe).join("")}`
      + `</${tagNameOf(node)}>`;
  }
  return childNodesOf(root).map(describe).join("");
}

export function planTextFieldContentOperations(originalFields, nextFields) {
  if (originalFields.length !== nextFields.length) return null;
  const operations = [];
  for (let index = 0; index < originalFields.length; index += 1) {
    const before = originalFields[index];
    const after = nextFields[index];
    if (before.key !== after.key || before.source !== after.source
      || JSON.stringify(before.nodePath) !== JSON.stringify(after.nodePath)) return null;
    if (before.value === after.value) continue;
    operations.push({
      type: "text-node-content",
      nodePath: [...before.nodePath],
      originalValue: before.value,
      value: after.value,
    });
  }
  return operations;
}
