import assert from "node:assert/strict";
import test from "node:test";

import { createAutoSaveController } from "../public/autoSaveController.js";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("auto-save debounces a burst of edits", async () => {
  let saves = 0;
  const controller = createAutoSaveController({
    delay: 20,
    maxWait: 100,
    save: () => { saves += 1; },
  });

  controller.schedule();
  await wait(10);
  controller.schedule();
  await wait(10);
  controller.schedule();
  await wait(35);

  assert.equal(saves, 1);
  controller.destroy();
});

test("auto-save enforces a maximum wait during continuous edits", async () => {
  let saves = 0;
  const controller = createAutoSaveController({
    delay: 30,
    maxWait: 55,
    save: () => { saves += 1; },
  });

  controller.schedule();
  await wait(20);
  controller.schedule();
  await wait(20);
  controller.schedule();
  await wait(25);

  assert.equal(saves, 1);
  controller.destroy();
});

test("flushNow saves immediately and cancels scheduled timers", async () => {
  let saves = 0;
  const controller = createAutoSaveController({
    delay: 50,
    maxWait: 100,
    save: () => { saves += 1; },
  });

  controller.schedule();
  await controller.flushNow();
  await wait(60);

  assert.equal(saves, 1);
  controller.destroy();
});
