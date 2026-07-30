import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFitScale,
  normalizeFitMode,
} from "../src/editor/fit.js";
import {
  calculateIframeOriginalSize,
  calculateIframeFitScale,
  isIframeFitRuntimeAttribute,
  normalizeIframeFitMode,
} from "../public/iframeFit.js";

test("normalizes fit modes and boolean shortcuts", () => {
  assert.equal(normalizeFitMode("none"), "none");
  assert.equal(normalizeFitMode("WIDTH"), "width");
  assert.equal(normalizeFitMode(true), "width");
  assert.equal(normalizeFitMode(false), "none");
  assert.throws(() => normalizeFitMode("cover"), /fit must be/);
});

test("width mode scales overflowing content without enlarging small pages", () => {
  assert.equal(calculateFitScale({
    mode: "width",
    availableWidth: 960,
    availableHeight: 600,
    contentWidth: 1920,
    contentHeight: 1080,
  }), 0.5);
  assert.equal(calculateFitScale({
    mode: "width",
    availableWidth: 1200,
    availableHeight: 600,
    contentWidth: 800,
    contentHeight: 1080,
  }), 1);
});

test("contain mode chooses the smaller width or height ratio", () => {
  assert.equal(calculateFitScale({
    mode: "contain",
    availableWidth: 1200,
    availableHeight: 540,
    contentWidth: 1920,
    contentHeight: 1080,
  }), 0.5);
});

test("none mode and the minimum scale remain bounded", () => {
  assert.equal(calculateFitScale({
    mode: "none",
    availableWidth: 100,
    availableHeight: 100,
    contentWidth: 10000,
    contentHeight: 10000,
  }), 1);
  assert.equal(calculateFitScale({
    mode: "width",
    availableWidth: 1,
    availableHeight: 1,
    contentWidth: 10000,
    contentHeight: 10000,
  }), 0.01);
});

test("standalone iframe fit uses the same mode and scale contract", () => {
  assert.equal(normalizeIframeFitMode(true), "width");
  assert.equal(normalizeIframeFitMode(false), "none");
  assert.equal(calculateIframeFitScale({
    mode: "width",
    availableWidth: 640,
    availableHeight: 480,
    contentWidth: 1280,
    contentHeight: 720,
  }), 0.5);
});

test("standalone original mode expands to fixed content and keeps the host minimum", () => {
  assert.deepEqual(calculateIframeOriginalSize({
    availableWidth: 607,
    availableHeight: 700,
    contentWidth: 1920,
    contentHeight: 1080,
  }), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(calculateIframeOriginalSize({
    availableWidth: 1200,
    availableHeight: 800,
    contentWidth: 900,
    contentHeight: 600,
  }), {
    width: 1200,
    height: 800,
  });
});

test("standalone fit ignores attributes owned by the editor runtime", () => {
  assert.equal(isIframeFitRuntimeAttribute("contenteditable"), true);
  assert.equal(isIframeFitRuntimeAttribute("spellcheck"), true);
  assert.equal(isIframeFitRuntimeAttribute("data-local-editor-selected"), true);
  assert.equal(isIframeFitRuntimeAttribute("style"), false);
  assert.equal(isIframeFitRuntimeAttribute("class"), false);
});
