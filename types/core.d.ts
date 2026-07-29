export interface ElementTarget {
  id?: string;
  selector?: string;
  selectorIndex?: number;
  domPath?: number[];
  tagName?: string;
  originalText?: string;
}

export type InlineStyleOperation = {
  type: "inline-style";
  property: string;
  value: string;
};

export type TextContentOperation = {
  type: "text-content";
  value: string;
};

export type TextNodeContentOperation = {
  type: "text-node-content";
  nodePath: number[];
  originalValue?: string;
  value: string;
};

export type InnerHtmlOperation = {
  type: "inner-html";
  value: string;
};

export type StructuralOperation =
  | { type: "duplicate-element"; newId?: string }
  | { type: "delete-element" }
  | { type: string; [key: string]: unknown };

export type HtmlOperation =
  | InlineStyleOperation
  | TextContentOperation
  | TextNodeContentOperation
  | InnerHtmlOperation
  | StructuralOperation;

export interface HtmlPatch {
  target: ElementTarget;
  operations: HtmlOperation[];
}

export interface PatchResult {
  html: string;
  matched: boolean;
  changed: boolean;
  failedIndex?: number;
}

export function patchElementInHtml(
  source: string,
  target: ElementTarget,
  operations?: HtmlOperation[],
): PatchResult;
export function patchElementsInHtml(source: string, patches?: HtmlPatch[]): PatchResult;

export function createElementTarget(element: Element, selector?: string): ElementTarget;
export function createEditorHistory<T = unknown>(limit?: number): {
  push(entry: T): void;
  undo(currentEntry: T): T | null;
  redo(currentEntry: T): T | null;
  clear(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
};

export function appendStylePatch(
  patches: unknown[],
  target: ElementTarget,
  operation: HtmlOperation,
): unknown;
export function appendStructuralPatch(
  patches: unknown[],
  target: ElementTarget,
  operation: HtmlOperation,
  sequence: number,
): unknown;

export interface EditableTextField {
  key: string;
  source: "self" | "child" | "text-node";
  value: string;
  nodePath: number[];
  tagName: string;
}

export function normalizeInlineEditText(value: unknown): string;
export function isEditableTextRoot(element: Element): boolean;
export function isEditableMixedTextRoot(element: Element): boolean;
export function resolveEditableTextTarget(element: Element): Element | null;
export function collectEditableTextFields(element: Element): EditableTextField[];
export function textStructureSignature(element: Element): string;
export function planTextFieldContentOperations(
  originalFields: EditableTextField[],
  nextFields: EditableTextField[],
): TextNodeContentOperation[] | null;
export function analyzeTableNode(table: unknown): unknown;
export function patchTableElementHtml(
  tableHtml: string,
  table: unknown,
  operation: HtmlOperation,
): string | null;
