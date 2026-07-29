export const PREVIEW_BASE_ATTRIBUTE = "data-local-editor-preview-base";

export function previewSandbox({ allowScripts = false } = {}) {
  return allowScripts ? "allow-same-origin allow-scripts" : "allow-same-origin";
}

export function previewSandboxForMode(mode) {
  return previewSandbox({ allowScripts: mode === "local" });
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * srcdoc resolves relative URLs against the editor page. A temporary base tag
 * points them at the selected project's read-only asset route instead.
 */
export function injectPreviewBase(html, href) {
  if (!href || /<base\s/i.test(html)) return html;
  const base = `<base ${PREVIEW_BASE_ATTRIBUTE} href="${escapeAttribute(href)}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${base}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n  <head>${base}</head>`);
  }
  return `<!doctype html>\n<html><head>${base}</head><body>${html}</body></html>`;
}
