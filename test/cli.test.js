import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "../cli.js";

test("CLI accepts a project path and startup options", () => {
  assert.deepEqual(parseCliArgs(["./site", "--port", "4567", "--no-open"]), {
    help: false,
    input: "./site",
    open: false,
    port: 4567,
  });
});

test("CLI defaults to the current directory and an automatic port", () => {
  assert.deepEqual(parseCliArgs([]), {
    help: false,
    input: ".",
    open: true,
    port: 0,
  });
});

test("CLI rejects unknown flags and invalid ports", () => {
  assert.throws(() => parseCliArgs(["--wat"]), /Unknown option/);
  assert.throws(() => parseCliArgs(["--port", "70000"]), /valid port/);
});
