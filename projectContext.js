import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

function isHtmlFile(filePath) {
  return HTML_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isInsideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function findFirstHtmlFile(directory, prefix = "") {
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isFile() && isHtmlFile(entry.name)) {
      return join(prefix, entry.name);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findFirstHtmlFile(join(directory, entry.name), join(prefix, entry.name));
    if (found) return found;
  }
  return null;
}

/**
 * Resolve the CLI input into an editable project root and initial HTML file.
 * A file input exposes its containing directory; a directory input prefers
 * index.html and otherwise picks the first HTML file in stable lexical order.
 */
export function resolveProjectInput(input = ".") {
  const requested = resolve(input);
  if (!existsSync(requested)) {
    throw new Error(`Input path does not exist: ${requested}`);
  }

  const canonical = realpathSync(requested);
  const stats = statSync(canonical);
  if (stats.isFile()) {
    if (!isHtmlFile(canonical)) {
      throw new Error(`Input file must be HTML: ${canonical}`);
    }
    const projectDir = realpathSync(resolve(canonical, ".."));
    return { projectDir, defaultFile: relative(projectDir, canonical) };
  }

  if (!stats.isDirectory()) {
    throw new Error(`Input path must be an HTML file or directory: ${canonical}`);
  }

  const indexFile = ["index.html", "index.htm"].find((name) => existsSync(join(canonical, name)));
  const defaultFile = indexFile || findFirstHtmlFile(canonical);
  if (!defaultFile) {
    throw new Error(`No HTML files found in: ${canonical}`);
  }
  return { projectDir: canonical, defaultFile };
}

/**
 * Create path helpers scoped to one canonical project root. Existing files and
 * the parent of new files are resolved through realpath so symlinks cannot
 * redirect reads or writes outside the selected project.
 */
export function createProjectContext(projectDir) {
  const root = realpathSync(resolve(projectDir));

  function safeHtmlPath(inputPath, { allowMissing = false } = {}) {
    if (typeof inputPath !== "string" || !inputPath.trim() || !isHtmlFile(inputPath)) return null;

    const candidate = resolve(root, inputPath);
    if (!isInsideRoot(root, candidate)) return null;

    if (existsSync(candidate)) {
      const canonical = realpathSync(candidate);
      if (!isInsideRoot(root, canonical) || !statSync(canonical).isFile()) return null;
      return { abs: canonical, rel: relative(root, canonical) || inputPath };
    }

    if (!allowMissing) return null;
    const parent = resolve(candidate, "..");
    if (!existsSync(parent)) return null;
    const canonicalParent = realpathSync(parent);
    if (!isInsideRoot(root, canonicalParent)) return null;
    return { abs: candidate, rel: relative(root, candidate) };
  }

  return { projectDir: root, safeHtmlPath };
}
