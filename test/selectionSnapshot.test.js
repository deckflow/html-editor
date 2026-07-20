import assert from "node:assert/strict";
import test from "node:test";

const snapshotModule = await import("../public/selectionSnapshot.js").catch(() => ({}));

function styleDeclaration(values = {}) {
  const entries = Object.entries(values);
  return {
    length: entries.length,
    item(index) {
      return entries[index]?.[0] || "";
    },
    getPropertyValue(property) {
      return values[property] || "";
    },
  };
}

function elementStub({
  tagName = "P",
  textContent = "Hello world",
  inlineStyles = {},
  computedStyles = {},
  rect = { left: 10, top: 20, right: 110, bottom: 60, width: 100, height: 40 },
} = {}) {
  const element = {
    nodeType: 1,
    tagName,
    textContent,
    isConnected: true,
    children: [],
    childNodes: [],
    parentElement: null,
    style: styleDeclaration(inlineStyles),
    getBoundingClientRect: () => rect,
    getAttributeNames: () => [],
    getAttribute: () => null,
    contains(node) {
      let current = node;
      while (current) {
        if (current === element) return true;
        current = current.parentElement;
      }
      return false;
    },
  };
  element.ownerDocument = {
    defaultView: {
      getComputedStyle(target) {
        return styleDeclaration(target.__computedStyles || computedStyles);
      },
    },
  };
  return element;
}

test("createSelectionKey uses file and stable target identity", () => {
  assert.equal(typeof snapshotModule.createSelectionKey, "function");
  assert.equal(
    snapshotModule.createSelectionKey("samples/demo.html", {
      id: "headline",
      selector: "#headline",
      selectorIndex: 0,
    }),
    "samples/demo.html|id:headline|0",
  );
});

test("buildSelectionSnapshot captures root geometry, styles, and identity", () => {
  assert.equal(typeof snapshotModule.buildSelectionSnapshot, "function");
  const element = elementStub({
    inlineStyles: { color: "red" },
    computedStyles: { color: "rgb(255, 0, 0)", "font-size": "24px" },
  });
  const target = { id: "copy", originalText: "Hello world" };
  const snapshot = snapshotModule.buildSelectionSnapshot({
    path: "samples/demo.html",
    element,
    target,
    selector: "#copy",
  });

  assert.equal(snapshot.key, "samples/demo.html|id:copy|0");
  assert.equal(snapshot.element, element);
  assert.equal(snapshot.target, target);
  assert.deepEqual(snapshot.boundingBox, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(snapshot.inlineStyles.color, "red");
  assert.equal(snapshot.computedStyles.color, "rgb(255, 0, 0)");
  assert.equal(snapshot.computedStyles["font-size"], "24px");
  assert.equal(snapshot.rangeStyle, null);
});

test("buildSelectionSnapshot reads range style from its real styled node", () => {
  const root = elementStub();
  const span = elementStub({ tagName: "SPAN" });
  span.parentElement = root;
  span.ownerDocument = root.ownerDocument;
  span.__computedStyles = { "font-style": "italic", "font-weight": "700" };
  root.children = [span];
  root.childNodes = [span];
  const range = {
    collapsed: false,
    startContainer: root,
    startOffset: 0,
    commonAncestorContainer: root,
    getBoundingClientRect: () => ({ left: 15, top: 25, width: 30, height: 12 }),
  };

  const snapshot = snapshotModule.buildSelectionSnapshot({
    path: "samples/demo.html",
    element: root,
    target: { selector: "p", selectorIndex: 0 },
    selector: "p",
    range,
  });

  assert.equal(snapshot.rangeStyle.styles["font-style"], "italic");
  assert.equal(snapshot.rangeStyle.styles["font-weight"], "700");
  assert.deepEqual(snapshot.rangeStyle.boundingBox, { x: 15, y: 25, width: 30, height: 12 });
});

test("resolveRangeStyleElement stops at a styled span but descends from the selected root", () => {
  const root = elementStub();
  const span = elementStub({ tagName: "SPAN" });
  const nested = elementStub({ tagName: "SPAN" });
  span.parentElement = root;
  nested.parentElement = span;
  root.children = [span];
  root.childNodes = [span];
  span.children = [nested];
  span.childNodes = [nested];

  assert.equal(snapshotModule.resolveRangeStyleElement({ startContainer: root, startOffset: 0 }, root), span);
  assert.equal(snapshotModule.resolveRangeStyleElement({ startContainer: span, startOffset: 0 }, root), span);
});

test("collapsed and out-of-root ranges do not create range style", () => {
  const root = elementStub();
  const outside = elementStub();
  assert.equal(
    snapshotModule.buildSelectionSnapshot({
      path: "sample.html",
      element: root,
      target: { selector: "p" },
      selector: "p",
      range: { collapsed: true, startContainer: root },
    }).rangeStyle,
    null,
  );
  assert.equal(
    snapshotModule.buildSelectionSnapshot({
      path: "sample.html",
      element: root,
      target: { selector: "p" },
      selector: "p",
      range: { collapsed: false, startContainer: outside, commonAncestorContainer: outside },
    }).rangeStyle,
    null,
  );
});

test("collectTextFields preserves mixed direct text and styled span order", () => {
  assert.equal(typeof snapshotModule.collectTextFields, "function");
  const root = elementStub({ textContent: "Hello styled" });
  const directText = { nodeType: 3, textContent: "Hello ", data: "Hello ", parentElement: root };
  const span = elementStub({ tagName: "SPAN", textContent: "styled", inlineStyles: { color: "red" } });
  span.parentElement = root;
  span.ownerDocument = root.ownerDocument;
  span.getAttributeNames = () => ["style"];
  root.children = [span];
  root.childNodes = [directText, span];

  const fields = snapshotModule.collectTextFields(root);
  assert.deepEqual(fields.map((field) => field.source), ["text-node", "child"]);
  assert.deepEqual(fields.map((field) => field.value), ["Hello ", "styled"]);
  assert.equal(fields[1].inlineStyles.color, "red");
});

test("rebuilding a snapshot refreshes live values while preserving stable identity", () => {
  const element = elementStub({ computedStyles: { color: "black" } });
  const target = { id: "copy", originalText: "Hello world" };
  const first = snapshotModule.buildSelectionSnapshot({
    path: "samples/demo.html",
    element,
    target,
    selector: "#copy",
  });

  element.textContent = "Updated text";
  element.__computedStyles = { color: "rgb(194, 65, 58)" };
  element.getBoundingClientRect = () => ({ left: 20, top: 30, width: 140, height: 50 });
  const second = snapshotModule.buildSelectionSnapshot({
    path: "samples/demo.html",
    element,
    target,
    selector: "#copy",
  });

  assert.equal(second.key, first.key);
  assert.equal(second.target, first.target);
  assert.equal(second.textContent, "Updated text");
  assert.equal(second.computedStyles.color, "rgb(194, 65, 58)");
  assert.deepEqual(second.boundingBox, { x: 20, y: 30, width: 140, height: 50 });
});
