import test from "node:test";
import assert from "node:assert/strict";
import {
  dragTargetAtPoint,
  pointHitsRenderedText,
  pointInsideRect,
  summaryDisclosureTargetAtPoint,
} from "../public/pointerIntent.js";

function createElement({ tagName = "DIV", textRects = [] } = {}) {
  const textNode = { nodeType: 3, data: "Editable text", parentElement: null, rects: textRects };
  const ranges = [];
  const doc = {
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    createTreeWalker() {
      let visited = false;
      return {
        currentNode: null,
        nextNode() {
          if (visited) return false;
          visited = true;
          this.currentNode = textNode;
          return true;
        },
      };
    },
    createRange() {
      const range = {
        node: null,
        selectNodeContents(node) { this.node = node; },
        getClientRects() { return this.node?.rects || []; },
        detach() {},
      };
      ranges.push(range);
      return range;
    },
  };
  const element = {
    nodeType: 1,
    tagName,
    ownerDocument: doc,
    closest(selector) {
      return selector === "[data-local-editor-ui]" && this.editorUi ? this : null;
    },
  };
  textNode.parentElement = element;
  return element;
}

test("pointInsideRect includes the rendered edge tolerance", () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 };
  assert.equal(pointInsideRect(50, 30, rect), true);
  assert.equal(pointInsideRect(111, 30, rect), true);
  assert.equal(pointInsideRect(113, 30, rect), false);
});

test("rendered text blocks box dragging while padding remains draggable", () => {
  const element = createElement({
    textRects: [{ left: 20, top: 20, right: 120, bottom: 40, width: 100, height: 20 }],
  });
  assert.equal(pointHitsRenderedText(element, 60, 30), true);
  assert.equal(pointHitsRenderedText(element, 180, 30), false);
  assert.equal(dragTargetAtPoint({ target: element, x: 60, y: 30 }), null);
  assert.equal(dragTargetAtPoint({ target: element, x: 180, y: 30 }), element);
});

test("active text editing or a non-collapsed selection disables box dragging", () => {
  const element = createElement();
  assert.equal(dragTargetAtPoint({
    target: element,
    x: 10,
    y: 10,
    selection: { isCollapsed: false },
  }), null);
  assert.equal(dragTargetAtPoint({
    target: element,
    x: 10,
    y: 10,
    inlineEditingElement: element,
  }), null);
});

test("document roots and editor UI are never canvas drag targets", () => {
  assert.equal(dragTargetAtPoint({ target: createElement({ tagName: "BODY" }), x: 1, y: 1 }), null);
  const ui = createElement();
  ui.editorUi = true;
  assert.equal(dragTargetAtPoint({ target: ui, x: 1, y: 1 }), null);
});

test("summary disclosure space keeps its native toggle interaction", () => {
  const summary = createElement({
    tagName: "SUMMARY",
    textRects: [{ left: 20, top: 20, right: 140, bottom: 40, width: 120, height: 20 }],
  });
  summary.closest = (selector) => {
    if (selector === "summary") return summary;
    return null;
  };

  assert.equal(summaryDisclosureTargetAtPoint({ target: summary, x: 200, y: 30 }), summary);
  assert.equal(summaryDisclosureTargetAtPoint({ target: summary, x: 80, y: 30 }), null);
  assert.equal(dragTargetAtPoint({ target: summary, x: 200, y: 30 }), summary);
  assert.equal(dragTargetAtPoint({ target: summary, x: 80, y: 30 }), null);
});
