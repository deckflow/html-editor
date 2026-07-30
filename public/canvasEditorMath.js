function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function floatingPosition({
  anchorRect,
  popupWidth,
  popupHeight,
  viewportWidth,
  viewportHeight,
  align = "center",
  gap = 10,
  margin = 8,
}) {
  const edge = Math.max(0, finiteNumber(margin, 8));
  const width = Math.max(0, finiteNumber(popupWidth));
  const height = Math.max(0, finiteNumber(popupHeight));
  const anchorLeft = finiteNumber(anchorRect?.left);
  const anchorRight = finiteNumber(anchorRect?.right, anchorLeft + finiteNumber(anchorRect?.width));
  const anchorWidth = finiteNumber(anchorRect?.width, anchorRight - anchorLeft);
  const preferredLeft = align === "end"
    ? anchorRight - width
    : anchorLeft + (anchorWidth - width) / 2;
  const above = finiteNumber(anchorRect?.top) - height - finiteNumber(gap, 10);
  const preferredTop = above >= 0 ? above : finiteNumber(anchorRect?.bottom) + finiteNumber(gap, 10);

  return {
    left: clamp(preferredLeft, edge, finiteNumber(viewportWidth) - width - edge),
    top: clamp(preferredTop, edge, finiteNumber(viewportHeight) - height - edge),
  };
}

export function normalizeEditorUiScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function resizeFromHandle({
  side,
  startWidth,
  startLeft,
  deltaX,
  minWidth = 48,
  maxWidth = Number.POSITIVE_INFINITY,
}) {
  const width = finiteNumber(startWidth);
  const left = finiteNumber(startLeft);
  const delta = finiteNumber(deltaX);
  const minimum = Math.max(1, finiteNumber(minWidth, 48));
  const parsedMaximum = Number(maxWidth);
  const maximum = Number.isFinite(parsedMaximum) ? Math.max(minimum, parsedMaximum) : Infinity;
  const nextWidth = clamp(side === "left" ? width - delta : width + delta, minimum, maximum);
  return {
    width: nextWidth,
    left: side === "left" ? left + width - nextWidth : left,
  };
}

export function resizeMaxWidthForViewport({
  side,
  startWidth,
  rectLeft,
  rectRight,
  viewportWidth,
  margin = 4,
}) {
  const edge = Math.max(0, finiteNumber(margin, 4));
  const availableWidth = side === "left"
    ? finiteNumber(rectRight) - edge
    : finiteNumber(viewportWidth) - finiteNumber(rectLeft) - edge;

  // When the authored box already exceeds the visible viewport, treating the
  // smaller available width as a maximum makes the first pointer move jump or
  // appear frozen. Leave that axis unconstrained so both shrinking and growing
  // continue from the actual rendered width.
  return availableWidth >= finiteNumber(startWidth)
    ? availableWidth
    : Number.POSITIVE_INFINITY;
}

export function moveFromPointer({
  startLeft,
  startTop,
  deltaX,
  deltaY,
  startRectLeft,
  startRectTop,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = 4,
}) {
  let appliedX = finiteNumber(deltaX);
  let appliedY = finiteNumber(deltaY);
  const canBound = [startRectLeft, startRectTop, width, height, viewportWidth, viewportHeight]
    .every((value) => Number.isFinite(Number(value)));
  if (canBound) {
    const edge = Math.max(0, finiteNumber(margin, 4));
    const viewport = {
      width: finiteNumber(viewportWidth),
      height: finiteNumber(viewportHeight),
    };
    const size = {
      width: finiteNumber(width),
      height: finiteNumber(height),
    };

    // A box larger than the viewport cannot satisfy both edge constraints.
    // Keep that axis following the pointer instead of collapsing its range and
    // pinning the element to zero while the snap guides continue to move.
    if (size.width <= viewport.width - edge * 2) {
      const visualLeft = clamp(
        finiteNumber(startRectLeft) + appliedX,
        edge,
        viewport.width - size.width - edge,
      );
      appliedX = visualLeft - finiteNumber(startRectLeft);
    }
    if (size.height <= viewport.height - edge * 2) {
      const visualTop = clamp(
        finiteNumber(startRectTop) + appliedY,
        edge,
        viewport.height - size.height - edge,
      );
      appliedY = visualTop - finiteNumber(startRectTop);
    }
  }
  return {
    left: finiteNumber(startLeft) + appliedX,
    top: finiteNumber(startTop) + appliedY,
  };
}

export function moveHandlePlacement({ top, viewportTop = 0, clearance = 10 }) {
  const availableTopSpace = finiteNumber(top) - finiteNumber(viewportTop);
  return availableTopSpace < Math.max(0, finiteNumber(clearance, 10)) ? "inside" : "outside";
}

export function positionStart({
  position,
  computedValue,
  inlineValue,
  offsetValue,
  rectValue,
}) {
  if (position === "static") return 0;
  const computed = String(computedValue || "").trim();
  if (computed && computed !== "auto") return finiteNumber(Number.parseFloat(computed), 0);
  const inline = String(inlineValue || "").trim();
  if (inline && inline !== "auto") return finiteNumber(Number.parseFloat(inline), 0);
  if (position === "fixed") return finiteNumber(rectValue, 0);
  if (position === "absolute") return finiteNumber(offsetValue, 0);
  return 0;
}

export function toggleDecoration(value, token) {
  const supported = ["underline", "line-through"];
  const active = new Set(String(value || "").split(/\s+/).filter((item) => supported.includes(item)));
  if (active.has(token)) active.delete(token);
  else if (supported.includes(token)) active.add(token);
  const result = supported.filter((item) => active.has(item));
  return result.length > 0 ? result.join(" ") : "none";
}

export function toggleFontStyle(value) {
  return String(value || "").toLowerCase() === "italic" ? "normal" : "italic";
}

export function toggleFontWeight(value) {
  const normalized = String(value || "").toLowerCase();
  const weight = normalized === "bold" ? 700 : Number.parseFloat(normalized);
  return Number.isFinite(weight) && weight >= 600 ? "400" : "700";
}

export function lineHeightRatio(lineHeight, fontSize) {
  if (String(lineHeight).trim() === "normal") return 1.2;
  const parsed = Number.parseFloat(lineHeight);
  if (!Number.isFinite(parsed)) return 1.2;
  if (String(lineHeight).trim().endsWith("px")) {
    const size = finiteNumber(fontSize, 16);
    return size > 0 ? Number((parsed / size).toFixed(2)) : 1.2;
  }
  return parsed;
}

export function createUniqueCopyId(existingIds, baseId) {
  const ids = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const base = String(baseId || "text").trim() || "text";
  const first = `${base}-copy`;
  if (!ids.has(first)) return first;
  let suffix = 2;
  while (ids.has(`${first}-${suffix}`)) suffix += 1;
  return `${first}-${suffix}`;
}
