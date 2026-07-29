export const HTML_EDITOR_FIT_MODES = ["none", "width", "contain"];

const fitModes = new Set(HTML_EDITOR_FIT_MODES);

export function normalizeFitMode(value) {
  if (value === true) return "width";
  if (value === false || value == null || value === "") return "none";
  const mode = String(value).toLowerCase();
  if (!fitModes.has(mode)) {
    throw new TypeError('fit must be "none", "width", or "contain"');
  }
  return mode;
}

export function calculateFitScale({
  mode,
  availableWidth,
  availableHeight,
  contentWidth,
  contentHeight,
  minimumScale = 0.01,
}) {
  const normalizedMode = normalizeFitMode(mode);
  if (normalizedMode === "none") return 1;
  const widthScale = contentWidth > 0 ? availableWidth / contentWidth : 1;
  const heightScale = contentHeight > 0 ? availableHeight / contentHeight : 1;
  const requestedScale = normalizedMode === "contain"
    ? Math.min(widthScale, heightScale)
    : widthScale;
  return Math.max(minimumScale, Math.min(1, requestedScale));
}
