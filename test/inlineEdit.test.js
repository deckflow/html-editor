import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInlineEditAttributes,
  removeInlineEditAttributes,
  normalizeInlineEditText,
  shouldCommitInlineEdit,
  shouldCancelInlineEdit,
} from "../public/inlineEdit.js";
import * as elementTarget from "../public/inlineEdit.js";

function createElementStub(textContent = "Hello") {
  const attrs = new Map();
  return {
    textContent,
    attrs,
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
  };
}

test("applyInlineEditAttributes enables plaintext editing markers", () => {
  const el = createElementStub();

  applyInlineEditAttributes(el);

  assert.equal(el.getAttribute("contenteditable"), "plaintext-only");
  assert.equal(el.getAttribute("spellcheck"), "false");
  assert.equal(el.getAttribute("data-local-editor-editing"), "true");
});

test("applyInlineEditAttributes preserves markup for mixed text roots", () => {
  const el = createElementStub();
  applyInlineEditAttributes(el, { preserveMarkup: true });
  assert.equal(el.getAttribute("contenteditable"), "true");
});

test("removeInlineEditAttributes removes editor-only markers", () => {
  const el = createElementStub();
  applyInlineEditAttributes(el);

  removeInlineEditAttributes(el);

  assert.equal(el.getAttribute("contenteditable"), null);
  assert.equal(el.getAttribute("spellcheck"), null);
  assert.equal(el.getAttribute("data-local-editor-editing"), null);
});

test("restores pre-existing inline edit attributes after editing", () => {
  assert.equal(typeof elementTarget.captureInlineEditAttributes, "function");
  assert.equal(typeof elementTarget.restoreInlineEditAttributes, "function");
  const el = createElementStub();
  el.setAttribute("contenteditable", "true");
  el.setAttribute("spellcheck", "true");
  el.setAttribute("data-local-editor-editing", "user-value");
  const snapshot = elementTarget.captureInlineEditAttributes(el);

  applyInlineEditAttributes(el);
  elementTarget.restoreInlineEditAttributes(el, snapshot);

  assert.equal(el.getAttribute("contenteditable"), "true");
  assert.equal(el.getAttribute("spellcheck"), "true");
  assert.equal(el.getAttribute("data-local-editor-editing"), "user-value");
});

test("normalizeInlineEditText trims non-breaking whitespace around edited text", () => {
  assert.equal(normalizeInlineEditText("\n  Edited copy \u00a0"), "Edited copy");
});

test("normalizeInlineEditText collapses source indentation into visible text spacing", () => {
  assert.equal(
    normalizeInlineEditText(`
      Click any text in the preview, change the words, tune the size, nudge the position,
      then save the edited HTML back to disk.
    `),
    "Click any text in the preview, change the words, tune the size, nudge the position, then save the edited HTML back to disk.",
  );
});

test("normalizeTextChunks collapses source indentation while preserving inline node boundaries", () => {
  assert.equal(typeof elementTarget.normalizeTextChunks, "function");
  assert.deepEqual(
    elementTarget.normalizeTextChunks([
      "\n          Click any text ",
      " in the preview,\n          change it",
      "\n        ",
    ]),
    ["Click any text ", "in the preview, change it", ""],
  );
});

test("isSimpleTextElement rejects containers with child elements", () => {
  assert.equal(typeof elementTarget.isSimpleTextElement, "function");
  assert.equal(elementTarget.isSimpleTextElement({ textContent: "Simple", children: [] }), true);
  assert.equal(
    elementTarget.isSimpleTextElement({ textContent: "Hello world", children: [{}] }),
    false,
  );
  assert.equal(elementTarget.isSimpleTextElement({ textContent: "   ", children: [] }), false);
});

test("isEditableTextRoot keeps a paragraph with safe inline style spans as one target", () => {
  assert.equal(typeof elementTarget.isEditableTextRoot, "function");
  const styledSpan = {
    tagName: "SPAN",
    textContent: "styled",
    children: [],
    getAttributeNames: () => ["style"],
  };
  const paragraph = { textContent: "plain styled text", children: [styledSpan] };

  assert.equal(elementTarget.isEditableTextRoot(paragraph), true);
  assert.equal(
    elementTarget.isEditableTextRoot({
      textContent: "label",
      children: [{ tagName: "STRONG", textContent: "label", children: [], getAttributeNames: () => [] }],
    }),
    false,
  );
});

function textElement(tagName, textContent, children = [], parentElement = null) {
  const element = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    textContent,
    children,
    parentElement,
    getAttributeNames: () => [],
  };
  for (const child of children) child.parentElement = element;
  return element;
}

test("resolves code and summary as text fields inside structural containers", () => {
  assert.equal(typeof elementTarget.resolveEditableTextTarget, "function");

  const article = textElement("article", "pipeline_defs/");
  const code = textElement("code", "pipeline_defs/", [], article);
  article.children = [code];

  const details = textElement("details", "Question Answer");
  const summary = textElement("summary", "Question", [], details);
  details.children = [summary];

  assert.equal(elementTarget.resolveEditableTextTarget(code), code);
  assert.equal(elementTarget.resolveEditableTextTarget(summary), summary);
  assert.equal(elementTarget.resolveEditableTextTarget(article), null);
  assert.equal(elementTarget.resolveEditableTextTarget(details), null);
});

test("resolves semantic inline leaves without replacing their parent structure", () => {
  const paragraph = textElement("p", "Hello bold code");
  const bold = textElement("b", "bold", [], paragraph);
  const code = textElement("code", "code", [], paragraph);
  paragraph.children = [bold, code];

  assert.equal(elementTarget.resolveEditableTextTarget(bold), bold);
  assert.equal(elementTarget.resolveEditableTextTarget(code), code);
});

test("resolves mixed direct text and semantic inline markup as one editable root", () => {
  const strong = textElement("strong", "讲法提示：");
  const directText = { nodeType: 3, textContent: "说明层像制作手册。" };
  const root = textElement("div", "讲法提示：说明层像制作手册。", [strong]);
  root.childNodes = [strong, directText];
  strong.parentElement = root;

  assert.equal(elementTarget.isEditableMixedTextRoot(root), true);
  assert.equal(elementTarget.resolveEditableTextTarget(root), root);
  assert.equal(elementTarget.resolveEditableTextTarget(strong), root);
});

test("preserves authored whitespace for code-like text fields", () => {
  assert.equal(elementTarget.preservesTextWhitespace({ tagName: "CODE" }), true);
  assert.equal(elementTarget.preservesTextWhitespace({ tagName: "PRE" }), true);
  assert.equal(elementTarget.preservesTextWhitespace({ tagName: "SUMMARY" }), false);
});

test("converts a computed rgb color to a color input hex value", () => {
  assert.equal(typeof elementTarget.cssColorToHex, "function");
  assert.equal(elementTarget.cssColorToHex("rgb(18, 110, 99)"), "#126e63");
  assert.equal(elementTarget.cssColorToHex("rgba(194, 65, 58, 0.5)"), "#c2413a");
  assert.equal(elementTarget.cssColorToHex("#ABC"), "#aabbcc");
});

test("builds a stable target for the second no-id element", () => {
  assert.equal(typeof elementTarget.createElementTarget, "function");

  const doc = { body: null, querySelectorAll: () => [] };
  const body = { children: [], parentElement: null, ownerDocument: doc };
  const first = {
    id: "",
    tagName: "P",
    parentElement: body,
    ownerDocument: doc,
    textContent: "First",
  };
  const second = {
    id: "",
    tagName: "P",
    parentElement: body,
    ownerDocument: doc,
    textContent: "Second",
  };
  body.children = [first, second];
  doc.body = body;
  doc.querySelectorAll = (selector) => (selector === "body > p" ? [first, second] : []);

  assert.deepEqual(elementTarget.createElementTarget(second, "body > p"), {
    tagName: "p",
    selector: "body > p",
    selectorIndex: 1,
    domPath: [1],
    originalText: "Second",
  });
});

test("keeps id as the strongest locator while retaining safety metadata", () => {
  assert.equal(typeof elementTarget.createElementTarget, "function");

  const doc = { body: null, querySelectorAll: () => [] };
  const body = { children: [], parentElement: null, ownerDocument: doc };
  const heading = {
    id: "hero",
    tagName: "H1",
    parentElement: body,
    ownerDocument: doc,
    textContent: "  Hello   world  ",
  };
  body.children = [heading];
  doc.body = body;
  doc.querySelectorAll = () => [heading];

  assert.deepEqual(elementTarget.createElementTarget(heading, "#hero"), {
    id: "hero",
    tagName: "h1",
    selector: "#hero",
    selectorIndex: 0,
    domPath: [0],
    originalText: "Hello world",
  });
});

test("shouldCommitInlineEdit accepts meta enter and ctrl enter", () => {
  assert.equal(shouldCommitInlineEdit({ key: "Enter", metaKey: true, ctrlKey: false }), true);
  assert.equal(shouldCommitInlineEdit({ key: "Enter", metaKey: false, ctrlKey: true }), true);
  assert.equal(shouldCommitInlineEdit({ key: "Enter", metaKey: false, ctrlKey: false }), false);
});

test("shouldCancelInlineEdit only accepts escape", () => {
  assert.equal(shouldCancelInlineEdit({ key: "Escape" }), true);
  assert.equal(shouldCancelInlineEdit({ key: "Enter" }), false);
});

test("fixed-width text without an authored wrap rule needs consistent wrapping", () => {
  assert.equal(typeof elementTarget.shouldEnsureFixedWidthWrap, "function");
  assert.equal(
    elementTarget.shouldEnsureFixedWidthWrap({
      style: { width: "360px", overflowWrap: "" },
    }),
    true,
  );
  assert.equal(
    elementTarget.shouldEnsureFixedWidthWrap({
      style: { width: "360px", overflowWrap: "anywhere" },
    }),
    false,
  );
  assert.equal(
    elementTarget.shouldEnsureFixedWidthWrap({
      style: { width: "", overflowWrap: "" },
    }),
    false,
  );
});

test("detects horizontal text overflow after contenteditable is removed", () => {
  assert.equal(typeof elementTarget.isTextHorizontallyOverflowing, "function");
  assert.equal(
    elementTarget.isTextHorizontallyOverflowing({ clientWidth: 360, scrollWidth: 640 }),
    true,
  );
  assert.equal(
    elementTarget.isTextHorizontallyOverflowing({ clientWidth: 360, scrollWidth: 360 }),
    false,
  );
  assert.equal(
    elementTarget.isTextHorizontallyOverflowing({ clientWidth: 0, scrollWidth: 640 }),
    false,
  );
});
