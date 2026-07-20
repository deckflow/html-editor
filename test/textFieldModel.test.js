import test from "node:test";
import assert from "node:assert/strict";
import {
  collectEditableTextFields,
  planTextFieldContentOperations,
  resolveEditableTextTarget,
  textStructureSignature,
} from "../public/textFieldModel.js";

function text(value) {
  return { nodeType: 3, data: value, textContent: value, parentElement: null };
}

function element(tagName, children = [], attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    children: children.filter((child) => child.nodeType === 1),
    parentElement: null,
    attributes: [...attrs].map(([name, value]) => ({ name, value })),
    get textContent() {
      return this.childNodes.map((child) => child.textContent || "").join("");
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    querySelector() {
      return null;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

test("resolves text leaves by DOM capability instead of a tag allowlist", () => {
  const button = element("button", [text("Save")]);
  const custom = element("deckflow-action", [text("Publish")]);

  assert.equal(resolveEditableTextTarget(button), button);
  assert.equal(resolveEditableTextTarget(custom), custom);
  assert.deepEqual(collectEditableTextFields(button).map((field) => field.source), ["self"]);
  assert.deepEqual(collectEditableTextFields(custom).map((field) => field.value), ["Publish"]);
});

test("keeps a structural container out while resolving its text child", () => {
  const heading = element("h1", [text("Title")]);
  const paragraph = element("p", [text("Body")]);
  const section = element("section", [heading, paragraph]);

  assert.equal(resolveEditableTextTarget(section), null);
  assert.equal(resolveEditableTextTarget(heading), heading);
});

test("models footer mixed content as stable text fields", () => {
  const firstLink = element("a", [text("GitHub")], { href: "https://example.com/repo" });
  const secondLink = element("a", [text("Guide")], { href: "https://example.com/guide" });
  const footer = element("footer", [
    text("参考资料："),
    firstLink,
    text("，"),
    secondLink,
    text("。"),
  ]);

  assert.equal(resolveEditableTextTarget(firstLink), footer);
  const fields = collectEditableTextFields(footer);
  assert.deepEqual(fields.map((field) => field.source), [
    "text-node", "child", "text-node", "child", "text-node",
  ]);
  assert.deepEqual(fields.map((field) => field.nodePath), [[0], [1, 0], [2], [3, 0], [4]]);
  assert.deepEqual(fields.map((field) => field.value), ["参考资料：", "GitHub", "，", "Guide", "。"]);
});

test("excludes executable and replaced content from text capabilities", () => {
  assert.equal(resolveEditableTextTarget(element("script", [text("alert(1)")])), null);
  assert.equal(resolveEditableTextTarget(element("style", [text("body{}")])) , null);
  assert.equal(resolveEditableTextTarget(element("textarea", [text("value")])), null);
});

test("plans path-addressed text node operations without changing structure", () => {
  const footer = element("footer", [text("Before"), element("a", [text("Link")])]);
  const before = collectEditableTextFields(footer);
  footer.childNodes[0].data = "After";
  footer.childNodes[0].textContent = "After";
  const after = collectEditableTextFields(footer);

  assert.deepEqual(planTextFieldContentOperations(before, after), [{
    type: "text-node-content",
    nodePath: [0],
    originalValue: "Before",
    value: "After",
  }]);
  assert.equal(textStructureSignature(footer), textStructureSignature(footer));
  assert.equal(planTextFieldContentOperations(before, after.slice(0, 1)), null);
});

test("structure signatures ignore text values but preserve element attributes", () => {
  const link = element("a", [text("Before")], { href: "/docs" });
  const root = element("footer", [text("See "), link]);
  const before = textStructureSignature(root);
  link.childNodes[0].data = "After";
  link.childNodes[0].textContent = "After";
  assert.equal(textStructureSignature(root), before);

  link.attributes[0].value = "/changed";
  assert.notEqual(textStructureSignature(root), before);
});
