import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("package subpaths expose the layered public API", async () => {
  const [core, editor, ui, server] = await Promise.all([
    import("@deckflow/html-editor/core"),
    import("@deckflow/html-editor/editor"),
    import("@deckflow/html-editor/ui"),
    import("@deckflow/html-editor/server"),
  ]);

  assert.equal(typeof core.patchElementsInHtml, "function");
  assert.equal(typeof core.createElementTarget, "function");
  assert.equal(typeof editor.createHtmlEditorRuntime, "function");
  assert.equal(typeof ui.mountHtmlEditor, "function");
  assert.equal(typeof server.createProjectServer, "function");
  assert.equal(typeof server.createEditorServer, "function");
});

test("browser bundlers can consume the UI entry without Node built-ins", async () => {
  const result = await build({
    entryPoints: ["src/ui/index.js"],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });

  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles[0].text.includes("mountHtmlEditor"));
});

test("core applies the same source-preserving patch contract used by the runtime", async () => {
  const { patchElementsInHtml } = await import("@deckflow/html-editor/core");
  const source = '<!doctype html>\n<h1 id="title" class="hero">Hello</h1>\n';
  const result = patchElementsInHtml(source, [{
    target: {
      id: "title",
      tagName: "h1",
      originalText: "Hello",
    },
    operations: [
      { type: "text-content", value: "Hello editor" },
      { type: "inline-style", property: "font-size", value: "42px" },
    ],
  }]);

  assert.equal(result.matched, true);
  assert.equal(result.changed, true);
  assert.equal(
    result.html,
    '<!doctype html>\n<h1 id="title" class="hero" style="font-size: 42px">Hello editor</h1>\n',
  );
});
