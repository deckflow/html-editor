import { createEditorServer } from "../../server.js";

/**
 * Standalone composition entry used by the CLI layer. It combines the local
 * project server with the complete top bar, file list, status, and auto-save
 * controller served from public/.
 */
export function createStandaloneEditorServer(options = {}) {
  return createEditorServer(options);
}
