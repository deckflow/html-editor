import assert from "node:assert/strict";
import test from "node:test";

import { activateEmbeddedPreview } from "../public/previewLifecycle.js";

test("activates a slide page through its embedded lifecycle contract", () => {
  const messages = [];
  const page = { dataset: { pageId: "page-001" } };
  const document = {
    querySelector(selector) {
      assert.equal(selector, ".slide-page[data-page-id]");
      return page;
    },
    defaultView: {
      postMessage(message, targetOrigin) {
        messages.push({ message, targetOrigin });
      },
    },
  };

  assert.equal(activateEmbeddedPreview(document), true);
  assert.deepEqual(messages, [{
    message: {
      type: "deck:page-enter",
      pageId: "page-001",
      source: "local-html-editor",
    },
    targetOrigin: "*",
  }]);
});

test("leaves ordinary HTML documents untouched", () => {
  let posted = false;
  const document = {
    querySelector() {
      return null;
    },
    defaultView: {
      postMessage() {
        posted = true;
      },
    },
  };

  assert.equal(activateEmbeddedPreview(document), false);
  assert.equal(posted, false);
});
