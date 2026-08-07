# @deckflow/html-editor

A local-first visual editor for existing HTML. Use it in either of two ways:

- Run `htmleditor` against a local `.html` file or directory. The bundled UI
  loads related assets and saves targeted changes back to disk automatically.
- Mount the editor in another website with an HTML string. The host receives
  updated source HTML and decides where and how to persist it.

The editor changes source HTML through targeted patch operations instead of
serializing the entire iframe DOM. This keeps unrelated markup and formatting
stable and produces smaller source diffs.

## Features

- Edit text directly in the preview.
- Format a selected text range: font size, color, weight, italic, underline,
  strike-through, alignment, line height, and letter spacing.
- Move and resize elements with alignment guides and snapping.
- Duplicate and delete elements.
- Insert and delete rows or columns in regular tables.
- Undo and redo completed edits.
- Preview fixed-size pages with width or contain scaling.
- Load relative CSS, JavaScript, images, fonts, media, and nested HTML.
- Use read-only mode when the page should be previewed without editor controls.
- Run without a frontend framework; TypeScript declarations are included.

## Requirements

- Node.js `18.18` or newer for the CLI and server APIs.
- A modern browser for the embedded UI.
- A modern ESM bundler such as Vite, webpack, Rollup, Parcel, or esbuild when
  importing the browser package from an application.

## Quick Start

Run the latest package without installing it globally:

```bash
npx @deckflow/html-editor ./index.html
```

The CLI validates the path, starts a server on `127.0.0.1`, chooses an available
port, opens the browser, and loads the requested file.

To edit a directory containing multiple HTML files:

```bash
npx @deckflow/html-editor ./site
```

Press `Ctrl+C` in the terminal to stop the local server.

## Global CLI

Install the executable globally when you use it frequently:

```bash
npm install -g @deckflow/html-editor --registry=https://registry.npmjs.org/
```

You can then run it from any directory:

```bash
htmleditor ./index.html
htmleditor ./site
```

Show the built-in help:

```bash
htmleditor --help
```

### CLI syntax

```text
htmleditor <file.html|directory> [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `--port <number>` | `0` | Preferred port. `0` selects an available port. |
| `--root <path>` | inferred | Filesystem root used for local resources. It may be a parent of the selected HTML file. |
| `--no-open` | off | Start the server without opening a browser. |
| `-h`, `--help` | | Print help and exit. |

Examples:

```bash
# Use a fixed port.
htmleditor ./site/index.html --port 4567

# Start the editor without opening a browser.
htmleditor ./site/index.html --no-open

# Allow a nested page to load assets from a shared parent directory.
htmleditor ./site/pages/page-001.html --root ./site
```

The input must be an existing `.html` file or a directory containing at least
one `.html` file. Missing paths, other file extensions, empty workspaces, unknown
options, and extra positional arguments fail before the server starts.

### File mode

When the input is an HTML file, that file is loaded immediately. The CLI infers
a project root that can serve its relative resources. Use `--root` when the page
references shared files above the inferred root:

```text
site/
  assets/theme.css
  runtime/page.js
  pages/page-001.html
```

```bash
htmleditor ./site/pages/page-001.html --root ./site
```

This allows references such as:

```html
<link rel="stylesheet" href="../assets/theme.css">
<script src="../runtime/page.js"></script>
<img src="/assets/logo.png" alt="Logo">
```

Asset handling is path-based rather than extension-based. CSS, JavaScript,
images, fonts, audio, video, nested HTML, and unknown file extensions can all be
served when they are inside the project root.

`--root /` permits access to the full local filesystem. Only use it with HTML
you trust.

### Directory mode

When the input is a directory, the standalone UI displays its HTML files in a
searchable sidebar. Nested files are shown as a flat, sorted relative-path list.
Hidden directories, `.local-html-editor`, and `node_modules` are skipped.

The initial page is selected in this order:

1. `index.html` at the selected directory root.
2. The first discovered HTML file in lexical order.

Switching files does not restart the server. Pending changes are flushed before
the next file is loaded.

### Choosing another file

The `Open` control can choose either an HTML file or a directory through the
operating system picker. A selected path becomes the active project, including
its own resource root and HTML file list. The editor does not require all files
to live under the directory used when the CLI first started.

### Automatic saving and backups

The standalone editor saves completed changes automatically:

- A burst of edits is saved after `1.2s` of inactivity.
- Continuous editing is saved at least once every `5s`.
- Switching files and reloading flush pending changes first.
- Saving does not reload the iframe, so selection and visual position remain
  stable.

Before a local file is changed, the server writes a backup under:

```text
<project>/.local-html-editor/backups/
```

Add `.local-html-editor/` to the edited project's `.gitignore` when backups
should remain local.

## Editing Controls

- Click editable text to place the caret and edit it directly.
- Select part of the text to show range-formatting controls.
- Click an element without a text range to show structural controls such as
  duplicate or delete.
- Drag an element from non-text padding or its move handle.
- Drag the left or right resize handle to change width.
- Hold `Alt` while moving or resizing to temporarily disable snapping.
- Click outside an active text field to commit its text.
- Press `Escape` while editing text to restore the value from before that edit.
- Press `Ctrl+Enter` or `Cmd+Enter` to commit active text editing.

Keyboard shortcuts outside an active text field:

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Undo | `Cmd+Z` | `Ctrl+Z` |
| Redo | `Cmd+Shift+Z` | `Ctrl+Shift+Z` or `Ctrl+Y` |
| Edit selected text element | `Enter` | `Enter` |
| Duplicate selected element | `Cmd+D` | `Ctrl+D` |
| Delete selected element | `Delete` / `Backspace` | `Delete` / `Backspace` |
| Clear selection | `Escape` | `Escape` |

Table row and column controls replace duplicate/delete while a regular table
cell is selected. See [Table Editing](#table-editing) for its constraints.

## Embed The UI In A Website

Install the package in the host application:

```bash
npm install @deckflow/html-editor
```

The browser entry does not start or depend on the local Node.js server. It takes
an HTML string and emits another HTML string after each completed logical edit.

### Minimal example

```html
<div id="editor"></div>
```

```css
#editor {
  width: 100%;
  height: 720px;
  min-height: 320px;
}
```

```js
import { mountHtmlEditor } from "@deckflow/html-editor/ui";

const editor = mountHtmlEditor({
  container: document.querySelector("#editor"),
  html: "<!doctype html><html><body><h1>Edit me</h1></body></html>",
  onChange({ html }) {
    console.log(html);
  },
});

await editor.ready;
```

The container must have a usable height. The mounted editor fills its container
and applies a `320px` minimum height.

### Complete example

```js
import { mountHtmlEditor } from "@deckflow/html-editor/ui";

const editor = mountHtmlEditor({
  container: document.querySelector("#editor"),
  html: initialHtml,

  // Used only by the preview to resolve relative resources.
  baseUrl: "https://example.com/project/",

  // Keep false unless every script in the supplied HTML is trusted.
  allowScripts: false,
  readonly: false,

  // Fit wide fixed-size pages and show the built-in Fit switch.
  scaleToFit: true,
  showScaleToggle: true,
  historyLimit: 50,
  className: "my-html-editor",
  title: "Page editor preview",

  async onChange({ html, patches, revision, reason }) {
    await fetch("/api/pages/current", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html, revision }),
    });

    console.log(reason, patches);
  },

  onSelectionChange(selection) {
    console.log(selection?.target ?? null);
  },

  onFitChange({ mode, scale }) {
    console.log(`Preview mode: ${mode}; scale: ${scale}`);
  },

  onError(error) {
    console.error(error);
  },
});

await editor.ready;

// Commit active text and wait for the latest asynchronous onChange callback.
const latestHtml = await editor.flush();

// Remove listeners, overlays, iframe content, and the mounted root.
editor.destroy();
```

### Mount options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `Element` | required | Host element that receives the editor. |
| `html` | `string` | `""` | Complete HTML document or HTML fragment to edit. |
| `baseUrl` | `string` | `""` | Preview-only base URL for relative resources. It is never written to output HTML. |
| `allowScripts` | `boolean` | `false` | Allows scripts in trusted preview HTML. |
| `readonly` | `boolean` | `false` | Disables editing, selection UI, drag/resize, and editor shortcuts. |
| `fit` | `"none" \| "width" \| "contain" \| boolean` | `"none"` | Controls fixed-page preview scaling. `true` means `"width"`; `false` means `"none"`. |
| `scaleToFit` | `boolean` | unset | Two-state shorthand for width fit. When supplied, it takes precedence over `fit`. |
| `showScaleToggle` | `boolean` | `true` | Shows the built-in `Fit` switch in the top-right corner. |
| `historyLimit` | `number` | `50` | Maximum number of undo snapshots. |
| `className` | `string` | `""` | Additional class applied to the mounted root. |
| `title` | `string` | `"HTML editor preview"` | Accessible iframe title. |
| `onChange` | `function` | no-op | Runs after a completed edit changes source HTML. May return a promise. |
| `onError` | `function` | no-op | Receives patch, persistence callback, and runtime errors. |
| `onSelectionChange` | `function` | no-op | Receives a selection snapshot or `null`. |
| `onFitChange` | `function` | no-op | Receives the active fit mode and scale. |

### Change events and persistence

`onChange` receives:

```ts
type HtmlEditorChange = {
  html: string;
  patches: HtmlPatch[];
  revision: number;
  reason:
    | "text"
    | "text-style"
    | "style"
    | "duplicate"
    | "delete"
    | "table"
    | "undo"
    | "redo"
    | string;
};
```

- `html` is the complete latest source string.
- `patches` describes the targeted operation that produced the change. Undo and
  redo restore snapshots, so their patch array is empty.
- `revision` increases once for every successful source change.
- `reason` lets the host group analytics or persistence behavior by edit type.

Callbacks run in edit order. If `onChange` returns a promise, later callbacks
wait for it. `editor.flush()` commits active text, waits for the preview, and
then waits for this callback chain. Callback errors are forwarded to `onError`.

A host should treat `html` as the canonical value to save. `patches` are useful
for inspection, collaboration adapters, or a custom patch endpoint, but the host
does not need to replay them to obtain the latest HTML.

### Loading new HTML

Use `setHtml()` when the host changes the selected document:

```js
await editor.setHtml(nextHtml, {
  baseUrl: "https://example.com/another-page/",
});
```

`setHtml()` clears the current selection and undo history. It does not invoke
`onChange`, preventing a host update from being mistaken for a user edit. Passing
the same HTML is a no-op.

Avoid calling `setHtml()` with every value received by `onChange`; the runtime
has already applied that value internally. Call it only for an external document
change, server refresh, or file switch.

### Read-only mode

Start read-only:

```js
const editor = mountHtmlEditor({
  container,
  html,
  readonly: true,
});
```

Or change it at runtime:

```js
editor.setReadonly(true);
editor.setReadonly(false);
```

Entering read-only mode commits an active text edit before removing the editor
interaction layer. `getHtml()`, `setHtml()`, fitting, and preview rendering remain
available while read-only.

### Fit and original-size modes

Fixed-size documents such as slides are often wider than their host container.
The editor supports three preview modes without modifying source HTML:

| Mode | Behavior |
| --- | --- |
| `none` | Keep the authored size. The mounted viewport scrolls when content overflows. |
| `width` | Shrink content only when it is wider than the available width. |
| `contain` | Shrink content to fit both available width and height. |

The runtime never enlarges content above `1x`. It recalculates after host resize,
resource load, committed edit, and relevant preview DOM changes.

```js
editor.setFitMode("width");
editor.setFitMode("contain");
editor.setFitMode("none");

console.log(editor.fitMode);
console.log(editor.scale);
```

For a simple two-state control:

```js
editor.setScaleToFit(true);  // width mode
editor.setScaleToFit(false); // original size with scrolling
```

Use `editor.refreshFit()` after a host layout change that cannot be observed by
`ResizeObserver`. Set `showScaleToggle: false` when the host supplies its own UI.

### Instance API

| Member | Return value | Description |
| --- | --- | --- |
| `ready` | `Promise<void>` | Resolves when the current iframe document and editor layer are ready. |
| `revision` | `number` | Current in-memory source revision. |
| `canUndo` | `boolean` | Whether an undo snapshot is available. |
| `canRedo` | `boolean` | Whether a redo snapshot is available. |
| `readonly` | `boolean` | Current interaction mode. |
| `fitMode` | `"none" \| "width" \| "contain"` | Current fit mode. |
| `scale` | `number` | Current preview scale from `0` to `1`. |
| `scaleToFit` | `boolean` | Whether the mounted UI is in a fitted mode. |
| `element` | `HTMLDivElement` | Mounted editor root. |
| `iframe` | `HTMLIFrameElement` | Preview iframe. |
| `getHtml()` | `string` | Returns the latest clean source HTML. |
| `setHtml(html, options?)` | `Promise<void>` | Loads external HTML and resets selection/history. |
| `setReadonly(value)` | `boolean` | Changes read-only state and returns the resulting value. |
| `setFitMode(mode)` | fit mode | Changes preview fit mode. |
| `setScaleToFit(value)` | `boolean` | Switches between width fit and original size. |
| `refreshFit()` | `number` | Recalculates and returns the preview scale. |
| `undo()` | `Promise<boolean>` | Restores the previous snapshot when available. |
| `redo()` | `Promise<boolean>` | Restores the next snapshot when available. |
| `flush()` | `Promise<string>` | Commits active text and waits for pending callbacks. |
| `destroy()` | `void` | Removes runtime state, listeners, UI, and mounted elements. |

### Relative resources and `baseUrl`

The embedded editor injects a temporary `<base>` element into `iframe.srcdoc` so
relative URLs resolve against `baseUrl`:

```js
mountHtmlEditor({
  container,
  html: '<link rel="stylesheet" href="./assets/page.css">',
  baseUrl: new URL("./pages/", window.location.href).href,
});
```

The temporary base is preview state only. It does not appear in `getHtml()`,
`flush()`, or `onChange` output. An authored `<base>` element takes precedence.

The remote server must permit the browser to request those resources. URLs that
require unavailable cookies, reject cross-origin requests, or are blocked by a
Content Security Policy may still fail to load.

### Script safety

Scripts are disabled by default through the iframe sandbox. This is the safe
setting for user-provided or otherwise untrusted HTML.

```js
mountHtmlEditor({
  container,
  html: trustedHtml,
  allowScripts: true,
});
```

Only enable `allowScripts` when the HTML and every referenced script are trusted.
The package is a visual editor, not an HTML sanitizer.

## Use The Runtime With A Custom UI

Use the editor entry when the host already owns an iframe and wants to replace
the default floating controls:

```js
import { createHtmlEditorRuntime } from "@deckflow/html-editor/editor";

const iframe = document.querySelector("#preview");

const runtime = createHtmlEditorRuntime({
  iframe,
  html: initialHtml,
  baseUrl: document.baseURI,
  fit: "width",
  onChange({ html }) {
    saveHtml(html);
  },
  uiFactory({ document, runtimeId, callbacks }) {
    const customUi = mountCustomControls({ document, runtimeId, callbacks });
    return {
      ...customUi,
      destroy() {
        customUi.destroy();
      },
    };
  },
});
```

`uiFactory` runs inside the iframe document. Its callback contract is intended
for advanced UI implementations; `mountHtmlEditor()` is the stable high-level
entry for most applications.

## Apply Patches Without The UI

The core entry works in both Node.js and browser bundles:

```js
import { patchElementsInHtml } from "@deckflow/html-editor/core";

const result = patchElementsInHtml(sourceHtml, [
  {
    target: {
      selector: "main h1",
      selectorIndex: 0,
      originalText: "Old title",
    },
    operations: [
      { type: "text-content", value: "New title" },
      { type: "inline-style", property: "font-size", value: "64px" },
      { type: "inline-style", property: "color", value: "#0f766e" },
    ],
  },
]);

if (!result.matched) {
  throw new Error(`Patch ${result.failedIndex} could not be resolved`);
}

console.log(result.changed);
console.log(result.html);
```

Targets may use an `id`, CSS `selector` plus `selectorIndex`, a DOM path, and a
text fingerprint. The editor generates redundant target metadata so arbitrary
HTML does not need pre-existing IDs.

Patch batches are atomic: when any target cannot be resolved safely, the result
returns `matched: false` and preserves the original source string.

## Node.js Server API

Start the complete standalone editor from another Node.js application:

```js
import { createEditorServer } from "@deckflow/html-editor";

const editor = await createEditorServer({
  input: "./site",
  root: "./site",
  port: 0,
});

console.log(editor.url);
console.log(editor.projectDir);
console.log(editor.defaultFile);

process.once("SIGINT", async () => {
  await editor.close();
});
```

Use the server subpath when the Node.js application provides its own frontend:

```js
import { createProjectServer } from "@deckflow/html-editor/server";

const project = await createProjectServer({
  input: "./site",
  root: "./site",
  port: 0,
});
```

`createProjectServer()` exposes the project APIs, preview, resources, backups,
and file events without serving the bundled standalone UI. Both server factories
bind to `127.0.0.1` and return `{ url, projectDir, defaultFile, close() }`.

## Table Editing

Text inside table cells uses the same inline editing and range formatting tools
as other page text. When no text range is active, selecting a cell in a regular
rectangular table shows actions to:

- insert a row above or below;
- insert a column to the left or right;
- delete the current row or column.

New rows and columns preserve presentation attributes from the neighboring row
or cell, start with empty content, and do not duplicate element IDs.

Structural editing is intentionally disabled for tables using `rowspan`,
`colspan`, `colgroup`, or inconsistent cell counts. Their cell text is still
editable, but changing those grids safely requires a span-aware table model.

## Package Entries

| Import | Purpose |
| --- | --- |
| `@deckflow/html-editor` | Complete local editor server. |
| `@deckflow/html-editor/ui` | `mountHtmlEditor()` plus the default iframe UI. |
| `@deckflow/html-editor/editor` | Framework-independent browser runtime. |
| `@deckflow/html-editor/core` | Targets, operations, source patching, history, and text/table models. |
| `@deckflow/html-editor/server` | Local project and standalone server factories. |
| `@deckflow/html-editor/html-patch` | Compatibility entry for the HTML patch helpers. |

The dependency direction is:

```text
Core <- Editor Runtime <- UI
Core <- Server
Editor Runtime + UI + Server <- Standalone CLI
```

## Local Development

```bash
git clone https://github.com/deckflow/html-editor.git
cd html-editor
npm install
npm run dev
```

The development command opens `samples/demo.html` on port `4177` without
launching a browser automatically.

Verification commands:

```bash
npm test
npm run typecheck
npm run pack:check
```

## Publishing

Versions already published to npm are immutable. Increment the package version
before publishing changed contents. Choose either manual publishing or the
GitHub Actions workflow for a version; do not run both for the same version.

For a manual release:

```bash
npm version patch
npm publish --access public --registry=https://registry.npmjs.org/
git push origin main --follow-tags
```

Accounts protected by two-factor authentication may be prompted for a one-time
password. The npm account must have permission to publish under `@deckflow`.

For an automated release, push the version commit and tag without publishing
locally, then publish the matching GitHub Release. The repository workflow at
`.github/workflows/publish.yml` installs dependencies, verifies the version,
runs tests, checks package contents, and publishes with the `NPM_TOKEN`
repository secret. A release tag such as `v0.1.6` must match `package.json`
version `0.1.6`.

## License

MIT
