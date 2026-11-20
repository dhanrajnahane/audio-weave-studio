export interface TimelineCommand {
  description: string;
  execute(): void;
  undo(): void;
}

/**
 * Double-Stack Data Structure managing non-destructive timeline Undo/Redo history.
 */
export class UndoRedoStack {
  private undoStack: TimelineCommand[] = [];
  private redoStack: TimelineCommand[] = [];
  private maxDepth: number = 50;

  constructor(maxDepth: number = 50) {
    this.maxDepth = maxDepth;
  }

  execute(command: TimelineCommand): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Any new command invalidates redo history
  }

  /**
   * Pushes an already-executed command to the undo stack and clears redo history.
   */
  pushCommand(command: TimelineCommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Any new command invalidates redo history
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const command = this.undoStack.pop()!;
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const command = this.redoStack.pop()!;
    command.execute();
    this.undoStack.push(command);
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  getRedoStackSize(): number {
    return this.redoStack.length;
  }

  getUndoDescription(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  getRedoDescription(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  getUndoHistory(): string[] {
    return this.undoStack.map((c) => c.description);
  }

  getRedoHistory(): string[] {
    return this.redoStack.map((c) => c.description);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
