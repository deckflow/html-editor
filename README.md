# Local HTML Editor

Run a browser-based visual text editor against an HTML file on your own machine.
Edits are previewed in an iframe and saved back through local, targeted HTML
patches. The server binds to `127.0.0.1` and keeps backups under
`.local-html-editor/backups/` in the selected project.

## Usage

Run directly from a package registry:

```bash
npx @deckflow/html-editor ./index.html
```

The package exposes `htmleditor` as its executable. After a global install, the
same editor can be started with `htmleditor ./index.html`.

Pass a directory to open it as an HTML workspace:

```bash
npx @deckflow/html-editor ./site
```

The editor prefers `index.html` as the initial page, then falls back to the first
HTML file in lexical order. A searchable sidebar lists every `.html` file under
the directory as a flat relative-path list, so nested pages can be switched
without restarting the CLI. Hidden directories and `node_modules` are skipped.

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

## Publishing

Authenticate with npm and publish the public scoped package:

```bash
npm login --registry https://registry.npmjs.org
npm publish
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
