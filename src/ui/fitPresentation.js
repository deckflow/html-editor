import { normalizeFitMode } from "../editor/fit.js";

export function resolveMountedFitMode({ fit = "none", scaleToFit } = {}) {
  if (scaleToFit == null) return normalizeFitMode(fit);
  if (typeof scaleToFit !== "boolean") {
    throw new TypeError("scaleToFit must be a boolean");
  }
  return scaleToFit ? "width" : "none";
}

export function mountedOverflowForFitMode(mode) {
  return normalizeFitMode(mode) === "none" ? "auto" : "hidden";
}

export function originalFrameSize({
  availableWidth,
  availableHeight,
  contentWidth,
  contentHeight,
}) {
  return {
    width: Math.max(1, availableWidth || 0, contentWidth || 0),
    height: Math.max(1, availableHeight || 0, contentHeight || 0),
  };
}
