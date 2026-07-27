function isElementNode(node) {
  return node?.type === "tag" || node?.type === "script" || node?.type === "style";
}

function elementChildren(node) {
  return (node?.children || []).filter(isElementNode);
}

function directTableRows(table) {
  const rows = [];
  for (const child of elementChildren(table)) {
    if (child.name === "tr") {
      rows.push(child);
      continue;
    }
    if (["thead", "tbody", "tfoot"].includes(child.name)) {
      rows.push(...elementChildren(child).filter((node) => node.name === "tr"));
    }
  }
  return rows;
}

function directRowCells(row) {
  return elementChildren(row).filter((node) => node.name === "td" || node.name === "th");
}

function hasComplexSpan(cell) {
  return ["rowspan", "colspan"].some((name) => {
    const value = cell.attribs?.[name];
    return value != null && String(value).trim() !== "1";
  });
}

export function analyzeTableNode(table) {
  if (table?.name !== "table") {
    return { editable: false, reason: "Target is not a table", rows: [], columnCount: 0 };
  }
  if (elementChildren(table).some((node) => node.name === "colgroup")) {
    return {
      editable: false,
      reason: "Tables with colgroup are not supported",
      rows: [],
      columnCount: 0,
    };
  }

  const rows = directTableRows(table);
  const cellsByRow = rows.map(directRowCells);
  const columnCount = cellsByRow[0]?.length || 0;
  if (rows.length === 0 || columnCount === 0) {
    return { editable: false, reason: "Table has no editable cells", rows, columnCount };
  }
  if (cellsByRow.some((cells) => cells.length !== columnCount)) {
    return { editable: false, reason: "Table rows have different column counts", rows, columnCount };
  }
  if (cellsByRow.some((cells) => cells.some(hasComplexSpan))) {
    return {
      editable: false,
      reason: "Tables with rowspan or colspan are not supported",
      rows,
      columnCount,
    };
  }
  return { editable: true, reason: "", rows, cellsByRow, columnCount };
}

function localStart(node, table) {
  return node.startIndex - table.startIndex;
}

function localEnd(node, table) {
  return node.endIndex - table.startIndex + 1;
}

function openingTagEnd(source, start, limit) {
  let quote = null;
  for (let index = start; index < limit; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index + 1;
  }
  return -1;
}

function closingTagStart(source, start, end) {
  const index = source.lastIndexOf("</", end - 1);
  return index >= start ? index : -1;
}

function withoutIdAttribute(openingTag) {
  return openingTag.replace(
    /\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
    "",
  );
}

function applyReplacements(source, replacements) {
  const ordered = [...replacements].sort((left, right) => right.start - left.start);
  let next = source;
  let boundary = source.length;
  for (const replacement of ordered) {
    if (replacement.start < 0 || replacement.end < replacement.start
      || replacement.end > boundary) return null;
    next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
    boundary = replacement.start;
  }
  return next;
}

function blankElementHtml(tableHtml, table, element, cells) {
  const elementStart = localStart(element, table);
  const elementEnd = localEnd(element, table);
  if (elementStart < 0 || elementEnd > tableHtml.length) return null;
  const replacements = [];

  const openingTagNodes = [...new Set([element, ...cells])];
  for (const node of openingTagNodes) {
    const start = localStart(node, table);
    const end = localEnd(node, table);
    const openEnd = openingTagEnd(tableHtml, start, end);
    if (openEnd < 0) return null;
    replacements.push({
      start,
      end: openEnd,
      value: withoutIdAttribute(tableHtml.slice(start, openEnd)),
    });
  }

  for (const cell of cells) {
    const start = localStart(cell, table);
    const end = localEnd(cell, table);
    const openEnd = openingTagEnd(tableHtml, start, end);
    const closeStart = closingTagStart(tableHtml, openEnd, end);
    if (openEnd < 0 || closeStart < 0) return null;
    replacements.push({ start: openEnd, end: closeStart, value: "" });
  }

  const elementHtml = tableHtml.slice(elementStart, elementEnd);
  const relative = replacements.map((replacement) => ({
    ...replacement,
    start: replacement.start - elementStart,
    end: replacement.end - elementStart,
  }));
  return applyReplacements(elementHtml, relative);
}

function insertionSeparator(source, position) {
  const before = source.slice(0, position);
  const match = before.match(/(\r?\n)([ \t]*)$/);
  return match ? `${match[1]}${match[2]}` : "";
}

function validIndex(value, upperBound) {
  return Number.isInteger(value) && value >= 0 && value < upperBound;
}

function expandStandaloneLine(source, start, end) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const newlineIndex = source.indexOf("\n", end);
  if (newlineIndex < 0) return { start, end };
  if (source.slice(lineStart, start).trim() || source.slice(end, newlineIndex).trim()) {
    return { start, end };
  }
  return { start: lineStart, end: newlineIndex + 1 };
}

function patchRow(tableHtml, table, structure, operation) {
  const rowIndex = operation.rowIndex;
  if (!validIndex(rowIndex, structure.rows.length)) return null;
  const row = structure.rows[rowIndex];
  const start = localStart(row, table);
  const end = localEnd(row, table);

  if (operation.type === "table-delete-row") {
    if (structure.rows.length <= 1) return null;
    const range = expandStandaloneLine(tableHtml, start, end);
    return `${tableHtml.slice(0, range.start)}${tableHtml.slice(range.end)}`;
  }

  if (operation.type !== "table-insert-row"
    || !["before", "after"].includes(operation.position)) return null;
  const blankRow = blankElementHtml(tableHtml, table, row, structure.cellsByRow[rowIndex]);
  if (blankRow == null) return null;
  const separator = insertionSeparator(tableHtml, start);
  const insertion = operation.position === "before"
    ? `${blankRow}${separator}`
    : `${separator}${blankRow}`;
  const position = operation.position === "before" ? start : end;
  return `${tableHtml.slice(0, position)}${insertion}${tableHtml.slice(position)}`;
}

function patchColumn(tableHtml, table, structure, operation) {
  const columnIndex = operation.columnIndex;
  if (!validIndex(columnIndex, structure.columnCount)) return null;
  if (operation.type === "table-delete-column" && structure.columnCount <= 1) return null;
  if (!["table-delete-column", "table-insert-column"].includes(operation.type)) return null;
  if (operation.type === "table-insert-column"
    && !["before", "after"].includes(operation.position)) return null;

  const replacements = [];
  for (const cells of structure.cellsByRow) {
    const cell = cells[columnIndex];
    const start = localStart(cell, table);
    const end = localEnd(cell, table);
    if (operation.type === "table-delete-column") {
      replacements.push({ ...expandStandaloneLine(tableHtml, start, end), value: "" });
      continue;
    }

    const blankCell = blankElementHtml(tableHtml, table, cell, [cell]);
    if (blankCell == null) return null;
    const separator = insertionSeparator(tableHtml, start);
    replacements.push({
      start: operation.position === "before" ? start : end,
      end: operation.position === "before" ? start : end,
      value: operation.position === "before"
        ? `${blankCell}${separator}`
        : `${separator}${blankCell}`,
    });
  }
  return applyReplacements(tableHtml, replacements);
}

export function patchTableElementHtml(tableHtml, table, operation) {
  const structure = analyzeTableNode(table);
  if (!structure.editable) return null;
  if (!Number.isInteger(table.startIndex) || !Number.isInteger(table.endIndex)) return null;

  if (operation?.type === "table-insert-row" || operation?.type === "table-delete-row") {
    return patchRow(tableHtml, table, structure, operation);
  }
  if (operation?.type === "table-insert-column"
    || operation?.type === "table-delete-column") {
    return patchColumn(tableHtml, table, structure, operation);
  }
  return null;
}
