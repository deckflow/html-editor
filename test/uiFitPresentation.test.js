import assert from "node:assert/strict";
import test from "node:test";

import {
  mountedOverflowForFitMode,
  originalFrameSize,
  resolveMountedFitMode,
} from "../src/ui/fitPresentation.js";

test("scaleToFit is a boolean shorthand for width and original modes", () => {
  assert.equal(resolveMountedFitMode({ scaleToFit: true }), "width");
  assert.equal(resolveMountedFitMode({ scaleToFit: false }), "none");
  assert.equal(resolveMountedFitMode({ fit: "contain" }), "contain");
  assert.throws(
    () => resolveMountedFitMode({ scaleToFit: "yes" }),
    /scaleToFit must be a boolean/,
  );
});

test("original mode scrolls while fitted modes clip the scaled iframe", () => {
  assert.equal(mountedOverflowForFitMode("none"), "auto");
  assert.equal(mountedOverflowForFitMode("width"), "hidden");
  assert.equal(mountedOverflowForFitMode("contain"), "hidden");
});

test("original frame expands to content without becoming smaller than its host", () => {
  assert.deepEqual(originalFrameSize({
    availableWidth: 640,
    availableHeight: 480,
    contentWidth: 1920,
    contentHeight: 1080,
  }), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(originalFrameSize({
    availableWidth: 1280,
    availableHeight: 720,
    contentWidth: 800,
    contentHeight: 600,
  }), {
    width: 1280,
    height: 720,
  });
});
