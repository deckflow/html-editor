import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { createEditorServer } from "./server.js";

export function parseCliArgs(argv) {
  const result = { help: false, input: ".", open: true, port: 0 };
  let hasInput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      result.help = true;
      continue;
    }
    if (value === "--no-open") {
      result.open = false;
      continue;
    }
    if (value === "--port") {
      const port = Number(argv[index + 1]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port must be a valid port between 0 and 65535");
      }
      result.port = port;
      index += 1;
      continue;
    }
    if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    }
    if (hasInput) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    result.input = value;
    hasInput = true;
  }
  return result;
}

export function printHelp(log = console.log) {
  log(`Local HTML Editor

Usage:
  local-html-editor [html-file-or-directory] [options]

Options:
  --port <number>  Preferred port; 0 selects an available port (default: 0)
  --no-open        Do not open the browser automatically
  -h, --help       Show this help`);
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    printHelp();
    return null;
  }

  const editor = await createEditorServer({ input: resolve(options.input), port: options.port });
  console.log(`Local HTML Editor: ${editor.url}`);
  console.log(`Project: ${editor.projectDir}`);
  console.log(`Editing: ${editor.defaultFile}`);

  if (options.open) openBrowser(editor.url);

  const shutdown = async () => {
    await editor.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return editor;
}
