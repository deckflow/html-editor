import { mountHtmlEditor } from "../../src/ui/index.js";

window.__browserErrors = [];
window.addEventListener("error", (event) => {
  window.__browserErrors.push({
    message: event.error?.message || event.message,
    stack: event.error?.stack || "",
  });
});

const firstHtml = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="theme.css">
    <script>document.documentElement.dataset.scriptRan = "true";</script>
  </head>
  <body style="box-sizing: border-box; width: 1200px">
    <h1 id="title">First editor</h1>
    <p id="copy">Editable copy</p>
  </body>
</html>`;

const secondHtml = `<!doctype html>
<html>
  <body>
    <script>document.documentElement.dataset.scriptRan = "true";</script>
    <h1 id="other-title">Second editor</h1>
  </body>
</html>`;

window.__editorChanges = [];
window.__editorErrors = [];

try {
  window.editorA = mountHtmlEditor({
    container: document.querySelector("#editor-a"),
    html: firstHtml,
    baseUrl: "/fixtures/browser/assets/",
    fit: "width",
    onChange(change) {
      window.__editorChanges.push(change);
      document.body.dataset.changeCount = String(window.__editorChanges.length);
      document.body.dataset.latestHtml = change.html;
      document.body.dataset.canUndo = String(window.editorA?.canUndo);
    },
    onError(error) {
      window.__editorErrors.push({ message: error.message, code: error.code });
      document.body.dataset.runtimeError = error.message;
    },
    onFitChange({ mode, scale }) {
      document.body.dataset.editorAFit = mode;
      document.body.dataset.editorAScale = String(scale);
    },
  });

  window.editorB = mountHtmlEditor({
    container: document.querySelector("#editor-b"),
    html: secondHtml,
    allowScripts: true,
    readonly: true,
  });

  window.__editorsReady = Promise.all([window.editorA.ready, window.editorB.ready]).then(() => {
    document.body.dataset.editorsReady = "true";
    document.body.dataset.sourceHasBase = String(
      window.editorA.getHtml().includes("data-local-editor-preview-base"),
    );
  });
  document.querySelector("#undo-a").addEventListener("click", async () => {
    document.body.dataset.undoResult = String(await window.editorA.undo());
    document.body.dataset.canUndo = String(window.editorA.canUndo);
  });
  document.querySelector("#redo-a").addEventListener("click", async () => {
    document.body.dataset.redoResult = String(await window.editorA.redo());
  });
  document.querySelector("#toggle-b").addEventListener("click", () => {
    const readonly = window.editorB.setReadonly(!window.editorB.readonly);
    document.body.dataset.editorBReadonly = String(readonly);
  });
  document.querySelector("#resize-a").addEventListener("click", () => {
    document.body.classList.toggle("is-narrow");
  });
} catch (error) {
  document.body.dataset.startupError = error.stack || error.message;
}
