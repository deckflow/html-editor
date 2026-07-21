import assert from "node:assert/strict";
import test from "node:test";

import { chooseLocalHtmlDirectory, chooseLocalHtmlFile } from "../nativeFilePicker.js";

test("native picker returns the selected path from macOS", async () => {
  const calls = [];
  const selected = await chooseLocalHtmlFile({
    platform: "darwin",
    execute: async (file, args) => {
      calls.push({ file, args });
      return "/tmp/site/index.html\n";
    },
  });

  assert.equal(selected, "/tmp/site/index.html");
  assert.equal(calls[0].file, "osascript");
});

test("native picker reports user cancellation without an error", async () => {
  const selected = await chooseLocalHtmlFile({
    platform: "darwin",
    execute: async () => {
      const error = new Error("User canceled");
      error.stderr = "execution error: User canceled.";
      throw error;
    },
  });

  assert.equal(selected, null);
});

test("native directory picker returns the selected folder from macOS", async () => {
  const calls = [];
  const selected = await chooseLocalHtmlDirectory({
    platform: "darwin",
    execute: async (file, args) => {
      calls.push({ file, args });
      return "/tmp/site/\n";
    },
  });

  assert.equal(selected, "/tmp/site/");
  assert.equal(calls[0].file, "osascript");
  assert.match(calls[0].args.join(" "), /choose folder/);
});
