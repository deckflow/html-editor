export {
  patchElementInHtml,
  patchElementsInHtml,
} from "../../htmlPatch.js";
export {
  appendStructuralPatch,
  appendStylePatch,
} from "../../public/patchQueue.js";
export { createEditorHistory } from "../../public/editorHistory.js";
export {
  createElementTarget,
  isEditableMixedTextRoot,
  isEditableTextRoot,
  normalizeInlineEditText,
  resolveEditableTextTarget,
} from "../../public/inlineEdit.js";
export {
  collectEditableTextFields,
  planTextFieldContentOperations,
  textStructureSignature,
} from "../../public/textFieldModel.js";
export {
  analyzeTableNode,
  patchTableElementHtml,
} from "../../tablePatch.js";
