# Local HTML Editor

Run a browser-based visual text editor against an HTML file on your own machine.
Edits are previewed in an iframe and saved back through local, targeted HTML
patches. The server binds to `127.0.0.1` and keeps backups under
`.local-html-editor/backups/` in the selected project.

## Usage

GitHub Packages requires authentication even when consuming a public package.
Point the `@deckflow` scope at GitHub Packages and log in with a GitHub personal
access token (classic) that has `read:packages` permission:

```bash
npm config set @deckflow:registry https://npm.pkg.github.com
npm login --scope=@deckflow --auth-type=legacy --registry=https://npm.pkg.github.com
```

Then run the package directly:

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
publishes the matching version to GitHub Packages. A release tagged `v0.1.1` (or
`0.1.1`) must therefore contain `"version": "0.1.1"` in `package.json`.

The workflow grants `packages: write` to the repository's built-in
`GITHUB_TOKEN`, so no npm token or additional Actions secret is required. A
normal patch release can be prepared with:

```bash
npm version patch
git push origin main --follow-tags
```

Finally, publish a GitHub Release for that tag in the repository UI. Publishing
the Release, rather than merely pushing the tag, starts the package workflow.
The current version can also be published manually from `main` with:

```bash
npm run publish:github
npm run publish:watch
```

## Package API

The server can also be embedded in another Node.js application:

```js
import { createEditorServer } from "@deckflow/html-editor";

const editor = await createEditorServer({
  input: "./site",
  root: ".",
  port: 0,
});

console.log(editor.url);
```
