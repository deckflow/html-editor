import assert from "node:assert/strict";
import test from "node:test";

import { createEditorHistory } from "../public/editorHistory.js";

test("undo and redo exchange the current snapshot", () => {
  const history = createEditorHistory();
  history.push({ content: "before" });

  const previous = history.undo({ content: "after" });
  assert.deepEqual(previous, { content: "before" });
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(previous), { content: "after" });
});

test("a new edit clears redo history", () => {
  const history = createEditorHistory();
  history.push({ content: "one" });
  history.undo({ content: "two" });
  history.push({ content: "three" });

  assert.equal(history.canRedo, false);
});

test("history discards the oldest snapshots above its limit", () => {
  const history = createEditorHistory(2);
  history.push({ content: "one" });
  history.push({ content: "two" });
  history.push({ content: "three" });

  assert.deepEqual(history.undo({ content: "four" }), { content: "three" });
  assert.deepEqual(history.undo({ content: "three" }), { content: "two" });
  assert.equal(history.undo({ content: "two" }), null);
});
