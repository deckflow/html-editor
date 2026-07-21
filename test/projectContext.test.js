import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createProjectContext,
  inferProjectRootForDirectory,
  inferProjectRootForHtml,
  listProjectHtmlFiles,
  resolveProjectInput,
} from "../projectContext.js";

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

test("directory input rejects a workspace without HTML files", () => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-empty-"));

  assert.throws(() => resolveProjectInput(root), /No HTML files found/);
});

test("HTML listing is recursive, flat, sorted, and skips ignored directories", () => {
  const root = createFixture();
  mkdirSync(join(root, ".hidden"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "node_modules", "package"));
  writeFileSync(join(root, ".hidden", "secret.html"), "<p>Hidden</p>");
  writeFileSync(join(root, "node_modules", "package", "demo.html"), "<p>Dependency</p>");

  assert.deepEqual(listProjectHtmlFiles(root), ["index.html", "pages/about.html"]);
});

test("an explicit project root may be a parent of the selected HTML", () => {
  const root = createFixture();
  const result = resolveProjectInput(join(root, "pages", "about.html"), { projectRoot: root });

  assert.equal(result.projectDir, realpathSync(root));
  assert.equal(result.defaultFile, "pages/about.html");
});

test("an explicit project root must contain the selected HTML", () => {
  const root = createFixture();
  const outside = mkdtempSync(join(tmpdir(), "local-html-editor-root-outside-"));

  assert.throws(
    () => resolveProjectInput(join(root, "index.html"), { projectRoot: outside }),
    /must be inside/,
  );
});

test("a nested selected page infers the common root from relative assets and index.html", () => {
  const root = createFixture();
  mkdirSync(join(root, "runtime"));
  writeFileSync(join(root, "runtime", "page.css"), "body { color: red; }");
  const page = join(root, "pages", "about.html");
  writeFileSync(page, '<link rel="stylesheet" href="../runtime/page.css"><h1>About</h1>');

  assert.equal(inferProjectRootForHtml(page), realpathSync(root));
});

test("a standalone selected HTML keeps its own directory as the project root", () => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-standalone-"));
  const page = join(root, "article.html");
  writeFileSync(page, "<h1>Standalone</h1>");

  assert.equal(inferProjectRootForHtml(page), realpathSync(root));
});

test("a selected directory expands its resource root but keeps a narrow HTML list", () => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-directory-resources-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "runtime"));
  writeFileSync(join(root, "outside.html"), "<h1>Outside</h1>");
  writeFileSync(join(root, "runtime", "page.css"), "body { color: red; }");
  writeFileSync(
    join(root, "pages", "page-001.html"),
    '<link rel="stylesheet" href="../runtime/page.css"><h1>Page</h1>',
  );

  const resourceRoot = inferProjectRootForDirectory(join(root, "pages"));
  const project = createProjectContext(resourceRoot, { htmlDirectory: join(root, "pages") });

  assert.equal(resourceRoot, realpathSync(root));
  assert.deepEqual(project.listHtmlFiles(), ["pages/page-001.html"]);
  assert.equal(project.safeAssetPath("runtime/page.css").abs, realpathSync(join(root, "runtime", "page.css")));
});

test("root-relative references infer an arbitrary common parent without directory conventions", () => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-opaque-root-"));
  mkdirSync(join(root, "one-off-bucket"));
  mkdirSync(join(root, "deep"));
  mkdirSync(join(root, "deep", "views"));
  writeFileSync(join(root, "one-off-bucket", "palette.unusual"), "opaque resource");
  const page = join(root, "deep", "views", "article.html");
  writeFileSync(page, '<link rel="stylesheet" href="/one-off-bucket/palette.unusual">');

  assert.equal(inferProjectRootForHtml(page), realpathSync(root));
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

test("project assets accept local files and reject traversal, backups, and symlink escapes", () => {
  const root = createFixture();
  const outside = mkdtempSync(join(tmpdir(), "local-html-editor-assets-outside-"));
  const outsideCss = join(outside, "secret.css");
  mkdirSync(join(root, "runtime"));
  mkdirSync(join(root, ".local-html-editor"));
  writeFileSync(join(root, "runtime", "player.css"), "body { color: red; }");
  writeFileSync(join(root, ".local-html-editor", "state.json"), "{}");
  writeFileSync(outsideCss, "body { display: none; }");
  symlinkSync(outsideCss, join(root, "runtime", "linked.css"));
  const project = createProjectContext(root);

  const target = project.safeAssetPath("runtime/player.css");

  assert.equal(target.abs, realpathSync(join(root, "runtime", "player.css")));
  assert.equal(target.rel, "runtime/player.css");
  assert.equal(project.safeAssetPath("../secret.css"), null);
  assert.equal(project.safeAssetPath(".local-html-editor/state.json"), null);
  assert.equal(project.safeAssetPath("runtime/linked.css"), null);
});
