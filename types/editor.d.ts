import type { ElementTarget, HtmlPatch } from "./core.js";

export interface HtmlEditorChange {
  html: string;
  patches: HtmlPatch[];
  revision: number;
  reason: "text" | "text-style" | "style" | "duplicate" | "delete" | "table" | "undo" | "redo" | string;
}

export interface SelectionSnapshot {
  key: string;
  element: Element;
  target: ElementTarget;
  selector: string;
  textContent: string;
  [key: string]: unknown;
}

export interface HtmlEditor {
  readonly ready: Promise<void>;
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readonly: boolean;
  getHtml(): string;
  setHtml(html: string, options?: { baseUrl?: string }): Promise<void>;
  setReadonly(readonly: boolean): boolean;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  flush(): Promise<string>;
  destroy(): void;
}

export interface HtmlEditorRuntimeOptions {
  iframe: HTMLIFrameElement;
  html?: string;
  baseUrl?: string;
  allowScripts?: boolean;
  readonly?: boolean;
  historyLimit?: number;
  onChange?(change: HtmlEditorChange): void | Promise<void>;
  onError?(error: Error): void;
  onSelectionChange?(selection: SelectionSnapshot | null): void;
  uiFactory?(context: {
    document: Document;
    runtimeId: string;
    callbacks: Record<string, (...args: any[]) => void>;
  }): { destroy(): void; [key: string]: unknown } | null;
}

export function createHtmlEditorRuntime(options: HtmlEditorRuntimeOptions): HtmlEditor;
