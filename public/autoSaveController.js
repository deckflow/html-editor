export function createAutoSaveController({
  save,
  delay = 1_200,
  maxWait = 5_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let idleTimer = null;
  let maxTimer = null;
  let inFlight = null;
  let queued = false;
  let destroyed = false;

  function clearTimers() {
    if (idleTimer !== null) clearTimer(idleTimer);
    if (maxTimer !== null) clearTimer(maxTimer);
    idleTimer = null;
    maxTimer = null;
  }

  async function run() {
    clearTimers();
    if (destroyed) return true;
    if (inFlight) {
      queued = true;
      return inFlight;
    }

    inFlight = Promise.resolve().then(save);
    try {
      const completed = await inFlight;
      if (completed === false && !destroyed) schedule();
      return completed;
    } finally {
      inFlight = null;
      if (queued && !destroyed) {
        queued = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (destroyed) return;
    if (inFlight) {
      queued = true;
      return;
    }
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = setTimer(run, delay);
    if (maxTimer === null) maxTimer = setTimer(run, maxWait);
  }

  async function flushNow() {
    clearTimers();
    if (inFlight) {
      queued = true;
      await inFlight;
      if (destroyed) return true;
      queued = false;
    }
    return run();
  }

  function cancel() {
    clearTimers();
    queued = false;
  }

  function destroy() {
    destroyed = true;
    cancel();
  }

  return { cancel, destroy, flushNow, schedule };
}
