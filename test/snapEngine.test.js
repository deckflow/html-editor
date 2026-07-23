import test from "node:test";
import assert from "node:assert/strict";
import {
  SNAP_THRESHOLD_PX,
  createSnapTarget,
  createViewportSnapTarget,
  keepGuidesAfterBounds,
  resolveResizeSnap,
  resolveSnapAdjustment,
} from "../public/snapEngine.js";

function rect(left, top, width, height) {
  return { left, top, width, height };
}

test("creates viewport edges and centers", () => {
  assert.deepEqual(createViewportSnapTarget(800, 600), {
    id: "viewport",
    kind: "viewport",
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    centerX: 400,
    centerY: 300,
  });
});

test("snaps element centers to the viewport center on both axes", () => {
  const result = resolveSnapAdjustment({
    movingRect: rect(0, 0, 100, 80),
    proposedDx: 347,
    proposedDy: 258,
    targets: [createViewportSnapTarget(800, 600)],
  });

  assert.equal(result.dx, 350);
  assert.equal(result.dy, 260);
  assert.deepEqual(result.guides.map(({ axis, position }) => ({ axis, position })), [
    { axis: "x", position: 400 },
    { axis: "y", position: 300 },
  ]);
});

test("snaps moving edges to another element edges and centers", () => {
  const target = createSnapTarget(rect(200, 120, 100, 60), "peer");
  const result = resolveSnapAdjustment({
    movingRect: rect(0, 0, 50, 40),
    proposedDx: 147,
    proposedDy: 98,
    targets: [target],
  });

  assert.equal(result.dx, 150);
  assert.equal(result.dy, 100);
  assert.ok(result.guides.some((guide) => guide.axis === "x" && guide.position === 200));
  assert.ok(result.guides.some((guide) => guide.axis === "y" && guide.position === 120));
});

test("snaps at the threshold and ignores positions beyond it", () => {
  const target = createSnapTarget(rect(100, 100, 20, 20), "peer");
  const atThreshold = resolveSnapAdjustment({
    movingRect: rect(0, 0, 20, 20),
    proposedDx: 74,
    proposedDy: 0,
    targets: [target],
    threshold: SNAP_THRESHOLD_PX,
  });
  const outside = resolveSnapAdjustment({
    movingRect: rect(0, 0, 20, 20),
    proposedDx: 73,
    proposedDy: 0,
    targets: [target],
    threshold: SNAP_THRESHOLD_PX,
  });

  assert.equal(atThreshold.dx, 80);
  assert.equal(outside.dx, 73);
  assert.equal(outside.guides.length, 0);
});

test("resolves axes independently", () => {
  const target = createSnapTarget(rect(100, 500, 40, 40), "peer");
  const result = resolveSnapAdjustment({
    movingRect: rect(0, 0, 20, 20),
    proposedDx: 78,
    proposedDy: 25,
    targets: [target],
  });

  assert.equal(result.dx, 80);
  assert.equal(result.dy, 25);
  assert.deepEqual(new Set(result.guides.map((guide) => guide.axis)), new Set(["x"]));
});

test("disables snapping while Alt is held", () => {
  const result = resolveSnapAdjustment({
    movingRect: rect(0, 0, 20, 20),
    proposedDx: 78,
    proposedDy: 78,
    targets: [createSnapTarget(rect(100, 100, 20, 20), "peer")],
    disabled: true,
  });

  assert.deepEqual(result, { dx: 78, dy: 78, guides: [] });
});

test("snaps only the actively resized right edge", () => {
  const result = resolveResizeSnap({
    side: "right",
    movingRect: rect(20, 40, 100, 60),
    proposedDelta: 77,
    targets: [createSnapTarget(rect(200, 10, 80, 40), "peer")],
  });

  assert.equal(result.delta, 80);
  assert.deepEqual(result.guides.map(({ axis, position }) => ({ axis, position })), [
    { axis: "x", position: 200 },
  ]);
});

test("snaps the resized left edge while the right edge stays fixed", () => {
  const result = resolveResizeSnap({
    side: "left",
    movingRect: rect(100, 40, 120, 60),
    proposedDelta: -37,
    targets: [createSnapTarget(rect(60, 10, 20, 40), "peer")],
  });

  assert.equal(result.delta, -40);
  assert.ok(result.guides.some((guide) => guide.axis === "x" && guide.position === 60));
});

test("disables resize snapping while Alt is held", () => {
  assert.deepEqual(
    resolveResizeSnap({
      side: "right",
      movingRect: rect(0, 0, 100, 40),
      proposedDelta: 97,
      targets: [createSnapTarget(rect(200, 0, 20, 20), "peer")],
      disabled: true,
    }),
    { delta: 97, guides: [] },
  );
});

test("suppresses an ambiguous equal-distance snap", () => {
  const result = resolveSnapAdjustment({
    movingRect: rect(50, 0, 10, 10),
    proposedDx: 0,
    proposedDy: 0,
    targets: [
      { id: "left", kind: "element", left: 49, centerX: 49, right: 49, top: 100, centerY: 100, bottom: 100 },
      { id: "right", kind: "element", left: 61, centerX: 61, right: 61, top: 100, centerY: 100, bottom: 100 },
    ],
    threshold: 6,
  });

  assert.equal(result.dx, 0);
  assert.equal(result.guides.filter((guide) => guide.axis === "x").length, 0);
});

test("drops only the guide whose snapped axis was changed by viewport bounds", () => {
  assert.deepEqual(
    keepGuidesAfterBounds({
      guides: [{ axis: "x", position: 0 }, { axis: "y", position: 100 }],
      snappedDx: -5,
      snappedDy: 20,
      finalDx: -2,
      finalDy: 20,
    }),
    [{ axis: "y", position: 100 }],
  );
});
