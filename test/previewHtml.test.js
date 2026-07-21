import assert from "node:assert/strict";
import test from "node:test";

import {
  injectPreviewBase,
  PREVIEW_BASE_ATTRIBUTE,
  previewSandboxForMode,
} from "../public/previewHtml.js";

test("injects the project asset base into an existing head", () => {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="runtime/player.css"></head><body></body></html>';
  const result = injectPreviewBase(html, "/project-assets/slides/");

  assert.match(result, new RegExp(`<base ${PREVIEW_BASE_ATTRIBUTE} href="/project-assets/slides/">`));
  assert.match(result, /<link rel="stylesheet" href="runtime\/player\.css">/);
});

test("does not override an authored base element", () => {
  const html = '<html><head><base href="/custom-preview-root/"></head></html>';

  assert.equal(injectPreviewBase(html, "/project-assets/"), html);
});

test("wraps an HTML fragment so relative assets still have a base", () => {
  const result = injectPreviewBase("<h1>Hello</h1>", "/project-assets/");

  assert.match(result, /^<!doctype html>/);
  assert.match(result, new RegExp(`<base ${PREVIEW_BASE_ATTRIBUTE} href="/project-assets/">`));
});

test("allows scripts only for files served from the selected local project", () => {
  assert.equal(previewSandboxForMode("local"), "allow-same-origin allow-scripts");
  assert.equal(previewSandboxForMode("browser-file"), "allow-same-origin");
});
