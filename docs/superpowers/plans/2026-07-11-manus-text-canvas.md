# Manus-Style Text Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavior. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement all element selection, resize, move, duplicate, delete, and text-format interactions shown in the supplied Manus references.

**Architecture:** Keep source patching in `htmlPatch.js`, put pure interaction calculations in `public/canvasEditorMath.js`, and put iframe overlay DOM/event behavior in `public/canvasTextEditor.js`. `public/app.js` remains the integration owner for selection state and pending operations.

**Tech Stack:** Browser DOM Pointer Events, ES modules, htmlparser2/css-select, node:test.

## Global Constraints

- Formatting applies to the whole selected text element.
- Preview updates are immediate; disk writes happen only through Save.
- Editor-only DOM must never be serialized into user HTML.
- Target fingerprint safety and local backups remain enabled.
- No framework or HyperFrames dependency is added.
- Work in the current shared directory because the demo is untracked; do not commit unrelated files.

---

### Task 1: Extend Source Patch Operations

**Files:** `htmlPatch.js`, `test/htmlPatch.test.js`

**Interfaces:** `patchElementInHtml(source, target, operations)` accepts the existing operations plus `{type:"duplicate-element", newId}` and `{type:"delete-element"}`. Inline styles additionally accept `font-weight`, `font-style`, `text-decoration-line`, `text-align`, `letter-spacing`, `line-height`, `width`, `max-width`, and `box-sizing`.

- [x] Add failing tests for all new allowed styles, duplicate with a safe unique id, and delete.
- [x] Run `node --test test/htmlPatch.test.js` and confirm the new tests fail.
- [x] Implement the minimal patch behavior while preserving source formatting outside the target range.
- [x] Run the focused test and confirm it passes.

### Task 2: Add Tested Interaction Math

**Files:** `public/canvasEditorMath.js`, `test/canvasEditorMath.test.js`

**Interfaces:** export `resizeFromHandle`, `moveFromPointer`, `toggleDecoration`, `lineHeightRatio`, and `createUniqueCopyId` as pure functions.

- [x] Write failing tests for left/right resize, minimum width, move deltas, decoration combinations, normal line-height fallback, and copy-id collisions.
- [x] Run `node --test test/canvasEditorMath.test.js` and confirm failure.
- [x] Implement the pure helpers.
- [x] Run the focused test and confirm it passes.

### Task 3: Build the Iframe Overlay and Toolbar

**Files:** `public/canvasTextEditor.js`, `public/app.js`, `public/index.html`, `public/styles.css`

**Interfaces:** `createCanvasTextEditor({document,onStyleOperations,onDuplicate,onDelete,onSelectionChange})` returns `{select,clear,refresh,destroy}`. Style callbacks receive an array of `{property,value}`.

- [x] Create the editor-only overlay, handles, action popover, toolbar, and spacing popover.
- [x] Implement pointer-captured move/resize with immediate DOM updates and final callback operations.
- [x] Implement all toolbar controls and active-state synchronization from computed styles.
- [x] Integrate selection, duplicate/delete pending patches, cleanup, scroll refresh, and inspector synchronization in `app.js`.
- [x] Bump the app script cache key.

### Task 4: Verify Complete Interaction Fidelity

**Files:** all modified files and `samples/demo.html` only for reversible browser checks.

- [x] Run syntax checks and `npm test`.
- [x] Restart the Node server so backend module changes load.
- [x] Verify blue selection box, left/right resize, top move, duplicate, delete, and all text toolbar controls in the browser.
- [x] Save changes and inspect source for local diffs and absence of `data-local-editor-ui`.
- [x] Restore the sample and rerun the full test suite.
