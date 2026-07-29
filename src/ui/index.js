import { createCanvasTextEditor } from "../../public/canvasTextEditor.js";
import { createHtmlEditorRuntime } from "../editor/index.js";

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
  onChange,
  onError,
  onSelectionChange,
  className = "",
  title = "HTML editor preview",
  historyLimit = 50,
} = {}) {
  if (!container || typeof container.append !== "function") {
    throw new TypeError("mountHtmlEditor requires a container element");
  }

  const document = container.ownerDocument || globalThis.document;
  const root = document.createElement("div");
  root.className = ["deckflow-html-editor", className].filter(Boolean).join(" ");
  root.setAttribute("data-deckflow-html-editor", "");
  root.dataset.readonly = String(Boolean(readonly));
  root.style.cssText = [
    "position:relative",
    "width:100%",
    "height:100%",
    "min-height:320px",
    "overflow:hidden",
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
    "border:0",
    "background:#fff",
  ].join(";");
  root.append(iframe);
  container.append(root);

  let destroyed = false;
  const runtime = createHtmlEditorRuntime({
    iframe,
    html,
    baseUrl,
    allowScripts,
    readonly,
    historyLimit,
    uiFactory: createDefaultUi,
    onChange,
    onError,
    onSelectionChange,
  });
  const runtimeDestroy = runtime.destroy;
  const runtimeSetReadonly = runtime.setReadonly;

  Object.defineProperties(runtime, {
    element: { enumerable: true, value: root },
    iframe: { enumerable: true, value: iframe },
  });
  runtime.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    runtimeDestroy();
    root.remove();
  };
  runtime.setReadonly = (nextReadonly) => {
    const next = runtimeSetReadonly(nextReadonly);
    root.dataset.readonly = String(next);
    return next;
  };
  return runtime;
}

export { createHtmlEditorRuntime } from "../editor/index.js";
