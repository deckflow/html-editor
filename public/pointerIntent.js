const NON_CANVAS_TAGS = new Set(["HTML", "BODY", "HEAD", "SCRIPT", "STYLE", "LINK", "META"]);

export function pointInsideRect(x, y, rect, tolerance = 1) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.left - tolerance
    && x <= rect.right + tolerance
    && y >= rect.top - tolerance
    && y <= rect.bottom + tolerance;
}

// Text nodes do not participate in event.target. Range rectangles let us distinguish
// a glyph line from padding and other empty space inside the same element box.
export function pointHitsRenderedText(element, x, y) {
  const doc = element?.ownerDocument;
  if (!doc?.createTreeWalker || !doc?.createRange) return false;
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(element, showText);
  const range = doc.createRange();

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node?.data?.trim()) continue;
    const parent = node.parentElement;
    if (parent?.closest?.("script, style, template, noscript")) continue;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects?.() || [])) {
      if (pointInsideRect(x, y, rect)) {
        range.detach?.();
        return true;
      }
    }
  }

  range.detach?.();
  return false;
}

export function dragTargetAtPoint({
  target,
  x,
  y,
  selection = null,
  inlineEditingElement = null,
}) {
  if (inlineEditingElement || (selection && !selection.isCollapsed)) return null;
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  if (!element || NON_CANVAS_TAGS.has(element.tagName)) return null;
  if (element.closest?.("[data-local-editor-ui]")) return null;
  // event.target is the most specific rendered box under the pointer. Keeping a
  // previously selected ancestor here makes every nested box impossible to
  // select, resize, or move. The ancestor remains available through its own
  // uncovered area and the editor's dedicated move handle.
  return pointHitsRenderedText(element, x, y) ? null : element;
}
