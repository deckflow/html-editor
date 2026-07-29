import type {
  ElementTarget,
  HtmlPatch,
  PatchResult,
} from "@deckflow/html-editor/core";
import { patchElementsInHtml } from "@deckflow/html-editor/core";
import { createHtmlEditorRuntime } from "@deckflow/html-editor/editor";
import { createProjectServer } from "@deckflow/html-editor/server";
import { mountHtmlEditor } from "@deckflow/html-editor/ui";

// Keep the contract examples inside an uncalled function. TypeScript still
// checks every expression, while modern Node versions that discover `.ts`
// files during `node --test` cannot execute browser-only calls.
function assertPublicApiTypes(
  container: HTMLElement,
  iframe: HTMLIFrameElement,
): void {
  const target: ElementTarget = {
    id: "headline",
    originalText: "Hello",
  };
  const patches: HtmlPatch[] = [{
    target,
    operations: [{ type: "text-content", value: "Updated" }],
  }];
  const result: PatchResult = patchElementsInHtml("<h1>Hello</h1>", patches);
  result.html;

  const mounted = mountHtmlEditor({
    container,
    html: "<h1>Hello</h1>",
    readonly: true,
    fit: "width",
    onChange({ html, patches: nextPatches, revision, reason }) {
      html.toUpperCase();
      nextPatches.length;
      revision.toFixed();
      reason.toUpperCase();
    },
  });
  mounted.getHtml();
  mounted.setHtml("<h1>Next</h1>");
  mounted.setReadonly(false);
  mounted.readonly;
  mounted.setFitMode("contain");
  mounted.refreshFit();
  mounted.scale;
  mounted.destroy();

  const runtime = createHtmlEditorRuntime({ iframe, html: "<p>Runtime</p>" });
  runtime.flush();
  createProjectServer({ input: "./samples/demo.html", port: 0 });
}

void assertPublicApiTypes;
