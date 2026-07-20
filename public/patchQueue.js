function targetKey(target) {
  const { originalText: _fingerprint, ...identity } = target || {};
  return JSON.stringify(identity);
}

function snapshotTarget(target) {
  return JSON.parse(JSON.stringify(target || {}));
}

function operationKey(operation) {
  return `${operation.type}:${operation.property || ""}`;
}

export function appendStylePatch(patches, target, operation) {
  const key = targetKey(target);
  const last = patches[patches.length - 1];
  let patch = last && !last.structural && last.key === key ? last : null;
  if (!patch) {
    patch = { key, target: snapshotTarget(target), operations: [], structural: false };
    patches.push(patch);
  }

  const keyForOperation = operationKey(operation);
  const existingIndex = patch.operations.findIndex(
    (item) => operationKey(item) === keyForOperation,
  );
  if (existingIndex >= 0) patch.operations[existingIndex] = operation;
  else patch.operations.push(operation);
  return patch;
}

export function appendStructuralPatch(patches, target, operation, sequence) {
  const patch = {
    key: `structural-${sequence}`,
    target: snapshotTarget(target),
    operations: [operation],
    structural: true,
  };
  patches.push(patch);
  return patch;
}
