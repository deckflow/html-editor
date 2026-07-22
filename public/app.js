import {
  applyInlineEditAttributes,
  captureInlineEditAttributes,
  createElementTarget,
  cssColorToHex,
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
} from "./inlineEdit.js";
import { createCanvasTextEditor } from "./canvasTextEditor.js";
import { createAutoSaveController } from "./autoSaveController.js";
import { positionStart } from "./canvasEditorMath.js";
import { createEditorHistory } from "./editorHistory.js";
import { appendStructuralPatch, appendStylePatch } from "./patchQueue.js";
import { dragTargetAtPoint } from "./pointerIntent.js";
import { activateEmbeddedPreview } from "./previewLifecycle.js";
import {
  injectPreviewBase,
  PREVIEW_BASE_ATTRIBUTE,
  previewSandboxForMode,
} from "./previewHtml.js";
import { buildSelectionSnapshot } from "./selectionSnapshot.js";
import {
  collectEditableTextFields,
  planTextFieldContentOperations,
  textStructureSignature,
} from "./textFieldModel.js";

// state 保存编辑器运行时状态；真正的 HTML 内容仍然在 iframe 文档里。
const state = {
  currentPath: "",
  mode: "local",
  source: "",
  previewBaseHref: "",
  selectionSnapshot: null,
  pendingPatches: [],
  inlineEditingElement: null,
  inlineEditCleanup: null,
  inlineAttributeSnapshot: null,
  dirty: false,
  elementTargets: new WeakMap(),
  canvasEditor: null,
  patchSequence: 0,
  editorStyle: null,
  selectedMarker: null,
  dragMarker: null,
  suppressPreviewClick: false,
  previewEventCleanup: null,
  editorRuntimeId: null,
  history: createEditorHistory(50),
  projectEvents: null,
  browserFileHandle: null,
  browserFile: null,
  browserFileName: "",
  htmlFiles: [],
  fileSwitchInProgress: false,
  autoSaveError: null,
};

let autoSave = null;

// 缓存页面控件引用，后续逻辑不需要反复 querySelector。
const els = {
  openPicker: document.querySelector("#openPicker"),
  chooseFileBtn: document.querySelector("#chooseFileBtn"),
  openPickerMenu: document.querySelector("#openPickerMenu"),
  openPickerItems: [...document.querySelectorAll("[data-open-kind]")],
  htmlFileInput: document.querySelector("#htmlFileInput"),
  workspace: document.querySelector(".workspace"),
  fileCount: document.querySelector("#fileCount"),
  fileSearch: document.querySelector("#fileSearch"),
  fileList: document.querySelector("#fileList"),
  fileListEmpty: document.querySelector("#fileListEmpty"),
  toggleFilesBtn: document.querySelector("#toggleFilesBtn"),
  reloadBtn: document.querySelector("#reloadBtn"),
  preview: document.querySelector("#preview"),
  previewStatus: document.querySelector("#previewStatus"),
  status: document.querySelector("#status"),
  selectionName: document.querySelector("#selectionName"),
  selectorText: document.querySelector("#selectorText"),
  textValue: document.querySelector("#textValue"),
  fontSize: document.querySelector("#fontSize"),
  fontSizeNumber: document.querySelector("#fontSizeNumber"),
  textColor: document.querySelector("#textColor"),
  textColorValue: document.querySelector("#textColorValue"),
  posX: document.querySelector("#posX"),
  posY: document.querySelector("#posY"),
  clearBtn: document.querySelector("#clearBtn"),
  nudgeButtons: document.querySelectorAll("[data-nudge]"),
};

// 注入到 iframe 内部的辅助样式。节点引用和原属性值会被精确恢复，
// 不依赖固定 id/全局 selector 清理，避免碰到用户同名标记。
const editorStyle = `
  [data-local-editor-selected="true"] {
    cursor: text !important;
  }

  body *:hover:not([data-local-editor-selected="true"]):not([data-local-editor-editing="true"]) {
    outline: 2px dashed rgba(18, 110, 99, 0.4);
    outline-offset: 3px;
  }

  [data-local-editor-editing="true"] {
    outline: none !important;
  }

  [data-local-editor-drag-ready="true"] {
    cursor: grab !important;
  }

  [data-local-editor-drag-ready="dragging"] {
    cursor: grabbing !important;
  }

`;

// 顶部工具栏的状态提示，tone 用来区分普通、成功、错误状态。
function setStatus(message, tone = "normal") {
  els.status.textContent = message;
  els.previewStatus.dataset.tone = tone;
}

function createFileItemIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6", "m9 13-2 2 2 2", "m15 13 2 2-2 2"]) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  const wrapper = document.createElement("span");
  wrapper.className = "file-item-icon";
  wrapper.append(svg);
  return wrapper;
}

function renderHtmlFiles() {
  const query = els.fileSearch.value.trim().toLowerCase();
  const files = query
    ? state.htmlFiles.filter((file) => file.path.toLowerCase().includes(query))
    : state.htmlFiles;
  const fragment = document.createDocumentFragment();

  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-item";
    button.setAttribute("aria-label", file.path);
    button.title = file.path;
    const copy = document.createElement("span");
    copy.className = "file-item-copy";
    const name = document.createElement("span");
    name.className = "file-item-name";
    name.textContent = file.name || file.path.split("/").pop();
    const directory = document.createElement("span");
    directory.className = "file-item-dir";
    directory.textContent = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "Project root";
    copy.append(name, directory);
    button.append(createFileItemIcon(), copy);
    if (state.mode === "local" && file.path === state.currentPath) {
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", () => switchWorkspaceFile(file.path));
    fragment.append(button);
  }

  els.fileList.replaceChildren(fragment);
  els.fileCount.textContent = String(state.htmlFiles.length);
  els.fileListEmpty.hidden = files.length > 0;
}

async function refreshHtmlFiles() {
  if (state.mode !== "local") {
    state.htmlFiles = [];
    renderHtmlFiles();
    return;
  }
  const response = await fetch("/api/html-files");
  const payload = await response.json();
  if (!response.ok || !payload.ok || !Array.isArray(payload.files)) {
    throw new Error(payload.error || "Failed to load HTML file list");
  }
  state.htmlFiles = payload.files;
  renderHtmlFiles();
}

async function switchWorkspaceFile(path) {
  if (state.fileSwitchInProgress || (state.mode === "local" && path === state.currentPath)) return;
  state.fileSwitchInProgress = true;
  try {
    await saveFile();
    await loadFile(path);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.fileSwitchInProgress = false;
  }
}

// 没有选中元素时禁用右侧编辑控件；选中后统一解锁。
function setControlsEnabled(enabled) {
  els.textValue.disabled = !enabled;
  els.fontSize.disabled = !enabled;
  els.fontSizeNumber.disabled = !enabled;
  els.textColor.disabled = !enabled;
  els.posX.disabled = !enabled;
  els.posY.disabled = !enabled;
  els.clearBtn.disabled = !enabled;
  els.nudgeButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

// iframe 使用 srcdoc 加载 HTML，和父页面同源，因此可以直接访问 contentDocument。
function previewDocument() {
  return els.preview.contentDocument;
}

// srcdoc 没有本地文件 URL。仅本地项目预览需要临时 base 标签，让 link、图片、
// 字体等相对路径通过服务端受限的只读资源路由加载。
function setPreviewContent(content) {
  const html = state.mode === "local"
    ? injectPreviewBase(content, state.previewBaseHref)
    : content;
  els.preview.setAttribute("sandbox", previewSandboxForMode(state.mode));
  els.preview.srcdoc = html;
}

function selectedElement() {
  return state.selectionSnapshot?.element || null;
}

function selectedTarget() {
  return state.selectionSnapshot?.target || null;
}

function selectedSelector() {
  return state.selectionSnapshot?.selector || "";
}

function refreshSelectionSnapshot(range = null) {
  const current = state.selectionSnapshot;
  if (!current?.element?.isConnected) {
    state.selectionSnapshot = null;
    return null;
  }
  const snapshot = buildSelectionSnapshot({
    path: state.currentPath,
    element: current.element,
    target: current.target,
    selector: current.selector,
    range,
  });
  state.selectionSnapshot = snapshot;
  return snapshot;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// 在当前 iframe 或历史快照中重新定位元素。selector 优先，domPath 是无 id HTML 的回退。
function resolveTarget(root, target) {
  if (!root || !target) return null;
  if (target.selector) {
    try {
      const matches = root.querySelectorAll(target.selector);
      const match = matches[target.selectorIndex || 0];
      if (match) return match;
    } catch {
      // selector 失效时继续尝试 id/domPath。
    }
  }
  if (target.id) {
    const byId = root.querySelector(`#${CSS.escape(target.id)}`);
    if (byId) return byId;
  }
  let node = root.querySelector("body");
  for (const index of target.domPath || []) node = node?.children?.[index];
  return node || null;
}

// 历史快照包含干净 HTML 和尚未保存的 patch 队列。编辑器注入节点用本次运行时 token 精确排除。
function captureHistoryEntry() {
  const doc = previewDocument();
  if (!doc) return null;
  const clone = doc.documentElement.cloneNode(true);
  if (state.editorRuntimeId) {
    const escaped = CSS.escape(state.editorRuntimeId);
    clone.querySelectorAll(`[data-local-editor-runtime="${escaped}"]`).forEach((node) => node.remove());
  }
  clone.querySelectorAll(`[${PREVIEW_BASE_ATTRIBUTE}]`).forEach((node) => node.remove());

  const selectedClone = resolveTarget(clone, selectedTarget());
  if (selectedClone && state.selectedMarker) {
    if (state.selectedMarker.present) {
      selectedClone.setAttribute("data-local-editor-selected", state.selectedMarker.value ?? "");
    } else {
      selectedClone.removeAttribute("data-local-editor-selected");
    }
  }
  if (selectedClone && state.inlineAttributeSnapshot) {
    restoreInlineEditAttributes(selectedClone, state.inlineAttributeSnapshot);
  }
  if (selectedClone && state.dragMarker?.element === selectedElement()) {
    if (state.dragMarker.present) {
      selectedClone.setAttribute("data-local-editor-drag-ready", state.dragMarker.value ?? "");
    } else {
      selectedClone.removeAttribute("data-local-editor-drag-ready");
    }
  }

  return {
    content: `<!doctype html>\n${clone.outerHTML}\n`,
    pendingPatches: cloneValue(state.pendingPatches),
    patchSequence: state.patchSequence,
    dirty: state.dirty,
    selectedTarget: cloneValue(selectedTarget()),
  };
}

function recordHistory() {
  const entry = captureHistoryEntry();
  if (entry) state.history.push(entry);
}

// CSS 像素值可能是 "24px" 或空字符串，这里统一转成数字。
function parsePx(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function targetForElement(el) {
  const existing = state.elementTargets.get(el);
  if (existing) return existing;
  const target = createElementTarget(el, selectorFor(el));
  state.elementTargets.set(el, target);
  return target;
}

function queuePatchOperation(operation) {
  const target = selectedTarget();
  if (!target) return;
  appendStylePatch(state.pendingPatches, target, operation);
}

// 复制和删除会改变节点结构，必须保持操作顺序，不能像样式属性那样合并。
function queueStructuralPatch(target, operation) {
  state.patchSequence += 1;
  appendStructuralPatch(state.pendingPatches, target, operation, state.patchSequence);
}

function clearPendingPatches() {
  state.pendingPatches = [];
  state.patchSequence = 0;
}

function updateSelectedTextFingerprint(text) {
  const element = selectedElement();
  const currentTarget = selectedTarget();
  if (!element || !currentTarget) return;
  const target = {
    ...currentTarget,
    originalText: normalizeInlineEditText(text),
  };
  state.elementTargets.set(element, target);
  state.selectionSnapshot = buildSelectionSnapshot({
    path: state.currentPath,
    element,
    target,
    selector: selectedSelector(),
  });
}

function stopInlineTextEdit({ commit = true } = {}) {
  if (!state.inlineEditingElement) return;
  state.inlineEditCleanup?.(commit);
  state.inlineEditCleanup = null;
  state.inlineEditingElement = null;
  state.inlineAttributeSnapshot = null;
}

function restoreSelectedMarker() {
  const marker = state.selectedMarker;
  if (!marker) return;
  if (marker.present) marker.element.setAttribute("data-local-editor-selected", marker.value ?? "");
  else marker.element.removeAttribute("data-local-editor-selected");
  state.selectedMarker = null;
}

function applySelectedMarker(el) {
  state.selectedMarker = {
    element: el,
    present: el.hasAttribute("data-local-editor-selected"),
    value: el.getAttribute("data-local-editor-selected"),
  };
  el.setAttribute("data-local-editor-selected", "true");
}

function restoreDragMarker() {
  const marker = state.dragMarker;
  if (!marker) return;
  if (marker.present) marker.element.setAttribute("data-local-editor-drag-ready", marker.value ?? "");
  else marker.element.removeAttribute("data-local-editor-drag-ready");
  state.dragMarker = null;
}

function applyDragMarker(el, value = "true") {
  if (state.dragMarker?.element === el) {
    el.setAttribute("data-local-editor-drag-ready", value);
    return;
  }
  restoreDragMarker();
  if (!el?.isConnected) return;
  state.dragMarker = {
    element: el,
    present: el.hasAttribute("data-local-editor-drag-ready"),
    value: el.getAttribute("data-local-editor-drag-ready"),
  };
  el.setAttribute("data-local-editor-drag-ready", value);
}

// 给当前选中元素生成一个人能读懂的 selector，用于右侧 Selection 面板展示。
// 如果元素有 id，优先展示 #id；否则退化成 nth-of-type 路径。
function selectorFor(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node.tagName !== "HTML") {
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

// 取消选中时，清理 iframe 内的选中标记，并把右侧面板恢复到初始状态。
function clearSelection() {
  stopInlineTextEdit({ commit: false });
  restoreDragMarker();
  restoreSelectedMarker();
  state.selectionSnapshot = null;
  state.canvasEditor?.clear();
  els.selectionName.textContent = "No element selected";
  els.selectorText.textContent = "Click text in the preview";
  els.textValue.value = "";
  els.fontSize.value = "16";
  els.fontSizeNumber.value = "16";
  els.textColor.value = "#15181d";
  els.textColorValue.value = "#15181d";
  els.posX.value = "0";
  els.posY.value = "0";
  setControlsEnabled(false);
}

// 将当前选中元素的真实 DOM 状态同步到右侧表单。
// 字号和位置都从 computedStyle/实际定位起点同步，避免 CSS 类中的 left/top 跳变。
function syncInspector() {
  const snapshot = state.selectionSnapshot;
  const el = snapshot?.element;
  if (!el) {
    clearSelection();
    return;
  }

  const computed = el.ownerDocument.defaultView.getComputedStyle(el);
  const fontSize = Math.round(parsePx(computed.fontSize, 16));
  const textColor = cssColorToHex(computed.color, "#15181d");
  const rect = el.getBoundingClientRect();
  const left = Math.round(positionStart({
    position: computed.position,
    computedValue: computed.left,
    inlineValue: el.style.left,
    offsetValue: el.offsetLeft,
    rectValue: rect.left,
  }));
  const top = Math.round(positionStart({
    position: computed.position,
    computedValue: computed.top,
    inlineValue: el.style.top,
    offsetValue: el.offsetTop,
    rectValue: rect.top,
  }));
  const tag = el.tagName.toLowerCase();

  els.selectionName.textContent = el.id ? `${tag}#${el.id}` : tag;
  els.selectorText.textContent = snapshot.selector;
  els.textValue.value = editableTextValue(el);
  els.fontSize.value = String(Math.max(8, Math.min(140, fontSize)));
  els.fontSizeNumber.value = String(fontSize);
  els.textColor.value = textColor;
  els.textColorValue.value = textColor;
  els.posX.value = String(left);
  els.posY.value = String(top);
  setControlsEnabled(true);
}

// 记录新的选中元素，并在 iframe 内给它加 data-local-editor-selected 以显示描边。
function selectElement(el) {
  if (selectedElement() === el) {
    refreshSelectionSnapshot();
    state.canvasEditor?.select(state.selectionSnapshot);
    syncInspector();
    return;
  }
  clearSelection();
  const selector = selectorFor(el);
  state.selectionSnapshot = buildSelectionSnapshot({
    path: state.currentPath,
    element: el,
    target: targetForElement(el),
    selector,
  });
  applySelectedMarker(el);
  state.canvasEditor?.select(state.selectionSnapshot);
  syncInspector();
  setStatus(`Selected ${selector}`);
}

function editableTextValue(el) {
  return preservesTextWhitespace(el)
    ? String(el?.textContent || "")
    : normalizeInlineEditText(el?.textContent);
}

function commitInlineTextEdit(el, originalText, editSnapshot = null) {
  const text = editableTextValue(el);
  els.textValue.value = text;
  const preservesMarkup = editSnapshot != null;
  if (preservesMarkup ? el.innerHTML === editSnapshot.html : text === originalText) {
    state.canvasEditor?.refresh();
    return true;
  }
  if (preservesMarkup) {
    const structure = textStructureSignature(el);
    const fields = collectEditableTextFields(el);
    const operations = structure === editSnapshot.structure
      ? planTextFieldContentOperations(editSnapshot.fields, fields)
      : null;
    if (!operations) {
      el.innerHTML = editSnapshot.html;
      els.textValue.value = originalText;
      setStatus("This edit changed the HTML structure and was reverted", "error");
      state.canvasEditor?.refresh();
      return false;
    }
    if (operations.length === 0) {
      el.innerHTML = editSnapshot.html;
      state.canvasEditor?.refresh();
      return true;
    }
    for (const operation of operations) queuePatchOperation(operation);
  } else {
    el.textContent = text;
    queuePatchOperation({ type: "text-content", value: text });
  }
  // contenteditable 会替长连续字符串提供额外断行机会。属性恢复后再测量真实
  // 页面布局，只在确实横向溢出时补齐可持久化的换行规则。
  if (!el.style.overflowWrap && isTextHorizontallyOverflowing(el)) {
    el.style.overflowWrap = "anywhere";
    queuePatchOperation({ type: "inline-style", property: "overflow-wrap", value: "anywhere" });
  }
  updateSelectedTextFingerprint(text);
  markDirty();
  state.canvasEditor?.refresh();
  return true;
}

function normalizeEditableWhitespace(el) {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, doc.defaultView.NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  const normalized = normalizeTextChunks(textNodes.map((node) => node.data));
  textNodes.forEach((node, index) => {
    node.data = normalized[index];
  });
}

function placeInlineCaret(el, caret) {
  if (!caret?.node?.isConnected || !el.contains(caret.node)) return;
  const selection = el.ownerDocument.defaultView.getSelection();
  const range = el.ownerDocument.createRange();
  const maxOffset = caret.node.nodeType === 3
    ? caret.node.data.length
    : caret.node.childNodes.length;
  range.setStart(caret.node, Math.max(0, Math.min(caret.offset, maxOffset)));
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretAtPoint(doc, event, target) {
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position?.offsetNode && target.contains(position.offsetNode)) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range?.startContainer && target.contains(range.startContainer)) {
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

function beginInlineTextEdit(el, caret = null) {
  if (state.inlineEditingElement === el) return;
  stopInlineTextEdit({ commit: true });
  selectElement(el);

  const addedFixedWidthWrap = shouldEnsureFixedWidthWrap(el);
  if (addedFixedWidthWrap) {
    recordHistory();
    el.style.overflowWrap = "anywhere";
    queuePatchOperation({ type: "inline-style", property: "overflow-wrap", value: "anywhere" });
    markDirty();
    const snapshot = refreshSelectionSnapshot();
    state.canvasEditor?.select(snapshot);
    syncInspector();
  }

  const originalText = editableTextValue(el);
  const preserveMarkup = isEditableMixedTextRoot(el) || el.children.length > 0;
  const editSnapshot = preserveMarkup ? {
    html: el.innerHTML,
    fields: collectEditableTextFields(el),
    structure: textStructureSignature(el),
  } : null;
  const attributeSnapshot = captureInlineEditAttributes(el);
  state.inlineEditingElement = el;
  state.inlineAttributeSnapshot = attributeSnapshot;
  // 普通文案折叠源码缩进；code/pre/kbd/samp 保留作者输入的空格和换行。
  if (!preserveMarkup && !preservesTextWhitespace(el)) normalizeEditableWhitespace(el);
  applyInlineEditAttributes(el, { preserveMarkup });
  el.focus({ preventScroll: true });
  placeInlineCaret(el, caret);

  let finished = false;
  let historyRecorded = addedFixedWidthWrap;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    el.removeEventListener("blur", onBlur, true);
    el.removeEventListener("keydown", onKeyDown, true);
    el.removeEventListener("beforeinput", onBeforeInput, true);
    if (!commit) {
      if (editSnapshot) el.innerHTML = editSnapshot.html;
      else el.textContent = originalText;
      els.textValue.value = originalText;
      restoreInlineEditAttributes(el, attributeSnapshot);
    } else {
      // 先恢复成普通页面元素，再提交并检测失焦后的真实溢出状态。
      restoreInlineEditAttributes(el, attributeSnapshot);
      commitInlineTextEdit(el, originalText, editSnapshot);
    }
    state.inlineEditingElement = null;
    state.inlineEditCleanup = null;
    state.inlineAttributeSnapshot = null;
  };

  function onBeforeInput() {
    if (historyRecorded) return;
    historyRecorded = true;
    recordHistory();
  }

  function onBlur() {
    finish(true);
  }

  function onKeyDown(event) {
    if (shouldCancelInlineEdit(event)) {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      return;
    }
    if (shouldCommitInlineEdit(event)) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
  }

  el.addEventListener("blur", onBlur, true);
  el.addEventListener("keydown", onKeyDown, true);
  el.addEventListener("beforeinput", onBeforeInput, true);
  state.inlineEditCleanup = finish;
  setStatus(`Editing ${selectedSelector()}`);
}

// 每次 iframe 加载新 HTML 后，都要重新注入编辑层。
// 监听器挂在 iframe document 上，用户点击预览里的文字时会选中对应元素。
function injectEditorLayer() {
  const doc = previewDocument();
  if (!doc) return;

  state.previewEventCleanup?.();
  state.previewEventCleanup = null;
  state.suppressPreviewClick = false;

  state.editorStyle?.remove();
  state.editorRuntimeId = `local-editor-${crypto.randomUUID()}`;

  const style = doc.createElement("style");
  style.dataset.localEditorRuntime = state.editorRuntimeId;
  style.textContent = editorStyle;
  doc.head.appendChild(style);
  state.editorStyle = style;

  state.canvasEditor?.destroy();
  state.canvasEditor = createCanvasTextEditor({
    document: doc,
    runtimeId: state.editorRuntimeId,
    onBeforeChange: recordHistory,
    onStyleOperations(operations, _element, range) {
      for (const operation of operations) {
        queuePatchOperation({ type: "inline-style", ...operation });
      }
      markDirty();
      const snapshot = refreshSelectionSnapshot(range);
      state.canvasEditor?.updateSelection(snapshot, range);
      syncInspector();
    },
    onInlineHtmlChange(innerHtml, _element, range) {
      queuePatchOperation({ type: "inner-html", value: innerHtml });
      markDirty();
      const snapshot = refreshSelectionSnapshot(range);
      state.canvasEditor?.updateSelection(snapshot, range);
      state.canvasEditor?.refresh();
    },
    onDuplicate(original, clone, newId) {
      const originalTarget = targetForElement(original);
      queueStructuralPatch(originalTarget, { type: "duplicate-element", newId });
      markDirty();
      selectElement(clone);
    },
    onDelete(element) {
      const target = targetForElement(element);
      queueStructuralPatch(target, { type: "delete-element" });
      markDirty();
      clearSelection();
    },
    onSelectionChange() {
      syncInspector();
    },
    onTextRangeChange(range) {
      if (range) restoreDragMarker();
      const snapshot = refreshSelectionSnapshot(range);
      state.canvasEditor?.updateSelection(snapshot, range);
    },
    onMoveStart(element) {
      state.suppressPreviewClick = true;
      applyDragMarker(element, "dragging");
    },
    onMoveEnd(element, moved) {
      if (element?.isConnected) applyDragMarker(element, "true");
      if (moved) {
        setTimeout(() => {
          state.suppressPreviewClick = false;
        }, 0);
      }
    },
  });

  const dragTargetForEvent = (event) => dragTargetAtPoint({
    target: event.target,
    x: event.clientX,
    y: event.clientY,
    selection: doc.defaultView.getSelection(),
    inlineEditingElement: state.inlineEditingElement,
    selectedElement: selectedElement(),
  });

  const onPointerMove = (event) => {
    if (event.buttons) return;
    const target = dragTargetForEvent(event);
    if (target) applyDragMarker(target);
    else restoreDragMarker();
  };

  const onPointerOut = (event) => {
    if (!event.relatedTarget) restoreDragMarker();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const target = dragTargetForEvent(event);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopInlineTextEdit({ commit: true });
    selectElement(target);
    applyDragMarker(target);
    state.canvasEditor?.beginMove(event, {
      captureTarget: target,
      activationDistance: 3,
    });
  };

  const onClick = (event) => {
    if (state.suppressPreviewClick) {
      state.suppressPreviewClick = false;
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
    const target = resolveEditableTextTarget(event.target);
    if (!target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopInlineTextEdit({ commit: true });
      clearSelection();
      setStatus("Selection cleared");
      return;
    }
    // 原页面的 click 处理器不参与编辑模式；当前 contenteditable 仍保留
    // 浏览器移动插入光标的默认行为。
    event.stopImmediatePropagation();
    if (state.inlineEditingElement === target) return;
    event.preventDefault();
    beginInlineTextEdit(target, caretAtPoint(doc, event, target));
  };

  const onToggle = () => state.canvasEditor?.refresh();

  doc.addEventListener("pointermove", onPointerMove, true);
  doc.addEventListener("pointerout", onPointerOut, true);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("toggle", onToggle, true);
  doc.addEventListener("keydown", handleEditorShortcut);
  state.previewEventCleanup = () => {
    doc.removeEventListener("pointermove", onPointerMove, true);
    doc.removeEventListener("pointerout", onPointerOut, true);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("toggle", onToggle, true);
    doc.removeEventListener("keydown", handleEditorShortcut);
    restoreDragMarker();
  };

  activateEmbeddedPreview(doc);
}

function restoreHistoryEntry(entry, message) {
  if (!entry) return;
  autoSave?.cancel();
  stopInlineTextEdit({ commit: false });
  state.previewEventCleanup?.();
  state.previewEventCleanup = null;
  state.canvasEditor?.destroy();
  state.canvasEditor = null;
  state.editorStyle?.remove();
  state.editorStyle = null;
  clearSelection();

  state.pendingPatches = cloneValue(entry.pendingPatches) || [];
  state.patchSequence = entry.patchSequence || 0;
  state.dirty = Boolean(entry.dirty);
  state.autoSaveError = null;
  els.preview.addEventListener(
    "load",
    () => {
      injectEditorLayer();
      const restored = resolveTarget(previewDocument()?.documentElement, entry.selectedTarget);
      if (restored?.nodeType === 1) selectElement(restored);
      setStatus(message, "ok");
      if (state.dirty) autoSave?.schedule();
    },
    { once: true },
  );
  setPreviewContent(entry.content);
}

function undoEdit() {
  const current = captureHistoryEntry();
  const previous = current && state.history.undo(current);
  if (!previous) {
    setStatus("Nothing to undo");
    return;
  }
  restoreHistoryEntry(previous, "Undid last change");
}

function redoEdit() {
  const current = captureHistoryEntry();
  const next = current && state.history.redo(current);
  if (!next) {
    setStatus("Nothing to redo");
    return;
  }
  restoreHistoryEntry(next, "Redid last change");
}

function isFormControl(target) {
  return Boolean(target?.closest?.("input, textarea, select, button"));
}

function handleEditorShortcut(event) {
  const key = event.key.toLowerCase();
  const modifier = event.metaKey || event.ctrlKey;

  // contenteditable 内部保留浏览器自己的逐字撤销；失焦提交后再进入编辑器历史。
  if (event.target?.isContentEditable) return;
  if (modifier && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoEdit();
    else undoEdit();
    return;
  }
  if (modifier && key === "y") {
    event.preventDefault();
    redoEdit();
    return;
  }
  const element = selectedElement();
  if (!element || isFormControl(event.target)) return;

  if (modifier && key === "d") {
    event.preventDefault();
    state.canvasEditor?.duplicateSelected();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    state.canvasEditor?.deleteSelected();
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    recordHistory();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    els.posX.value = String(parsePx(els.posX.value) + dx);
    els.posY.value = String(parsePx(els.posY.value) + dy);
    updatePositionFromInputs();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    beginInlineTextEdit(element);
    return;
  }
  if (event.key === "Escape") clearSelection();
}

// 用户改了文字、字号或位置后，标记为未保存。
function markDirty() {
  state.dirty = true;
  setStatus("Unsaved changes", "warn");
  autoSave?.schedule();
}

// left/top 只有在元素不是 static 定位时才会生效。
// 为了尽量不打乱原布局，这里使用 relative，让元素基于原位置偏移。
function ensurePositioned(el) {
  const computed = el.ownerDocument.defaultView.getComputedStyle(el);
  if (computed.position === "static") {
    el.style.position = "relative";
    return true;
  }
  return false;
}

// 将右侧 X/Y 输入框的值写回选中元素的内联样式。
function updatePositionFromInputs() {
  const element = selectedElement();
  if (!element) return;
  if (ensurePositioned(element)) {
    queuePatchOperation({ type: "inline-style", property: "position", value: "relative" });
  }
  element.style.left = `${parsePx(els.posX.value)}px`;
  element.style.top = `${parsePx(els.posY.value)}px`;
  queuePatchOperation({ type: "inline-style", property: "left", value: element.style.left });
  queuePatchOperation({ type: "inline-style", property: "top", value: element.style.top });
  markDirty();
  refreshSelectionSnapshot();
  state.canvasEditor?.sync();
}

// 从本地服务读取 HTML，并放进 iframe.srcdoc。
// path 可以是项目相对路径、绝对路径或 file:// URL。
// load 监听必须先注册再设置 srcdoc，避免 HTML 很小时错过 load 事件。
async function loadFile(path = state.currentPath) {
  autoSave?.cancel();
  state.currentPath = path || (state.mode === "browser-file" ? "" : state.currentPath);
  if (!state.currentPath) throw new Error("Choose an HTML file to load");
  setStatus("Loading...");
  stopInlineTextEdit({ commit: false });
  state.previewEventCleanup?.();
  state.previewEventCleanup = null;
  state.canvasEditor?.destroy();
  state.canvasEditor = null;
  state.editorStyle?.remove();
  state.editorStyle = null;
  clearSelection();

  const response = await fetch(`/api/file?path=${encodeURIComponent(state.currentPath)}`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Failed to load file");
  }

  state.source = payload.content;
  state.mode = "local";
  state.currentPath = payload.path;
  state.previewBaseHref = payload.previewBase || "";
  state.browserFileHandle = null;
  state.browserFile = null;
  state.browserFileName = "";
  clearPendingPatches();
  state.history.clear();
  state.dirty = false;
  state.autoSaveError = null;
  await refreshHtmlFiles();
  els.preview.addEventListener(
    "load",
    () => {
      injectEditorLayer();
      setStatus(`Loaded ${payload.path}`, "ok");
    },
    { once: true },
  );
  setPreviewContent(state.source);
}

function isHtmlFile(file) {
  return Boolean(file && /\.html$/i.test(file.name));
}

// 文件选择器加载任意本地 HTML。浏览器不会暴露绝对路径，因此这里保存
// FileSystemFileHandle；后续保存由该句柄写回，而不是把路径交给服务器。
async function loadBrowserHtmlFile(file, handle = null) {
  if (!isHtmlFile(file)) throw new Error("Only one .html file can be selected");
  const content = await file.text();

  const resolved = await postJson("/api/resolve-project-file", {
    name: file.name,
    content,
  });
  if (resolved.matched && resolved.path) {
    await loadFile(resolved.path);
    return;
  }

  stopInlineTextEdit({ commit: false });
  state.canvasEditor?.destroy();
  state.canvasEditor = null;
  state.editorStyle?.remove();
  state.editorStyle = null;
  clearSelection();

  state.currentPath = file.name;
  state.source = content;
  state.mode = "browser-file";
  state.previewBaseHref = "";
  state.browserFileHandle = handle;
  state.browserFile = file;
  state.browserFileName = file.name;
  state.htmlFiles = [];
  renderHtmlFiles();
  clearPendingPatches();
  state.history.clear();
  state.dirty = false;
  state.autoSaveError = null;
  els.preview.addEventListener(
    "load",
    () => {
      injectEditorLayer();
      const suffix = handle ? "" : " Auto-save requires file write permission.";
      setStatus(`Loaded ${file.name}.${suffix}`, "ok");
    },
    { once: true },
  );
  setPreviewContent(content);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Save failed");
  }
  return data;
}

function serializablePatches(patches) {
  return patches.map(({ target, operations }) => ({ target, operations }));
}

// Auto-save detaches the current batch before writing. Edits made while the
// request is in flight accumulate in a fresh queue and cannot be cleared by an
// older response.
async function flushPendingPatches() {
  if (!state.dirty || state.pendingPatches.length === 0) {
    state.dirty = false;
    return true;
  }
  // contenteditable is committed on blur. Saving during an active composition
  // would disturb the caret and can capture an invalid intermediate DOM shape.
  if (state.inlineEditingElement) return false;

  const batch = state.pendingPatches;
  state.pendingPatches = [];
  state.autoSaveError = null;
  setStatus("Saving changes...");

  try {
    let payload;
    if (state.mode === "browser-file") {
      if (!state.browserFileHandle) {
        throw new Error("Auto-save needs file write permission. Choose the HTML file again.");
      }
      payload = await postJson("/api/patch-content", {
        content: state.source,
        patches: serializablePatches(batch),
      });
      if (payload.matched === false) {
        const suffix = Number.isInteger(payload.failedIndex) ? ` at operation ${payload.failedIndex + 1}` : "";
        throw new Error(`Selected element could not be resolved in the source HTML${suffix}`);
      }
      const writable = await state.browserFileHandle.createWritable();
      await writable.write(payload.content);
      await writable.close();
    } else {
      payload = await postJson("/api/patch-elements", {
        path: state.currentPath,
        patches: serializablePatches(batch),
      });
      if (payload.matched === false) {
        const suffix = Number.isInteger(payload.failedIndex) ? ` at operation ${payload.failedIndex + 1}` : "";
        throw new Error(`Selected element could not be resolved in the source HTML${suffix}`);
      }
    }

    state.source = payload.content || state.source;
    state.dirty = state.pendingPatches.length > 0;
    if (state.dirty) {
      setStatus("Unsaved changes", "warn");
      autoSave?.schedule();
    } else {
      // The old manual Save reloaded the iframe and cleared history. Auto-save
      // keeps the live DOM and selection, but closes the persisted undo batch so
      // a later undo cannot diverge from the file on disk.
      state.history.clear();
      setStatus(`Saved ${state.currentPath}`, "ok");
    }
    return true;
  } catch (error) {
    state.pendingPatches = [...batch, ...state.pendingPatches];
    state.dirty = true;
    state.autoSaveError = error;
    setStatus(`Auto-save failed: ${error.message}`, "error");
    return true;
  }
}

autoSave = createAutoSaveController({
  delay: 1_200,
  maxWait: 5_000,
  save: flushPendingPatches,
});

// Explicit transitions commit an active text edit and wait for the same
// background pipeline, so switching files never races an unfinished write.
async function saveFile() {
  stopInlineTextEdit({ commit: true });
  await autoSave.flushNow();
  if (state.dirty) {
    throw state.autoSaveError || new Error("The current changes could not be saved");
  }
}

els.fileSearch.addEventListener("input", renderHtmlFiles);
els.toggleFilesBtn.addEventListener("click", () => {
  const collapsed = !els.workspace.classList.contains("files-collapsed");
  els.workspace.classList.toggle("files-collapsed", collapsed);
  els.toggleFilesBtn.title = collapsed ? "Show HTML files" : "Hide HTML files";
  els.toggleFilesBtn.setAttribute("aria-label", els.toggleFilesBtn.title);
  els.toggleFilesBtn.setAttribute("aria-expanded", String(!collapsed));
});

function setOpenPickerMenu(open) {
  els.openPickerMenu.hidden = !open;
  els.chooseFileBtn.setAttribute("aria-expanded", String(open));
}

async function chooseLocalInput(kind) {
  setOpenPickerMenu(false);
  try {
    await saveFile();
    const response = await fetch("/api/select-local-path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const payload = await response.json();
    if (response.ok && payload.ok) {
      if (!payload.cancelled) await loadFile(payload.path);
      return;
    }
    if (payload.code !== "PICKER_UNAVAILABLE") {
      throw new Error(payload.error || "Failed to choose HTML file");
    }
  } catch (error) {
    if (error?.message !== "Native file picker is unavailable") {
      setStatus(error.message, "error");
      return;
    }
  }

  if (kind === "directory") {
    setStatus("Folder selection requires the local CLI desktop picker.", "error");
    return;
  }

  // Non-desktop environments fall back to the browser picker. The browser
  // intentionally hides absolute paths, so related local assets may be unavailable.
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        excludeAcceptAllOption: true,
        multiple: false,
        types: [
          {
            description: "HTML file",
            accept: { "text/html": [".html"] },
          },
        ],
      });
      await loadBrowserHtmlFile(await handle.getFile(), handle);
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(error.message, "error");
    }
    return;
  }
  els.htmlFileInput.click();
}

els.chooseFileBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setOpenPickerMenu(els.openPickerMenu.hidden);
});
els.openPickerMenu.addEventListener("click", (event) => event.stopPropagation());
els.openPickerItems.forEach((button) => {
  button.addEventListener("click", () => chooseLocalInput(button.dataset.openKind));
});
document.addEventListener("click", (event) => {
  if (!els.openPicker.contains(event.target)) setOpenPickerMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.openPickerMenu.hidden) {
    event.stopPropagation();
    setOpenPickerMenu(false);
    els.chooseFileBtn.focus();
  }
});
els.htmlFileInput.addEventListener("change", async () => {
  const files = [...els.htmlFileInput.files];
  try {
    if (files.length !== 1 || !isHtmlFile(files[0])) {
      throw new Error("Only one .html file can be selected");
    }
    await loadBrowserHtmlFile(files[0]);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.htmlFileInput.value = "";
  }
});

// Reload：重新从磁盘读取当前文件，会丢弃未保存的 iframe 内改动。
els.reloadBtn.addEventListener("click", async () => {
  try {
    await saveFile();
    if (state.mode === "browser-file") {
      const file = state.browserFileHandle
        ? await state.browserFileHandle.getFile()
        : state.browserFile;
      await loadBrowserHtmlFile(file, state.browserFileHandle);
      return;
    }
    await loadFile(state.currentPath);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

els.clearBtn.addEventListener("click", clearSelection);

// 文案编辑是即时预览：textarea 改动会立刻写到 iframe 选中元素的 textContent。
els.textValue.addEventListener("input", () => {
  const element = selectedElement();
  if (!element) return;
  recordHistory();
  element.textContent = els.textValue.value;
  queuePatchOperation({ type: "text-content", value: els.textValue.value });
  updateSelectedTextFingerprint(els.textValue.value);
  markDirty();
  state.canvasEditor?.refresh();
});

// 字号编辑同样即时预览，最终以 inline style 的方式保存到 HTML 中。
function updateFontSize(value) {
  const element = selectedElement();
  if (!element) return;
  const size = Math.max(8, Math.min(140, parsePx(value, 16)));
  element.style.fontSize = `${size}px`;
  els.fontSize.value = String(size);
  els.fontSizeNumber.value = String(size);
  queuePatchOperation({ type: "inline-style", property: "font-size", value: element.style.fontSize });
  markDirty();
  refreshSelectionSnapshot();
  state.canvasEditor?.sync();
}

els.fontSize.addEventListener("input", () => {
  recordHistory();
  updateFontSize(els.fontSize.value);
});
els.fontSizeNumber.addEventListener("input", () => {
  recordHistory();
  updateFontSize(els.fontSizeNumber.value);
});
els.textColor.addEventListener("input", () => {
  const element = selectedElement();
  if (!element) return;
  recordHistory();
  const color = els.textColor.value.toLowerCase();
  element.style.color = color;
  els.textColorValue.value = color;
  queuePatchOperation({ type: "inline-style", property: "color", value: color });
  markDirty();
  refreshSelectionSnapshot();
  state.canvasEditor?.sync();
});
els.posX.addEventListener("input", () => {
  recordHistory();
  updatePositionFromInputs();
});
els.posY.addEventListener("input", () => {
  recordHistory();
  updatePositionFromInputs();
});

// 方向按钮只是对 X/Y 数字做 +/-1，然后复用同一套位置写回逻辑。
els.nudgeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    recordHistory();
    const [dx, dy] = button.dataset.nudge.split(",").map(Number);
    els.posX.value = String(parsePx(els.posX.value) + dx);
    els.posY.value = String(parsePx(els.posY.value) + dy);
    updatePositionFromInputs();
  });
});

// 有未保存修改时，刷新/关闭页面前给用户一次浏览器原生提醒。
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  void saveFile().catch(() => {});
  event.preventDefault();
  event.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.dirty) {
    void saveFile().catch(() => {});
  }
});
window.addEventListener("keydown", handleEditorShortcut);

// 本地文件被其他编辑器修改时，通过服务端 SSE 获知。编辑器不会自动重载
// iframe，避免保存或外部写盘打断当前选区、光标和拖拽状态。
function connectProjectEvents() {
  state.projectEvents?.close();
  const events = new EventSource("/api/events");
  events.addEventListener("file-change", async (event) => {
    const change = JSON.parse(event.data);
    if (state.mode !== "local") return;
    try {
      await refreshHtmlFiles();
    } catch (error) {
      setStatus(error.message, "error");
    }
    if (change.path !== state.currentPath) return;
    if (!state.dirty) setStatus(`${change.path} changed on disk. Reload to update the preview.`, "warn");
  });
  state.projectEvents = events;
}

// CLI 启动时决定项目根和默认文件，前端不再依赖包内 samples 路径。
async function bootstrapProject() {
  const response = await fetch("/api/project");
  const project = await response.json();
  if (!response.ok || !project.ok) throw new Error(project.error || "Failed to load project");
  state.currentPath = project.defaultFile;
  await loadFile(project.defaultFile);
  if (project.watch) connectProjectEvents();
}

window.addEventListener("pagehide", () => {
  state.projectEvents?.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) connectProjectEvents();
});

bootstrapProject().catch((error) => {
  setStatus(error.message, "error");
});
