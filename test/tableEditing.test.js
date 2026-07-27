import test from "node:test";
import assert from "node:assert/strict";
import { operationForTableAction } from "../public/tableEditing.js";

const context = {
  editable: true,
  rowIndex: 2,
  columnIndex: 1,
  canDeleteRow: true,
  canDeleteColumn: true,
};

test("maps table menu actions to source patch operations", () => {
  assert.deepEqual(operationForTableAction(context, "row-before"), {
    type: "table-insert-row",
    rowIndex: 2,
    position: "before",
  });
  assert.deepEqual(operationForTableAction(context, "column-after"), {
    type: "table-insert-column",
    columnIndex: 1,
    position: "after",
  });
  assert.deepEqual(operationForTableAction(context, "row-delete"), {
    type: "table-delete-row",
    rowIndex: 2,
  });
});

test("does not produce destructive operations for the final row or column", () => {
  assert.equal(operationForTableAction({ ...context, canDeleteRow: false }, "row-delete"), null);
  assert.equal(
    operationForTableAction({ ...context, canDeleteColumn: false }, "column-delete"),
    null,
  );
});

test("does not produce operations for complex table structures", () => {
  assert.equal(
    operationForTableAction({ ...context, editable: false }, "row-after"),
    null,
  );
});
