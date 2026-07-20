import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEditorServer } from "../server.js";

test("server exposes the selected project and initial HTML on an available port", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "local-html-editor-server-"));
  const htmlPath = join(root, "landing.html");
  writeFileSync(htmlPath, "<!doctype html><h1>Hello</h1>");

  const editor = await createEditorServer({ input: htmlPath, port: 0 });
  t.after(() => editor.close());

  assert.match(editor.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const project = await fetch(`${editor.url}/api/project`).then((response) => response.json());
  assert.equal(project.ok, true);
  assert.equal(project.defaultFile, "landing.html");

  const file = await fetch(`${editor.url}/api/file?path=landing.html`).then((response) => response.json());
  assert.equal(file.content, "<!doctype html><h1>Hello</h1>");

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
