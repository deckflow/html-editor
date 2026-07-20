import { cssColorToHex } from "./inlineEdit.js";
import { applyRangeStylesAsTextFields } from "./textFieldFormatting.js";
import {
  SNAP_THRESHOLD_PX,
  createSnapTarget,
  createViewportSnapTarget,
  keepGuidesAfterBounds,
  resolveSnapAdjustment,
} from "./snapEngine.js";
import {
  createUniqueCopyId,
  floatingPosition,
  lineHeightRatio,
  moveFromPointer,
  positionStart,
  resizeFromHandle,
  toggleDecoration,
  toggleFontStyle,
  toggleFontWeight,
} from "./canvasEditorMath.js";

const BLUE = "#1473e6";

const overlayStyles = `
  [data-local-editor-ui] {
    box-sizing: border-box;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
  }

  [data-local-editor-ui],
  [data-local-editor-ui] * {
    outline: none !important;
  }

  .local-editor-root {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
  }

  .local-editor-box {
    position: fixed;
    z-index: 1;
    display: none;
    border: 2px solid ${BLUE};
    pointer-events: none;
  }

  .local-editor-snap-guide {
    position: fixed;
    z-index: 0;
    display: none;
    background: rgba(255, 49, 190, 0.9);
    box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.72);
    pointer-events: none;
  }

  .local-editor-snap-guide[data-axis="x"] {
    top: 0;
    width: 1px;
    height: 100vh;
  }

  .local-editor-snap-guide[data-axis="y"] {
    left: 0;
    width: 100vw;
    height: 1px;
  }

  .local-editor-handle {
    position: absolute;
    border: 2px solid ${BLUE};
    background: #fff;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.16);
    pointer-events: auto;
    touch-action: none;
  }

  .local-editor-handle[data-handle="left"],
  .local-editor-handle[data-handle="right"] {
    top: 50%;
    width: 8px;
    height: 22px;
    border-radius: 5px;
    cursor: ew-resize;
    transform: translateY(-50%);
  }

  .local-editor-handle[data-handle="left"] { left: -5px; }
  .local-editor-handle[data-handle="right"] { right: -5px; }

  .local-editor-handle[data-handle="move"] {
    left: 50%;
    top: -7px;
    width: 16px;
    height: 8px;
    border-radius: 5px;
    background: ${BLUE};
    cursor: move;
    transform: translateX(-50%);
  }

  .local-editor-handle[data-handle="move"]::after {
    content: "";
    position: absolute;
    inset: 2px 5px;
    border-radius: 2px;
    background: #fff;
    opacity: 0.92;
  }

  .local-editor-toolbar,
  .local-editor-actions,
  .local-editor-spacing {
    position: fixed;
    z-index: 2;
    display: none;
    align-items: center;
    color: #252a31;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid #e4e7ec;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.16);
    pointer-events: auto;
  }

  .local-editor-toolbar {
    max-width: calc(100vw - 16px);
    min-height: 46px;
    padding: 5px 7px;
    gap: 3px;
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
  }

  .local-editor-toolbar::-webkit-scrollbar { display: none; }

  .local-editor-actions {
    min-height: 42px;
    padding: 5px;
    gap: 2px;
  }

  .local-editor-toolbar button,
  .local-editor-actions button,
  .local-editor-toolbar input,
  .local-editor-spacing input {
    box-sizing: border-box;
    font: inherit;
  }

  .local-editor-tool,
  .local-editor-action {
    width: 34px;
    height: 34px;
    min-height: 34px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #343942;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
  }

  .local-editor-tool:hover,
  .local-editor-action:hover,
  .local-editor-tool.is-active {
    color: #1268c4;
    background: #eaf3ff;
  }

  .local-editor-action[data-action="delete"]:hover {
    color: #d92d20;
    background: #fff0ee;
  }

  .local-editor-size {
    display: grid;
    grid-template-columns: 48px auto;
    align-items: center;
    height: 34px;
    padding: 0 6px;
    border-radius: 6px;
    background: #f6f7f9;
    color: #667085;
    font-size: 12px;
  }

  .local-editor-size input {
    width: 46px;
    height: 30px;
    padding: 0 3px;
    border: 0;
    outline: 0;
    background: transparent;
    color: #252a31;
    font-size: 13px;
  }

  .local-editor-divider {
    width: 1px;
    height: 24px;
    margin: 0 3px;
    background: #e4e7ec;
  }

  .local-editor-color {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 6px;
    cursor: pointer;
  }

  .local-editor-color:hover { background: #f2f4f7; }

  .local-editor-color span {
    font-size: 16px;
    font-weight: 700;
    text-decoration: underline 3px var(--local-editor-color, #111827);
    text-underline-offset: 4px;
  }

  .local-editor-color input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .local-editor-align-icon {
    display: grid;
    width: 15px;
    margin: auto;
    gap: 3px;
  }

  .local-editor-align-icon i {
    display: block;
    height: 1.5px;
    background: currentColor;
  }

  .local-editor-align-icon.is-center i:nth-child(2) { margin-inline: 3px; }
  .local-editor-align-icon.is-right i:nth-child(2) { margin-left: 6px; }
  .local-editor-align-icon.is-left i:nth-child(2) { margin-right: 6px; }

  .local-editor-spacing {
    width: 220px;
    padding: 14px;
    flex-direction: column;
    gap: 14px;
  }

  .local-editor-spacing-row { width: 100%; }

  .local-editor-spacing-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 7px;
    color: #4b5563;
    font-size: 12px;
  }

  .local-editor-spacing-label input {
    width: 56px;
    height: 28px;
    padding: 0 6px;
    border: 1px solid #e4e7ec;
    border-radius: 5px;
    color: #252a31;
    text-align: right;
  }

  .local-editor-spacing input[type="range"] {
    width: 100%;
    height: 4px;
    padding: 0;
    accent-color: ${BLUE};
  }
`;

function parseNumber(value, fallback = 0) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

const ignoredSnapTags = new Set([
  "base", "br", "link", "meta", "script", "source", "style", "template", "track", "wbr",
]);

function isVisibleSnapCandidate(element, selected, win) {
  if (element === selected || element.contains(selected) || selected.contains(element)) return false;
  if (element.closest("[data-local-editor-ui]")) return false;
  if (ignoredSnapTags.has(element.tagName.toLowerCase())) return false;

  let current = element;
  while (current && current !== element.ownerDocument.documentElement) {
    const computed = win.getComputedStyle(current);
    if (computed.display === "none" || computed.visibility === "hidden") return false;
    const opacity = Number.parseFloat(computed.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
    current = current.parentElement;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  return rect.right > 0
    && rect.bottom > 0
    && rect.left < win.innerWidth
    && rect.top < win.innerHeight;
}

function collectMoveSnapTargets(doc, win, selected, selectedRect, maxItems = 80) {
  const selectedCenterX = selectedRect.left + selectedRect.width / 2;
  const selectedCenterY = selectedRect.top + selectedRect.height / 2;
  const candidates = [];

  for (const [index, element] of Array.from(doc.body.querySelectorAll("*")).entries()) {
    if (!isVisibleSnapCandidate(element, selected, win)) continue;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    candidates.push({
      id: `element-${index}`,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      distance: (centerX - selectedCenterX) ** 2 + (centerY - selectedCenterY) ** 2,
    });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return [
    ...candidates.slice(0, maxItems).map(({ rect, id }) => createSnapTarget(rect, id)),
    createViewportSnapTarget(win.innerWidth, win.innerHeight),
  ];
}

function createUi(doc, runtimeId) {
  const style = doc.createElement("style");
  style.dataset.localEditorUi = "true";
  style.dataset.localEditorRuntime = runtimeId;
  style.textContent = overlayStyles;
  doc.head.appendChild(style);

  const root = doc.createElement("div");
  root.className = "local-editor-root";
  root.dataset.localEditorUi = "true";
  root.dataset.localEditorRuntime = runtimeId;
  root.innerHTML = `
    ${Array.from({ length: 6 }, () => '<div class="local-editor-snap-guide" data-local-editor-ui="true"></div>').join("")}
    <div class="local-editor-box" data-local-editor-ui="true">
      <button class="local-editor-handle" data-handle="left" type="button" aria-label="Resize text from left" title="Resize from left"></button>
      <button class="local-editor-handle" data-handle="right" type="button" aria-label="Resize text from right" title="Resize from right"></button>
      <button class="local-editor-handle" data-handle="move" type="button" aria-label="Move text container" title="Move text container"></button>
    </div>
    <div class="local-editor-toolbar" data-local-editor-ui="true" role="toolbar" aria-label="Text formatting">
      <label class="local-editor-size" title="Font size">
        <input data-tool="font-size" type="number" min="8" max="240" step="1" aria-label="Font size">
        <span>px</span>
      </label>
      <span class="local-editor-divider"></span>
      <button class="local-editor-tool" data-tool="bold" type="button" aria-label="Bold" title="Bold"><strong>B</strong></button>
      <button class="local-editor-tool" data-tool="italic" type="button" aria-label="Italic" title="Italic"><em>I</em></button>
      <button class="local-editor-tool" data-tool="underline" type="button" aria-label="Underline" title="Underline"><u>U</u></button>
      <button class="local-editor-tool" data-tool="strike" type="button" aria-label="Strikethrough" title="Strikethrough"><s>S</s></button>
      <button class="local-editor-tool" data-tool="spacing" type="button" aria-label="Character and line spacing" title="Character and line spacing">↕</button>
      <label class="local-editor-color" title="Text color">
        <span>A</span>
        <input data-tool="color" type="color" aria-label="Toolbar text color">
      </label>
    </div>
    <div class="local-editor-actions" data-local-editor-ui="true" aria-label="Element actions">
      <button class="local-editor-action" data-action="duplicate" type="button" aria-label="Duplicate element" title="Duplicate element">⧉</button>
      <button class="local-editor-action" data-action="delete" type="button" aria-label="Delete element" title="Delete element">⌫</button>
    </div>
    <div class="local-editor-spacing" data-local-editor-ui="true" aria-label="Text spacing">
      <div class="local-editor-spacing-row">
        <label class="local-editor-spacing-label">Character spacing <input data-spacing-number="letter" type="number" min="-2" max="20" step="0.5" aria-label="Character spacing value"></label>
        <input data-spacing-range="letter" type="range" min="-2" max="20" step="0.5" aria-label="Character spacing">
      </div>
      <div class="local-editor-spacing-row">
        <label class="local-editor-spacing-label">Line height <input data-spacing-number="line" type="number" min="0.6" max="3" step="0.05" aria-label="Line height value"></label>
        <input data-spacing-range="line" type="range" min="0.6" max="3" step="0.05" aria-label="Line height">
      </div>
    </div>
  `;
  doc.body.appendChild(root);
  return { root, style };
}

export function createCanvasTextEditor({
  document: doc,
  runtimeId = "local-editor-runtime",
  onBeforeChange = () => {},
  onStyleOperations = () => {},
  onInlineHtmlChange = () => {},
  onDuplicate = () => {},
  onDelete = () => {},
  onSelectionChange = () => {},
  onTextRangeChange = () => {},
}) {
  const win = doc.defaultView;
  const { root, style } = createUi(doc, runtimeId);
  const box = root.querySelector(".local-editor-box");
  const toolbar = root.querySelector(".local-editor-toolbar");
  const actions = root.querySelector(".local-editor-actions");
  const spacing = root.querySelector(".local-editor-spacing");
  const fontSizeInput = root.querySelector('[data-tool="font-size"]');
  const colorInput = root.querySelector('[data-tool="color"]');
  const letterRange = root.querySelector('[data-spacing-range="letter"]');
  const letterNumber = root.querySelector('[data-spacing-number="letter"]');
  const lineRange = root.querySelector('[data-spacing-range="line"]');
  const lineNumber = root.querySelector('[data-spacing-number="line"]');
  const snapGuideElements = Array.from(root.querySelectorAll(".local-editor-snap-guide"));
  let selected = null;
  let selectionSnapshot = null;
  let spacingOpen = false;
  let activeRange = null;

  function show(element, visible, display = "flex") {
    element.style.display = visible ? display : "none";
  }

  function active(tool, enabled) {
    root.querySelector(`[data-tool="${tool}"]`)?.classList.toggle("is-active", enabled);
  }

  function clearSnapGuides() {
    for (const guideElement of snapGuideElements) {
      guideElement.style.display = "none";
      guideElement.removeAttribute("data-axis");
    }
  }

  function renderSnapGuides(guides) {
    clearSnapGuides();
    for (const [index, guide] of (guides || []).slice(0, snapGuideElements.length).entries()) {
      const guideElement = snapGuideElements[index];
      guideElement.dataset.axis = guide.axis;
      guideElement.style.display = "block";
      if (guide.axis === "x") {
        guideElement.style.left = `${guide.position}px`;
        guideElement.style.top = "0";
        guideElement.style.width = "1px";
        guideElement.style.height = `${win.innerHeight}px`;
      } else {
        guideElement.style.left = "0";
        guideElement.style.top = `${guide.position}px`;
        guideElement.style.width = `${win.innerWidth}px`;
        guideElement.style.height = "1px";
      }
    }
  }

  function placeFloating(element, preferredTop, preferredLeft) {
    show(element, true);
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(8, Math.min(win.innerWidth - width - 8, preferredLeft));
    const top = Math.max(8, Math.min(win.innerHeight - height - 8, preferredTop));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function placeNear(element, anchorRect, align) {
    show(element, true);
    const position = floatingPosition({
      anchorRect,
      popupWidth: element.offsetWidth,
      popupHeight: element.offsetHeight,
      viewportWidth: win.innerWidth,
      viewportHeight: win.innerHeight,
      align,
    });
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
  }

  function refresh() {
    if (!selected?.isConnected) {
      clear();
      return;
    }
    const rect = selected.getBoundingClientRect();
    show(box, true, "block");
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const hasTextRange = Boolean(activeRange && selectionSnapshot?.rangeStyle);
    if (hasTextRange) {
      show(actions, false);
      const rangeRect = activeRange.getBoundingClientRect();
      const anchorRect = rangeRect.width || rangeRect.height ? rangeRect : rect;
      placeNear(toolbar, anchorRect, "center");
    } else {
      show(toolbar, false);
      show(spacing, false);
      spacingOpen = false;
      placeNear(actions, rect, "end");
    }

    if (spacingOpen) {
      const toolRect = root.querySelector('[data-tool="spacing"]').getBoundingClientRect();
      placeFloating(spacing, toolRect.bottom + 8, toolRect.right - spacing.offsetWidth);
    }
  }

  function stylesForSelection() {
    return selectionSnapshot?.rangeStyle?.styles
      || selectionSnapshot?.computedStyles
      || {};
  }

  function sync() {
    if (!selected?.isConnected || !selectionSnapshot) return;
    const styles = stylesForSelection();
    const fontSize = parseNumber(styles["font-size"], 16);
    const decoration = styles["text-decoration-line"] || "none";
    const alignValue = styles["text-align"] || "left";
    const align = alignValue === "start" ? "left" : alignValue;
    const letterValue = styles["letter-spacing"];
    const letter = letterValue === "normal" ? 0 : parseNumber(letterValue, 0);
    const line = lineHeightRatio(styles["line-height"], fontSize);
    const color = cssColorToHex(styles.color, "#111827");

    fontSizeInput.value = String(Math.round(fontSize));
    colorInput.value = color;
    colorInput.parentElement.style.setProperty("--local-editor-color", color);
    letterRange.value = String(letter);
    letterNumber.value = String(letter);
    lineRange.value = String(line);
    lineNumber.value = String(line);
    active("bold", styles["font-weight"] === "bold" || parseNumber(styles["font-weight"]) >= 600);
    active("italic", styles["font-style"] === "italic");
    active("underline", decoration.includes("underline"));
    active("strike", decoration.includes("line-through"));
    active("align-left", align === "left");
    active("align-center", align === "center");
    active("align-right", align === "right");
    refresh();
  }

  function emitStyles(changes) {
    if (!selected) return;
    onBeforeChange();
    if (activeRange && !activeRange.collapsed) {
      const result = applyRangeStylesAsTextFields(selected, activeRange, changes);
      if (!result?.range) return;
      activeRange = result.range.cloneRange();
      onInlineHtmlChange(selected.innerHTML, selected, activeRange);
      onSelectionChange(selected);
      sync();
      return;
    }
    const normalizedChanges = [...changes];
    const needsBox = changes.some(({ property }) => property === "width" || property === "text-align");
    if (needsBox && win.getComputedStyle(selected).display === "inline") {
      normalizedChanges.unshift({ property: "display", value: "inline-block" });
    }
    for (const { property, value } of normalizedChanges) selected.style.setProperty(property, value);
    onStyleOperations(normalizedChanges, selected, activeRange);
    onSelectionChange(selected);
    sync();
  }

  function updateSelection(snapshot, range = activeRange) {
    selectionSnapshot = snapshot;
    selected = snapshot?.element || null;
    activeRange = range && !range.collapsed ? range.cloneRange?.() || range : null;
    if (!selected) {
      clear();
      return;
    }
    sync();
  }

  function select(snapshot) {
    clearSnapGuides();
    selectionSnapshot = snapshot;
    selected = snapshot?.element || null;
    activeRange = null;
    spacingOpen = false;
    show(spacing, false);
    sync();
  }

  function clear() {
    clearSnapGuides();
    selected = null;
    selectionSnapshot = null;
    activeRange = null;
    spacingOpen = false;
    show(box, false);
    show(toolbar, false);
    show(actions, false);
    show(spacing, false);
  }

  function beginMove(event) {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    onBeforeChange();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const computed = win.getComputedStyle(selected);
    const rect = selected.getBoundingClientRect();
    const startLeft = positionStart({
      position: computed.position,
      computedValue: computed.left,
      inlineValue: selected.style.left,
      offsetValue: selected.offsetLeft,
      rectValue: rect.left,
    });
    const startTop = positionStart({
      position: computed.position,
      computedValue: computed.top,
      inlineValue: selected.style.top,
      offsetValue: selected.offsetTop,
      rectValue: rect.top,
    });
    const wasStatic = computed.position === "static";
    const snapTargets = collectMoveSnapTargets(doc, win, selected, rect);
    const movingRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    if (wasStatic) selected.style.position = "relative";
    let latest = { left: startLeft, top: startTop };

    const move = (moveEvent) => {
      const bounded = moveFromPointer({
        startLeft,
        startTop,
        deltaX: moveEvent.clientX - startX,
        deltaY: moveEvent.clientY - startY,
        startRectLeft: rect.left,
        startRectTop: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: win.innerWidth,
        viewportHeight: win.innerHeight,
      });
      const boundedDx = bounded.left - startLeft;
      const boundedDy = bounded.top - startTop;
      const snapped = resolveSnapAdjustment({
        movingRect,
        proposedDx: boundedDx,
        proposedDy: boundedDy,
        targets: snapTargets,
        threshold: SNAP_THRESHOLD_PX,
        disabled: moveEvent.altKey,
      });
      latest = moveFromPointer({
        startLeft,
        startTop,
        deltaX: snapped.dx,
        deltaY: snapped.dy,
        startRectLeft: rect.left,
        startRectTop: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: win.innerWidth,
        viewportHeight: win.innerHeight,
      });
      const finalDx = latest.left - startLeft;
      const finalDy = latest.top - startTop;
      renderSnapGuides(keepGuidesAfterBounds({
        guides: snapped.guides,
        snappedDx: snapped.dx,
        snappedDy: snapped.dy,
        finalDx,
        finalDy,
      }));
      selected.style.left = `${latest.left}px`;
      selected.style.top = `${latest.top}px`;
      refresh();
    };
    const finish = () => {
      clearSnapGuides();
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      const changes = [];
      if (wasStatic) changes.push({ property: "position", value: "relative" });
      changes.push(
        { property: "left", value: `${latest.left}px` },
        { property: "top", value: `${latest.top}px` },
      );
      onStyleOperations(changes, selected, activeRange);
      onSelectionChange(selected);
      sync();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function beginResize(event) {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    onBeforeChange();
    const handle = event.currentTarget;
    const side = handle.dataset.handle;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const rect = selected.getBoundingClientRect();
    const startWidth = rect.width;
    const computed = win.getComputedStyle(selected);
    const startLeft = positionStart({
      position: computed.position,
      computedValue: computed.left,
      inlineValue: selected.style.left,
      offsetValue: selected.offsetLeft,
      rectValue: rect.left,
    });
    const wasStatic = computed.position === "static";
    const wasInline = computed.display === "inline";
    if (side === "left" && wasStatic) selected.style.position = "relative";
    if (wasInline) selected.style.display = "inline-block";
    selected.style.boxSizing = "border-box";
    selected.style.maxWidth = "none";
    // 固定文本框宽度后，长连续文本也应在框内换行。contenteditable 本身会
    // 提供类似断行，显式保存该规则可避免失焦后文字突然横向溢出。
    selected.style.overflowWrap = "anywhere";
    let latest = { width: startWidth, left: startLeft };

    const move = (moveEvent) => {
      latest = resizeFromHandle({
        side,
        startWidth,
        startLeft,
        deltaX: moveEvent.clientX - startX,
        maxWidth: side === "left" ? rect.right - 4 : win.innerWidth - rect.left - 4,
      });
      selected.style.width = `${latest.width}px`;
      if (side === "left") selected.style.left = `${latest.left}px`;
      refresh();
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      const changes = [
        { property: "box-sizing", value: "border-box" },
        { property: "max-width", value: "none" },
        { property: "overflow-wrap", value: "anywhere" },
        { property: "width", value: `${latest.width}px` },
      ];
      if (wasInline) changes.unshift({ property: "display", value: "inline-block" });
      if (side === "left") {
        if (wasStatic) changes.push({ property: "position", value: "relative" });
        changes.push({ property: "left", value: `${latest.left}px` });
      }
      onStyleOperations(changes, selected, activeRange);
      onSelectionChange(selected);
      sync();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  root.querySelector('[data-handle="move"]').addEventListener("pointerdown", beginMove);
  root.querySelector('[data-handle="left"]').addEventListener("pointerdown", beginResize);
  root.querySelector('[data-handle="right"]').addEventListener("pointerdown", beginResize);

  fontSizeInput.addEventListener("input", () => {
    const value = Math.max(8, Math.min(240, parseNumber(fontSizeInput.value, 16)));
    emitStyles([{ property: "font-size", value: `${value}px` }]);
  });

  root.querySelector('[data-tool="bold"]').addEventListener("click", () => {
    emitStyles([{
      property: "font-weight",
      value: toggleFontWeight(stylesForSelection()["font-weight"]),
    }]);
  });
  root.querySelector('[data-tool="italic"]').addEventListener("click", () => {
    emitStyles([{
      property: "font-style",
      value: toggleFontStyle(stylesForSelection()["font-style"]),
    }]);
  });
  root.querySelector('[data-tool="underline"]').addEventListener("click", () => {
    emitStyles([{
      property: "text-decoration-line",
      value: toggleDecoration(stylesForSelection()["text-decoration-line"], "underline"),
    }]);
  });
  root.querySelector('[data-tool="strike"]').addEventListener("click", () => {
    emitStyles([{
      property: "text-decoration-line",
      value: toggleDecoration(stylesForSelection()["text-decoration-line"], "line-through"),
    }]);
  });
  root.querySelector('[data-tool="spacing"]').addEventListener("click", () => {
    spacingOpen = !spacingOpen;
    show(spacing, spacingOpen);
    refresh();
  });
  colorInput.addEventListener("input", () => {
    emitStyles([{ property: "color", value: colorInput.value.toLowerCase() }]);
  });

  function updateLetter(value) {
    const letter = Math.max(-2, Math.min(20, parseNumber(value, 0)));
    letterRange.value = String(letter);
    letterNumber.value = String(letter);
    emitStyles([{ property: "letter-spacing", value: `${letter}px` }]);
  }
  function updateLine(value) {
    const line = Math.max(0.6, Math.min(3, parseNumber(value, 1.2)));
    lineRange.value = String(line);
    lineNumber.value = String(line);
    emitStyles([{ property: "line-height", value: String(line) }]);
  }
  letterRange.addEventListener("input", () => updateLetter(letterRange.value));
  letterNumber.addEventListener("input", () => updateLetter(letterNumber.value));
  lineRange.addEventListener("input", () => updateLine(lineRange.value));
  lineNumber.addEventListener("input", () => updateLine(lineNumber.value));

  function duplicateSelected() {
    if (!selected) return;
    onBeforeChange();
    const original = selected;
    const existingIds = new Set(
      Array.from(doc.querySelectorAll("[id]"), (element) => element.id).filter(Boolean),
    );
    const newId = createUniqueCopyId(existingIds, original.id || original.tagName.toLowerCase());
    const clone = original.cloneNode(true);
    clone.removeAttribute("data-local-editor-selected");
    clone.removeAttribute("data-local-editor-editing");
    clone.removeAttribute("contenteditable");
    clone.removeAttribute("spellcheck");
    clone.id = newId;
    original.after(clone);
    onDuplicate(original, clone, newId);
  }

  function deleteSelected() {
    if (!selected) return;
    onBeforeChange();
    const element = selected;
    onDelete(element);
    element.remove();
    clear();
  }

  root.querySelector('[data-action="duplicate"]').addEventListener("click", duplicateSelected);
  root.querySelector('[data-action="delete"]').addEventListener("click", deleteSelected);

  function updateTextSelection() {
    if (!selected?.isConnected) return;
    // 点击工具栏会把焦点移到控件上，但仍需保留刚才的文字 Range 来应用样式。
    if (root.contains(doc.activeElement) && activeRange) return;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      activeRange = null;
      onTextRangeChange(null);
      refresh();
      return;
    }
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    activeRange = common && selected.contains(common) ? range.cloneRange() : null;
    onTextRangeChange(activeRange);
    refresh();
  }

  const keepUiEvent = (event) => event.stopPropagation();
  root.addEventListener("click", keepUiEvent);
  root.addEventListener("dblclick", keepUiEvent);
  win.addEventListener("resize", refresh);
  doc.addEventListener("scroll", refresh, true);
  doc.addEventListener("selectionchange", updateTextSelection);

  function destroy() {
    clearSnapGuides();
    win.removeEventListener("resize", refresh);
    doc.removeEventListener("scroll", refresh, true);
    doc.removeEventListener("selectionchange", updateTextSelection);
    root.remove();
    style.remove();
    selected = null;
    selectionSnapshot = null;
  }

  return { select, updateSelection, clear, refresh, sync, duplicateSelected, deleteSelected, destroy };
}
