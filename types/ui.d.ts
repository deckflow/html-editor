import type {
  HtmlEditor,
  HtmlEditorChange,
  SelectionSnapshot,
} from "./editor.js";

export interface MountedHtmlEditor extends HtmlEditor {
  readonly element: HTMLDivElement;
  readonly iframe: HTMLIFrameElement;
}

export interface MountHtmlEditorOptions {
  container: Element;
  html?: string;
  baseUrl?: string;
  allowScripts?: boolean;
  readonly?: boolean;
  historyLimit?: number;
  className?: string;
  title?: string;
  onChange?(change: HtmlEditorChange): void | Promise<void>;
  onError?(error: Error): void;
  onSelectionChange?(selection: SelectionSnapshot | null): void;
}

export function mountHtmlEditor(options: MountHtmlEditorOptions): MountedHtmlEditor;
export { createHtmlEditorRuntime } from "./editor.js";
