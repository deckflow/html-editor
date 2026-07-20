# HyperFrames-Inspired Selection Snapshot Design

## Goal

Make text-style state deterministic across focus changes, range recreation, DOM patching, undo/redo, and preview reloads without introducing React, Zustand, or a build step.

The editor will follow HyperFrames Studio's useful separation: DOM selection is an input signal, while a structured selection model is the source of truth consumed by the UI.

## Scope

This change adds a selection snapshot layer to the existing zero-framework editor. It keeps the current iframe preview, direct text editing, range-level formatting, patch APIs, history snapshots, remote snapshot flow, and server-side HTML patching.

It does not add a React state layer, collaborative editing, arbitrary rich text, or a HyperFrames dependency.

## Selection Snapshot

The current element selection is represented by one object:

```js
{
  key,
  element,
  target,
  selector,
  boundingBox,
  textContent,
  inlineStyles,
  computedStyles,
  textFields,
  rangeStyle,
}
```

- `key`: stable identity derived from file path and target identity.
- `element`: live iframe element reference. It is never serialized.
- `target`: existing patch target containing id, selector/index, DOM path, tag, and text fingerprint.
- `selector`: human-readable selector used by the inspector.
- `boundingBox`: latest element rectangle in iframe coordinates.
- `textContent`: normalized visible text.
- `inlineStyles`: authored inline styles on the selected root.
- `computedStyles`: curated computed styles for the selected root.
- `textFields`: stable leaf text descriptions for plain text and safe styled spans.
- `rangeStyle`: computed style and rectangle for the current non-collapsed text range, or `null`.

The snapshot is recreated from live DOM rather than mutated field by field. This avoids stale combinations of element geometry, nested span styles, and browser Range state.

## Modules

### `public/selectionSnapshot.js`

Owns pure or DOM-focused selection-model operations:

- Build a stable snapshot from an element, target, selector, and optional Range.
- Read curated inline and computed styles.
- Resolve the actual style-bearing node at the Range start.
- Collect text fields without changing the selected root.
- Refresh geometry and style data after DOM mutations.
- Compare stable selection keys.

This module does not render UI, queue patches, or save files.

### `public/app.js`

Owns snapshot lifecycle:

- Creates a snapshot when an element is selected.
- Refreshes the snapshot after inline input, style changes, movement, resizing, duplicate/delete, undo/redo, and iframe reload.
- Keeps the stable target and pending patch queue synchronized with text changes.
- Resolves a saved target back to a live element after history or file reload.
- Clears the snapshot when selection is cleared.

The legacy `selected`, `selectedTarget`, and `selectedSelector` state fields are replaced by `selectionSnapshot`. The existing element-target WeakMap remains an identity cache. All UI decisions use the snapshot.

### `public/canvasTextEditor.js`

Becomes a snapshot consumer:

- Receives the current snapshot through `select()` or `updateSelection()`.
- Renders the element box from `boundingBox`.
- Shows the formatting toolbar only when `rangeStyle` exists.
- Shows duplicate/delete only when `rangeStyle` is `null`.
- Reads active button state from `rangeStyle`, never from ad hoc `getComputedStyle(selected)` calls.
- Emits requested operations; it does not own patch identity.

The live Range may still be retained for applying a style to selected characters. It is not the source of truth for toolbar state.

## Data Flow

### Element Selection

1. Resolve the stable outer text root.
2. Build the patch target and selector.
3. Build a complete selection snapshot.
4. Store it in app state.
5. Pass it to the canvas editor and inspector.

### Text Range Selection

1. Receive iframe `selectionchange`.
2. Validate that the Range belongs to the selected root and is non-collapsed.
3. Rebuild the snapshot with the Range.
4. Resolve the real style-bearing start node, including nested spans.
5. Render formatting controls from `snapshot.rangeStyle`.

### Focus Loss and Return

On focus loss, the element snapshot remains available while `rangeStyle` becomes `null`. When the user returns and selects text, the range style is rebuilt from the new Range and current DOM. No old Range is required for style reflection.

### Style Commit

1. Record history before mutation.
2. Apply the requested operation to the current Range or selected root.
3. Queue the existing structured patch operation.
4. Rebuild the complete snapshot from the mutated DOM.
5. Render all controls from the refreshed snapshot.

Toggle decisions use the pre-mutation `rangeStyle`; active state uses the refreshed post-mutation snapshot.

### Undo, Redo, and Reload

History entries continue to store clean HTML and pending patches. After restoring iframe HTML, the app resolves the stored stable target, creates a new live snapshot, and passes it to the UI. Live element and Range references are never restored from serialized history.

## Text Fields

Text fields are the normalized mutation model for range-level formatting. Native DOM Range is treated as an input signal and converted to text offsets; style toggles update stable fields, serialize them as flat sibling spans, and recreate the live Range from field keys. They provide a HyperFrames-style normalized view:

- A simple text root produces one `self` field.
- Safe styled spans produce child fields while the outer text root remains selected.
- Mixed direct text and safe spans produce ordered text-node and child fields.
- A partial selection splits a field into before, selected, and after fields while preserving the selected field key.
- Generated fields persist `data-local-text-key`, mirroring HyperFrames Studio's stable `data-hf-text-key` identity.
- Repeated toggles update the selected field's style map instead of nesting another span.

This prevents generated spans from becoming accidental element-level selections and avoids ancestor/descendant style conflicts such as an underline that cannot be canceled by a nested `text-decoration: none`.

## Error Handling

- An invalid or disconnected element clears the snapshot and canvas selection.
- A Range outside the selected root is ignored and produces `rangeStyle: null`.
- A missing target after reload leaves the page loaded but clears selection with a status message.
- Unsupported rich-text descendants remain non-editable instead of being flattened.
- Snapshot collection failures must not modify DOM or pending patches.

## Testing

Unit tests will cover:

- Stable key generation.
- Snapshot collection for simple text, styled spans, and mixed text.
- Range start resolution for outer elements, text nodes, and nested spans.
- Curated inline/computed style collection.
- Collapsed and out-of-root Ranges producing no range style.
- Snapshot refresh after style changes.

Browser tests will cover:

- Italic, bold, underline, strike, color, size, spacing, and line-height reflection.
- Focus loss followed by selecting the same styled text.
- Toggle on/off after focus loss.
- Stable outer element selection after generated spans exist.
- Mutually exclusive formatting and element-action menus.
- Undo/redo and reload rebuilding snapshots from stable targets.

The full existing Node test suite, syntax checks, and `git diff --check` remain required.

## Acceptance Criteria

- Toolbar state never depends on a stale or missing browser Range.
- Re-selecting styled text after focus loss shows the correct active controls.
- Repeated toggles correctly enable and disable the selected style.
- Generated inline spans do not change the element-level selection root.
- Existing patch, save, history, remote URL, movement, resize, duplicate, and delete behavior remains intact.
- No new runtime dependency or frontend framework is introduced.
