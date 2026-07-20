# Manus-Style Text Canvas Design

## Scope

Add element-level text editing interactions matching the two supplied Manus references. Formatting applies to the complete selected text element, not an arbitrary character range.

## Selection Layer

The iframe receives an editor-only fixed overlay positioned from the selected element's `getBoundingClientRect()`. It renders a blue selection border, left and right width handles, a centered top move handle, an action popover, a text-format toolbar, and a spacing popover. Every injected node carries `data-local-editor-ui` and is removed before snapshot serialization.

Dragging the right handle changes width. Dragging the left handle changes width and relative `left` so the visual right edge remains fixed. Dragging the top handle updates relative `left/top`. Pointer movement updates the preview immediately; pointer release emits final inline-style operations.

## Text Toolbar

The toolbar controls font size, bold, italic, underline, strikethrough, left/center/right alignment, letter spacing, line height, and text color. Controls read computed styles whenever selection changes and emit inline-style operations through the existing pending-patch queue.

## Structure Actions

Duplicate clones the selected element immediately after itself and assigns a unique id supplied to the backend operation. Delete removes the element immediately. Both are persisted through new `duplicate-element` and `delete-element` operations, keeping source edits local and backed up.

## Patch Safety

Existing target resolution and original-text fingerprint checks remain mandatory. The style allowlist expands only for the properties exposed by the editor. Duplicate escapes the supplied id. Delete and duplicate operate only on the already-resolved element source range.

Pending operations preserve chronological groups across duplicate/delete boundaries and are submitted through one atomic batch endpoint. The server applies the complete batch in memory, writes one backup and one file only after every target resolves, and returns the original source unchanged if any operation fails. Selector index and DOM path take precedence over plain id fallback so malformed pages with duplicate ids do not silently patch the first match.

## Verification

Node tests cover every new style property, structural operations, drag math, text-decoration toggling, line-height conversion, and unique copy ids. Browser verification covers selection UI, both resize handles, move handle, every toolbar control, spacing popover, duplicate, delete, Save persistence, iframe scrolling, and absence of editor-only markup in the saved file.
