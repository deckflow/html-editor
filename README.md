# Local HTML Editor

Run a browser-based visual text editor against an HTML file on your own machine.
Edits are previewed in an iframe and saved back through local, targeted HTML
patches. The server binds to `127.0.0.1` and keeps backups under
`.local-html-editor/backups/` in the selected project.

## Usage

The package is public on npm and does not require registry authentication to
install or run:

```bash
npx @deckflow/html-editor ./index.html
```

## Global CLI

The package exposes `htmleditor` as its executable. Install it globally when you
want to run the editor from any local project:

```bash
npm install -g @deckflow/html-editor
```

Then start the editor with an HTML file:

```bash
htmleditor ./index.html
```

Or open a whole directory as a workspace:

```bash
htmleditor ./site
```

Useful flags:

```bash
htmleditor ./site/index.html --port 4567
htmleditor ./site/index.html --no-open
htmleditor ./site/pages/page-001.html --root ./site
```

Without a global install, use `npx` with the same arguments:

```bash
npx @deckflow/html-editor ./index.html
npx @deckflow/html-editor ./site
```

In directory mode, the editor prefers `index.html` as the initial page, then
falls back to the first HTML file in lexical order. A searchable sidebar lists
every `.html` file under the directory as a flat relative-path list, so nested
pages can be switched without restarting the CLI. Hidden directories and
`node_modules` are skipped.

For local development in this repository:

```bash
npm install
npm run dev
```

The CLI opens the browser automatically and selects an available port. Pass a
fixed port or keep the browser closed with:

```bash
npx @deckflow/html-editor ./site/index.html --port 4567 --no-open
```

`Choose HTML` uses the local CLI process to open the operating system's file
picker. Files selected outside the startup directory become the active project,
so their sibling CSS, JavaScript, images, fonts, media, and nested HTML remain
available in the preview.

Relative resources are resolved from the edited HTML file, with the selected
project directory acting as the filesystem boundary. To use shared assets above
the HTML directory, provide a common parent explicitly:

```bash
npx @deckflow/html-editor ./site/pages/index.html --root ./site
```

This supports arbitrary `./`, `../`, and root-relative resource paths and does
not restrict asset extensions. `--root /` is available for fully unrestricted
local filesystem access, but should only be used with HTML you trust.

The CLI requires one existing `.html` file or a directory containing at least
one `.html` file. Missing paths, other file extensions, empty workspaces, and
extra positional arguments fail before the server starts. All reads and writes
stay under the inferred or explicit project root. The editor writes targeted
patches back to the selected local file automatically. Rapid changes are batched
after 1.2 seconds of inactivity, with a 5 second maximum wait during continuous
adjustments. File switching and Reload flush pending changes before continuing.

## Embed With An HTML String

Applications that already own their persistence can use the editor without
starting the local file server. The UI entry accepts a container and an HTML
string; each completed edit returns updated source HTML and the exact patch
batch that produced it:

```js
import { mountHtmlEditor } from "@deckflow/html-editor/ui";

const editor = mountHtmlEditor({
  container: document.querySelector("#editor"),
  html: initialHtml,
  baseUrl: "https://example.com/project/",
  readonly: false,
  scaleToFit: true,
  showScaleToggle: true,

  async onChange({ html, patches, revision, reason }) {
    await saveHtml({ html, patches, revision, reason });
  },

  onError(error) {
    console.error(error);
  },
});

await editor.ready;
editor.getHtml();
editor.setHtml(nextHtml);
editor.setReadonly(true);
editor.setScaleToFit(false);
editor.setFitMode("contain");
editor.refreshFit();
editor.undo();
editor.redo();
await editor.flush();
editor.destroy();
```

Give the container an explicit height; the embedded surface fills it and has a
`320px` minimum height. `baseUrl` is injected into the preview as a temporary
`<base>` element so relative CSS, images, fonts, media, and nested pages resolve
correctly. It is never written into `getHtml()` or `onChange` output.

Scripts are disabled in embedded previews by default. A host may set
`allowScripts: true` for trusted HTML, but untrusted HTML should always keep the
default sandbox. `setHtml()` clears selection and history, does not call
`onChange`, and treats identical HTML as a no-op. `flush()` commits active text
editing and waits for the host's latest `onChange` callback.

Set `readonly: true` to render the preview without selection outlines, editing
menus, text editing, drag/resize behavior, or editor keyboard shortcuts. The
host can switch modes without reloading the HTML by calling
`editor.setReadonly(true | false)`. Host-controlled `setHtml()` remains
available while the editor is read-only.

Use `fit: "width"` when fixed-width HTML is wider than the embedded preview.
The runtime gives the iframe a larger logical viewport and scales it back to the
host width, without changing the source HTML:

- `none` keeps the authored size and native overflow behavior.
- `width` only shrinks overflowing content to the available width.
- `contain` fits both width and height, which is useful for fixed-size slides.

The runtime never enlarges content above `1x`. It recalculates after host
resizes, committed edits, resource loads, and non-editor DOM changes.
`editor.setFitMode(mode)` changes the behavior at runtime, while
`editor.refreshFit()` lets a host request an immediate recalculation after an
external layout change. The current ratio is available as `editor.scale`.

For a simple two-state UI, use `scaleToFit: true | false`. `true` is shorthand
for `fit: "width"`. `false` preserves the authored fixed size, expands the
iframe to that size, and makes the mounted preview container scroll. The mode
can be changed later with `editor.setScaleToFit(enabled)`. When both
`scaleToFit` and `fit` are supplied, `scaleToFit` takes precedence.
The default UI shows a compact `Fit` switch; set `showScaleToggle: false` when
the host application provides its own control.

The lower-level runtime is available when a host supplies its own iframe and UI:

```js
import { createHtmlEditorRuntime } from "@deckflow/html-editor/editor";
```

Package layers are exposed independently:

- `@deckflow/html-editor/core` contains targets, operations, source patching,
  history, and text/table models.
- `@deckflow/html-editor/editor` contains the serverless iframe runtime.
- `@deckflow/html-editor/ui` contains `mountHtmlEditor()` and the default
  floating editing controls.
- `@deckflow/html-editor/server` contains local project and standalone servers.
- `@deckflow/html-editor` remains the compatible standalone server entry.

## Table Editing

Text inside table cells uses the same inline text and range-formatting tools as
other page text. When no text range is active, selecting content inside a
regular rectangular table replaces the element duplicate/delete menu with row
and column actions:

- insert a row above or below
- insert a column to the left or right
- delete the current row or column

New rows and columns preserve the presentation attributes of the neighboring
row or cell, start with empty content, and do not copy element IDs. The preview
updates immediately and the same semantic operation is applied to the source
HTML during auto-save.

Structural editing is deliberately disabled for tables that use `rowspan`,
`colspan`, `colgroup`, or inconsistent cell counts. Their cell text remains
editable, but changing their grid safely requires a span-aware table model.

## Publishing

Publishing is handled by [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
Creating a GitHub Release runs the test suite, checks the package contents, and
publishes the matching version as a public package on npm. A
release tagged `v0.1.1` (or `0.1.1`) must therefore contain `"version":
"0.1.1"` in `package.json`.

Add an npm automation or granular access token to the repository as the
`NPM_TOKEN` Actions secret. The npm account behind that token must have publish
permission for the `@deckflow` scope.

A normal patch release can be prepared with:

```bash
npm version patch
git push origin main --follow-tags
```

Finally, publish a GitHub Release for that tag in the repository UI. Publishing
the Release, rather than merely pushing the tag, starts the package workflow.
The current version can also be published manually from `main` with:

```bash
npm run publish:npm
npm run publish:watch
```

## Package API

The complete standalone server can also be embedded in another Node.js
application:

```js
import { createEditorServer } from "@deckflow/html-editor";

const editor = await createEditorServer({
  input: "./site",
  root: ".",
  port: 0,
});

console.log(editor.url);
```

Use the headless project server when your Node application supplies its own UI:

```js
import { createProjectServer } from "@deckflow/html-editor/server";

const project = await createProjectServer({
  input: "./site",
  root: ".",
  port: 0,
});
```
