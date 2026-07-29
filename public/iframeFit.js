const FIT_MODES = new Set(["none", "width", "contain"]);
const EDITOR_RUNTIME_ATTRIBUTES = new Set(["contenteditable", "spellcheck"]);

export function normalizeIframeFitMode(value) {
  if (value === true) return "width";
  if (value === false || value == null) return "none";
  const mode = String(value).toLowerCase();
  if (!FIT_MODES.has(mode)) {
    throw new TypeError(`Unsupported iframe fit mode: ${value}`);
  }
  return mode;
}

export function calculateIframeFitScale({
  mode,
  availableWidth,
  availableHeight,
  contentWidth,
  contentHeight,
  minScale = 0.01,
}) {
  const normalizedMode = normalizeIframeFitMode(mode);
  if (normalizedMode === "none") return 1;

  const widthScale = contentWidth > 0 ? availableWidth / contentWidth : 1;
  const heightScale = contentHeight > 0 ? availableHeight / contentHeight : 1;
  const requestedScale = normalizedMode === "contain"
    ? Math.min(widthScale, heightScale)
    : widthScale;
  return Math.max(minScale, Math.min(1, requestedScale));
}

function isEditorRuntimeNode(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return Boolean(element?.closest?.(
    "[data-local-editor-ui], [data-local-editor-runtime], [data-local-editor-editing]",
  ));
}

export function isIframeFitRuntimeAttribute(name) {
  const normalized = String(name || "").toLowerCase();
  return normalized.startsWith("data-local-editor-")
    || EDITOR_RUNTIME_ATTRIBUTES.has(normalized);
}

function mutationChangesPage(mutation) {
  if (isEditorRuntimeNode(mutation.target)) return false;
  if (mutation.type === "attributes") {
    return !isIframeFitRuntimeAttribute(mutation.attributeName);
  }
  if (mutation.type === "childList") {
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) => !isEditorRuntimeNode(node),
    );
  }
  return true;
}

/**
 * Fits an iframe's logical viewport into its visible host without changing the
 * source document. The larger logical viewport lets responsive pages lay out
 * naturally while the outer transform scales the result back into the host.
 */
export function createIframeFitController({
  iframe,
  mode = "width",
  minScale = 0.01,
  onFitChange = null,
} = {}) {
  if (!iframe || String(iframe.tagName).toLowerCase() !== "iframe") {
    throw new TypeError("createIframeFitController requires an iframe");
  }

  const initialStyle = {
    width: iframe.style.width,
    height: iframe.style.height,
    transform: iframe.style.transform,
    transformOrigin: iframe.style.transformOrigin,
  };
  const state = {
    mode: normalizeIframeFitMode(mode),
    scale: 1,
    frame: null,
    destroyed: false,
    hostObserver: null,
    contentObserver: null,
    contentCleanup: null,
  };

  function cancelScheduledFit() {
    if (state.frame == null) return;
    iframe.ownerDocument.defaultView?.cancelAnimationFrame(state.frame);
    state.frame = null;
  }

  function disconnectContent() {
    state.contentObserver?.disconnect();
    state.contentObserver = null;
    state.contentCleanup?.();
    state.contentCleanup = null;
  }

  function report(nextScale) {
    const changed = Math.abs(state.scale - nextScale) > 0.0001;
    state.scale = nextScale;
    iframe.dataset.deckflowFit = state.mode;
    iframe.dataset.deckflowScale = String(nextScale);
    if (changed) onFitChange?.({ mode: state.mode, scale: nextScale });
  }

  function restoreStyles() {
    iframe.style.width = initialStyle.width;
    iframe.style.height = initialStyle.height;
    iframe.style.transform = initialStyle.transform;
    iframe.style.transformOrigin = initialStyle.transformOrigin;
  }

  function refresh() {
    cancelScheduledFit();
    if (state.destroyed) return state.scale;
    if (state.mode === "none") {
      restoreStyles();
      report(1);
      return 1;
    }

    const host = iframe.parentElement;
    const document = iframe.contentDocument;
    const root = document?.documentElement;
    const body = document?.body;
    const availableWidth = host?.clientWidth || 0;
    const availableHeight = host?.clientHeight || 0;
    if (!root || availableWidth <= 0 || availableHeight <= 0) return state.scale;

    // Editor overlays are fixed runtime controls and must not influence the
    // authored page's intrinsic dimensions.
    const runtimeNodes = [...document.querySelectorAll(
      "[data-local-editor-ui], [data-local-editor-runtime]",
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

    iframe.style.width = `${availableWidth}px`;
    iframe.style.height = `${availableHeight}px`;
    iframe.style.transform = "none";
    iframe.style.transformOrigin = "top left";
    void iframe.offsetWidth;

    const contentWidth = Math.max(
      root.scrollWidth,
      root.offsetWidth,
      body?.scrollWidth || 0,
      body?.offsetWidth || 0,
    );
    const contentHeight = Math.max(
      root.scrollHeight,
      root.offsetHeight,
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
    );
    const scale = calculateIframeFitScale({
      mode: state.mode,
      availableWidth,
      availableHeight,
      contentWidth,
      contentHeight,
      minScale,
    });

    iframe.style.width = `${availableWidth / scale}px`;
    iframe.style.height = `${availableHeight / scale}px`;
    iframe.style.transform = `scale(${scale})`;
    runtimeNodes.forEach((node, index) => {
      node.style.display = runtimeDisplays[index];
    });
    editingNodes.forEach((node, index) => {
      for (const [name, snapshot] of Object.entries({
        contenteditable: editingAttributes[index].contenteditable,
        spellcheck: editingAttributes[index].spellcheck,
        "data-local-editor-editing": editingAttributes[index].editing,
      })) {
        if (snapshot.present) node.setAttribute(name, snapshot.value ?? "");
        else node.removeAttribute(name);
      }
    });
    report(scale);
    return scale;
  }

  function schedule() {
    if (state.destroyed || state.mode === "none" || state.frame != null) return;
    const view = iframe.ownerDocument.defaultView;
    if (!view) return;
    state.frame = view.requestAnimationFrame(() => {
      state.frame = null;
      refresh();
    });
  }

  function connectContent(document = iframe.contentDocument) {
    disconnectContent();
    if (state.destroyed || state.mode === "none" || !document?.documentElement) return;

    const view = document.defaultView;
    const MutationObserverCtor = view?.MutationObserver;
    if (MutationObserverCtor) {
      state.contentObserver = new MutationObserverCtor((mutations) => {
        if (mutations.some(mutationChangesPage)) schedule();
      });
      state.contentObserver.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    }

    const onResourceLoad = (event) => {
      if (event.target?.matches?.("img, video, audio, iframe, link")) schedule();
    };
    document.addEventListener("load", onResourceLoad, true);
    state.contentCleanup = () => {
      document.removeEventListener("load", onResourceLoad, true);
    };
    document.fonts?.ready?.then(schedule).catch(() => {});
    schedule();
  }

  function setMode(value) {
    state.mode = normalizeIframeFitMode(value);
    if (state.mode === "none") {
      disconnectContent();
      return refresh();
    }
    connectContent();
    return refresh();
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    cancelScheduledFit();
    disconnectContent();
    state.hostObserver?.disconnect();
    iframe.removeEventListener("load", onIframeLoad);
    restoreStyles();
    delete iframe.dataset.deckflowFit;
    delete iframe.dataset.deckflowScale;
  }

  function onIframeLoad() {
    connectContent();
    refresh();
  }

  iframe.addEventListener("load", onIframeLoad);
  const ResizeObserverCtor = iframe.ownerDocument.defaultView?.ResizeObserver;
  if (ResizeObserverCtor && iframe.parentElement) {
    state.hostObserver = new ResizeObserverCtor(schedule);
    state.hostObserver.observe(iframe.parentElement);
  }

  return {
    connectContent,
    destroy,
    refresh,
    schedule,
    setMode,
    get mode() {
      return state.mode;
    },
    get scale() {
      return state.scale;
    },
  };
}
