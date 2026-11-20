// src/audio/timeline/IntervalTree.ts
var IntervalNode = class {
  low;
  high;
  max;
  clip;
  left = null;
  right = null;
  constructor(clip) {
    this.clip = clip;
    this.low = clip.startOffset;
    this.high = clip.startOffset + clip.duration;
    this.max = this.high;
  }
};
var TimelineIntervalTree = class {
  root = null;
  insert(clip) {
    const newNode = new IntervalNode(clip);
    this.root = this.insertNode(this.root, newNode);
  }
  insertNode(root, node) {
    if (!root) return node;
    if (node.low < root.low) {
      root.left = this.insertNode(root.left, node);
    } else {
      root.right = this.insertNode(root.right, node);
    }
    root.max = Math.max(root.high, Math.max(
      root.left ? root.left.max : 0,
      root.right ? root.right.max : 0
    ));
    return root;
  }
  remove(clipId) {
    this.root = this.removeNode(this.root, clipId);
  }
  removeNode(root, clipId) {
    if (!root) return null;
    if (root.clip.id === clipId) {
      if (!root.left) return root.right;
      if (!root.right) return root.left;
      let minLarger = root.right;
      while (minLarger.left) {
        minLarger = minLarger.left;
      }
      root.clip = minLarger.clip;
      root.low = minLarger.low;
      root.high = minLarger.high;
      root.right = this.removeNode(root.right, minLarger.clip.id);
    } else {
      root.left = this.removeNode(root.left, clipId);
      root.right = this.removeNode(root.right, clipId);
    }
    root.max = Math.max(
      root.high,
      Math.max(root.left ? root.left.max : 0, root.right ? root.right.max : 0)
    );
    return root;
  }
  /**
   * Queries all clips that overlap with time interval [start, end].
   * Optionally filtered by trackId.
   */
  queryOverlaps(start, end, trackId) {
    const results = [];
    this.queryOverlapsSubtree(this.root, start, end, trackId, results);
    return results;
  }
  queryOverlapsSubtree(node, start, end, trackId, results) {
    if (!node) return;
    if (node.max <= start) return;
    if (node.left && node.left.max > start) {
      this.queryOverlapsSubtree(node.left, start, end, trackId, results);
    }
    if (node.low < end && start < node.high) {
      if (!trackId || node.clip.trackId === trackId) {
        results.push(node.clip);
      }
    }
    if (node.right && node.low < end) {
      this.queryOverlapsSubtree(node.right, start, end, trackId, results);
    }
  }
  /**
   * Queries which clip(s) are active at exact timeline position time.
   */
  queryAtTime(time, trackId) {
    return this.queryOverlaps(time, time + 1e-5, trackId);
  }
  clear() {
    this.root = null;
  }
};

// src/audio/timeline/ClipLinkedList.ts
var ClipNode = class {
  clip;
  prev = null;
  next = null;
  constructor(clip) {
    this.clip = clip;
  }
};
var ClipLinkedList = class {
  head = null;
  tail = null;
  length = 0;
  get count() {
    return this.length;
  }
  /**
   * Inserts clip maintaining chronological order of startOffset.
   */
  insert(clip) {
    const newNode = new ClipNode(clip);
    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
      this.length++;
      return newNode;
    }
    if (clip.startOffset < this.head.clip.startOffset) {
      newNode.next = this.head;
      this.head.prev = newNode;
      this.head = newNode;
      this.length++;
      return newNode;
    }
    let curr = this.head;
    while (curr.next && curr.next.clip.startOffset <= clip.startOffset) {
      curr = curr.next;
    }
    newNode.next = curr.next;
    newNode.prev = curr;
    if (curr.next) {
      curr.next.prev = newNode;
    } else {
      this.tail = newNode;
    }
    curr.next = newNode;
    this.length++;
    return newNode;
  }
  remove(clipId) {
    const node = this.find(clipId);
    if (!node) return false;
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    node.prev = null;
    node.next = null;
    this.length--;
    return true;
  }
  find(clipId) {
    let curr = this.head;
    while (curr) {
      if (curr.clip.id === clipId) return curr;
      curr = curr.next;
    }
    return null;
  }
  getAdjacent(clipId) {
    const node = this.find(clipId);
    if (!node) return { prev: null, next: null };
    return {
      prev: node.prev ? node.prev.clip : null,
      next: node.next ? node.next.clip : null
    };
  }
  toArray() {
    const result = [];
    let curr = this.head;
    while (curr) {
      result.push(curr.clip);
      curr = curr.next;
    }
    return result;
  }
  clear() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
};

// src/audio/timeline/UndoRedoStack.ts
var UndoRedoStack = class {
  undoStack = [];
  redoStack = [];
  maxDepth = 50;
  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }
  execute(command) {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }
  /**
   * Pushes an already-executed command to the undo stack and clears redo history.
   */
  pushCommand(command) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }
  undo() {
    if (this.undoStack.length === 0) return false;
    const command = this.undoStack.pop();
    command.undo();
    this.redoStack.push(command);
    return true;
  }
  redo() {
    if (this.redoStack.length === 0) return false;
    const command = this.redoStack.pop();
    command.execute();
    this.undoStack.push(command);
    return true;
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  getUndoStackSize() {
    return this.undoStack.length;
  }
  getRedoStackSize() {
    return this.redoStack.length;
  }
  getUndoDescription() {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }
  getRedoDescription() {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }
  getUndoHistory() {
    return this.undoStack.map((c) => c.description);
  }
  getRedoHistory() {
    return this.redoStack.map((c) => c.description);
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
};

// src/audio/timeline/TimelineModel.ts
var STEM_TRACK_IDS = ["vocals", "drums", "bass", "other"];
function normalizeTrackId(id) {
  if (!id) return id;
  const lower = id.toLowerCase().trim();
  if (lower === "track-1" || lower === "track 1" || lower === "vocals" || lower === "vocal") return "vocals";
  if (lower === "track-2" || lower === "track 2" || lower === "drums" || lower === "drum") return "drums";
  if (lower === "track-3" || lower === "track 3" || lower === "bass") return "bass";
  if (lower === "track-4" || lower === "track 4" || lower === "other") return "other";
  return id;
}
var TimelineModel = class {
  // Hash Maps (O(1) retrieval)
  clipsMap = /* @__PURE__ */ new Map();
  tracksMap = /* @__PURE__ */ new Map();
  assetsMap = /* @__PURE__ */ new Map();
  // Doubly Linked List (Ordered sequence per track)
  trackLists = /* @__PURE__ */ new Map();
  // Augmented Interval Tree (1D Range queries)
  intervalTree = new TimelineIntervalTree();
  // Undo / Redo History (Double Stack)
  history = new UndoRedoStack();
  // Selection & UI State
  selectedClipIds = /* @__PURE__ */ new Set();
  selectedTrackId = null;
  listeners = /* @__PURE__ */ new Set();
  constructor() {
    this.initDefaultTracks();
  }
  initDefaultTracks() {
    const defaultTracks = [
      { id: "vocals", name: "Vocals", color: "#06b6d4", muted: false, solo: false, volume: 1, pan: 0 },
      { id: "drums", name: "Drums", color: "#f59e0b", muted: false, solo: false, volume: 1, pan: 0 },
      { id: "bass", name: "Bass", color: "#a855f7", muted: false, solo: false, volume: 1, pan: 0 },
      { id: "other", name: "Other", color: "#10b981", muted: false, solo: false, volume: 1, pan: 0 }
    ];
    defaultTracks.forEach((t) => {
      this.tracksMap.set(t.id, t);
      this.trackLists.set(t.id, new ClipLinkedList());
    });
  }
  // -------------------------------------------------------------
  // Asset Management (Preserves original AudioBuffer in entirety)
  // -------------------------------------------------------------
  registerAsset(assetId, buffer) {
    this.assetsMap.set(assetId, buffer);
  }
  getAsset(assetId) {
    return this.assetsMap.get(assetId);
  }
  hasAsset(assetId) {
    return this.assetsMap.has(assetId);
  }
  getRegisteredAssetIds() {
    return Array.from(this.assetsMap.keys());
  }
  // -------------------------------------------------------------
  // Track Management
  // -------------------------------------------------------------
  getTracks() {
    return Array.from(this.tracksMap.values());
  }
  getTrack(trackId) {
    const normalized = normalizeTrackId(trackId);
    return this.tracksMap.get(normalized) || this.tracksMap.get(trackId);
  }
  addTrack(track) {
    const normalizedId = normalizeTrackId(track.id);
    const normalizedTrack = { ...track, id: normalizedId };
    this.tracksMap.set(normalizedId, normalizedTrack);
    if (!this.trackLists.has(normalizedId)) {
      this.trackLists.set(normalizedId, new ClipLinkedList());
    }
    this.notify();
  }
  updateTrack(trackId, updates) {
    const normalized = normalizeTrackId(trackId);
    const track = this.tracksMap.get(normalized) || this.tracksMap.get(trackId);
    if (track) {
      this.tracksMap.set(track.id, { ...track, ...updates });
      this.notify();
    }
  }
  setTrackVolume(trackId, volume) {
    this.updateTrack(trackId, { volume });
  }
  setTrackPan(trackId, pan) {
    this.updateTrack(trackId, { pan });
  }
  setTrackMute(trackId, muted) {
    this.updateTrack(trackId, { muted });
  }
  setTrackSolo(trackId, solo) {
    this.updateTrack(trackId, { solo });
  }
  selectTrack(trackId) {
    const normalized = trackId ? normalizeTrackId(trackId) : null;
    this.selectedTrackId = normalized;
    this.notify();
  }
  getSelectedTrackId() {
    return this.selectedTrackId;
  }
  // -------------------------------------------------------------
  // Clip Querying (Hash Map, Linked List, Interval Tree)
  // -------------------------------------------------------------
  getClip(clipId) {
    return this.clipsMap.get(clipId);
  }
  getAllClips() {
    return Array.from(this.clipsMap.values());
  }
  getTrackClips(trackId) {
    const normalized = normalizeTrackId(trackId);
    const list = this.trackLists.get(normalized) || this.trackLists.get(trackId);
    return list ? list.toArray() : [];
  }
  /**
   * Interval Tree Query: Find overlapping clips within [start, end].
   */
  getOverlappingClips(start, end, trackId) {
    const normalized = trackId ? normalizeTrackId(trackId) : void 0;
    return this.intervalTree.queryOverlaps(start, end, normalized);
  }
  /**
   * Interval Tree Point Query: Find which clip is active at a given time.
   */
  getClipsAtTime(time, trackId) {
    const normalized = trackId ? normalizeTrackId(trackId) : void 0;
    return this.intervalTree.queryAtTime(time, normalized);
  }
  /**
   * Doubly Linked List Navigation: Find neighboring clips.
   */
  getAdjacentClips(clipId) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return { prev: null, next: null };
    const list = this.trackLists.get(clip.trackId);
    return list ? list.getAdjacent(clipId) : { prev: null, next: null };
  }
  // -------------------------------------------------------------
  // Internal Helpers for Data Structure Synchronization
  // -------------------------------------------------------------
  doAdd(clip) {
    const normTrackId = normalizeTrackId(clip.trackId);
    const normalizedClip = { ...clip, trackId: normTrackId };
    this.clipsMap.set(normalizedClip.id, normalizedClip);
    this.intervalTree.insert(normalizedClip);
    let list = this.trackLists.get(normTrackId);
    if (!list) {
      list = new ClipLinkedList();
      this.trackLists.set(normTrackId, list);
    }
    list.insert(normalizedClip);
  }
  doRemove(clipId) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    this.clipsMap.delete(clipId);
    this.intervalTree.remove(clipId);
    this.trackLists.get(clip.trackId)?.remove(clipId);
    this.selectedClipIds.delete(clipId);
  }
  // -------------------------------------------------------------
  // Non-Destructive Clip Editing Operations
  // -------------------------------------------------------------
  /**
   * Feature 1 & 10: Add audio clip referencing source asset.
   */
  addClip(clip, recordHistory = true) {
    const addedClip = { ...clip };
    if (recordHistory) {
      this.history.execute({
        description: `Add clip "${clip.name}"`,
        execute: () => {
          this.doAdd(addedClip);
          this.notify();
        },
        undo: () => {
          this.doRemove(addedClip.id);
          this.notify();
        }
      });
    } else {
      this.doAdd(addedClip);
      this.notify();
    }
  }
  /**
   * Feature 2: Move clip along timeline or to another track.
   */
  moveClip(clipId, newStartOffset, newTrackId, recordHistory = true) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return false;
    const oldStart = clip.startOffset;
    const oldTrackId = clip.trackId;
    const targetTrackId = newTrackId ? normalizeTrackId(newTrackId) : oldTrackId;
    const clampedStart = Math.max(0, newStartOffset);
    if (oldStart === clampedStart && oldTrackId === targetTrackId) return true;
    if (recordHistory) {
      this.history.execute({
        description: `Move clip "${clip.name}"`,
        execute: () => {
          this.applyMove(clipId, clampedStart, targetTrackId);
          this.notify();
        },
        undo: () => {
          this.applyMove(clipId, oldStart, oldTrackId);
          this.notify();
        }
      });
    } else {
      this.applyMove(clipId, clampedStart, targetTrackId);
      this.notify();
    }
    return true;
  }
  applyMove(clipId, startOffset, trackId) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    const normTrackId = normalizeTrackId(trackId);
    this.intervalTree.remove(clipId);
    this.trackLists.get(clip.trackId)?.remove(clipId);
    clip.startOffset = startOffset;
    clip.trackId = normTrackId;
    this.intervalTree.insert(clip);
    let list = this.trackLists.get(normTrackId);
    if (!list) {
      list = new ClipLinkedList();
      this.trackLists.set(normTrackId, list);
    }
    list.insert(clip);
  }
  /**
   * Feature 3: Split clip at timeline playhead position into two independent non-destructive slices.
   */
  splitClip(clipId, splitTime, recordHistory = true) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return null;
    if (splitTime <= clip.startOffset + 0.05 || splitTime >= clip.startOffset + clip.duration - 0.05) {
      return null;
    }
    const originalState = { ...clip };
    const leftDuration = splitTime - clip.startOffset;
    const rightDuration = clip.duration - leftDuration;
    const rightSourceOffset = clip.sourceOffset + leftDuration;
    const leftClip = {
      ...clip,
      duration: leftDuration
    };
    const rightClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const rightClip = {
      id: rightClipId,
      trackId: clip.trackId,
      assetId: clip.assetId,
      name: `${clip.name} (Part 2)`,
      startOffset: splitTime,
      duration: rightDuration,
      sourceOffset: rightSourceOffset,
      color: clip.color
    };
    const doSplit = () => {
      this.doRemove(clipId);
      this.doAdd(leftClip);
      this.doAdd(rightClip);
    };
    const undoSplit = () => {
      this.doRemove(leftClip.id);
      this.doRemove(rightClip.id);
      this.doAdd(originalState);
    };
    if (recordHistory) {
      this.history.execute({
        description: `Split clip "${clip.name}"`,
        execute: () => {
          doSplit();
          this.notify();
        },
        undo: () => {
          undoSplit();
          this.notify();
        }
      });
    } else {
      doSplit();
      this.notify();
    }
    return [leftClip, rightClip];
  }
  /**
   * Feature 4: Trim beginning or end of clip without modifying source audio buffer.
   */
  trimClip(clipId, newStartOffset, newDuration, newSourceOffset, recordHistory = true) {
    const clip = this.clipsMap.get(clipId);
    if (!clip || newDuration <= 0.05) return false;
    const asset = this.assetsMap.get(clip.assetId);
    if (asset && newSourceOffset + newDuration > asset.duration + 0.01) {
      return false;
    }
    const oldState = { ...clip };
    if (recordHistory) {
      this.history.execute({
        description: `Trim clip "${clip.name}"`,
        execute: () => {
          this.applyTrim(clipId, newStartOffset, newDuration, newSourceOffset);
          this.notify();
        },
        undo: () => {
          this.applyTrim(clipId, oldState.startOffset, oldState.duration, oldState.sourceOffset);
          this.notify();
        }
      });
    } else {
      this.applyTrim(clipId, newStartOffset, newDuration, newSourceOffset);
      this.notify();
    }
    return true;
  }
  applyTrim(clipId, startOffset, duration, sourceOffset) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    this.intervalTree.remove(clipId);
    this.trackLists.get(clip.trackId)?.remove(clipId);
    clip.startOffset = Math.max(0, startOffset);
    clip.duration = duration;
    clip.sourceOffset = Math.max(0, sourceOffset);
    this.intervalTree.insert(clip);
    this.trackLists.get(clip.trackId)?.insert(clip);
  }
  /**
   * Feature 5: Duplicate clip non-destructively.
   */
  duplicateClip(clipId, recordHistory = true) {
    const original = this.clipsMap.get(clipId);
    if (!original) return null;
    const newClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const duplicate = {
      ...original,
      id: newClipId,
      name: `${original.name} (Copy)`,
      startOffset: original.startOffset + original.duration
      // Placed adjacent to original
    };
    if (recordHistory) {
      this.history.execute({
        description: `Duplicate clip "${original.name}"`,
        execute: () => {
          this.doAdd(duplicate);
          this.notify();
        },
        undo: () => {
          this.doRemove(duplicate.id);
          this.notify();
        }
      });
    } else {
      this.doAdd(duplicate);
      this.notify();
    }
    return duplicate;
  }
  /**
   * Records a user drag-move gesture that was interactively applied in real-time.
   */
  recordMoveHistory(clipId, oldStart, newStart, oldTrackId, newTrackId) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    if (Math.abs(oldStart - newStart) < 1e-3 && oldTrackId === newTrackId) return;
    this.history.pushCommand({
      description: `Move clip "${clip.name}" to ${newStart.toFixed(2)}s`,
      execute: () => {
        this.applyMove(clipId, newStart, newTrackId);
        this.notify();
      },
      undo: () => {
        this.applyMove(clipId, oldStart, oldTrackId);
        this.notify();
      }
    });
    this.notify();
  }
  /**
   * Records a user drag-trim gesture that was interactively applied in real-time.
   */
  recordTrimHistory(clipId, oldStart, oldDuration, oldSourceOffset, newStart, newDuration, newSourceOffset) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    if (Math.abs(oldStart - newStart) < 1e-3 && Math.abs(oldDuration - newDuration) < 1e-3 && Math.abs(oldSourceOffset - newSourceOffset) < 1e-3) {
      return;
    }
    this.history.pushCommand({
      description: `Trim clip "${clip.name}"`,
      execute: () => {
        this.applyTrim(clipId, newStart, newDuration, newSourceOffset);
        this.notify();
      },
      undo: () => {
        this.applyTrim(clipId, oldStart, oldDuration, oldSourceOffset);
        this.notify();
      }
    });
    this.notify();
  }
  /**
   * Feature 6: Delete clip.
   */
  deleteClip(clipId, recordHistory = true) {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return false;
    const deletedState = { ...clip };
    if (recordHistory) {
      this.history.execute({
        description: `Delete clip "${deletedState.name}"`,
        execute: () => {
          this.doRemove(clipId);
          this.notify();
        },
        undo: () => {
          this.doAdd(deletedState);
          this.notify();
        }
      });
    } else {
      this.doRemove(clipId);
      this.notify();
    }
    return true;
  }
  // -------------------------------------------------------------
  // Feature 7: Selection & Feature 9: Snapping
  // -------------------------------------------------------------
  selectClip(clipId, multiSelect = false) {
    if (!multiSelect) {
      this.selectedClipIds.clear();
    }
    if (this.clipsMap.has(clipId)) {
      this.selectedClipIds.add(clipId);
    }
    this.notify();
  }
  deselectAll() {
    this.selectedClipIds.clear();
    this.notify();
  }
  getSelectedClipIds() {
    return Array.from(this.selectedClipIds);
  }
  /**
   * Feature 9: Snaps time to grid and neighboring clip boundaries (using Doubly Linked List).
   */
  snapPosition(time, trackId, gridSeconds = 0.25) {
    let snappedTime = Math.round(time / gridSeconds) * gridSeconds;
    if (trackId) {
      const normTrackId = normalizeTrackId(trackId);
      const list = this.trackLists.get(normTrackId) || this.trackLists.get(trackId);
      if (list) {
        let curr = list.head;
        while (curr) {
          const clipStart = curr.clip.startOffset;
          const clipEnd = curr.clip.startOffset + curr.clip.duration;
          if (Math.abs(time - clipStart) < 0.08) {
            return clipStart;
          }
          if (Math.abs(time - clipEnd) < 0.08) {
            return clipEnd;
          }
          curr = curr.next;
        }
      }
    }
    return Math.max(0, snappedTime);
  }
  // -------------------------------------------------------------
  // Feature 8: Total Timeline Duration
  // -------------------------------------------------------------
  getTotalDuration() {
    let maxEnd = 0;
    for (const clip of this.clipsMap.values()) {
      const end = clip.startOffset + clip.duration;
      if (end > maxEnd) maxEnd = end;
    }
    return Math.max(10, maxEnd);
  }
  // -------------------------------------------------------------
  // Playback & Export Engine Connection (Actual Sample Offsets)
  // -------------------------------------------------------------
  /**
   * Generates exact sample and time offsets for Web Audio API AudioBufferSourceNodes.
   * Connects the non-destructive timeline clips directly to audio output.
   */
  getScheduleForTime(playheadTime) {
    const items = [];
    for (const clip of this.clipsMap.values()) {
      const clipEnd = clip.startOffset + clip.duration;
      if (clipEnd > playheadTime) {
        const isCurrentlyPlaying = playheadTime >= clip.startOffset;
        const delaySeconds = isCurrentlyPlaying ? 0 : clip.startOffset - playheadTime;
        const offsetIntoClip = isCurrentlyPlaying ? playheadTime - clip.startOffset : 0;
        const sourceOffset = clip.sourceOffset + offsetIntoClip;
        const playDuration = clip.duration - offsetIntoClip;
        items.push({
          clip,
          trackId: normalizeTrackId(clip.trackId),
          sourceOffset,
          delaySeconds,
          playDuration
        });
      }
    }
    return items;
  }
  // -------------------------------------------------------------
  // Undo / Redo Facade
  // -------------------------------------------------------------
  undo() {
    const res = this.history.undo();
    if (res) this.notify();
    return res;
  }
  redo() {
    const res = this.history.redo();
    if (res) this.notify();
    return res;
  }
  canUndo() {
    return this.history.canUndo();
  }
  canRedo() {
    return this.history.canRedo();
  }
  getUndoCount() {
    return this.history.getUndoStackSize();
  }
  getRedoCount() {
    return this.history.getRedoStackSize();
  }
  getUndoText() {
    return this.history.getUndoDescription();
  }
  getRedoText() {
    return this.history.getRedoDescription();
  }
  getUndoHistory() {
    return this.history.getUndoHistory();
  }
  getRedoHistory() {
    return this.history.getRedoHistory();
  }
  // -------------------------------------------------------------
  // Change Subscriptions
  // -------------------------------------------------------------
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    this.listeners.forEach((cb) => cb());
  }
  clearAll() {
    this.clipsMap.clear();
    this.intervalTree.clear();
    this.trackLists.forEach((l) => l.clear());
    this.selectedClipIds.clear();
    this.history.clear();
    this.notify();
  }
};
var timelineModel = new TimelineModel();
export {
  ClipLinkedList,
  ClipNode,
  STEM_TRACK_IDS,
  TimelineIntervalTree,
  TimelineModel,
  UndoRedoStack,
  normalizeTrackId,
  timelineModel
};
