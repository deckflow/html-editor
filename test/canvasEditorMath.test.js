import test from "node:test";
import assert from "node:assert/strict";

const math = await import("../public/canvasEditorMath.js").catch(() => ({}));

test("right resize changes width without moving the left edge", () => {
  assert.equal(typeof math.resizeFromHandle, "function");
  assert.deepEqual(
    math.resizeFromHandle({ side: "right", startWidth: 200, startLeft: 12, deltaX: 35 }),
    { width: 235, left: 12 },
  );
});

test("left resize keeps the visual right edge fixed", () => {
  assert.deepEqual(
    math.resizeFromHandle({ side: "left", startWidth: 200, startLeft: 12, deltaX: 35 }),
    { width: 165, left: 47 },
  );
});

test("resize respects minimum width and adjusts left by the applied delta", () => {
  assert.deepEqual(
    math.resizeFromHandle({
      side: "left",
      startWidth: 100,
      startLeft: 10,
      deltaX: 90,
      minWidth: 48,
    }),
    { width: 48, left: 62 },
  );
});

test("resize respects the available viewport width", () => {
  assert.deepEqual(
    math.resizeFromHandle({
      side: "right",
      startWidth: 200,
      startLeft: 10,
      deltaX: 200,
      maxWidth: 260,
    }),
    { width: 260, left: 10 },
  );
});

test("move applies pointer deltas to the starting position", () => {
  assert.equal(typeof math.moveFromPointer, "function");
  assert.deepEqual(
    math.moveFromPointer({ startLeft: 8, startTop: -4, deltaX: 24, deltaY: 11 }),
    { left: 32, top: 7 },
  );
});

test("move keeps the visual element inside viewport margins", () => {
  assert.deepEqual(
    math.moveFromPointer({
      startLeft: 10,
      startTop: 10,
      deltaX: -100,
      deltaY: 500,
      startRectLeft: 20,
      startRectTop: 20,
      width: 100,
      height: 50,
      viewportWidth: 300,
      viewportHeight: 200,
      margin: 4,
    }),
    { left: -6, top: 136 },
  );
});

test("positionStart reads computed and positioned-element offsets without jumping", () => {
  assert.equal(typeof math.positionStart, "function");
  assert.equal(
    math.positionStart({ position: "relative", computedValue: "24px", inlineValue: "", offsetValue: 80, rectValue: 90 }),
    24,
  );
  assert.equal(
    math.positionStart({ position: "absolute", computedValue: "auto", inlineValue: "", offsetValue: 80, rectValue: 90 }),
    80,
  );
  assert.equal(
    math.positionStart({ position: "fixed", computedValue: "auto", inlineValue: "", offsetValue: 80, rectValue: 90 }),
    90,
  );
  assert.equal(
    math.positionStart({ position: "static", computedValue: "auto", inlineValue: "", offsetValue: 80, rectValue: 90 }),
    0,
  );
});

test("toggleDecoration independently toggles underline and line-through", () => {
  assert.equal(typeof math.toggleDecoration, "function");
  assert.equal(math.toggleDecoration("none", "underline"), "underline");
  assert.equal(math.toggleDecoration("underline", "line-through"), "underline line-through");
  assert.equal(math.toggleDecoration("underline line-through", "underline"), "line-through");
  assert.equal(math.toggleDecoration("line-through", "line-through"), "none");
});

test("font toggles turn the selected range style on and off", () => {
  assert.equal(typeof math.toggleFontStyle, "function");
  assert.equal(typeof math.toggleFontWeight, "function");
  assert.equal(math.toggleFontStyle("normal"), "italic");
  assert.equal(math.toggleFontStyle("italic"), "normal");
  assert.equal(math.toggleFontWeight("400"), "700");
  assert.equal(math.toggleFontWeight("700"), "400");
  assert.equal(math.toggleFontWeight("bold"), "400");
});

test("lineHeightRatio handles normal, pixel, and unitless computed values", () => {
  assert.equal(typeof math.lineHeightRatio, "function");
  assert.equal(math.lineHeightRatio("normal", 24), 1.2);
  assert.equal(math.lineHeightRatio("36px", 24), 1.5);
  assert.equal(math.lineHeightRatio("1.4", 24), 1.4);
});

test("createUniqueCopyId avoids every existing id collision", () => {
  assert.equal(typeof math.createUniqueCopyId, "function");
  const existing = new Set(["hero", "hero-copy", "hero-copy-2", "text-copy"]);
  assert.equal(math.createUniqueCopyId(existing, "hero"), "hero-copy-3");
  assert.equal(math.createUniqueCopyId(existing, ""), "text-copy-2");
});

test("floatingPosition right-aligns an action menu above the selected element", () => {
  assert.equal(typeof math.floatingPosition, "function");
  assert.deepEqual(
    math.floatingPosition({
      anchorRect: { left: 26, right: 448, top: 58, bottom: 310, width: 422 },
      popupWidth: 80,
      popupHeight: 42,
      viewportWidth: 640,
      viewportHeight: 480,
      align: "end",
    }),
    { left: 368, top: 8 },
  );
});

test("floatingPosition centers a style menu on the text range and keeps it in viewport", () => {
  assert.deepEqual(
    math.floatingPosition({
      anchorRect: { left: 2, right: 62, top: 4, bottom: 28, width: 60 },
      popupWidth: 180,
      popupHeight: 46,
      viewportWidth: 320,
      viewportHeight: 200,
      align: "center",
    }),
    { left: 8, top: 38 },
  );
});
