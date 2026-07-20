import test from "node:test";
import assert from "node:assert/strict";

const queue = await import("../public/patchQueue.js").catch(() => ({}));

test("adjacent styles for the same target merge by property", () => {
  assert.equal(typeof queue.appendStylePatch, "function");
  const patches = [];
  const target = { id: "hero" };
  queue.appendStylePatch(patches, target, { type: "inline-style", property: "color", value: "red" });
  queue.appendStylePatch(patches, target, { type: "inline-style", property: "color", value: "blue" });

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].operations, [
    { type: "inline-style", property: "color", value: "blue" },
  ]);
});

test("a structural patch prevents later styles from merging before duplication", () => {
  assert.equal(typeof queue.appendStructuralPatch, "function");
  const patches = [];
  const target = { id: "hero" };
  queue.appendStylePatch(patches, target, { type: "inline-style", property: "color", value: "red" });
  queue.appendStructuralPatch(patches, target, { type: "duplicate-element", newId: "hero-copy" }, 1);
  queue.appendStylePatch(patches, target, { type: "inline-style", property: "color", value: "blue" });

  assert.equal(patches.length, 3);
  assert.equal(patches[0].operations[0].value, "red");
  assert.equal(patches[1].operations[0].type, "duplicate-element");
  assert.equal(patches[2].operations[0].value, "blue");
});

test("switching targets preserves chronological style groups", () => {
  const patches = [];
  const hero = { id: "hero" };
  const body = { id: "body" };
  queue.appendStylePatch(patches, hero, { type: "inline-style", property: "color", value: "red" });
  queue.appendStylePatch(patches, body, { type: "inline-style", property: "color", value: "green" });
  queue.appendStylePatch(patches, hero, { type: "inline-style", property: "font-size", value: "40px" });

  assert.equal(patches.length, 3);
  assert.deepEqual(patches.map((patch) => patch.target.id), ["hero", "body", "hero"]);
});

test("adjacent text fingerprints share identity while preserving the source snapshot", () => {
  const patches = [];
  const before = { id: "hero", originalText: "Old" };
  const afterFirstInput = { id: "hero", originalText: "N" };
  queue.appendStylePatch(patches, before, { type: "text-content", value: "N" });
  queue.appendStylePatch(patches, afterFirstInput, { type: "text-content", value: "New" });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].target.originalText, "Old");
  assert.equal(patches[0].operations[0].value, "New");
});

test("a later group snapshots the updated text fingerprint", () => {
  const patches = [];
  const before = { id: "hero", originalText: "Old" };
  const after = { id: "hero", originalText: "New" };
  queue.appendStylePatch(patches, before, { type: "text-content", value: "New" });
  queue.appendStructuralPatch(patches, after, { type: "duplicate-element", newId: "hero-copy" }, 1);
  queue.appendStylePatch(patches, after, { type: "inline-style", property: "color", value: "red" });

  assert.equal(patches[0].target.originalText, "Old");
  assert.equal(patches[1].target.originalText, "New");
  assert.equal(patches[2].target.originalText, "New");
});

test("repeated text-node edits keep the source value and latest preview value", () => {
  const patches = [];
  const target = { id: "footer", originalText: "Before" };
  queue.appendStylePatch(patches, target, {
    type: "text-node-content",
    nodePath: [0],
    originalValue: "Before",
    value: "Middle",
  });
  queue.appendStylePatch(patches, { ...target, originalText: "Middle" }, {
    type: "text-node-content",
    nodePath: [0],
    originalValue: "Middle",
    value: "After",
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].operations, [{
    type: "text-node-content",
    nodePath: [0],
    originalValue: "Before",
    value: "After",
  }]);
});
