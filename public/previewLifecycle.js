/**
 * Activate known embedded-page contracts without coupling resource resolution
 * to a project's directory layout. Ordinary HTML documents are left alone.
 */
export function activateEmbeddedPreview(document) {
  const page = document?.querySelector?.(".slide-page[data-page-id]");
  const view = document?.defaultView;
  if (!page || !view?.postMessage) return false;

  view.postMessage({
    type: "deck:page-enter",
    pageId: page.dataset.pageId || "",
    source: "local-html-editor",
  }, "*");
  return true;
}
