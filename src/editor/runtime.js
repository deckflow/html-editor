import { patchElementsInHtml } from "../../htmlPatch.js";
import { positionStart } from "../../public/canvasEditorMath.js";
import { createEditorHistory } from "../../public/editorHistory.js";
import {
  applyInlineEditAttributes,
  captureInlineEditAttributes,
  createElementTarget,
  isEditableMixedTextRoot,
  isTextHorizontallyOverflowing,
  normalizeInlineEditText,
  normalizeTextChunks,
  preservesTextWhitespace,
  resolveEditableTextTarget,
  restoreInlineEditAttributes,
  shouldCancelInlineEdit,
  shouldCommitInlineEdit,
  shouldEnsureFixedWidthWrap,
} from "../../public/inlineEdit.js";
import { dragTargetAtPoint } from "../../public/pointerIntent.js";
import { injectPreviewBase, previewSandbox } from "../../public/previewHtml.js";
import { buildSelectionSnapshot } from "../../public/selectionSnapshot.js";
import {
  collectEditableTextFields,
  planTextFieldContentOperations,
  textStructureSignature,
} from "../../public/textFieldModel.js";
import { applyTableAction, tableContextForElement } from "../../public/tableEditing.js";
import { calculateFitScale, normalizeFitMode } from "./fit.js";

const EDITOR_STYLE = `
  [data-local-editor-selected="true"] { cursor: text !important; }
  body *:hover:not([data-local-editor-selected="true"]):not([data-local-editor-editing="true"]) {
    outline: 2px dashed rgba(18, 110, 99, 0.4);
    outline-offset: 3px;
  }
  [data-local-editor-editing="true"] { outline: none !important; }
  [data-local-editor-drag-ready="true"] { cursor: grab !important; }
  [data-local-editor-drag-ready="dragging"] { cursor: grabbing !important; }
`;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function editableTextValue(element) {
  return preservesTextWhitespace(element)
    ? String(element?.textContent || "")
    : normalizeInlineEditText(element?.textContent);
}

function selectorEscape(win, value) {
  if (win?.CSS?.escape) return win.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function selectorFor(element) {
  const win = element?.ownerDocument?.defaultView;
  if (element.id) return `#${selectorEscape(win, element.id)}`;
  const parts = [];
  let node = element;
  while (node?.nodeType === 1 && node.tagName !== "HTML") {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
    const index = siblings.indexOf(node) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    node = parent;
  }
  return parts.join(" > ");
}

function resolveTarget(document, target) {
  if (!document || !target) return null;
  if (target.selector) {
    try {
      const match = document.querySelectorAll(target.selector)[target.selectorIndex ?? 0];
      if (match) return match;
    } catch {
      // Invalid selectors continue through the stable fallbacks.
    }
  }
  if (target.id) {
    const byId = document.querySelector(`#${selectorEscape(document.defaultView, target.id)}`);
    if (byId) return byId;
  }
  let node = document.body;
  for (const index of target.domPath || []) node = node?.children?.[index];
  return node || null;
}

function caretAtPoint(document, event, target) {
  const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position?.offsetNode && target.contains(position.offsetNode)) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range?.startContainer && target.contains(range.startContainer)) {
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

function placeInlineCaret(element, caret) {
  if (!caret?.node?.isConnected || !element.contains(caret.node)) return;
  const selection = element.ownerDocument.defaultView.getSelection();
  const range = element.ownerDocument.createRange();
  const maxOffset = caret.node.nodeType === 3
    ? caret.node.data.length
    : caret.node.childNodes.length;
  range.setStart(caret.node, Math.max(0, Math.min(caret.offset, maxOffset)));
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function normalizeEditableWhitespace(element) {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(
    element,
    document.defaultView.NodeFilter.SHOW_TEXT,
  );
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const normalized = normalizeTextChunks(nodes.map((node) => node.data));
  nodes.forEach((node, index) => {
    node.data = normalized[index];
  });
}

function runtimeError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

/**
 * Creates a serverless editor around an existing iframe. The iframe is the
 * preview surface; source HTML remains an immutable string until a complete
 * editor operation is patched successfully.
 */
export function createHtmlEditorRuntime({
  iframe,
  html = "",
  baseUrl = "",
  allowScripts = false,
  readonly = false,
  fit = "none",
  historyLimit = 50,
  uiFactory = null,
  onChange = () => {},
  onError = () => {},
  onSelectionChange = () => {},
  onFitChange = () => {},
} = {}) {
  if (!iframe || String(iframe.tagName).toLowerCase() !== "iframe") {
    throw new TypeError("createHtmlEditorRuntime requires an iframe");
  }

  const iframeStyleSnapshot = {
    height: iframe.style.height,
    transform: iframe.style.transform,
    transformOrigin: iframe.style.transformOrigin,
    width: iframe.style.width,
  };
  const state = {
    source: String(html ?? ""),
    baseUrl: String(baseUrl || ""),
    allowScripts: Boolean(allowScripts),
    readonly: Boolean(readonly),
    fitMode: normalizeFitMode(fit),
    scale: 1,
    fitFrame: null,
    fitSettleTimer: null,
    fitHostObserver: null,
    fitHostCleanup: null,
    fitContentCleanup: null,
    revision: 0,
    destroyed: false,
    selection: null,
    elementTargets: new WeakMap(),
    selectedMarker: null,
    dragMarker: null,
    inlineElement: null,
    inlineCleanup: null,
    inlineAttributes: null,
    ui: null,
    editorStyle: null,
    eventCleanup: null,
    suppressClick: false,
    history: createEditorHistory(historyLimit),
    loadSequence: 0,
    ready: Promise.resolve(),
    callbackChain: Promise.resolve(),
  };

  const runtimeId = globalThis.crypto?.randomUUID
    ? `html-editor-${globalThis.crypto.randomUUID()}`
    : `html-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function reportError(error) {
    try {
      onError(error);
    } catch {
      // A host error handler must not take down the editor.
    }
  }

  function reportFitChange() {
    iframe.dataset.deckflowFit = state.fitMode;
    iframe.dataset.deckflowScale = String(state.scale);
    try {
      onFitChange({ mode: state.fitMode, scale: state.scale });
    } catch (error) {
      reportError(error);
    }
  }

  function restoreIframeFitStyles() {
    iframe.style.width = iframeStyleSnapshot.width;
    iframe.style.height = iframeStyleSnapshot.height;
    iframe.style.transform = iframeStyleSnapshot.transform;
    iframe.style.transformOrigin = iframeStyleSnapshot.transformOrigin;
  }

  function previewContentSize(document) {
    const root = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(
        root?.scrollWidth || 0,
        root?.offsetWidth || 0,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0,
      ),
      height: Math.max(
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
      ),
    };
  }

  function suppressFitRuntimeState(document) {
    const runtimeNodes = [...document.querySelectorAll(
      `[data-local-editor-ui], [data-local-editor-runtime="${runtimeId}"]`,
    )];
    const runtimeDisplays = runtimeNodes.map((node) => node.style.display);
    const editingNodes = [...document.querySelectorAll("[data-local-editor-editing]")];
    const editingAttributes = editingNodes.map((node) => ({
      contenteditable: {
        present: node.hasAttribute("contenteditable"),
        value: node.getAttribute("contenteditable"),
      },
      spellcheck: {
        present: node.hasAttribute("spellcheck"),
        value: node.getAttribute("spellcheck"),
      },
      editing: {
        present: node.hasAttribute("data-local-editor-editing"),
        value: node.getAttribute("data-local-editor-editing"),
      },
    }));

    runtimeNodes.forEach((node) => {
      node.style.display = "none";
    });
    editingNodes.forEach((node) => {
      node.removeAttribute("contenteditable");
      node.removeAttribute("spellcheck");
      node.removeAttribute("data-local-editor-editing");
    });

    return () => {
      runtimeNodes.forEach((node, index) => {
        node.style.display = runtimeDisplays[index];
      });
      editingNodes.forEach((node, index) => {
        const attributes = {
          contenteditable: editingAttributes[index].contenteditable,
          spellcheck: editingAttributes[index].spellcheck,
          "data-local-editor-editing": editingAttributes[index].editing,
        };
        for (const [name, snapshot] of Object.entries(attributes)) {
          if (snapshot.present) node.setAttribute(name, snapshot.value ?? "");
          else node.removeAttribute(name);
        }
      });
    };
  }

  function applyFit() {
    if (state.destroyed) return state.scale;
    if (state.fitFrame != null) {
      iframe.ownerDocument.defaultView?.cancelAnimationFrame(state.fitFrame);
      state.fitFrame = null;
    }

    if (state.fitMode === "none") {
      const changed = state.scale !== 1;
      state.scale = 1;
      restoreIframeFitStyles();
      if (changed || iframe.dataset.deckflowFit !== "none") reportFitChange();
      state.ui?.refresh();
      return state.scale;
    }

    const container = iframe.parentElement;
    const document = iframe.contentDocument;
    if (!container || !document?.documentElement) return state.scale;
    const availableWidth = Math.max(1, container.clientWidth);
    const availableHeight = Math.max(1, container.clientHeight);

    // Measure from the real host-sized viewport. Otherwise the inverse width
    // from a previous scale becomes part of scrollWidth and locks the old ratio.
    iframe.style.width = `${availableWidth}px`;
    iframe.style.height = `${availableHeight}px`;
    iframe.style.transform = "none";
    iframe.style.transformOrigin = "top left";
    void iframe.offsetWidth;

    const restoreRuntimeState = suppressFitRuntimeState(document);
    const content = previewContentSize(document);
    restoreRuntimeState();
    const nextScale = calculateFitScale({
      mode: state.fitMode,
      availableWidth,
      availableHeight,
      contentWidth: content.width,
      contentHeight: content.height,
    });
    const changed = Math.abs(nextScale - state.scale) > 0.0001;
    state.scale = nextScale;
    iframe.style.width = `${availableWidth / nextScale}px`;
    iframe.style.height = `${availableHeight / nextScale}px`;
    iframe.style.transform = `scale(${nextScale})`;
    iframe.style.transformOrigin = "top left";
    if (changed || iframe.dataset.deckflowFit !== state.fitMode) reportFitChange();
    state.ui?.refresh();
    return state.scale;
  }

  function scheduleFit() {
    if (state.destroyed || state.fitMode === "none" || state.fitFrame != null) return;
    const win = iframe.ownerDocument.defaultView;
    if (!win?.requestAnimationFrame) {
      applyFit();
      return;
    }
    state.fitFrame = win.requestAnimationFrame(() => {
      state.fitFrame = null;
      applyFit();
    });
  }

  function cancelSettledFit() {
    if (state.fitSettleTimer == null) return;
    iframe.ownerDocument.defaultView?.clearTimeout(state.fitSettleTimer);
    state.fitSettleTimer = null;
  }

  function scheduleSettledFit() {
    if (state.destroyed || state.fitMode === "none") return;
    scheduleFit();
    const win = iframe.ownerDocument.defaultView;
    if (!win) return;
    cancelSettledFit();
    state.fitSettleTimer = win.setTimeout(() => {
      state.fitSettleTimer = null;
      applyFit();
    }, 220);
  }

  function isEditorRuntimeNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.(
      `[data-local-editor-ui], [data-local-editor-runtime="${runtimeId}"]`,
    ));
  }

  function mutationAffectsPreview(mutation) {
    if (isEditorRuntimeNode(mutation.target)) return false;
    if (mutation.type === "attributes") {
      const name = String(mutation.attributeName || "");
      if (name.startsWith("data-local-editor-")
        || name === "contenteditable"
        || name === "spellcheck") return false;
    }
    if (mutation.type === "childList") {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changedNodes.length > 0 && changedNodes.every(isEditorRuntimeNode)) return false;
    }
    return true;
  }

  function installFitSignals(document) {
    state.fitContentCleanup?.();
    state.fitContentCleanup = null;
    if (state.fitMode === "none") return;

    const MutationObserverCtor = document.defaultView?.MutationObserver;
    const observer = MutationObserverCtor
      ? new MutationObserverCtor((mutations) => {
        if (!state.inlineElement && mutations.some(mutationAffectsPreview)) scheduleFit();
      })
      : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const handleResourceLoad = (event) => {
      if (["IMG", "VIDEO", "AUDIO", "IFRAME"].includes(event.target?.tagName)) scheduleFit();
    };
    document.addEventListener("load", handleResourceLoad, true);
    const loadSequence = state.loadSequence;
    document.fonts?.ready?.then(() => {
      if (loadSequence === state.loadSequence) scheduleFit();
    });
    state.fitContentCleanup = () => {
      observer?.disconnect();
      document.removeEventListener("load", handleResourceLoad, true);
    };
  }

  function installHostFitObserver() {
    const container = iframe.parentElement;
    const win = iframe.ownerDocument.defaultView;
    const ResizeObserverCtor = win?.ResizeObserver;
    if (container && ResizeObserverCtor) {
      state.fitHostObserver = new ResizeObserverCtor(scheduleSettledFit);
      state.fitHostObserver.observe(container);
    }
    win?.addEventListener("resize", scheduleSettledFit, { passive: true });
    win?.visualViewport?.addEventListener("resize", scheduleSettledFit, { passive: true });
    state.fitHostCleanup = () => {
      win?.removeEventListener("resize", scheduleSettledFit);
      win?.visualViewport?.removeEventListener("resize", scheduleSettledFit);
    };
  }

  function notifyChange(patches, reason) {
    const payload = {
      html: state.source,
      patches: clone(patches),
      revision: state.revision,
      reason,
    };
    state.callbackChain = state.callbackChain
      .then(() => onChange(payload))
      .catch((error) => reportError(error));
  }

  function selectedElement() {
    return state.selection?.element || null;
  }

  function selectedTarget() {
    return state.selection?.target || null;
  }

  function targetForElement(element) {
    const existing = state.elementTargets.get(element);
    if (existing) return existing;
    const target = createElementTarget(element, selectorFor(element));
    state.elementTargets.set(element, target);
    return target;
  }

  function refreshSelection(range = null) {
    const current = state.selection;
    if (!current?.element?.isConnected) {
      state.selection = null;
      return null;
    }
    state.selection = buildSelectionSnapshot({
      path: "",
      element: current.element,
      target: current.target,
      selector: current.selector,
      range,
    });
    return state.selection;
  }

  function restoreSelectedMarker() {
    const marker = state.selectedMarker;
    if (!marker) return;
    if (marker.present) marker.element.setAttribute("data-local-editor-selected", marker.value ?? "");
    else marker.element.removeAttribute("data-local-editor-selected");
    state.selectedMarker = null;
  }

  function applySelectedMarker(element) {
    state.selectedMarker = {
      element,
      present: element.hasAttribute("data-local-editor-selected"),
      value: element.getAttribute("data-local-editor-selected"),
    };
    element.setAttribute("data-local-editor-selected", "true");
  }

  function restoreDragMarker() {
    const marker = state.dragMarker;
    if (!marker) return;
    if (marker.present) marker.element.setAttribute("data-local-editor-drag-ready", marker.value ?? "");
    else marker.element.removeAttribute("data-local-editor-drag-ready");
    state.dragMarker = null;
  }

  function applyDragMarker(element, value = "true") {
    if (state.dragMarker?.element === element) {
      element.setAttribute("data-local-editor-drag-ready", value);
      return;
    }
    restoreDragMarker();
    if (!element?.isConnected) return;
    state.dragMarker = {
      element,
      present: element.hasAttribute("data-local-editor-drag-ready"),
      value: element.getAttribute("data-local-editor-drag-ready"),
    };
    element.setAttribute("data-local-editor-drag-ready", value);
  }

  function stopInlineEdit({ commit = true } = {}) {
    if (!state.inlineElement) return;
    state.inlineCleanup?.(commit);
  }

  function clearSelection({ commit = false } = {}) {
    stopInlineEdit({ commit });
    restoreDragMarker();
    restoreSelectedMarker();
    state.selection = null;
    state.ui?.clear();
    onSelectionChange(null);
  }

  function selectElement(element) {
    if (!element?.isConnected) return;
    if (selectedElement() === element) {
      const snapshot = refreshSelection();
      state.ui?.select(snapshot);
      onSelectionChange(snapshot);
      return;
    }
    clearSelection({ commit: true });
    const selector = selectorFor(element);
    state.selection = buildSelectionSnapshot({
      path: "",
      element,
      target: targetForElement(element),
      selector,
    });
    applySelectedMarker(element);
    state.ui?.select(state.selection);
    onSelectionChange(state.selection);
  }

  function recordHistory() {
    state.history.push({
      html: state.source,
      selectedTarget: clone(selectedTarget()),
    });
  }

  function updateTextFingerprint(element) {
    const target = targetForElement(element);
    const next = {
      ...target,
      originalText: normalizeInlineEditText(element.textContent),
    };
    state.elementTargets.set(element, next);
    if (selectedElement() === element) {
      state.selection = buildSelectionSnapshot({
        path: "",
        element,
        target: next,
        selector: state.selection.selector,
      });
    }
  }

  function commitPatches(patches, reason) {
    if (state.destroyed || patches.length === 0) return false;
    const serializable = patches.map(({ target, operations }) => ({
      target: clone(target),
      operations: clone(operations),
    }));
    const previousSource = state.source;
    const result = patchElementsInHtml(previousSource, serializable);
    if (!result.matched) {
      const error = runtimeError("The selected element could not be patched in the source HTML", {
        code: "HTML_PATCH_FAILED",
        failedIndex: result.failedIndex,
        patches: serializable,
      });
      void reloadPreview(previousSource, { resetHistory: false });
      reportError(error);
      return false;
    }
    if (!result.changed) return true;
    state.source = result.html;
    state.revision += 1;
    notifyChange(serializable, reason);
    scheduleFit();
    return true;
  }

  function commitStyleOperations(operations, element, reason = "style") {
    const target = targetForElement(element);
    return commitPatches([{
      target,
      operations: operations.map((operation) => ({
        type: "inline-style",
        ...operation,
      })),
    }], reason);
  }

  function commitInlineText(element, originalText, editSnapshot) {
    const text = editableTextValue(element);
    const preservesMarkup = editSnapshot != null;
    if (preservesMarkup ? element.innerHTML === editSnapshot.html : text === originalText) {
      state.ui?.refresh();
      return true;
    }

    let operations;
    if (preservesMarkup) {
      const sameStructure = textStructureSignature(element) === editSnapshot.structure;
      const fields = collectEditableTextFields(element);
      operations = sameStructure
        ? planTextFieldContentOperations(editSnapshot.fields, fields)
        : null;
      if (!operations) {
        element.innerHTML = editSnapshot.html;
        state.ui?.refresh();
        reportError(runtimeError("The text edit changed the HTML structure and was reverted", {
          code: "HTML_STRUCTURE_CHANGED",
        }));
        return false;
      }
    } else {
      element.textContent = text;
      operations = [{ type: "text-content", value: text }];
    }

    if (!element.style.overflowWrap && isTextHorizontallyOverflowing(element)) {
      element.style.overflowWrap = "anywhere";
      operations.push({
        type: "inline-style",
        property: "overflow-wrap",
        value: "anywhere",
      });
    }
    if (operations.length === 0) return true;
    const committed = commitPatches([{
      target: targetForElement(element),
      operations,
    }], "text");
    if (committed) updateTextFingerprint(element);
    state.ui?.refresh();
    return committed;
  }

  function beginInlineEdit(element, caret = null) {
    if (state.inlineElement === element) return;
    stopInlineEdit({ commit: true });
    selectElement(element);

    let historyRecorded = false;
    if (shouldEnsureFixedWidthWrap(element)) {
      recordHistory();
      historyRecorded = true;
      element.style.overflowWrap = "anywhere";
      commitStyleOperations([{
        property: "overflow-wrap",
        value: "anywhere",
      }], element, "style");
    }

    const originalText = editableTextValue(element);
    const preserveMarkup = isEditableMixedTextRoot(element) || element.children.length > 0;
    const editSnapshot = preserveMarkup ? {
      html: element.innerHTML,
      fields: collectEditableTextFields(element),
      structure: textStructureSignature(element),
    } : null;
    const attributes = captureInlineEditAttributes(element);
    state.inlineElement = element;
    state.inlineAttributes = attributes;
    if (!preserveMarkup && !preservesTextWhitespace(element)) {
      normalizeEditableWhitespace(element);
    }
    applyInlineEditAttributes(element, { preserveMarkup });
    element.focus({ preventScroll: true });
    placeInlineCaret(element, caret);

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      element.removeEventListener("blur", handleBlur, true);
      element.removeEventListener("keydown", handleKeyDown, true);
      element.removeEventListener("beforeinput", handleBeforeInput, true);
      if (!commit) {
        if (editSnapshot) element.innerHTML = editSnapshot.html;
        else element.textContent = originalText;
        restoreInlineEditAttributes(element, attributes);
      } else {
        const changed = editSnapshot
          ? element.innerHTML !== editSnapshot.html
          : editableTextValue(element) !== originalText;
        // Some programmatic and accessibility input paths do not emit
        // beforeinput. Keep the eager listener for normal typing, but guarantee
        // one source snapshot before every text commit.
        if (changed && !historyRecorded) {
          recordHistory();
          historyRecorded = true;
        }
        restoreInlineEditAttributes(element, attributes);
        commitInlineText(element, originalText, editSnapshot);
      }
      state.inlineElement = null;
      state.inlineCleanup = null;
      state.inlineAttributes = null;
    };

    function handleBeforeInput() {
      if (historyRecorded) return;
      historyRecorded = true;
      recordHistory();
    }

    function handleBlur() {
      finish(true);
    }

    function handleKeyDown(event) {
      if (shouldCancelInlineEdit(event)) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (shouldCommitInlineEdit(event)) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    }

    element.addEventListener("blur", handleBlur, true);
    element.addEventListener("keydown", handleKeyDown, true);
    element.addEventListener("beforeinput", handleBeforeInput, true);
    state.inlineCleanup = finish;
  }

  function handleShortcut(event) {
    const key = event.key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (event.target?.isContentEditable) return;
    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    const element = selectedElement();
    if (!element || event.target?.closest?.("input, textarea, select, button")) return;
    if (modifier && key === "d" && !tableContextForElement(element)) {
      event.preventDefault();
      state.ui?.duplicateSelected();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace")
      && !tableContextForElement(element)) {
      event.preventDefault();
      state.ui?.deleteSelected();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      beginInlineEdit(element);
    } else if (event.key === "Escape") {
      clearSelection();
    }
  }

  function createUi(document) {
    if (typeof uiFactory !== "function") return null;
    return uiFactory({
      document,
      runtimeId,
      callbacks: {
        onBeforeChange: recordHistory,
        onStyleOperations(operations, element, range) {
          commitStyleOperations(operations, element);
          const snapshot = refreshSelection(range);
          state.ui?.updateSelection(snapshot, range);
          onSelectionChange(snapshot);
        },
        onInlineHtmlChange(innerHtml, element, range) {
          commitPatches([{
            target: targetForElement(element),
            operations: [{ type: "inner-html", value: innerHtml }],
          }], "text-style");
          updateTextFingerprint(element);
          const snapshot = refreshSelection(range);
          state.ui?.updateSelection(snapshot, range);
          state.ui?.refresh();
          onSelectionChange(snapshot);
        },
        onDuplicate(original, cloneElement, newId) {
          const committed = commitPatches([{
            target: targetForElement(original),
            operations: [{ type: "duplicate-element", newId }],
          }], "duplicate");
          if (committed) selectElement(cloneElement);
        },
        onDelete(element) {
          commitPatches([{
            target: targetForElement(element),
            operations: [{ type: "delete-element" }],
          }], "delete");
          clearSelection();
        },
        onTableAction(action, context) {
          const target = targetForElement(context.table);
          const result = applyTableAction(context, action);
          if (!result.changed) {
            reportError(runtimeError(result.reason || "This table operation is unavailable", {
              code: "TABLE_OPERATION_UNAVAILABLE",
            }));
            state.ui?.refresh();
            return;
          }
          const committed = commitPatches([{
            target,
            operations: [result.operation],
          }], "table");
          if (!committed) return;
          state.elementTargets.set(
            context.table,
            createElementTarget(context.table, selectorFor(context.table)),
          );
          if (result.selectedCell?.isConnected) selectElement(result.selectedCell);
          else clearSelection();
        },
        onSelectionChange() {
          const snapshot = refreshSelection();
          onSelectionChange(snapshot);
        },
        onTextRangeChange(range) {
          if (range) restoreDragMarker();
          const snapshot = refreshSelection(range);
          state.ui?.updateSelection(snapshot, range);
          onSelectionChange(snapshot);
        },
        onInteractionStart() {
          stopInlineEdit({ commit: true });
        },
        onMoveStart(element) {
          state.suppressClick = true;
          applyDragMarker(element, "dragging");
        },
        onMoveEnd(element, moved) {
          if (element?.isConnected) applyDragMarker(element, "true");
          if (moved) {
            setTimeout(() => {
              state.suppressClick = false;
            }, 0);
          }
        },
      },
    });
  }

  function installEditorLayer() {
    const document = iframe.contentDocument;
    if (state.readonly || !document?.head || !document.body) return;

    const style = document.createElement("style");
    style.dataset.localEditorRuntime = runtimeId;
    style.textContent = EDITOR_STYLE;
    document.head.append(style);
    state.editorStyle = style;
    state.ui = createUi(document);

    const dragTargetForEvent = (event) => dragTargetAtPoint({
      target: event.target,
      x: event.clientX,
      y: event.clientY,
      selection: document.defaultView.getSelection(),
      inlineEditingElement: state.inlineElement,
    });
    const handlePointerMove = (event) => {
      if (event.buttons) return;
      const target = dragTargetForEvent(event);
      if (target) applyDragMarker(target);
      else restoreDragMarker();
    };
    const handlePointerOut = (event) => {
      if (!event.relatedTarget) restoreDragMarker();
    };
    const handlePointerDown = (event) => {
      if (event.button !== 0) return;
      const target = dragTargetForEvent(event);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopInlineEdit({ commit: true });
      selectElement(target);
      applyDragMarker(target);
      state.ui?.beginMove(event, { captureTarget: target, activationDistance: 3 });
    };
    const handleClick = (event) => {
      if (state.suppressClick) {
        state.suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.target.closest?.("[data-local-editor-ui]")) return;
      const dragTarget = dragTargetForEvent(event);
      if (dragTarget) {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectElement(dragTarget);
        applyDragMarker(dragTarget);
        return;
      }
      const tableCell = event.target.closest?.("td, th");
      const target = resolveEditableTextTarget(event.target) || tableCell;
      event.stopImmediatePropagation();
      if (!target) {
        event.preventDefault();
        clearSelection({ commit: true });
        return;
      }
      if (state.inlineElement === target) return;
      event.preventDefault();
      beginInlineEdit(target, caretAtPoint(document, event, target));
    };
    const handleToggle = () => state.ui?.refresh();

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("toggle", handleToggle, true);
    document.addEventListener("keydown", handleShortcut);
    state.eventCleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("toggle", handleToggle, true);
      document.removeEventListener("keydown", handleShortcut);
    };
  }

  function teardownPreview({ commit = false } = {}) {
    stopInlineEdit({ commit });
    state.fitContentCleanup?.();
    state.fitContentCleanup = null;
    state.eventCleanup?.();
    state.eventCleanup = null;
    state.ui?.destroy();
    state.ui = null;
    state.editorStyle?.remove();
    state.editorStyle = null;
    restoreDragMarker();
    restoreSelectedMarker();
    state.selection = null;
    state.elementTargets = new WeakMap();
  }

  function reloadPreview(source, {
    resetHistory = false,
    restoreSelectionTarget = null,
  } = {}) {
    if (state.destroyed) return Promise.resolve();
    teardownPreview();
    if (resetHistory) state.history.clear();
    const sequence = ++state.loadSequence;
    iframe.setAttribute("sandbox", previewSandbox({ allowScripts: state.allowScripts }));
    const loaded = new Promise((resolve) => {
      iframe.addEventListener("load", () => {
        if (state.destroyed || sequence !== state.loadSequence) {
          resolve();
          return;
        }
        installEditorLayer();
        installFitSignals(iframe.contentDocument);
        applyFit();
        const restored = resolveTarget(iframe.contentDocument, restoreSelectionTarget);
        if (restored) selectElement(restored);
        resolve();
      }, { once: true });
    });
    iframe.srcdoc = injectPreviewBase(source, state.baseUrl);
    state.ready = loaded;
    return loaded;
  }

  async function restoreHistory(entry, reason) {
    if (!entry) return false;
    state.source = entry.html;
    state.revision += 1;
    await reloadPreview(state.source, {
      resetHistory: false,
      restoreSelectionTarget: entry.selectedTarget,
    });
    notifyChange([], reason);
    return true;
  }

  function undo() {
    if (state.readonly) return Promise.resolve(false);
    stopInlineEdit({ commit: true });
    const previous = state.history.undo({
      html: state.source,
      selectedTarget: clone(selectedTarget()),
    });
    return restoreHistory(previous, "undo");
  }

  function redo() {
    if (state.readonly) return Promise.resolve(false);
    stopInlineEdit({ commit: true });
    const next = state.history.redo({
      html: state.source,
      selectedTarget: clone(selectedTarget()),
    });
    return restoreHistory(next, "redo");
  }

  function setHtml(nextHtml, options = {}) {
    const next = String(nextHtml ?? "");
    if (next === state.source) return state.ready;
    state.source = next;
    if (Object.hasOwn(options, "baseUrl")) state.baseUrl = String(options.baseUrl || "");
    return reloadPreview(next, { resetHistory: true });
  }

  function setReadonly(nextReadonly) {
    const next = Boolean(nextReadonly);
    if (state.destroyed || next === state.readonly) return state.readonly;
    // Commit an active text edit before removing the interaction layer so the
    // host never loses a completed value when it locks the editor.
    teardownPreview({ commit: next });
    state.readonly = next;
    onSelectionChange(null);
    if (!state.readonly) installEditorLayer();
    if (iframe.contentDocument?.documentElement) {
      installFitSignals(iframe.contentDocument);
      applyFit();
    }
    return state.readonly;
  }

  function setFitMode(nextMode) {
    const next = normalizeFitMode(nextMode);
    if (state.destroyed) return state.fitMode;
    state.fitMode = next;
    if (next === "none") cancelSettledFit();
    state.fitContentCleanup?.();
    state.fitContentCleanup = null;
    if (iframe.contentDocument?.documentElement) {
      installFitSignals(iframe.contentDocument);
    }
    applyFit();
    return state.fitMode;
  }

  function refreshFit() {
    return applyFit();
  }

  async function flush() {
    stopInlineEdit({ commit: true });
    await state.ready;
    await state.callbackChain;
    return state.source;
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.loadSequence += 1;
    teardownPreview();
    state.fitHostObserver?.disconnect();
    state.fitHostObserver = null;
    state.fitHostCleanup?.();
    state.fitHostCleanup = null;
    cancelSettledFit();
    if (state.fitFrame != null) {
      iframe.ownerDocument.defaultView?.cancelAnimationFrame(state.fitFrame);
      state.fitFrame = null;
    }
    state.scale = 1;
    restoreIframeFitStyles();
    delete iframe.dataset.deckflowFit;
    delete iframe.dataset.deckflowScale;
    iframe.removeAttribute("srcdoc");
  }

  const api = {
    get ready() {
      return state.ready;
    },
    get revision() {
      return state.revision;
    },
    get canUndo() {
      return state.history.canUndo;
    },
    get canRedo() {
      return state.history.canRedo;
    },
    get readonly() {
      return state.readonly;
    },
    get fitMode() {
      return state.fitMode;
    },
    get scale() {
      return state.scale;
    },
    getHtml() {
      return state.source;
    },
    setHtml,
    setReadonly,
    setFitMode,
    refreshFit,
    undo,
    redo,
    flush,
    destroy,
  };

  installHostFitObserver();
  state.ready = reloadPreview(state.source, { resetHistory: true });
  return api;
}
