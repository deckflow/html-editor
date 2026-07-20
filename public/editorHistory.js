// 编辑历史只负责保存快照顺序，不关心快照里具体存放的是 DOM 还是 patch 队列。
export function createEditorHistory(limit = 50) {
  const undoStack = [];
  const redoStack = [];

  return {
    push(entry) {
      undoStack.push(entry);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },

    undo(currentEntry) {
      const previous = undoStack.pop();
      if (!previous) return null;
      redoStack.push(currentEntry);
      return previous;
    },

    redo(currentEntry) {
      const next = redoStack.pop();
      if (!next) return null;
      undoStack.push(currentEntry);
      return next;
    },

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },

    get canUndo() {
      return undoStack.length > 0;
    },

    get canRedo() {
      return redoStack.length > 0;
    },
  };
}
