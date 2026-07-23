import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { patchElementInHtml, patchElementsInHtml } from "./htmlPatch.js";
import { chooseLocalHtmlDirectory, chooseLocalHtmlFile } from "./nativeFilePicker.js";
import {
  createProjectContext,
  inferProjectRootForDirectory,
  inferProjectRootForHtml,
  resolveProjectInput,
} from "./projectContext.js";

const packageDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(packageDir, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizeProjectFileInput(inputPath) {
  if (!/^file:\/\//i.test(inputPath.trim())) return inputPath;
  try {
    return fileURLToPath(new URL(inputPath));
  } catch {
    return "";
  }
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 6_000_000) {
        rejectBody(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

function serveFile(res, absPath, { cacheControl } = {}) {
  if (!existsSync(absPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const content = readFileSync(absPath);
  const headers = {
    "content-type": mimeTypes[extname(absPath).toLowerCase()] || "application/octet-stream",
    "content-length": content.length,
  };
  if (cacheControl) headers["cache-control"] = cacheControl;
  res.writeHead(200, headers);
  res.end(content);
}

function safeStaticPath(urlPath) {
  const candidate = resolve(publicDir, `.${urlPath}`);
  const rel = relative(publicDir, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"))
    ? candidate
    : null;
}

function projectAssetBase(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const directory = slash === -1 ? [] : normalized.slice(0, slash).split("/");
  const encoded = directory.map((segment) => encodeURIComponent(segment)).join("/");
  return `/project-assets/${encoded ? `${encoded}/` : ""}`;
}

function startProjectWatcher(projectDir, onChange) {
  try {
    const watcher = watch(projectDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const path = String(filename).replaceAll("\\", "/");
      if (path.startsWith(".local-html-editor/") || !/\.html?$/i.test(path)) return;
      onChange(path);
    });
    watcher.on("error", () => watcher.close());
    return watcher;
  } catch (error) {
    if (error?.code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") return null;
    throw error;
  }
}

/**
 * Start one editor instance scoped to the HTML file or directory supplied by
 * the CLI. Port 0 asks the OS for an available port, which makes parallel local
 * editor sessions possible without a separate port-scanning dependency.
 */
export async function createEditorServer({
  input = ".",
  root = null,
  host = "127.0.0.1",
  port = 0,
  selectLocalHtmlFile = chooseLocalHtmlFile,
  selectLocalHtmlDirectory = chooseLocalHtmlDirectory,
} = {}) {
  if (host !== "127.0.0.1") throw new Error("The editor server only binds to 127.0.0.1");

  const startupInput = normalizeProjectFileInput(input);
  const startupIsDirectory = Boolean(
    startupInput && existsSync(startupInput) && statSync(startupInput).isDirectory(),
  );
  let startupRoot = root;
  if (startupRoot == null) {
    startupRoot = startupIsDirectory
      ? inferProjectRootForDirectory(startupInput)
      : inferProjectRootForHtml(startupInput);
  }
  const resolvedInput = resolveProjectInput(input, { projectRoot: startupRoot });
  let project = createProjectContext(resolvedInput.projectDir, {
    htmlDirectory: startupIsDirectory ? resolve(startupInput) : resolvedInput.projectDir,
  });
  let projectDir = project.projectDir;
  let defaultFile = resolvedInput.defaultFile.replaceAll("\\", "/");
  let backupDir = join(projectDir, ".local-html-editor", "backups");
  const eventClients = new Set();
  const internalWrites = new Map();
  let watcher = null;

  function activateProjectInput(inputPath, kind = "file") {
    const normalized = normalizeProjectFileInput(inputPath);
    if (!normalized || !isAbsolute(normalized) || !existsSync(normalized)) {
      throw new Error(`Selected ${kind} must exist`);
    }

    const stats = statSync(normalized);
    if (kind === "directory" && !stats.isDirectory()) {
      throw new Error("Selected path must be a directory");
    }
    if (kind === "file" && (!stats.isFile() || !/\.html?$/i.test(normalized))) {
      throw new Error("Selected file must be an existing HTML file");
    }

    const selectedRoot = kind === "directory"
      ? inferProjectRootForDirectory(normalized)
      : inferProjectRootForHtml(normalized);
    const selected = resolveProjectInput(normalized, { projectRoot: selectedRoot });
    watcher?.close();
    project = createProjectContext(selected.projectDir, {
      htmlDirectory: kind === "directory" ? normalized : selected.projectDir,
    });
    projectDir = project.projectDir;
    defaultFile = selected.defaultFile.replaceAll("\\", "/");
    backupDir = join(projectDir, ".local-html-editor", "backups");
    internalWrites.clear();
    if (server.listening) watcher = startProjectWatcher(projectDir, sendFileChange);
    return safeProjectPath(defaultFile);
  }

  function activateHtmlFile(filePath) {
    return activateProjectInput(filePath, "file");
  }

  function safeProjectPath(inputPath = defaultFile) {
    return project.safeHtmlPath(normalizeProjectFileInput(inputPath));
  }

  function resolveSelectedProjectFile(fileName, content) {
    if (
      typeof fileName !== "string" ||
      basename(fileName) !== fileName ||
      !/\.html?$/i.test(fileName) ||
      typeof content !== "string"
    ) {
      return null;
    }

    const matches = [];
    const visit = (directory, prefix = "") => {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          visit(join(directory, entry.name), rel);
        } else if (entry.isFile() && entry.name === fileName) {
          const target = safeProjectPath(rel);
          if (target && readFileSync(target.abs, "utf-8") === content) matches.push(target);
        }
      }
    };
    visit(projectDir);
    return matches.length === 1 ? matches[0] : null;
  }

  function backupFile(target) {
    if (!existsSync(target.abs)) return null;
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `${target.rel.replace(/[\\/]/g, "__")}.${stamp}.bak`);
    writeFileSync(backupPath, readFileSync(target.abs));
    return backupPath;
  }

  function writeProjectFile(target, content) {
    internalWrites.set(target.rel.replaceAll("\\", "/"), Date.now());
    const temporary = `${target.abs}.local-html-editor-${process.pid}.tmp`;
    writeFileSync(temporary, content, "utf-8");
    renameSync(temporary, target.abs);
  }

  function sendFileChange(path) {
    const writeTime = internalWrites.get(path);
    if (writeTime) {
      // Atomic rename can emit more than one watcher event. Keep the marker for
      // the full suppression window so every event from our own save is ignored.
      if (Date.now() - writeTime < 1_000) return;
      internalWrites.delete(path);
    }
    const message = `event: file-change\ndata: ${JSON.stringify({ path })}\n\n`;
    for (const client of eventClients) client.write(message);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/project" && req.method === "GET") {
      json(res, 200, {
        ok: true,
        name: basename(projectDir),
        defaultFile,
        watch: Boolean(watcher),
      });
      return;
    }

    if (url.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      });
      res.write("event: ready\ndata: {}\n\n");
      eventClients.add(res);
      req.on("close", () => eventClients.delete(res));
      return;
    }

    if (url.pathname === "/api/html-files" && req.method === "GET") {
      const files = project.listHtmlFiles();
      json(res, 200, {
        ok: true,
        files: files.map((path) => ({
          path,
          name: basename(path),
        })),
      });
      return;
    }

    // The browser File API deliberately hides absolute paths, which means a
    // normal <input type=file> cannot load sibling CSS/JS/images. Because this
    // is a localhost CLI, open the OS picker in Node and switch the active
    // project context to the selected file before loading its preview.
    if (
      (url.pathname === "/api/select-local-path" || url.pathname === "/api/select-local-file")
      && req.method === "POST"
    ) {
      try {
        let kind = "file";
        if (url.pathname === "/api/select-local-path") {
          const payload = JSON.parse(await readBody(req));
          kind = payload.kind;
          if (kind !== "file" && kind !== "directory") {
            throw new Error("Selection kind must be file or directory");
          }
        }
        const selectedPath = kind === "directory"
          ? await selectLocalHtmlDirectory()
          : await selectLocalHtmlFile();
        if (!selectedPath) {
          json(res, 200, { ok: true, cancelled: true });
          return;
        }
        const target = activateProjectInput(selectedPath, kind);
        json(res, 200, {
          ok: true,
          cancelled: false,
          kind,
          path: target.rel.replaceAll("\\", "/"),
          displayPath: target.abs,
          projectDir,
        });
      } catch (error) {
        const unavailable = error?.code === "PICKER_UNAVAILABLE";
        json(res, unavailable ? 501 : 400, {
          ok: false,
          code: unavailable ? "PICKER_UNAVAILABLE" : "INVALID_LOCAL_FILE",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (url.pathname === "/api/file" && req.method === "GET") {
      const inputPath = url.searchParams.get("path") || defaultFile;
      let target = safeProjectPath(inputPath);
      const normalizedInput = normalizeProjectFileInput(inputPath);
      if (!target && isAbsolute(normalizedInput)) {
        try {
          target = activateHtmlFile(normalizedInput);
        } catch {
          // Preserve the normal not-found response below.
        }
      }
      if (!target) {
        json(res, 404, { ok: false, error: "HTML file not found inside the selected project" });
        return;
      }
      json(res, 200, {
        ok: true,
        path: target.rel.replaceAll("\\", "/"),
        displayPath: target.abs,
        previewBase: projectAssetBase(target.rel),
        content: readFileSync(target.abs, "utf-8"),
      });
      return;
    }

    // A browser file picker hides absolute paths. If the selected file exactly
    // matches one unique HTML file in the CLI project, recover its project path
    // so sibling CSS, fonts, images, and scripts remain available.
    if (url.pathname === "/api/resolve-project-file" && req.method === "POST") {
      try {
        const payload = JSON.parse(await readBody(req));
        const target = resolveSelectedProjectFile(payload.name, payload.content);
        json(res, 200, {
          ok: true,
          matched: Boolean(target),
          path: target ? target.rel.replaceAll("\\", "/") : null,
        });
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // 浏览器文件选择器拿不到任意本地文件的服务器路径。这个接口只在内存中
    // 应用结构化 patch 并返回结果，最终写回由浏览器持有的文件句柄完成。
    if (url.pathname === "/api/patch-content" && req.method === "POST") {
      try {
        const payload = JSON.parse(await readBody(req));
        if (typeof payload.content !== "string") {
          json(res, 400, { ok: false, error: "content must be a string" });
          return;
        }
        if (!Array.isArray(payload.patches) || payload.patches.length === 0) {
          json(res, 400, { ok: false, error: "patches must be a non-empty array" });
          return;
        }

        const patch = patchElementsInHtml(payload.content, payload.patches);
        json(res, 200, {
          ok: true,
          changed: patch.changed,
          matched: patch.matched,
          failedIndex: patch.failedIndex,
          content: patch.changed ? patch.html : payload.content,
        });
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/patch-elements" && req.method === "POST") {
      try {
        const payload = JSON.parse(await readBody(req));
        const target = safeProjectPath(payload.path || defaultFile);
        if (!target) {
          json(res, 404, { ok: false, error: "HTML file not found" });
          return;
        }
        if (!Array.isArray(payload.patches) || payload.patches.length === 0) {
          json(res, 400, { ok: false, error: "patches must be a non-empty array" });
          return;
        }

        const original = readFileSync(target.abs, "utf-8");
        const patch = patchElementsInHtml(original, payload.patches);
        if (!patch.matched || !patch.changed) {
          json(res, 200, {
            ok: true,
            changed: false,
            matched: patch.matched,
            failedIndex: patch.failedIndex,
            path: target.rel,
            content: original,
          });
          return;
        }

        const backupPath = backupFile(target);
        writeProjectFile(target, patch.html);
        json(res, 200, {
          ok: true,
          changed: true,
          matched: true,
          path: target.rel,
          content: patch.html,
          backupPath: backupPath ? relative(projectDir, backupPath) : null,
        });
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/patch-element" && req.method === "POST") {
      try {
        const payload = JSON.parse(await readBody(req));
        const target = safeProjectPath(payload.path || defaultFile);
        if (!target) {
          json(res, 404, { ok: false, error: "HTML file not found" });
          return;
        }
        if (!payload.target || !Array.isArray(payload.operations)) {
          json(res, 400, { ok: false, error: "target and operations are required" });
          return;
        }

        const original = readFileSync(target.abs, "utf-8");
        const patch = patchElementInHtml(original, payload.target, payload.operations);
        if (!patch.matched || !patch.changed) {
          json(res, 200, {
            ok: true,
            changed: false,
            matched: patch.matched,
            path: target.rel,
            content: original,
          });
          return;
        }

        const backupPath = backupFile(target);
        writeProjectFile(target, patch.html);
        json(res, 200, {
          ok: true,
          changed: true,
          matched: true,
          path: target.rel,
          content: patch.html,
          backupPath: backupPath ? relative(projectDir, backupPath) : null,
        });
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/preview") {
      const target = safeProjectPath(url.searchParams.get("path") || defaultFile);
      if (!target) {
        res.writeHead(400);
        res.end("Invalid file path");
        return;
      }
      serveFile(res, target.abs);
      return;
    }

    if (url.pathname.startsWith("/project-assets/") && req.method === "GET") {
      let assetPath;
      try {
        assetPath = decodeURIComponent(url.pathname.slice("/project-assets/".length));
      } catch {
        res.writeHead(400);
        res.end("Invalid asset path");
        return;
      }
      const target = project.safeAssetPath(assetPath);
      if (!target) {
        res.writeHead(404);
        res.end("Project asset not found");
        return;
      }
      serveFile(res, target.abs);
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(302, { location: "/__local-editor__/" });
      res.end();
      return;
    }

    if (url.pathname === "/__local-editor__" && req.method === "GET") {
      res.writeHead(302, { location: "/__local-editor__/" });
      res.end();
      return;
    }

    if (url.pathname.startsWith("/__local-editor__/") && req.method === "GET") {
      const suffix = url.pathname.slice("/__local-editor__".length);
      const publicPath = suffix === "/" ? "/index.html" : suffix;
      const absPublicPath = safeStaticPath(publicPath);
      if (!absPublicPath) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      // Editor code changes frequently during local development. Stale ES
      // modules keep their old event handlers alive even after the CLI server
      // restarts, so editor-owned assets must always be fetched again.
      serveFile(res, absPublicPath, { cacheControl: "no-store" });
      return;
    }

    // Root-relative URLs such as /shared/theme.css are resolved from the active
    // project root. Editor-owned files live under /__local-editor__/ so common
    // project names such as /styles.css and /app.js cannot collide with them.
    if (req.method === "GET") {
      let rootAssetPath;
      try {
        rootAssetPath = decodeURIComponent(url.pathname.slice(1));
      } catch {
        res.writeHead(400);
        res.end("Invalid asset path");
        return;
      }
      const target = project.safeAssetPath(rootAssetPath);
      if (target) {
        serveFile(res, target.abs);
        return;
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  watcher = startProjectWatcher(projectDir, sendFileChange);

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  let closed = false;
  return {
    defaultFile,
    projectDir,
    url: `http://${host}:${actualPort}`,
    async close() {
      if (closed) return;
      closed = true;
      watcher?.close();
      for (const client of eventClients) client.end();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}
