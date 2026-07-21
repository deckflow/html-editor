import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const HTML_EXTENSIONS = new Set([".html"]);

function isHtmlFile(filePath) {
  return HTML_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isInsideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

const PROJECT_MARKERS = [".git", "package.json", "deck.json", "vite.config.js", "vite.config.ts"];

function commonAncestor(left, right) {
  let current = resolve(left);
  const candidate = resolve(right);
  while (!isInsideRoot(current, candidate)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function referencedResourceRoot(htmlPath) {
  const htmlDirectory = dirname(htmlPath);
  let root = htmlDirectory;
  const rootRelativePaths = [];
  let source;
  try {
    source = readFileSync(htmlPath, "utf-8");
  } catch {
    return root;
  }

  // Direct relative references reveal how far the project needs to extend above
  // a nested HTML file. Query strings and fragments do not affect disk paths.
  const attributePattern = /\b(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of source.matchAll(attributePattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!value || value.startsWith("#") || value.startsWith("//")) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) continue;

    const pathname = value.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    if (pathname.startsWith("/")) {
      rootRelativePaths.push(pathname.slice(1));
      continue;
    }
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      // Keep malformed percent escapes as literal path characters.
    }
    const target = resolve(htmlDirectory, decoded);
    if (existsSync(target)) root = commonAncestor(root, target);
  }

  // A root-relative URL does not reveal the filesystem root directly. Walk
  // upward and choose the nearest ancestor where every referenced path exists.
  // Directory names are treated as opaque input; there are no assets/pages/etc.
  // conventions here. Never infer the filesystem root itself as a project.
  if (rootRelativePaths.length > 0) {
    let candidate = root;
    while (dirname(candidate) !== candidate) {
      const containsEveryReference = rootRelativePaths.every((pathname) => {
        let decoded = pathname;
        try {
          decoded = decodeURIComponent(pathname);
        } catch {
          // Keep malformed percent escapes as literal path characters.
        }
        return existsSync(resolve(candidate, decoded));
      });
      if (containsEveryReference) {
        root = candidate;
        break;
      }
      candidate = dirname(candidate);
    }
  }
  return root;
}

/**
 * Infer a useful resource root for an HTML file selected after startup. Direct
 * relative references establish the minimum common root; nearby project markers
 * allow nested pages to share root-relative assets with the entry page.
 */
export function inferProjectRootForHtml(filePath) {
  const canonical = realpathSync(resolve(filePath));
  if (!statSync(canonical).isFile() || !isHtmlFile(canonical)) {
    throw new Error(`Selected file must be HTML: ${canonical}`);
  }

  const fileDirectory = dirname(canonical);
  const inferredResourceRoot = referencedResourceRoot(canonical);
  let candidate = inferredResourceRoot;
  while (true) {
    const hasProjectMarker = PROJECT_MARKERS.some((name) => existsSync(join(candidate, name)));
    const hasEntryHtml = existsSync(join(candidate, "index.html"));
    if (hasProjectMarker || hasEntryHtml || basename(canonical).toLowerCase() === "index.html") {
      return realpathSync(candidate);
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return realpathSync(inferredResourceRoot || fileDirectory);
}

/**
 * Keep an explicitly selected directory as the HTML browsing scope while
 * expanding the resource root only as far as real relative references require.
 */
export function inferProjectRootForDirectory(directoryPath) {
  const canonical = realpathSync(resolve(directoryPath));
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`Selected path must be a directory: ${canonical}`);
  }

  let root = canonical;
  for (const file of listProjectHtmlFiles(canonical)) {
    root = commonAncestor(root, referencedResourceRoot(join(canonical, file)));
  }
  return realpathSync(root);
}

export function listProjectHtmlFiles(directory) {
  const root = realpathSync(resolve(directory));
  const files = [];

  function visit(current, prefix = "") {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (current === root) throw error;
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      if (entry.isFile() && isHtmlFile(entry.name)) files.push(rel.replaceAll("\\", "/"));
      if (entry.isDirectory()) visit(join(current, entry.name), rel);
    }
  }

  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * Resolve the CLI input into an editable project root and initial HTML file.
 * A file input exposes its containing directory; a directory input prefers
 * index.html and otherwise picks the first HTML file in stable lexical order.
 */
export function resolveProjectInput(input = ".", { projectRoot = null } = {}) {
  const requested = resolve(input);
  if (!existsSync(requested)) {
    throw new Error(`Input path does not exist: ${requested}`);
  }

  const canonical = realpathSync(requested);
  const stats = statSync(canonical);
  let inferredRoot;
  let selectedFile;
  if (stats.isFile()) {
    if (!isHtmlFile(canonical)) {
      throw new Error(`Input file must be HTML: ${canonical}`);
    }
    inferredRoot = realpathSync(resolve(canonical, ".."));
    selectedFile = canonical;
  } else if (!stats.isDirectory()) {
    throw new Error(`Input path must be an HTML file or directory: ${canonical}`);
  } else {
    const indexFile = existsSync(join(canonical, "index.html")) ? "index.html" : null;
    const defaultFile = indexFile || listProjectHtmlFiles(canonical)[0];
    if (!defaultFile) {
      throw new Error(`No HTML files found in: ${canonical}`);
    }
    inferredRoot = canonical;
    selectedFile = realpathSync(join(canonical, defaultFile));
  }

  const root = projectRoot == null ? inferredRoot : realpathSync(resolve(projectRoot));
  if (!statSync(root).isDirectory()) throw new Error(`Project root must be a directory: ${root}`);
  if (!isInsideRoot(root, selectedFile)) {
    throw new Error(`Input HTML must be inside the selected project root: ${root}`);
  }
  return { projectDir: root, defaultFile: relative(root, selectedFile) };
}

/**
 * Create path helpers scoped to one canonical project root. Existing files and
 * the parent of new files are resolved through realpath so symlinks cannot
 * redirect reads or writes outside the selected project.
 */
export function createProjectContext(projectDir, { htmlDirectory = projectDir } = {}) {
  const root = realpathSync(resolve(projectDir));
  const htmlRoot = realpathSync(resolve(htmlDirectory));
  if (!isInsideRoot(root, htmlRoot) || !statSync(htmlRoot).isDirectory()) {
    throw new Error(`HTML directory must be inside the selected project root: ${root}`);
  }

  function safeExistingFile(inputPath) {
    if (typeof inputPath !== "string" || !inputPath.trim()) return null;

    const candidate = resolve(root, inputPath);
    if (!existsSync(candidate)) return null;

    const canonical = realpathSync(candidate);
    if (!isInsideRoot(root, canonical) || !statSync(canonical).isFile()) return null;
    return { abs: canonical, rel: relative(root, canonical) || inputPath };
  }

  function safeHtmlPath(inputPath) {
    if (typeof inputPath !== "string" || !inputPath.trim() || !isHtmlFile(inputPath)) return null;

    return safeExistingFile(inputPath);
  }

  // Preview assets may be CSS, fonts, images, scripts, or nested HTML. They are
  // read-only and receive the same canonical-path/symlink containment checks as HTML.
  function safeAssetPath(inputPath) {
    const target = safeExistingFile(inputPath);
    if (!target) return null;
    const normalized = target.rel.replaceAll("\\", "/");
    if (normalized === ".local-html-editor" || normalized.startsWith(".local-html-editor/")) {
      return null;
    }
    return target;
  }

  function listHtmlFiles() {
    return listProjectHtmlFiles(htmlRoot).map((file) => (
      relative(root, join(htmlRoot, file)).replaceAll("\\", "/")
    ));
  }

  return { projectDir: root, htmlDirectory: htmlRoot, listHtmlFiles, safeAssetPath, safeHtmlPath };
}
