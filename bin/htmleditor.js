#!/usr/bin/env node

import { runCli } from "../cli.js";

runCli().catch((error) => {
  console.error(`htmleditor: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
