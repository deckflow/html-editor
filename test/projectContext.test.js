import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProjectContext, resolveProjectInput } from "../projectContext.js";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-"));
  mkdirSync(join(root, "pages"));
  writeFileSync(join(root, "index.html"), "<h1>Home</h1>");
  writeFileSync(join(root, "pages", "about.html"), "<h1>About</h1>");
  return root;
}

test("an HTML input uses its parent as project root and itself as the default file", () => {
  const root = createFixture();
  const result = resolveProjectInput(join(root, "pages", "about.html"));

  assert.equal(result.projectDir, realpathSync(join(root, "pages")));
  assert.equal(result.defaultFile, "about.html");
});

test("a directory input prefers index.html as the default file", () => {
  const root = createFixture();
  const result = resolveProjectInput(root);

  assert.equal(result.projectDir, realpathSync(root));
  assert.equal(result.defaultFile, "index.html");
});

test("a directory without index.html chooses the first HTML file recursively", () => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-"));
  mkdirSync(join(root, "pages"));
  writeFileSync(join(root, "pages", "about.html"), "<h1>About</h1>");

  const result = resolveProjectInput(root);

  assert.equal(result.defaultFile, "pages/about.html");
});

test("project paths accept HTML files inside the root", () => {
  const root = createFixture();
  const project = createProjectContext(root);

  const target = project.safeHtmlPath("pages/about.html");

  assert.equal(target.abs, realpathSync(join(root, "pages", "about.html")));
  assert.equal(target.rel, "pages/about.html");
});

test("project paths reject traversal, non-HTML files and symlink escapes", () => {
  const root = createFixture();
  const outside = mkdtempSync(join(tmpdir(), "local-html-editor-outside-"));
  const outsideHtml = join(outside, "secret.html");
  writeFileSync(outsideHtml, "<p>secret</p>");
  writeFileSync(join(root, "notes.txt"), "notes");
  symlinkSync(outsideHtml, join(root, "linked.html"));
  const project = createProjectContext(root);

  assert.equal(project.safeHtmlPath("../secret.html"), null);
  assert.equal(project.safeHtmlPath("notes.txt"), null);
  assert.equal(project.safeHtmlPath("linked.html"), null);
});

test("project paths allow a new HTML snapshot under an existing directory", () => {
  const root = createFixture();
  const project = createProjectContext(root);

  const target = project.safeHtmlPath("pages/remote-example.html", { allowMissing: true });

  assert.equal(target.abs, join(realpathSync(root), "pages", "remote-example.html"));
  assert.equal(target.rel, "pages/remote-example.html");
});
