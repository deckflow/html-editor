import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { patchElementInHtml, patchElementsInHtml } from "./htmlPatch.js";
import { createProjectContext, resolveProjectInput } from "./projectContext.js";

const packageDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(packageDir, "public");
const remoteFetchTimeoutMs = 10_000;
const remoteHtmlLimitBytes = 5_000_000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function isRemoteUrl(inputPath = "") {
  return /^https?:\/\//i.test(inputPath.trim());
}

function normalizeRemoteUrl(inputPath) {
  try {
    const remoteUrl = new URL(inputPath);
    if (!["http:", "https:"].includes(remoteUrl.protocol)) return null;
    const host = remoteUrl.hostname.toLowerCase();
    const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
    const isPrivateIp =
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host);
    if (blockedHosts.has(host) || isPrivateIp || host.endsWith(".local")) return null;
    return remoteUrl;
  } catch {
    return null;
  }
}

function suggestedSnapshotPath(remoteUrl) {
  const pathPart = remoteUrl.pathname.replace(/\/$/, "") || "/index";
  const safeName = `${remoteUrl.hostname}${pathPart}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `remote-${safeName || "page"}.html`;
}

function injectBaseHref(html, remoteHref) {
  const baseTag = `<base href="${remoteHref.replaceAll('"', "&quot;")}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n  <head>${baseTag}</head>`);
  }
  return `<!doctype html>\n<html><head>${baseTag}</head><body>${html}</body></html>`;
}

async function fetchRemoteHtml(inputPath) {
  const remoteUrl = normalizeRemoteUrl(inputPath);
  if (!remoteUrl) throw new Error("Only public http(s) URLs are supported");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remoteFetchTimeoutMs);
  try {
    const response = await fetch(remoteUrl, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "local-html-editor/0.1",
      },
    });
    if (!response.ok) throw new Error(`Remote server returned ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Remote URL is not HTML (${contentType})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > remoteHtmlLimitBytes) throw new Error("Remote HTML is too large");
    return {
      content: injectBaseHref(buffer.toString("utf-8"), remoteUrl.href),
      suggestedPath: suggestedSnapshotPath(remoteUrl),
      url: remoteUrl.href,
    };
  } finally {
    clearTimeout(timeout);
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

function serveFile(res, absPath) {
  if (!existsSync(absPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const content = readFileSync(absPath);
  res.writeHead(200, {
    "content-type": mimeTypes[extname(absPath).toLowerCase()] || "application/octet-stream",
    "content-length": content.length,
  });
  res.end(content);
}

function safeStaticPath(urlPath) {
  const candidate = resolve(publicDir, `.${urlPath}`);
  const rel = relative(publicDir, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"))
    ? candidate
    : null;
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
export async function createEditorServer({ input = ".", host = "127.0.0.1", port = 0 } = {}) {
  if (host !== "127.0.0.1") throw new Error("The editor server only binds to 127.0.0.1");

  const resolvedInput = resolveProjectInput(input);
  const project = createProjectContext(resolvedInput.projectDir);
  const { projectDir } = project;
  const defaultFile = resolvedInput.defaultFile.replaceAll("\\", "/");
  const backupDir = join(projectDir, ".local-html-editor", "backups");
  const eventClients = new Set();
  const internalWrites = new Map();
  let watcher = null;

  function safeProjectPath(inputPath = defaultFile, options) {
    return project.safeHtmlPath(inputPath, options);
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
    if (writeTime && Date.now() - writeTime < 1_000) {
      internalWrites.delete(path);
      return;
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

    if (url.pathname === "/api/file" && req.method === "GET") {
      const inputPath = url.searchParams.get("path") || defaultFile;
      if (isRemoteUrl(inputPath)) {
        try {
          const remote = await fetchRemoteHtml(inputPath);
          json(res, 200, {
            ok: true,
            mode: "remote",
            path: remote.url,
            suggestedPath: remote.suggestedPath,
            content: remote.content,
          });
        } catch (error) {
          json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      const target = safeProjectPath(inputPath);
      if (!target) {
        json(res, 404, { ok: false, error: "HTML file not found inside the selected project" });
        return;
      }
      json(res, 200, {
        ok: true,
        mode: "local",
        path: target.rel.replaceAll("\\", "/"),
        content: readFileSync(target.abs, "utf-8"),
      });
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

    if (url.pathname === "/api/file" && req.method === "POST") {
      try {
        const payload = JSON.parse(await readBody(req));
        const target = safeProjectPath(payload.path || defaultFile, { allowMissing: true });
        if (!target) {
          json(res, 400, { ok: false, error: "Only HTML files inside the selected project can be edited" });
          return;
        }
        if (typeof payload.content !== "string") {
          json(res, 400, { ok: false, error: "content must be a string" });
          return;
        }
        const backupPath = backupFile(target);
        writeProjectFile(target, payload.content);
        json(res, 200, {
          ok: true,
          path: target.rel.replaceAll("\\", "/"),
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

    const publicPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const absPublicPath = safeStaticPath(publicPath);
    if (!absPublicPath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    serveFile(res, absPublicPath);
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
