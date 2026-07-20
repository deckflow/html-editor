# Selection Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered live-DOM selection state with a HyperFrames-inspired snapshot model that drives inspector and toolbar reflection across focus changes, range recreation, DOM mutations, undo/redo, and reload.

**Architecture:** A new `selectionSnapshot.js` module collects stable identity, geometry, curated root styles, text fields, and optional Range styles from the iframe DOM. `app.js` owns the current snapshot and patch target lifecycle. `canvasTextEditor.js` retains a live Range only to apply formatting, while all visible control state comes from the latest snapshot.

**Tech Stack:** Browser DOM APIs, ES modules, Node `node:test`, existing iframe preview, existing HTML patch API; no new runtime dependencies or framework.

## Global Constraints

- Keep the zero-framework frontend and existing iframe preview.
- Do not add React, Zustand, HyperFrames, or another dependency.
- Preserve `/api/patch-elements`, safe `inner-html`, history, remote snapshots, movement, resize, duplicate, and delete behavior.
- Generated safe spans must not become element-level selection roots.
- Live Element and Range references must never be serialized into history or save requests.

---

### Task 1: Selection Snapshot Model

**Files:**
- Create: `public/selectionSnapshot.js`
- Create: `test/selectionSnapshot.test.js`
- Modify: `public/inlineEdit.js`
- Modify: `test/inlineEdit.test.js`

**Interfaces:**
- Produces: `createSelectionKey(path, target): string`
- Produces: `buildSelectionSnapshot({ path, element, target, selector, range }): SelectionSnapshot | null`
- Produces: `collectTextFields(element): TextField[]`
- Produces: `rangeBelongsToElement(range, element): boolean`
- Moves existing `resolveRangeStyleElement(range, element)` ownership from `inlineEdit.js` to `selectionSnapshot.js`, with a compatibility re-export removed after consumers migrate.

- [ ] **Step 1: Write failing model tests**

Add tests that construct minimal DOM stubs and assert:

```js
assert.equal(createSelectionKey("samples/demo.html", target), expectedKey);
assert.deepEqual(snapshot.boundingBox, { x: 10, y: 20, width: 100, height: 40 });
assert.equal(snapshot.rangeStyle.styles["font-style"], "italic");
assert.equal(snapshot.rangeStyle, null); // collapsed/out-of-root range
assert.deepEqual(collectTextFields(root).map((field) => field.source), ["text-node", "child"]);
```

- [ ] **Step 2: Run tests and verify the expected failure**

Run: `node --test test/selectionSnapshot.test.js`

Expected: FAIL because `public/selectionSnapshot.js` does not exist.

- [ ] **Step 3: Implement snapshot collection**

Use the curated style list:

```js
export const TEXT_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration-line",
];
```

`rangeStyle` must contain `{ styles, boundingBox }` and be `null` for missing, collapsed, disconnected, or out-of-root ranges. `textFields` must preserve DOM order and distinguish `self`, `text-node`, and safe `child` span fields.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/selectionSnapshot.test.js test/inlineEdit.test.js`

Expected: all snapshot and inline edit tests PASS.

- [ ] **Step 5: Commit the model**

```bash
git add html-editor-demo/public/selectionSnapshot.js html-editor-demo/public/inlineEdit.js html-editor-demo/test/selectionSnapshot.test.js html-editor-demo/test/inlineEdit.test.js
git commit -m "feat: add selection snapshot model"
```

---

### Task 2: App Selection Lifecycle Migration

**Files:**
- Modify: `public/app.js`
- Modify: `test/selectionSnapshot.test.js`

**Interfaces:**
- Consumes: `buildSelectionSnapshot(...)` and `createSelectionKey(...)` from Task 1.
- Produces: `state.selectionSnapshot` as the only element-selection state object.
- Produces internal helpers `selectedElement()`, `selectedTarget()`, `refreshSelectionSnapshot(range)`, and `clearSelectionSnapshot()`.

- [ ] **Step 1: Add failing lifecycle assertions**

Extend snapshot tests to verify rebuilding a snapshot after text/style changes returns updated `textContent`, `inlineStyles`, `computedStyles`, and geometry while preserving `key` and `target`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test test/selectionSnapshot.test.js`

Expected: FAIL on stale style/text expectations until the rebuild behavior is implemented.

- [ ] **Step 3: Replace scattered app state**

Replace:

```js
selected: null,
selectedTarget: null,
selectedSelector: "",
```

with:

```js
selectionSnapshot: null,
```

Create snapshots in `selectElement()`, rebuild them after inline edits and all style/geometry callbacks, and clear them in `clearSelection()`. History serialization must copy only `selectionSnapshot.target` and never the snapshot itself.

- [ ] **Step 4: Update inspector and patch consumers**

All reads must use snapshot data:

```js
const snapshot = state.selectionSnapshot;
const el = snapshot?.element;
const target = snapshot?.target;
```

`queuePatchOperation`, text fingerprint updates, position controls, keyboard operations, duplicate/delete, reload restoration, and history capture must use those values. A disconnected element must clear selection without modifying pending patches.

- [ ] **Step 5: Run syntax and full unit tests**

Run: `node --check public/app.js && npm test`

Expected: syntax PASS and all tests PASS.

- [ ] **Step 6: Commit app migration**

```bash
git add html-editor-demo/public/app.js html-editor-demo/test/selectionSnapshot.test.js
git commit -m "refactor: drive app selection from snapshots"
```

---

### Task 3: Snapshot-Driven Canvas Toolbar

**Files:**
- Modify: `public/canvasTextEditor.js`
- Modify: `public/selectionSnapshot.js`
- Modify: `test/selectionSnapshot.test.js`

**Interfaces:**
- Consumes: `SelectionSnapshot.rangeStyle.styles` and `.boundingBox`.
- Produces: `select(snapshot)`, `updateSelection(snapshot, range)`, and existing `clear/refresh/sync/destroy` methods.
- Emits: `onTextRangeChange(range | null)` whenever iframe selection changes.
- Style callbacks include the active Range so `app.js` can rebuild the post-mutation snapshot immediately.

- [ ] **Step 1: Add failing style reflection tests**

Add model tests for outer-container Range starts, text-node starts, nested spans, inherited bold, explicit italic, combined decoration, color, font size, spacing, and line height. Assert the snapshot returns the style-bearing node's values.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/selectionSnapshot.test.js`

Expected: at least one nested/outer Range style assertion FAILS before the resolver is complete.

- [ ] **Step 3: Convert canvas selection API**

Store both `selectionSnapshot` and the live `activeRange`. `refresh()` uses `snapshot.element` and current geometry; `sync()` reads only:

```js
const styles = selectionSnapshot.rangeStyle?.styles
  ?? selectionSnapshot.computedStyles;
```

Do not call `getComputedStyle(selected)` to decide active toolbar state or toggle direction.

- [ ] **Step 4: Refresh snapshot on Range changes and mutations**

On `selectionchange`, validate/clone the Range and call `onTextRangeChange`. After wrapping or updating a span, pass the new Range through the callback before `sync()`. App rebuilds the snapshot and calls `updateSelection(snapshot, range)`.

- [ ] **Step 5: Preserve menu exclusivity and live Range application**

Show the formatting toolbar only when `snapshot.rangeStyle` and a non-collapsed active Range both exist. Otherwise show only duplicate/delete. Applying a style still uses the live Range, and toggles use the pre-mutation snapshot style.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test test/selectionSnapshot.test.js test/canvasEditorMath.test.js && npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit canvas migration**

```bash
git add html-editor-demo/public/canvasTextEditor.js html-editor-demo/public/selectionSnapshot.js html-editor-demo/test/selectionSnapshot.test.js
git commit -m "refactor: render toolbar from selection snapshots"
```

---

### Task 4: Browser Regression and Final Cleanup

**Files:**
- Modify: `public/index.html`
- Modify: `docs/superpowers/specs/2026-07-11-selection-snapshot-design.md` only if implementation reveals a necessary clarification.

**Interfaces:**
- Consumes all previous tasks.
- Produces a cache-busted browser entry and verified local preview.

- [ ] **Step 1: Bump the module cache key**

Update the `/app.js?v=...` query string so a fresh browser tab loads the snapshot implementation.

- [ ] **Step 2: Verify focus and formatting workflows**

In `http://127.0.0.1:4177/`, verify:

1. Select a word, apply italic, and confirm active reflection.
2. Click blank canvas, return, select the styled word, and confirm italic remains active.
3. Click italic again and confirm computed style becomes normal and active reflection clears.
4. Repeat toggle checks for bold, underline, and strike.
5. Verify color, size, spacing, and line height values reflect after focus loss.
6. Confirm formatting and duplicate/delete menus never appear together.
7. Confirm generated spans keep the outer text root selected.
8. Undo/redo and reload, then confirm snapshot reconstruction and toolbar reflection.

- [ ] **Step 3: Verify persistence path**

Use a disposable sample or unit/API path to confirm snapshot changes still queue safe `inner-html` and `/api/patch-elements` accepts the patch. Do not leave test mutations in `samples/demo.html`.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
node --check server.js
node --check htmlPatch.js
node --check public/app.js
node --check public/canvasTextEditor.js
node --check public/selectionSnapshot.js
git diff --check
```

Expected: all tests and checks PASS with no browser console errors.

- [ ] **Step 5: Commit final integration**

```bash
git add html-editor-demo/public/index.html html-editor-demo/docs/superpowers/specs/2026-07-11-selection-snapshot-design.md
git commit -m "test: verify snapshot-driven text editing"
```
