import { createCanvasTextEditor } from "../../public/canvasTextEditor.js";
import { createHtmlEditorRuntime } from "../editor/index.js";
import {
  mountedOverflowForFitMode,
  originalFrameSize,
  resolveMountedFitMode,
} from "./fitPresentation.js";

function createDefaultUi({ document, runtimeId, callbacks }) {
  return createCanvasTextEditor({
    document,
    runtimeId,
    ...callbacks,
  });
}

/**
 * Mounts the default iframe editor without the standalone file browser shell.
 * Persistence belongs to the host application through onChange.
 */
export function mountHtmlEditor({
  container,
  html = "",
  baseUrl = "",
  allowScripts = false,
  readonly = false,
  fit = "none",
  scaleToFit,
  showScaleToggle = true,
  onChange,
  onError,
  onSelectionChange,
  onFitChange,
  className = "",
  title = "HTML editor preview",
  historyLimit = 50,
} = {}) {
  if (!container || typeof container.append !== "function") {
    throw new TypeError("mountHtmlEditor requires a container element");
  }

  const document = container.ownerDocument || globalThis.document;
  let mountedFitMode = resolveMountedFitMode({ fit, scaleToFit });
  const root = document.createElement("div");
  root.className = ["deckflow-html-editor", className].filter(Boolean).join(" ");
  root.setAttribute("data-deckflow-html-editor", "");
  root.dataset.readonly = String(Boolean(readonly));
  root.dataset.fit = mountedFitMode;
  root.dataset.scale = "1";
  root.style.cssText = [
    "position:relative",
    "width:100%",
    "height:100%",
    "min-height:320px",
    "overflow:hidden",
    "background:#fff",
  ].join(";");

  const viewport = document.createElement("div");
  viewport.className = "deckflow-html-editor__viewport";
  viewport.setAttribute("data-deckflow-html-editor-viewport", "");
  viewport.style.cssText = [
    "position:absolute",
    "inset:0",
    `overflow:${mountedOverflowForFitMode(mountedFitMode)}`,
    "overscroll-behavior:contain",
    "background:#fff",
  ].join(";");

  const iframe = document.createElement("iframe");
  iframe.className = "deckflow-html-editor__preview";
  iframe.title = title;
  iframe.style.cssText = [
    "display:block",
    "width:100%",
    "height:100%",
    "min-height:inherit",
    "max-width:none",
    "max-height:none",
    "border:0",
    "background:#fff",
  ].join(";");
  viewport.append(iframe);
  root.append(viewport);

  const scaleToggle = document.createElement("label");
  scaleToggle.className = "deckflow-html-editor__scale-toggle";
  scaleToggle.setAttribute("data-deckflow-html-editor-control", "");
  scaleToggle.style.cssText = [
    "position:absolute",
    "z-index:2147483647",
    "top:12px",
    "right:12px",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "height:32px",
    "padding:0 9px",
    "border:1px solid rgba(15,23,42,.16)",
    "border-radius:6px",
    "background:rgba(255,255,255,.94)",
    "box-shadow:0 4px 14px rgba(15,23,42,.12)",
    "color:#1f2937",
    "font:600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "cursor:pointer",
    "user-select:none",
    "-webkit-user-select:none",
    "backdrop-filter:blur(8px)",
  ].join(";");

  const scaleToggleLabel = document.createElement("span");
  scaleToggleLabel.textContent = "Fit";

  const scaleToggleInput = document.createElement("input");
  scaleToggleInput.type = "checkbox";
  scaleToggleInput.checked = mountedFitMode !== "none";
  scaleToggleInput.setAttribute("aria-label", "Scale preview to fit");
  scaleToggleInput.style.cssText = [
    "appearance:none",
    "-webkit-appearance:none",
    "position:relative",
    "width:28px",
    "height:16px",
    "margin:0",
    "border:0",
    "border-radius:999px",
    `background:${scaleToggleInput.checked ? "#0f766e" : "#9ca3af"}`,
    "cursor:pointer",
    "transition:background 140ms ease",
  ].join(";");

  const scaleToggleThumb = document.createElement("span");
  scaleToggleThumb.setAttribute("aria-hidden", "true");
  scaleToggleThumb.style.cssText = [
    "position:absolute",
    "pointer-events:none",
    "top:8px",
    `right:${scaleToggleInput.checked ? "11px" : "23px"}`,
    "width:12px",
    "height:12px",
    "border-radius:50%",
    "background:#fff",
    "box-shadow:0 1px 3px rgba(15,23,42,.28)",
    "transform:translateY(-50%)",
    "transition:right 140ms ease",
  ].join(";");

  scaleToggle.append(scaleToggleLabel, scaleToggleInput, scaleToggleThumb);
  if (showScaleToggle) root.append(scaleToggle);
  container.append(root);

  let destroyed = false;
  let originalSizeFrame = null;
  let originalSizeTimer = null;
  let originalSizeLoadCleanup = null;
  let originalSizeResourceCleanup = null;
  let originalSizeHostObserver = null;
  const hostWindow = document.defaultView;

  function cancelOriginalSize() {
    if (originalSizeFrame != null) {
      hostWindow?.cancelAnimationFrame(originalSizeFrame);
      originalSizeFrame = null;
    }
    if (originalSizeTimer != null) {
      hostWindow?.clearTimeout(originalSizeTimer);
      originalSizeTimer = null;
    }
  }

  function restoreHostSizedIframe() {
    iframe.style.width = "100%";
    iframe.style.height = "100%";
  }

  function previewContentSize() {
    const previewDocument = iframe.contentDocument;
    const documentElement = previewDocument?.documentElement;
    const body = previewDocument?.body;
    return {
      width: Math.max(
        documentElement?.scrollWidth || 0,
        documentElement?.offsetWidth || 0,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0,
      ),
      height: Math.max(
        documentElement?.scrollHeight || 0,
        documentElement?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
      ),
    };
  }

  function syncScaleToggle() {
    const enabled = mountedFitMode !== "none";
    scaleToggleInput.checked = enabled;
    scaleToggleInput.style.background = enabled ? "#0f766e" : "#9ca3af";
    scaleToggleThumb.style.right = enabled ? "11px" : "23px";
    scaleToggle.title = enabled
      ? "Keep the original size"
      : "Scale the preview to fit";
  }

  function measureOriginalSize() {
    originalSizeFrame = null;
    if (destroyed || mountedFitMode !== "none") return;

    const scrollLeft = viewport.scrollLeft;
    const scrollTop = viewport.scrollTop;
    const availableWidth = Math.max(1, viewport.clientWidth);
    const availableHeight = Math.max(1, viewport.clientHeight);

    // Start from the visible viewport so scrollWidth/scrollHeight reveal the
    // authored fixed canvas instead of retaining a previous measurement.
    iframe.style.width = `${availableWidth}px`;
    iframe.style.height = `${availableHeight}px`;
    const content = previewContentSize();
    const size = originalFrameSize({
      availableWidth,
      availableHeight,
      contentWidth: content.width,
      contentHeight: content.height,
    });
    iframe.style.width = `${size.width}px`;
    iframe.style.height = `${size.height}px`;
    viewport.scrollLeft = scrollLeft;
    viewport.scrollTop = scrollTop;
  }

  function scheduleOriginalSize() {
    if (destroyed || mountedFitMode !== "none") return;
    cancelOriginalSize();
    if (hostWindow?.requestAnimationFrame) {
      originalSizeFrame = hostWindow.requestAnimationFrame(measureOriginalSize);
      originalSizeTimer = hostWindow.setTimeout(() => {
        originalSizeTimer = null;
        measureOriginalSize();
      }, 220);
      return;
    }
    measureOriginalSize();
  }

  function installOriginalSizeResourceSignals() {
    originalSizeResourceCleanup?.();
    originalSizeResourceCleanup = null;
    const previewDocument = iframe.contentDocument;
    if (!previewDocument) return;
    const handleResourceLoad = () => scheduleOriginalSize();
    previewDocument.addEventListener("load", handleResourceLoad, true);
    previewDocument.fonts?.ready?.then(scheduleOriginalSize);
    originalSizeResourceCleanup = () => {
      previewDocument.removeEventListener("load", handleResourceLoad, true);
    };
  }

  function applyMountedFitPresentation(mode) {
    mountedFitMode = mode;
    root.dataset.fit = mode;
    viewport.style.overflow = mountedOverflowForFitMode(mode);
    syncScaleToggle();
    if (mode === "none") {
      scheduleOriginalSize();
    } else {
      cancelOriginalSize();
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }

  const handleIframeLoad = () => {
    installOriginalSizeResourceSignals();
    scheduleOriginalSize();
  };
  iframe.addEventListener("load", handleIframeLoad);
  originalSizeLoadCleanup = () => iframe.removeEventListener("load", handleIframeLoad);
  const ResizeObserverCtor = hostWindow?.ResizeObserver;
  if (ResizeObserverCtor) {
    originalSizeHostObserver = new ResizeObserverCtor(scheduleOriginalSize);
    originalSizeHostObserver.observe(viewport);
  }

  const runtime = createHtmlEditorRuntime({
    iframe,
    html,
    baseUrl,
    allowScripts,
    readonly,
    fit: mountedFitMode,
    historyLimit,
    uiFactory: createDefaultUi,
    onChange(change) {
      scheduleOriginalSize();
      return onChange?.(change);
    },
    onError,
    onSelectionChange,
    onFitChange(detail) {
      applyMountedFitPresentation(detail.mode);
      root.dataset.scale = String(detail.scale);
      onFitChange?.(detail);
    },
  });
  const runtimeDestroy = runtime.destroy;
  const runtimeSetReadonly = runtime.setReadonly;
  const runtimeSetFitMode = runtime.setFitMode;
  const runtimeRefreshFit = runtime.refreshFit;
  const runtimeSetHtml = runtime.setHtml;

  Object.defineProperties(runtime, {
    element: { enumerable: true, value: root },
    iframe: { enumerable: true, value: iframe },
    scaleToFit: {
      enumerable: true,
      get() {
        return mountedFitMode !== "none";
      },
    },
  });
  runtime.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelOriginalSize();
    originalSizeLoadCleanup?.();
    originalSizeResourceCleanup?.();
    originalSizeHostObserver?.disconnect();
    runtimeDestroy();
    root.remove();
  };
  runtime.setReadonly = (nextReadonly) => {
    const next = runtimeSetReadonly(nextReadonly);
    root.dataset.readonly = String(next);
    return next;
  };
  runtime.setFitMode = (nextMode) => {
    const requestedMode = resolveMountedFitMode({ fit: nextMode });
    if (requestedMode !== "none") {
      cancelOriginalSize();
      restoreHostSizedIframe();
    }
    const next = runtimeSetFitMode(requestedMode);
    applyMountedFitPresentation(next);
    root.dataset.scale = String(runtime.scale);
    return next;
  };
  runtime.setScaleToFit = (enabled) => {
    if (typeof enabled !== "boolean") {
      throw new TypeError("setScaleToFit requires a boolean");
    }
    return runtime.setFitMode(enabled ? "width" : "none") !== "none";
  };
  runtime.refreshFit = () => {
    const scale = runtimeRefreshFit();
    scheduleOriginalSize();
    return scale;
  };
  runtime.setHtml = async (nextHtml, options) => {
    await runtimeSetHtml(nextHtml, options);
    scheduleOriginalSize();
  };
  const handleScaleToggle = () => {
    runtime.setScaleToFit(scaleToggleInput.checked);
  };
  scaleToggleInput.addEventListener("change", handleScaleToggle);
  const runtimeDestroyWithUi = runtime.destroy;
  runtime.destroy = () => {
    scaleToggleInput.removeEventListener("change", handleScaleToggle);
    runtimeDestroyWithUi();
  };
  applyMountedFitPresentation(mountedFitMode);
  return runtime;
}

export { createHtmlEditorRuntime } from "../editor/index.js";
