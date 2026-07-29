export interface EditorServerOptions {
  input?: string;
  root?: string | null;
  host?: "127.0.0.1";
  port?: number;
  selectLocalHtmlFile?: () => Promise<string | null>;
  selectLocalHtmlDirectory?: () => Promise<string | null>;
}

export interface EditorServer {
  defaultFile: string;
  projectDir: string;
  url: string;
  close(): Promise<void>;
}

export function createEditorServer(options?: EditorServerOptions): Promise<EditorServer>;
export function createProjectServer(options?: EditorServerOptions): Promise<EditorServer>;
