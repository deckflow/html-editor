export const SNAP_THRESHOLD_PX = 6;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rectEdges(rect) {
  const left = finiteNumber(rect?.left);
  const top = finiteNumber(rect?.top);
  const width = Math.max(0, finiteNumber(rect?.width));
  const height = Math.max(0, finiteNumber(rect?.height));
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

export function createSnapTarget(rect, id, kind = "element") {
  return { ...rectEdges(rect), id: String(id), kind };
}

export function createViewportSnapTarget(width, height) {
  return createSnapTarget(
    { left: 0, top: 0, width: finiteNumber(width), height: finiteNumber(height) },
    "viewport",
    "viewport",
  );
}

function collectAxisCandidates(movingEdges, targets, edgeNames, threshold) {
  const candidates = [];
  for (const target of targets || []) {
    for (const movingPosition of movingEdges) {
      for (const edgeName of edgeNames) {
        const targetPosition = finiteNumber(target?.[edgeName]);
        const adjustment = targetPosition - movingPosition;
        const distance = Math.abs(adjustment);
        if (distance <= threshold) {
          candidates.push({
            adjustment,
            distance,
            position: targetPosition,
            targetId: target.id,
            targetKind: target.kind || "element",
          });
        }
      }
    }
  }
  return candidates;
}

function pickBest(candidates) {
  if (candidates.length === 0) return null;
  const minimum = Math.min(...candidates.map((candidate) => candidate.distance));
  const winners = candidates.filter((candidate) => Math.abs(candidate.distance - minimum) < 0.001);
  const hasPositive = winners.some((candidate) => candidate.adjustment > 0.001);
  const hasNegative = winners.some((candidate) => candidate.adjustment < -0.001);
  if (hasPositive && hasNegative) return null;

  const adjustment = winners[0].adjustment;
  return {
    adjustment,
    matches: candidates.filter(
      (candidate) => Math.abs(candidate.adjustment - adjustment) < 0.001,
    ),
  };
}

function guidesForAxis(axis, best) {
  if (!best) return [];
  const positions = new Set();
  const guides = [];
  for (const match of best.matches) {
    const key = match.position.toFixed(3);
    if (positions.has(key)) continue;
    positions.add(key);
    guides.push({
      axis,
      position: match.position,
      targetId: match.targetId,
      targetKind: match.targetKind,
    });
  }
  return guides;
}

export function resolveSnapAdjustment({
  movingRect,
  proposedDx,
  proposedDy,
  targets,
  threshold = SNAP_THRESHOLD_PX,
  disabled = false,
}) {
  const dx = finiteNumber(proposedDx);
  const dy = finiteNumber(proposedDy);
  const snapThreshold = Math.max(0, finiteNumber(threshold));
  if (disabled || snapThreshold === 0 || !targets?.length) {
    return { dx, dy, guides: [] };
  }

  const proposed = rectEdges({
    left: finiteNumber(movingRect?.left) + dx,
    top: finiteNumber(movingRect?.top) + dy,
    width: movingRect?.width,
    height: movingRect?.height,
  });
  const bestX = pickBest(collectAxisCandidates(
    [proposed.left, proposed.centerX, proposed.right],
    targets,
    ["left", "centerX", "right"],
    snapThreshold,
  ));
  const bestY = pickBest(collectAxisCandidates(
    [proposed.top, proposed.centerY, proposed.bottom],
    targets,
    ["top", "centerY", "bottom"],
    snapThreshold,
  ));

  return {
    dx: dx + (bestX?.adjustment || 0),
    dy: dy + (bestY?.adjustment || 0),
    guides: [
      ...guidesForAxis("x", bestX),
      ...guidesForAxis("y", bestY),
    ],
  };
}

export function resolveResizeSnap({
  side,
  movingRect,
  proposedDelta,
  targets,
  threshold = SNAP_THRESHOLD_PX,
  disabled = false,
}) {
  const delta = finiteNumber(proposedDelta);
  const snapThreshold = Math.max(0, finiteNumber(threshold));
  if (
    disabled
    || snapThreshold === 0
    || !targets?.length
    || (side !== "left" && side !== "right")
  ) {
    return { delta, guides: [] };
  }

  const edges = rectEdges(movingRect);
  const movingPosition = (side === "left" ? edges.left : edges.right) + delta;
  const bestX = pickBest(collectAxisCandidates(
    [movingPosition],
    targets,
    ["left", "centerX", "right"],
    snapThreshold,
  ));

  return {
    delta: delta + (bestX?.adjustment || 0),
    guides: guidesForAxis("x", bestX),
  };
}

export function keepGuidesAfterBounds({ guides, snappedDx, snappedDy, finalDx, finalDy }) {
  return (guides || []).filter((guide) =>
    guide.axis === "x"
      ? Math.abs(finiteNumber(finalDx) - finiteNumber(snappedDx)) < 0.01
      : Math.abs(finiteNumber(finalDy) - finiteNumber(snappedDy)) < 0.01,
  );
}
