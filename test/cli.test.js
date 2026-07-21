import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseCliArgs, validateEditorInput } from "../cli.js";

test("CLI accepts a project path, resource root, and startup options", () => {
  assert.deepEqual(parseCliArgs(["./site/pages/index.html", "--root", "./site", "--port", "4567", "--no-open"]), {
    help: false,
    input: "./site/pages/index.html",
    open: false,
    port: 4567,
    root: "./site",
  });
});

test("CLI requires an explicit input and defaults to an automatic port", () => {
  assert.deepEqual(parseCliArgs([]), {
    help: false,
    input: null,
    open: true,
    port: 0,
    root: null,
  });
});

test("CLI accepts an existing .html file", () => {
  const root = mkdtempSync(join(tmpdir(), "htmleditor-cli-"));
  const htmlPath = join(root, "PAGE.HTML");
  writeFileSync(htmlPath, "<h1>Hello</h1>");

  assert.equal(validateEditorInput(htmlPath), resolve(htmlPath));
});

test("CLI accepts an existing directory", () => {
  const root = mkdtempSync(join(tmpdir(), "htmleditor-cli-directory-"));

  assert.equal(validateEditorInput(root), resolve(root));
});

test("CLI rejects missing, malformed, and nonexistent inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "htmleditor-cli-invalid-"));
  const htmPath = join(root, "page.htm");
  writeFileSync(htmPath, "<h1>Unsupported extension</h1>");

  assert.throws(() => validateEditorInput(null), /Missing input path/);
  assert.throws(() => validateEditorInput(htmPath), /must be an \.html file or directory/);
  assert.throws(() => validateEditorInput(join(root, "missing.html")), /does not exist/);
});

test("CLI rejects unknown flags and invalid ports", () => {
  assert.throws(() => parseCliArgs(["--wat"]), /Unknown option/);
  assert.throws(() => parseCliArgs(["--port", "70000"]), /valid port/);
  assert.throws(() => parseCliArgs(["--root"]), /requires a directory/);
});
