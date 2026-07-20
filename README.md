# Local HTML Editor

Run a browser-based visual text editor against an HTML file on your own machine.
Edits are previewed in an iframe and saved back through local, targeted HTML
patches. The server binds to `127.0.0.1` and keeps backups under
`.local-html-editor/backups/` in the selected project.

## Usage

Run directly from a package registry:

```bash
npx local-html-editor ./index.html
npx local-html-editor ./my-site
```

For local development in this repository:

```bash
npm install
npm run dev
```

The CLI opens the browser automatically and selects an available port. Pass a
fixed port or keep the browser closed with:

```bash
local-html-editor ./site --port 4567 --no-open
```

When a directory is supplied, `index.html` is preferred. If it does not exist,
the first HTML file in lexical order is loaded. All reads and writes stay under
that project directory. Remote URLs can be loaded, but Save creates a local
snapshot because the editor cannot write back to the remote server.

## Package API

The server can also be embedded in another Node.js application:

```js
import { createEditorServer } from "local-html-editor";

const editor = await createEditorServer({
  input: "./site/index.html",
  port: 0,
});

console.log(editor.url);
```
