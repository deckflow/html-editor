import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createEditorServer } from "../server.js";

test("server exposes the selected project and initial HTML on an available port", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-server-"));
  mkdirSync(join(root, "site"));
  const htmlPath = join(root, "site", "landing.html");
  mkdirSync(join(root, "assets"));
  mkdirSync(join(root, "assets", "theme"));
  mkdirSync(join(root, "content"));
  mkdirSync(join(root, "content", "slides"));
  writeFileSync(htmlPath, '<!doctype html><link rel="stylesheet" href="../assets/theme/main.css"><h1>Hello</h1>');
  writeFileSync(join(root, "assets", "theme", "main.css"), "h1 { color: rgb(1, 2, 3); }");
  const nestedHtmlPath = join(root, "content", "slides", "intro.html");
  writeFileSync(nestedHtmlPath, '<!doctype html><link rel="stylesheet" href="../../assets/theme/main.css">');

  const editor = await createEditorServer({ input: htmlPath, root, port: 0 });
  t.after(() => editor.close());

  assert.match(editor.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const project = await fetch(`${editor.url}/api/project`).then((response) => response.json());
  assert.equal(project.ok, true);
  assert.equal(project.defaultFile, "site/landing.html");

  const htmlFiles = await fetch(`${editor.url}/api/html-files`).then((response) => response.json());
  assert.deepEqual(htmlFiles.files, [
    { path: "content/slides/intro.html", name: "intro.html" },
    { path: "site/landing.html", name: "landing.html" },
  ]);

  const file = await fetch(`${editor.url}/api/file?path=site/landing.html`).then((response) => response.json());
  assert.equal(file.content, '<!doctype html><link rel="stylesheet" href="../assets/theme/main.css"><h1>Hello</h1>');
  assert.equal(file.displayPath, realpathSync(htmlPath));
  assert.equal(file.previewBase, "/project-assets/site/");

  const unsupportedUrl = await fetch(`${editor.url}/api/file?path=${encodeURIComponent("https://example.com/page.html")}`);
  assert.equal(unsupportedUrl.status, 404);

  const removedFullWrite = await fetch(`${editor.url}/api/file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "new.html", content: "<h1>New</h1>" }),
  });
  assert.equal(removedFullWrite.status, 404);

  const cssResponse = await fetch(`${editor.url}${file.previewBase}../assets/theme/main.css`);
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get("content-type"), /^text\/css/);
  assert.equal(await cssResponse.text(), "h1 { color: rgb(1, 2, 3); }");

  const rootRelativeCss = await fetch(`${editor.url}/assets/theme/main.css`);
  assert.equal(rootRelativeCss.status, 200);
  assert.equal(await rootRelativeCss.text(), "h1 { color: rgb(1, 2, 3); }");

  const editorPage = await fetch(editor.url);
  assert.equal(editorPage.url, `${editor.url}/__local-editor__/`);
  const editorHtml = await editorPage.text();
  assert.match(editorHtml, /Local HTML Editor/);
  assert.match(editorHtml, /href="styles\.css"/);
  assert.match(editorHtml, /src="app\.js\?/);

  const editorScript = await fetch(`${editor.url}/__local-editor__/app.js`);
  assert.equal(editorScript.status, 200);
  assert.match(editorScript.headers.get("content-type"), /^text\/javascript/);
  assert.equal(editorScript.headers.get("cache-control"), "no-store");

  const escapedAsset = await fetch(`${editor.url}/project-assets/%2e%2e/package.json`);
  assert.equal(escapedAsset.status, 404);

  const fileUrl = pathToFileURL(nestedHtmlPath).href;
  const nestedFile = await fetch(`${editor.url}/api/file?path=${encodeURIComponent(fileUrl)}`)
    .then((response) => response.json());
  assert.equal(nestedFile.ok, true, JSON.stringify(nestedFile));
  assert.equal(nestedFile.path, "content/slides/intro.html");
  assert.equal(nestedFile.previewBase, "/project-assets/content/slides/");

  const selectedFileResponse = await fetch(`${editor.url}/api/resolve-project-file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "intro.html",
      content: '<!doctype html><link rel="stylesheet" href="../../assets/theme/main.css">',
    }),
  });
  const selectedFile = await selectedFileResponse.json();
  assert.equal(selectedFile.matched, true);
  assert.equal(selectedFile.path, "content/slides/intro.html");

  const patchedResponse = await fetch(`${editor.url}/api/patch-content`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: '<!doctype html><h1 id="title">Hello</h1>',
      patches: [
        {
          target: { id: "title" },
          operations: [{ type: "text-content", value: "Updated" }],
        },
      ],
    }),
  });
  const patched = await patchedResponse.json();
  assert.equal(patched.ok, true);
  assert.equal(patched.content, '<!doctype html><h1 id="title">Updated</h1>');
});

test("server switches to an HTML selected outside the startup project", async (t) => {
  const startup = mkdtempSync(join(tmpdir(), "local-html-editor-startup-"));
  writeFileSync(join(startup, "index.html"), "<h1>Startup</h1>");

  const external = mkdtempSync(join(tmpdir(), "local-html-editor-external-"));
  mkdirSync(join(external, "deeply"));
  mkdirSync(join(external, "deeply", "nested"));
  mkdirSync(join(external, "resource-bin"));
  writeFileSync(join(external, "index.html"), "<h1>External home</h1>");
  writeFileSync(join(external, "resource-bin", "theme.unusual"), "h1 { color: green; }");
  const selectedPage = join(external, "deeply", "nested", "page-001.html");
  writeFileSync(selectedPage, '<link rel="stylesheet" href="../../resource-bin/theme.unusual"><h1>Page one</h1>');

  const inferredEditor = await createEditorServer({ input: selectedPage, port: 0 });
  assert.equal(inferredEditor.projectDir, realpathSync(external));
  assert.equal(inferredEditor.defaultFile, "deeply/nested/page-001.html");
  await inferredEditor.close();

  const editor = await createEditorServer({
    input: join(startup, "index.html"),
    port: 0,
    selectLocalHtmlFile: async () => selectedPage,
  });
  t.after(() => editor.close());

  const selectionResponse = await fetch(`${editor.url}/api/select-local-file`, { method: "POST" });
  const selection = await selectionResponse.json();
  assert.equal(selection.ok, true, JSON.stringify(selection));
  assert.equal(selection.path, "deeply/nested/page-001.html");
  assert.equal(selection.projectDir, realpathSync(external));

  const file = await fetch(`${editor.url}/api/file?path=${encodeURIComponent(selection.path)}`)
    .then((response) => response.json());
  assert.equal(file.previewBase, "/project-assets/deeply/nested/");
  assert.equal(file.displayPath, realpathSync(selectedPage));

  const unusualAsset = await fetch(`${editor.url}${file.previewBase}../../resource-bin/theme.unusual`);
  assert.equal(unusualAsset.status, 200);
  assert.equal(unusualAsset.headers.get("content-type"), "application/octet-stream");
  assert.equal(await unusualAsset.text(), "h1 { color: green; }");
});

test("server switches to an explicitly selected HTML directory", async (t) => {
  const startup = mkdtempSync(join(tmpdir(), "local-html-editor-directory-startup-"));
  writeFileSync(join(startup, "index.html"), "<h1>Startup</h1>");

  const parent = mkdtempSync(join(tmpdir(), "local-html-editor-directory-parent-"));
  writeFileSync(join(parent, "outside.html"), "<h1>Outside</h1>");
  const selectedDirectory = join(parent, "selected-site");
  mkdirSync(selectedDirectory);
  mkdirSync(join(selectedDirectory, "pages"));
  mkdirSync(join(parent, "runtime"));
  writeFileSync(join(parent, "runtime", "theme.css"), "h1 { color: green; }");
  writeFileSync(
    join(selectedDirectory, "index.html"),
    '<link rel="stylesheet" href="../runtime/theme.css"><h1>Selected home</h1>',
  );
  writeFileSync(join(selectedDirectory, "pages", "detail.html"), "<h1>Detail</h1>");

  const editor = await createEditorServer({
    input: join(startup, "index.html"),
    port: 0,
    selectLocalHtmlDirectory: async () => selectedDirectory,
  });
  t.after(() => editor.close());

  const response = await fetch(`${editor.url}/api/select-local-path`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "directory" }),
  });
  const selection = await response.json();
  assert.equal(selection.ok, true, JSON.stringify(selection));
  assert.equal(selection.kind, "directory");
  assert.equal(selection.path, "selected-site/index.html");
  assert.equal(selection.projectDir, realpathSync(parent));

  const files = await fetch(`${editor.url}/api/html-files`).then((result) => result.json());
  assert.deepEqual(files.files.map((file) => file.path), [
    "selected-site/index.html",
    "selected-site/pages/detail.html",
  ]);

  const stylesheet = await fetch(`${editor.url}/project-assets/runtime/theme.css`);
  assert.equal(stylesheet.status, 200);
  assert.equal(await stylesheet.text(), "h1 { color: green; }");
});
