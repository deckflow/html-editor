const TABLE_SECTIONS = new Set(["THEAD", "TBODY", "TFOOT"]);
const CELL_TAGS = new Set(["TD", "TH"]);
const EDITOR_ATTRIBUTES = [
  "contenteditable",
  "spellcheck",
  "data-local-editor-selected",
  "data-local-editor-editing",
  "data-local-editor-drag-ready",
];

function elementChildren(element) {
  return Array.from(element?.children || []);
}

function directRows(table) {
  const rows = [];
  for (const child of elementChildren(table)) {
    if (child.tagName === "TR") {
      rows.push(child);
      continue;
    }
    if (TABLE_SECTIONS.has(child.tagName)) {
      rows.push(...elementChildren(child).filter((row) => row.tagName === "TR"));
    }
  }
  return rows;
}

function directCells(row) {
  return elementChildren(row).filter((cell) => CELL_TAGS.has(cell.tagName));
}

function hasComplexSpan(cell) {
  return ["rowspan", "colspan"].some((name) => {
    const value = cell.getAttribute?.(name);
    return value != null && String(value).trim() !== "1";
  });
}

function tableCellForElement(element) {
  if (!element?.closest) return null;
  return CELL_TAGS.has(element.tagName) ? element : element.closest("td, th");
}

export function tableContextForElement(element) {
  const cell = tableCellForElement(element);
  const table = cell?.closest?.("table");
  const row = cell?.parentElement;
  if (!cell || !table || row?.tagName !== "TR" || row.closest("table") !== table) return null;

  const rows = directRows(table);
  const cellsByRow = rows.map(directCells);
  const rowIndex = rows.indexOf(row);
  const columnIndex = directCells(row).indexOf(cell);
  const columnCount = cellsByRow[0]?.length || 0;
  let reason = "";

  if (elementChildren(table).some((child) => child.tagName === "COLGROUP")) {
    reason = "Tables with colgroup cannot be restructured";
  } else if (rows.length === 0 || columnCount === 0 || rowIndex < 0 || columnIndex < 0) {
    reason = "This table has no editable row and column grid";
  } else if (cellsByRow.some((cells) => cells.length !== columnCount)) {
    reason = "Rows with different column counts cannot be restructured";
  } else if (cellsByRow.some((cells) => cells.some(hasComplexSpan))) {
    reason = "Tables with rowspan or colspan cannot be restructured";
  }

  const editable = !reason;
  return {
    table,
    cell,
    row,
    rows,
    cellsByRow,
    rowIndex,
    columnIndex,
    rowCount: rows.length,
    columnCount,
    editable,
    reason,
    canDeleteRow: editable && rows.length > 1,
    canDeleteColumn: editable && columnCount > 1,
  };
}

export function operationForTableAction(context, action) {
  if (!context?.editable) return null;
  const rowOperations = {
    "row-before": {
      type: "table-insert-row",
      rowIndex: context.rowIndex,
      position: "before",
    },
    "row-after": {
      type: "table-insert-row",
      rowIndex: context.rowIndex,
      position: "after",
    },
    "row-delete": {
      type: "table-delete-row",
      rowIndex: context.rowIndex,
    },
  };
  const columnOperations = {
    "column-before": {
      type: "table-insert-column",
      columnIndex: context.columnIndex,
      position: "before",
    },
    "column-after": {
      type: "table-insert-column",
      columnIndex: context.columnIndex,
      position: "after",
    },
    "column-delete": {
      type: "table-delete-column",
      columnIndex: context.columnIndex,
    },
  };
  if (action === "row-delete" && !context.canDeleteRow) return null;
  if (action === "column-delete" && !context.canDeleteColumn) return null;
  return rowOperations[action] || columnOperations[action] || null;
}

function clearEditorAttributes(element) {
  element.removeAttribute("id");
  for (const name of EDITOR_ATTRIBUTES) element.removeAttribute(name);
}

function createBlankCell(cell) {
  const clone = cell.cloneNode(false);
  clearEditorAttributes(clone);
  return clone;
}

function createBlankRow(context) {
  const clone = context.row.cloneNode(false);
  clearEditorAttributes(clone);
  for (const cell of directCells(context.row)) clone.append(createBlankCell(cell));
  return clone;
}

export function applyTableAction(context, action) {
  const operation = operationForTableAction(context, action);
  if (!operation) {
    return {
      changed: false,
      reason: context?.reason || "This row or column cannot be removed",
      selectedCell: context?.cell || null,
    };
  }

  if (action === "row-before" || action === "row-after") {
    const row = createBlankRow(context);
    if (action === "row-before") context.row.before(row);
    else context.row.after(row);
    return {
      changed: true,
      operation,
      selectedCell: directCells(row)[context.columnIndex] || directCells(row)[0] || null,
    };
  }

  if (action === "row-delete") {
    const fallbackRow = context.rows[context.rowIndex + 1] || context.rows[context.rowIndex - 1];
    const fallbackCells = directCells(fallbackRow);
    context.row.remove();
    return {
      changed: true,
      operation,
      selectedCell: fallbackCells[Math.min(context.columnIndex, fallbackCells.length - 1)] || null,
    };
  }

  if (action === "column-before" || action === "column-after") {
    let selectedCell = null;
    context.cellsByRow.forEach((cells, rowIndex) => {
      const anchor = cells[context.columnIndex];
      const cell = createBlankCell(anchor);
      if (action === "column-before") anchor.before(cell);
      else anchor.after(cell);
      if (rowIndex === context.rowIndex) selectedCell = cell;
    });
    return { changed: true, operation, selectedCell };
  }

  let selectedCell = null;
  context.cellsByRow.forEach((cells, rowIndex) => {
    const cell = cells[context.columnIndex];
    const fallback = cells[context.columnIndex + 1] || cells[context.columnIndex - 1] || null;
    cell.remove();
    if (rowIndex === context.rowIndex) selectedCell = fallback;
  });
  return { changed: true, operation, selectedCell };
}
