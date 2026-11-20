// src/storage/indexedDB.ts
var DB_NAME = "AudioWeaveStudioDB";
var DB_VERSION = 2;
var STORE_ASSETS = "audio_assets";
var STORE_BINARIES = "audio_binaries";
var STORE_PROJECTS = "projects";
var STORE_AUTOSAVE = "autosave";
var IndexedDBManager = class {
  dbPromise = null;
  getDB() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_BINARIES)) {
          db.createObjectStore(STORE_BINARIES);
        }
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) {
          db.createObjectStore(STORE_AUTOSAVE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }
  // -------------------------------------------------------------
  // Audio Assets & Raw Binaries Storage
  // -------------------------------------------------------------
  async saveAsset(asset, rawBytes) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS, STORE_BINARIES], "readwrite");
      const assetStore = tx.objectStore(STORE_ASSETS);
      const binaryStore = tx.objectStore(STORE_BINARIES);
      const assetToSave = { ...asset };
      delete assetToSave.rawArrayBuffer;
      assetStore.put(assetToSave);
      if (rawBytes) {
        binaryStore.put(rawBytes, asset.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async getAllAssets() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, "readonly");
      const store = tx.objectStore(STORE_ASSETS);
      const request = store.getAll();
      request.onsuccess = () => {
        const assets = request.result || [];
        assets.sort((a, b) => b.createdAt - a.createdAt);
        resolve(assets);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async getAsset(assetId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, "readonly");
      const store = tx.objectStore(STORE_ASSETS);
      const request = store.get(assetId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async getAssetBinary(assetId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BINARIES, "readonly");
      const store = tx.objectStore(STORE_BINARIES);
      const request = store.get(assetId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async hasAssetBinary(assetId) {
    const binary = await this.getAssetBinary(assetId);
    return binary !== null && binary.byteLength > 0;
  }
  async saveAssetBinary(assetId, rawBytes) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BINARIES, "readwrite");
      const store = tx.objectStore(STORE_BINARIES);
      store.put(rawBytes, assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async deleteAsset(assetId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS, STORE_BINARIES], "readwrite");
      tx.objectStore(STORE_ASSETS).delete(assetId);
      tx.objectStore(STORE_BINARIES).delete(assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  // -------------------------------------------------------------
  // Versioned Project Management Storage
  // -------------------------------------------------------------
  async saveProject(project) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);
      const toSave = {
        ...project,
        id: project.metadata.id
      };
      store.put(toSave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async getProject(projectId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const store = tx.objectStore(STORE_PROJECTS);
      const request = store.get(projectId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async getAllProjects() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const store = tx.objectStore(STORE_PROJECTS);
      const request = store.getAll();
      request.onsuccess = () => {
        const rawList = request.result || [];
        const summaries = rawList.map((p) => ({
          id: p.metadata.id,
          name: p.metadata.name,
          schemaVersion: p.metadata.schemaVersion,
          updatedAt: p.metadata.updatedAt,
          createdAt: p.metadata.createdAt,
          clipCount: p.clips.length,
          trackCount: p.tracks.length,
          duration: p.metadata.duration
        }));
        summaries.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(summaries);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async deleteProject(projectId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);
      store.delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  // -------------------------------------------------------------
  // Auto-Save & Crash Recovery
  // -------------------------------------------------------------
  async saveAutoSave(project) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUTOSAVE, "readwrite");
      const store = tx.objectStore(STORE_AUTOSAVE);
      store.put({
        id: "current_autosave",
        project,
        savedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async getAutoSave() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUTOSAVE, "readonly");
      const store = tx.objectStore(STORE_AUTOSAVE);
      const request = store.get("current_autosave");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async clearAutoSave() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUTOSAVE, "readwrite");
      const store = tx.objectStore(STORE_AUTOSAVE);
      store.delete("current_autosave");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async clearAll() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_ASSETS, STORE_BINARIES, STORE_PROJECTS, STORE_AUTOSAVE],
        "readwrite"
      );
      tx.objectStore(STORE_ASSETS).clear();
      tx.objectStore(STORE_BINARIES).clear();
      tx.objectStore(STORE_PROJECTS).clear();
      tx.objectStore(STORE_AUTOSAVE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};
var assetStorage = new IndexedDBManager();

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

// src/audio/routing/types.ts
var NODE_PARAM_DEFINITIONS = {
  input: [],
  output: [
    { name: "masterGain", label: "Output Level", min: 0, max: 2, step: 0.01, defaultValue: 1, unit: "x" }
  ],
  gain: [
    { name: "gain", label: "Gain", min: 0, max: 2, step: 0.01, defaultValue: 1, unit: "x" }
  ],
  eq: [
    { name: "lowGain", label: "Low (320Hz)", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" },
    { name: "midGain", label: "Mid (1kHz)", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" },
    { name: "highGain", label: "High (3.2kHz)", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" }
  ],
  compressor: [
    { name: "threshold", label: "Threshold", min: -60, max: 0, step: 1, defaultValue: -24, unit: "dB" },
    { name: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, defaultValue: 4, unit: ":1" },
    { name: "knee", label: "Knee", min: 0, max: 40, step: 1, defaultValue: 10, unit: "dB" },
    { name: "attack", label: "Attack", min: 1e-3, max: 0.5, step: 5e-3, defaultValue: 0.01, unit: "s" },
    { name: "release", label: "Release", min: 0.05, max: 1, step: 0.05, defaultValue: 0.25, unit: "s" }
  ],
  reverb: [
    { name: "decay", label: "Decay Time", min: 0.2, max: 6, step: 0.1, defaultValue: 2, unit: "s" },
    { name: "wet", label: "Wet Mix", min: 0, max: 1, step: 0.02, defaultValue: 0.35, unit: "%" },
    { name: "dry", label: "Dry Mix", min: 0, max: 1, step: 0.02, defaultValue: 1, unit: "%" }
  ],
  delay: [
    { name: "delayTime", label: "Delay Time", min: 0.02, max: 1.5, step: 0.02, defaultValue: 0.3, unit: "s" },
    { name: "feedback", label: "Feedback", min: 0, max: 0.85, step: 0.02, defaultValue: 0.35, unit: "%" },
    { name: "wet", label: "Wet Level", min: 0, max: 1, step: 0.02, defaultValue: 0.4, unit: "%" }
  ],
  lowpass: [
    { name: "frequency", label: "Cutoff Freq", min: 100, max: 18e3, step: 50, defaultValue: 2500, unit: "Hz" },
    { name: "q", label: "Resonance (Q)", min: 0.5, max: 12, step: 0.1, defaultValue: 1, unit: "" }
  ],
  highpass: [
    { name: "frequency", label: "Cutoff Freq", min: 20, max: 4e3, step: 20, defaultValue: 150, unit: "Hz" },
    { name: "q", label: "Resonance (Q)", min: 0.5, max: 12, step: 0.1, defaultValue: 1, unit: "" }
  ],
  pan: [
    { name: "pan", label: "Pan", min: -1, max: 1, step: 0.05, defaultValue: 0, unit: "" }
  ]
};

// src/audio/routing/AudioGraphModel.ts
var AudioGraphModel = class {
  nodes = /* @__PURE__ */ new Map();
  connections = /* @__PURE__ */ new Map();
  // Adjacency lists for fast edge lookups
  outgoingEdges = /* @__PURE__ */ new Map();
  // from -> Set<to>
  incomingEdges = /* @__PURE__ */ new Map();
  // to -> Set<from>
  listeners = /* @__PURE__ */ new Set();
  constructor() {
    this.initDefaultGraph();
  }
  /**
   * Initializes standard baseline graph: Input -> Gain -> Output.
   */
  initDefaultGraph() {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    const inputNode = {
      id: "node-input",
      type: "input",
      name: "Audio In",
      x: 60,
      y: 180,
      bypassed: false,
      params: {}
    };
    const gainNode = {
      id: "node-gain-master",
      type: "gain",
      name: "Master Level",
      x: 320,
      y: 180,
      bypassed: false,
      params: { gain: 1 }
    };
    const outputNode = {
      id: "node-output",
      type: "output",
      name: "Audio Out",
      x: 580,
      y: 180,
      bypassed: false,
      params: { masterGain: 1 }
    };
    this.addNodeInternal(inputNode);
    this.addNodeInternal(gainNode);
    this.addNodeInternal(outputNode);
    this.connectInternal("node-input", "node-gain-master");
    this.connectInternal("node-gain-master", "node-output");
    this.notify();
  }
  // -----------------------------------------------------------------
  // Node Management
  // -----------------------------------------------------------------
  addNode(type, x = 300, y = 200, name) {
    const id = `node-${type}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    const defaultParams = {};
    const configs = NODE_PARAM_DEFINITIONS[type] || [];
    for (const c of configs) {
      defaultParams[c.name] = c.defaultValue;
    }
    const defaultNames = {
      input: "Audio In",
      gain: "Gain Stage",
      eq: "Parametric EQ",
      compressor: "Compressor",
      reverb: "Convolver Reverb",
      delay: "Stereo Delay",
      lowpass: "Low-Pass Filter",
      highpass: "High-Pass Filter",
      pan: "Stereo Panner",
      output: "Audio Out"
    };
    const node = {
      id,
      type,
      name: name || defaultNames[type] || type.toUpperCase(),
      x,
      y,
      bypassed: false,
      params: defaultParams
    };
    this.addNodeInternal(node);
    this.notify();
    return node;
  }
  addNodeInternal(node) {
    this.nodes.set(node.id, { ...node });
    if (!this.outgoingEdges.has(node.id)) {
      this.outgoingEdges.set(node.id, /* @__PURE__ */ new Set());
    }
    if (!this.incomingEdges.has(node.id)) {
      this.incomingEdges.set(node.id, /* @__PURE__ */ new Set());
    }
  }
  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || node.type === "input" || node.type === "output") {
      return false;
    }
    const toRemove = [];
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.fromNodeId === nodeId || conn.toNodeId === nodeId) {
        toRemove.push(connId);
      }
    }
    toRemove.forEach((connId) => this.disconnect(connId, false));
    this.outgoingEdges.delete(nodeId);
    this.incomingEdges.delete(nodeId);
    this.nodes.delete(nodeId);
    this.notify();
    return true;
  }
  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }
  getAllNodes() {
    return Array.from(this.nodes.values());
  }
  updateNodePosition(nodeId, x, y) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.x = Math.max(0, x);
      node.y = Math.max(0, y);
      this.notify();
    }
  }
  updateNodeParam(nodeId, paramName, value) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.params = { ...node.params, [paramName]: value };
      this.notify();
    }
  }
  toggleBypass(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node && node.type !== "input" && node.type !== "output") {
      node.bypassed = !node.bypassed;
      this.notify();
      return node.bypassed;
    }
    return false;
  }
  // -----------------------------------------------------------------
  // Connection Validation & Cycle Detection
  // -----------------------------------------------------------------
  /**
   * Validates if a directed connection from fromNodeId to toNodeId is legally allowable.
   * Checks for:
   * 1. Self loops (u == v)
   * 2. Missing nodes
   * 3. Role restrictions (cannot connect out of 'output', cannot connect into 'input')
   * 4. Duplicate connections
   * 5. Cycle creation (Directed Acyclic Graph invariant)
   */
  validateConnection(fromNodeId, toNodeId) {
    if (fromNodeId === toNodeId) {
      return { valid: false, reason: "Cannot connect a node to itself (self-loop)." };
    }
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) {
      return { valid: false, reason: "One or both nodes do not exist." };
    }
    if (fromNode.type === "output") {
      return { valid: false, reason: "Audio Output node cannot have outgoing connections." };
    }
    if (toNode.type === "input") {
      return { valid: false, reason: "Audio Input node cannot have incoming connections." };
    }
    const outgoing = this.outgoingEdges.get(fromNodeId);
    if (outgoing && outgoing.has(toNodeId)) {
      return { valid: false, reason: "Connection already exists between these two nodes." };
    }
    if (this.pathExists(toNodeId, fromNodeId)) {
      return {
        valid: false,
        reason: "Connection creates a cycle. Audio routing graph must remain a Directed Acyclic Graph (DAG)."
      };
    }
    return { valid: true };
  }
  /**
   * Depth-First Search (DFS) to detect reachability from startId to targetId.
   */
  pathExists(startId, targetId) {
    const visited = /* @__PURE__ */ new Set();
    const stack = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === targetId) return true;
      if (!visited.has(current)) {
        visited.add(current);
        const neighbors = this.outgoingEdges.get(current);
        if (neighbors) {
          for (const next of neighbors) {
            if (!visited.has(next)) {
              stack.push(next);
            }
          }
        }
      }
    }
    return false;
  }
  connect(fromNodeId, toNodeId) {
    const validation = this.validateConnection(fromNodeId, toNodeId);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }
    const conn = this.connectInternal(fromNodeId, toNodeId);
    this.notify();
    return { success: true, connection: conn };
  }
  connectInternal(fromNodeId, toNodeId) {
    const id = `conn-${fromNodeId}->${toNodeId}`;
    const conn = {
      id,
      fromNodeId,
      fromPort: "out",
      toNodeId,
      toPort: "in"
    };
    this.connections.set(id, conn);
    let fromOut = this.outgoingEdges.get(fromNodeId);
    if (!fromOut) {
      fromOut = /* @__PURE__ */ new Set();
      this.outgoingEdges.set(fromNodeId, fromOut);
    }
    fromOut.add(toNodeId);
    let toIn = this.incomingEdges.get(toNodeId);
    if (!toIn) {
      toIn = /* @__PURE__ */ new Set();
      this.incomingEdges.set(toNodeId, toIn);
    }
    toIn.add(fromNodeId);
    return conn;
  }
  disconnect(connectionId, shouldNotify = true) {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    this.connections.delete(connectionId);
    this.outgoingEdges.get(conn.fromNodeId)?.delete(conn.toNodeId);
    this.incomingEdges.get(conn.toNodeId)?.delete(conn.fromNodeId);
    if (shouldNotify) {
      this.notify();
    }
    return true;
  }
  getAllConnections() {
    return Array.from(this.connections.values());
  }
  // -----------------------------------------------------------------
  // Topological Sorting (Kahn's Algorithm)
  // -----------------------------------------------------------------
  /**
   * Computes exact topological ordering for the DAG using Kahn's algorithm.
   * Returns list of node IDs in evaluation order.
   * Fails if graph contains a cycle.
   */
  getTopologicalOrder() {
    const inDegree = /* @__PURE__ */ new Map();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }
    for (const conn of this.connections.values()) {
      inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) || 0) + 1);
    }
    const queue = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }
    const order = [];
    while (queue.length > 0) {
      const u = queue.shift();
      order.push(u);
      const neighbors = this.outgoingEdges.get(u);
      if (neighbors) {
        for (const v of neighbors) {
          const currentDeg = (inDegree.get(v) || 1) - 1;
          inDegree.set(v, currentDeg);
          if (currentDeg === 0) {
            queue.push(v);
          }
        }
      }
    }
    if (order.length !== this.nodes.size) {
      return {
        isValid: false,
        hasCycle: true,
        error: "Cycle detected during topological sorting! Audio graph cannot be processed."
      };
    }
    return {
      isValid: true,
      hasCycle: false,
      topologicalOrder: order
    };
  }
  // -----------------------------------------------------------------
  // Preset Topologies
  // -----------------------------------------------------------------
  loadPreset(presetName) {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    const inNode = this.addNode("input", 50, 200, "Audio In");
    const outNode = this.addNode("output", 750, 200, "Audio Out");
    if (presetName === "direct") {
      const gain = this.addNode("gain", 400, 200, "Master Level");
      this.connect(inNode.id, gain.id);
      this.connect(gain.id, outNode.id);
    } else if (presetName === "vocal_warmth") {
      const hp = this.addNode("highpass", 200, 160, "Low Cut (80Hz)");
      hp.params.frequency = 80;
      const eq = this.addNode("eq", 360, 240, "Vocal Air & Body");
      eq.params.lowGain = 1.5;
      eq.params.midGain = -1;
      eq.params.highGain = 3;
      const comp = this.addNode("compressor", 520, 160, "Vocal Leveler");
      comp.params.threshold = -18;
      comp.params.ratio = 3.5;
      this.connect(inNode.id, hp.id);
      this.connect(hp.id, eq.id);
      this.connect(eq.id, comp.id);
      this.connect(comp.id, outNode.id);
    } else if (presetName === "space_echo") {
      const delay = this.addNode("delay", 240, 220, "Tape Echo");
      delay.params.delayTime = 0.35;
      delay.params.feedback = 0.45;
      delay.params.wet = 0.5;
      const reverb = this.addNode("reverb", 480, 220, "Hall Verb");
      reverb.params.decay = 2.8;
      reverb.params.wet = 0.4;
      this.connect(inNode.id, delay.id);
      this.connect(delay.id, reverb.id);
      this.connect(reverb.id, outNode.id);
    } else if (presetName === "lofi_filter") {
      const lp = this.addNode("lowpass", 240, 180, "Warm Low-Pass");
      lp.params.frequency = 1800;
      lp.params.q = 1.4;
      const hp = this.addNode("highpass", 450, 180, "Phone Cut");
      hp.params.frequency = 320;
      this.connect(inNode.id, lp.id);
      this.connect(lp.id, hp.id);
      this.connect(hp.id, outNode.id);
    }
    this.notify();
  }
  // -----------------------------------------------------------------
  // Serialization & Change Subscriptions
  // -----------------------------------------------------------------
  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()),
      connections: Array.from(this.connections.values())
    };
  }
  fromJSON(data) {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    for (const node of data.nodes) {
      this.addNodeInternal(node);
    }
    for (const conn of data.connections) {
      this.connectInternal(conn.fromNodeId, conn.toNodeId);
    }
    this.notify();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    this.listeners.forEach((cb) => cb());
  }
};
var audioGraphModel = new AudioGraphModel();

// src/audio/remix/RemixComposerModel.ts
var RemixComposerModel = class {
  detectedSections = [];
  arrangements = /* @__PURE__ */ new Map();
  activeArrangementId = "arr-default";
  originalTimelineClips = [];
  listeners = /* @__PURE__ */ new Set();
  constructor() {
    this.initDefaultArrangement();
  }
  // -----------------------------------------------------------------
  // Original Timeline Preservation
  // -----------------------------------------------------------------
  snapshotOriginalTimeline(clips) {
    if (this.originalTimelineClips.length === 0 && clips.length > 0) {
      this.originalTimelineClips = clips.map((c) => ({ ...c }));
    }
  }
  getOriginalTimelineClips() {
    return this.originalTimelineClips;
  }
  restoreOriginalArrangement(timeline) {
    this.selectArrangement("arr-default");
    if (this.originalTimelineClips.length > 0) {
      timeline.clearAll();
      for (const clip of this.originalTimelineClips) {
        timeline.addClip({ ...clip }, false);
      }
      this.notify();
      return true;
    } else {
      this.applyToTimeline(timeline);
      return true;
    }
  }
  initDefaultArrangement() {
    const defaultArr = {
      id: "arr-default",
      name: "Original Sequence",
      bpm: 120,
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.arrangements.set(defaultArr.id, defaultArr);
    this.activeArrangementId = defaultArr.id;
  }
  // -----------------------------------------------------------------
  // Detected Sections
  // -----------------------------------------------------------------
  setDetectedSections(sections) {
    this.detectedSections = [...sections];
    const active = this.getActiveArrangement();
    if (active.blocks.length === 0 && sections.length > 0) {
      let currentOffset = 0;
      active.blocks = sections.map((sec, idx) => {
        const block = {
          id: `block-${sec.id}-${idx}`,
          sectionId: sec.id,
          name: sec.name,
          type: sec.type,
          sourceStart: sec.start,
          sourceEnd: sec.end,
          duration: sec.duration,
          timelineStart: currentOffset,
          activeStems: {
            vocals: true,
            drums: true,
            bass: true,
            other: true
          },
          color: sec.color
        };
        currentOffset += sec.duration;
        return block;
      });
      active.updatedAt = Date.now();
    }
    this.notify();
  }
  getDetectedSections() {
    return this.detectedSections;
  }
  // -----------------------------------------------------------------
  // Arrangement Operations
  // -----------------------------------------------------------------
  getActiveArrangement() {
    let arr = this.arrangements.get(this.activeArrangementId);
    if (!arr) {
      arr = Array.from(this.arrangements.values())[0];
      if (arr) this.activeArrangementId = arr.id;
    }
    return arr || {
      id: "fallback",
      name: "Arrangement",
      bpm: 120,
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
  getAllArrangements() {
    return Array.from(this.arrangements.values());
  }
  setArrangements(arrangements) {
    this.arrangements.clear();
    for (const arr of arrangements) {
      this.arrangements.set(arr.id, JSON.parse(JSON.stringify(arr)));
    }
    this.notify();
  }
  selectArrangement(id) {
    if (this.arrangements.has(id)) {
      this.activeArrangementId = id;
      this.notify();
      return true;
    }
    return false;
  }
  createArrangement(name, template = "copy_current") {
    const id = `arr-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    let blocks = [];
    const current = this.getActiveArrangement();
    if (template === "copy_current") {
      blocks = current.blocks.map((b) => ({
        ...b,
        id: `block-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
        activeStems: { ...b.activeStems }
      }));
    } else if (template === "radio_edit" && this.detectedSections.length > 0) {
      const intro = this.detectedSections.find((s) => s.type === "intro") || this.detectedSections[0];
      const chorus = this.detectedSections.find((s) => s.type === "chorus") || this.detectedSections[Math.min(1, this.detectedSections.length - 1)];
      const verse = this.detectedSections.find((s) => s.type === "verse") || this.detectedSections[0];
      const outro = this.detectedSections.find((s) => s.type === "outro") || this.detectedSections[this.detectedSections.length - 1];
      const ordered = [intro, chorus, verse, chorus, outro].filter(Boolean);
      blocks = ordered.map((s, idx) => ({
        id: `block-radio-${idx}`,
        sectionId: s.id,
        name: idx === 1 ? "Early Chorus (Hook)" : s.name,
        type: s.type,
        sourceStart: s.start,
        sourceEnd: s.end,
        duration: s.duration,
        timelineStart: 0,
        activeStems: {
          vocals: true,
          drums: true,
          bass: true,
          other: true
        },
        color: s.color
      }));
    } else if (template === "club_extended" && this.detectedSections.length > 0) {
      const intro = this.detectedSections.find((s) => s.type === "intro") || this.detectedSections[0];
      const verse = this.detectedSections.find((s) => s.type === "verse") || this.detectedSections[0];
      const chorus = this.detectedSections.find((s) => s.type === "chorus") || this.detectedSections[0];
      const outro = this.detectedSections.find((s) => s.type === "outro") || this.detectedSections[this.detectedSections.length - 1];
      const ordered = [intro, intro, verse, chorus, chorus, outro].filter(Boolean);
      blocks = ordered.map((s, idx) => ({
        id: `block-club-${idx}`,
        sectionId: s.id,
        name: idx === 0 ? "Intro (Beat only)" : idx === 4 ? "Chorus (Club Drop)" : s.name,
        type: s.type,
        sourceStart: s.start,
        sourceEnd: s.end,
        duration: s.duration,
        timelineStart: 0,
        activeStems: {
          vocals: idx !== 0,
          // mute vocals in intro 1
          drums: true,
          bass: true,
          other: true
        },
        color: s.color
      }));
    }
    const newArr = {
      id,
      name,
      bpm: current.bpm || 120,
      blocks,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.recalculateTimelineOffsets(newArr);
    this.arrangements.set(id, newArr);
    this.activeArrangementId = id;
    this.notify();
    return newArr;
  }
  deleteArrangement(id) {
    if (this.arrangements.size <= 1) return false;
    const deleted = this.arrangements.delete(id);
    if (deleted && this.activeArrangementId === id) {
      this.activeArrangementId = Array.from(this.arrangements.keys())[0];
    }
    this.notify();
    return deleted;
  }
  // -----------------------------------------------------------------
  // Block Editing within Active Arrangement
  // -----------------------------------------------------------------
  /**
   * Appends or inserts a section into the active arrangement.
   */
  addSectionToArrangement(sectionId, targetIndex) {
    const sec = this.detectedSections.find((s) => s.id === sectionId);
    if (!sec) return null;
    const arr = this.getActiveArrangement();
    const newBlock = {
      id: `block-${sec.id}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
      sectionId: sec.id,
      name: sec.name,
      type: sec.type,
      sourceStart: sec.start,
      sourceEnd: sec.end,
      duration: sec.duration,
      timelineStart: 0,
      activeStems: { vocals: true, drums: true, bass: true, other: true },
      color: sec.color
    };
    if (typeof targetIndex === "number" && targetIndex >= 0 && targetIndex <= arr.blocks.length) {
      arr.blocks.splice(targetIndex, 0, newBlock);
    } else {
      arr.blocks.push(newBlock);
    }
    this.recalculateTimelineOffsets(arr);
    this.notify();
    return newBlock;
  }
  /**
   * Duplicates a section block in the active arrangement.
   */
  duplicateSection(blockId) {
    const arr = this.getActiveArrangement();
    const index = arr.blocks.findIndex((b) => b.id === blockId);
    if (index === -1) return null;
    const original = arr.blocks[index];
    const clone = {
      ...original,
      id: `block-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
      name: `${original.name} (Copy)`,
      activeStems: { ...original.activeStems }
    };
    arr.blocks.splice(index + 1, 0, clone);
    this.recalculateTimelineOffsets(arr);
    this.notify();
    return clone;
  }
  /**
   * Moves a section to a new position in the arrangement sequence.
   */
  rearrangeSection(blockId, targetIndex) {
    const arr = this.getActiveArrangement();
    const currentIndex = arr.blocks.findIndex((b) => b.id === blockId);
    if (currentIndex === -1) return false;
    const clampedIndex = Math.max(0, Math.min(arr.blocks.length - 1, targetIndex));
    if (currentIndex === clampedIndex) return true;
    const [movedBlock] = arr.blocks.splice(currentIndex, 1);
    arr.blocks.splice(clampedIndex, 0, movedBlock);
    this.recalculateTimelineOffsets(arr);
    this.notify();
    return true;
  }
  /**
   * Removes a section from the active arrangement.
   */
  removeSection(blockId) {
    const arr = this.getActiveArrangement();
    const index = arr.blocks.findIndex((b) => b.id === blockId);
    if (index === -1) return false;
    arr.blocks.splice(index, 1);
    this.recalculateTimelineOffsets(arr);
    this.notify();
    return true;
  }
  /**
   * Toggles an individual stem active/inactive in a specific section block.
   */
  toggleStem(blockId, stemKey) {
    const arr = this.getActiveArrangement();
    const block = arr.blocks.find((b) => b.id === blockId);
    if (!block) return false;
    block.activeStems[stemKey] = !block.activeStems[stemKey];
    arr.updatedAt = Date.now();
    this.notify();
    return block.activeStems[stemKey];
  }
  recalculateTimelineOffsets(arr) {
    let offset = 0;
    for (const b of arr.blocks) {
      b.timelineStart = Number(offset.toFixed(2));
      offset += b.duration;
    }
    arr.updatedAt = Date.now();
  }
  getArrangementDuration() {
    const arr = this.getActiveArrangement();
    if (arr.blocks.length === 0) return 0;
    const last = arr.blocks[arr.blocks.length - 1];
    return Number((last.timelineStart + last.duration).toFixed(2));
  }
  // -----------------------------------------------------------------
  // Sync to Multi-Track Timeline & Playback Engine
  // -----------------------------------------------------------------
  /**
   * Converts the active remix arrangement into timeline clips on tracks 1-4,
   * making the remix instantly editable and playable through the Web Audio engine.
   */
  applyToTimeline(timeline) {
    const arr = this.getActiveArrangement();
    timeline.clearAll();
    const hasStems = timeline.hasAsset("vocals") || timeline.hasAsset("drums") || timeline.hasAsset("bass") || timeline.hasAsset("other");
    if (hasStems) {
      const stemTrackMap = {
        vocals: { trackId: "vocals", color: "#06b6d4" },
        drums: { trackId: "drums", color: "#f59e0b" },
        bass: { trackId: "bass", color: "#a855f7" },
        other: { trackId: "other", color: "#10b981" }
      };
      for (const block of arr.blocks) {
        const stems = ["vocals", "drums", "bass", "other"];
        for (const stem of stems) {
          if (block.activeStems[stem] && timeline.hasAsset(stem)) {
            const map = stemTrackMap[stem];
            const clip = {
              id: `remix-clip-${stem}-${block.id}`,
              trackId: map.trackId,
              assetId: stem,
              // references registered stem buffer
              name: `${block.name} (${stem.toUpperCase()})`,
              startOffset: block.timelineStart,
              duration: block.duration,
              sourceOffset: block.sourceStart,
              color: block.color || map.color
            };
            timeline.addClip(clip, false);
          }
        }
      }
    } else {
      const registeredIds = timeline.getRegisteredAssetIds();
      const fallbackAssetId = registeredIds.length > 0 ? registeredIds[0] : "master";
      for (const block of arr.blocks) {
        const clip = {
          id: `remix-clip-stereo-${block.id}`,
          trackId: "vocals",
          assetId: fallbackAssetId,
          name: `${block.name} (Stereo Mix)`,
          startOffset: block.timelineStart,
          duration: block.duration,
          sourceOffset: block.sourceStart,
          color: block.color || "#3b82f6"
        };
        timeline.addClip(clip, false);
      }
    }
  }
  // -----------------------------------------------------------------
  // Real Offline WAV Audio Export
  // -----------------------------------------------------------------
  /**
   * Performs real multi-track offline rendering of the remix arrangement into a downloadable WAV audio file.
   */
  async exportArrangementWav(stemBuffers, sampleRate = 44100) {
    const arr = this.getActiveArrangement();
    const totalDuration = this.getArrangementDuration();
    if (totalDuration <= 0) {
      throw new Error("Arrangement has no sections to export.");
    }
    const totalFrames = Math.ceil(totalDuration * sampleRate);
    const OfflineCtxClass = typeof window !== "undefined" && (window.OfflineAudioContext || window.webkitOfflineAudioContext) || typeof globalThis !== "undefined" && globalThis.OfflineAudioContext;
    if (!OfflineCtxClass) {
      throw new Error("OfflineAudioContext is not supported in this environment.");
    }
    const offlineCtx = new OfflineCtxClass(2, totalFrames, sampleRate);
    for (const block of arr.blocks) {
      const stems = ["vocals", "drums", "bass", "other"];
      for (const stem of stems) {
        if (block.activeStems[stem]) {
          const buffer = stemBuffers[stem];
          if (buffer) {
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(offlineCtx.destination);
            source.start(block.timelineStart, block.sourceStart, block.duration);
          }
        }
      }
    }
    const renderedBuffer = await offlineCtx.startRendering();
    return this.encodeWavBlob(renderedBuffer);
  }
  /**
   * Encodes an AudioBuffer into an industry-standard 16-bit PCM WAV Blob.
   */
  encodeWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2;
    const bufferArray = new ArrayBuffer(44 + length);
    const view = new DataView(bufferArray);
    const writeString = (offset2, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset2 + i, str.charCodeAt(i));
      }
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + length, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length, true);
    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      let s0 = Math.max(-1, Math.min(1, ch0[i]));
      let s1 = Math.max(-1, Math.min(1, ch1[i]));
      view.setInt16(offset, s0 < 0 ? s0 * 32768 : s0 * 32767, true);
      view.setInt16(offset + 2, s1 < 0 ? s1 * 32768 : s1 * 32767, true);
      offset += 4;
    }
    return new Blob([view], { type: "audio/wav" });
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    this.listeners.forEach((cb) => cb());
  }
};
var remixComposerModel = new RemixComposerModel();

// src/audio/effects/types.ts
var createDefaultEQ = () => ({
  enabled: false,
  lowGain: 0,
  midGain: 0,
  highGain: 0,
  lowFreq: 100,
  midFreq: 1e3,
  highFreq: 6e3
});
var createDefaultReverb = () => ({
  enabled: false,
  decay: 2,
  preDelay: 0.01,
  wet: 0.35,
  dry: 1
});
var createDefaultDelay = () => ({
  enabled: false,
  time: 0.25,
  feedback: 0.35,
  wet: 0.3,
  dry: 1
});
var createDefaultCompressor = () => ({
  enabled: false,
  threshold: -24,
  knee: 30,
  ratio: 4,
  attack: 3e-3,
  release: 0.25
});
var createDefaultTrackEffects = () => ({
  eq: createDefaultEQ(),
  reverb: createDefaultReverb(),
  delay: createDefaultDelay(),
  compressor: createDefaultCompressor()
});

// src/audio/effects/EffectsRack.ts
var EffectsRack = class {
  ctx;
  inputNode;
  outputNode;
  // 1. Equalizer Nodes
  eqLowShelf;
  eqMidPeak;
  eqHighShelf;
  // 2. Compressor Nodes & Bypass
  compInputGain;
  compNode;
  compWetGain;
  compDryGain;
  compOutputGain;
  // 3. Delay Nodes & Bypass
  delayInputGain;
  delayNode;
  delayFeedbackGain;
  delayWetGain;
  delayDryGain;
  delayOutputGain;
  // 4. Reverb Nodes & Bypass
  reverbInputGain;
  convolverNode;
  reverbWetGain;
  reverbDryGain;
  // Current Settings
  settings;
  constructor(ctx, initialSettings) {
    this.ctx = ctx;
    this.settings = { ...createDefaultTrackEffects(), ...initialSettings };
    this.inputNode = ctx.createGain();
    this.inputNode.gain.value = 1;
    this.outputNode = ctx.createGain();
    this.outputNode.gain.value = 1;
    if (typeof ctx.createBiquadFilter !== "function" || typeof ctx.createDynamicsCompressor !== "function") {
      this.inputNode.connect(this.outputNode);
      return;
    }
    this.eqLowShelf = ctx.createBiquadFilter();
    this.eqLowShelf.type = "lowshelf";
    this.eqLowShelf.frequency.value = this.settings.eq.lowFreq;
    this.eqLowShelf.gain.value = this.settings.eq.enabled ? this.settings.eq.lowGain : 0;
    this.eqMidPeak = ctx.createBiquadFilter();
    this.eqMidPeak.type = "peaking";
    this.eqMidPeak.frequency.value = this.settings.eq.midFreq;
    this.eqMidPeak.Q.value = 1;
    this.eqMidPeak.gain.value = this.settings.eq.enabled ? this.settings.eq.midGain : 0;
    this.eqHighShelf = ctx.createBiquadFilter();
    this.eqHighShelf.type = "highshelf";
    this.eqHighShelf.frequency.value = this.settings.eq.highFreq;
    this.eqHighShelf.gain.value = this.settings.eq.enabled ? this.settings.eq.highGain : 0;
    this.inputNode.connect(this.eqLowShelf);
    this.eqLowShelf.connect(this.eqMidPeak);
    this.eqMidPeak.connect(this.eqHighShelf);
    this.compInputGain = ctx.createGain();
    this.compNode = ctx.createDynamicsCompressor();
    this.compWetGain = ctx.createGain();
    this.compDryGain = ctx.createGain();
    this.compOutputGain = ctx.createGain();
    this.applyCompressorParams(this.settings.compressor);
    this.eqHighShelf.connect(this.compInputGain);
    this.compInputGain.connect(this.compNode);
    this.compNode.connect(this.compWetGain);
    this.compWetGain.connect(this.compOutputGain);
    this.compInputGain.connect(this.compDryGain);
    this.compDryGain.connect(this.compOutputGain);
    this.delayInputGain = ctx.createGain();
    this.delayNode = ctx.createDelay(2);
    this.delayFeedbackGain = ctx.createGain();
    this.delayWetGain = ctx.createGain();
    this.delayDryGain = ctx.createGain();
    this.delayOutputGain = ctx.createGain();
    this.applyDelayParams(this.settings.delay);
    this.compOutputGain.connect(this.delayInputGain);
    this.delayInputGain.connect(this.delayDryGain);
    this.delayDryGain.connect(this.delayOutputGain);
    this.delayInputGain.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayWetGain);
    this.delayWetGain.connect(this.delayOutputGain);
    this.reverbInputGain = ctx.createGain();
    this.convolverNode = ctx.createConvolver();
    this.reverbWetGain = ctx.createGain();
    this.reverbDryGain = ctx.createGain();
    this.applyReverbParams(this.settings.reverb);
    this.delayOutputGain.connect(this.reverbInputGain);
    this.reverbInputGain.connect(this.reverbDryGain);
    this.reverbDryGain.connect(this.outputNode);
    this.reverbInputGain.connect(this.convolverNode);
    this.convolverNode.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.outputNode);
  }
  getInputNode() {
    return this.inputNode;
  }
  getOutputNode() {
    return this.outputNode;
  }
  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }
  // -------------------------------------------------------------
  // Parameter Updaters
  // -------------------------------------------------------------
  setEqualizer(eq) {
    this.settings.eq = { ...this.settings.eq, ...eq };
    if (!this.eqLowShelf) return;
    const enabled = this.settings.eq.enabled;
    this.eqLowShelf.frequency.setValueAtTime(this.settings.eq.lowFreq, this.ctx.currentTime);
    this.eqLowShelf.gain.setValueAtTime(enabled ? this.settings.eq.lowGain : 0, this.ctx.currentTime);
    this.eqMidPeak.frequency.setValueAtTime(this.settings.eq.midFreq, this.ctx.currentTime);
    this.eqMidPeak.gain.setValueAtTime(enabled ? this.settings.eq.midGain : 0, this.ctx.currentTime);
    this.eqHighShelf.frequency.setValueAtTime(this.settings.eq.highFreq, this.ctx.currentTime);
    this.eqHighShelf.gain.setValueAtTime(enabled ? this.settings.eq.highGain : 0, this.ctx.currentTime);
  }
  applyCompressorParams(comp) {
    if (!this.compNode) return;
    this.compNode.threshold.setValueAtTime(comp.threshold, this.ctx.currentTime);
    this.compNode.knee.setValueAtTime(comp.knee, this.ctx.currentTime);
    this.compNode.ratio.setValueAtTime(comp.ratio, this.ctx.currentTime);
    this.compNode.attack.setValueAtTime(comp.attack, this.ctx.currentTime);
    this.compNode.release.setValueAtTime(comp.release, this.ctx.currentTime);
    if (comp.enabled) {
      this.compWetGain.gain.setValueAtTime(1, this.ctx.currentTime);
      this.compDryGain.gain.setValueAtTime(0, this.ctx.currentTime);
    } else {
      this.compWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.compDryGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
  setCompressor(comp) {
    this.settings.compressor = { ...this.settings.compressor, ...comp };
    this.applyCompressorParams(this.settings.compressor);
  }
  applyDelayParams(delay) {
    if (!this.delayNode) return;
    this.delayNode.delayTime.setValueAtTime(delay.time, this.ctx.currentTime);
    if (delay.enabled) {
      this.delayFeedbackGain.gain.setValueAtTime(Math.min(0.85, Math.max(0, delay.feedback)), this.ctx.currentTime);
      this.delayWetGain.gain.setValueAtTime(Math.min(1, Math.max(0, delay.wet)), this.ctx.currentTime);
      this.delayDryGain.gain.setValueAtTime(Math.min(1, Math.max(0, delay.dry)), this.ctx.currentTime);
    } else {
      this.delayFeedbackGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.delayWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.delayDryGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
  setDelay(delay) {
    this.settings.delay = { ...this.settings.delay, ...delay };
    this.applyDelayParams(this.settings.delay);
  }
  applyReverbParams(reverb) {
    if (!this.convolverNode) return;
    if (reverb.enabled) {
      this.reverbWetGain.gain.setValueAtTime(Math.min(1, Math.max(0, reverb.wet)), this.ctx.currentTime);
      this.reverbDryGain.gain.setValueAtTime(Math.min(1, Math.max(0, reverb.dry)), this.ctx.currentTime);
      const ir = this.generateImpulseResponse(reverb.decay, this.ctx.sampleRate);
      try {
        this.convolverNode.buffer = ir;
      } catch (err) {
      }
    } else {
      this.reverbWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.reverbDryGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
  setReverb(reverb) {
    const prevDecay = this.settings.reverb.decay;
    this.settings.reverb = { ...this.settings.reverb, ...reverb };
    if (reverb.decay !== void 0 && reverb.decay !== prevDecay && this.settings.reverb.enabled) {
      this.convolverNode.buffer = this.generateImpulseResponse(this.settings.reverb.decay, this.ctx.sampleRate);
    }
    this.applyReverbParams(this.settings.reverb);
  }
  /**
   * Generates a stereo algorithmic impulse response with natural exponential decay.
   */
  generateImpulseResponse(decaySeconds, sampleRate) {
    const safeDecay = Math.max(0.1, Math.min(10, decaySeconds));
    const length = Math.floor(sampleRate * safeDecay);
    const irBuffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = irBuffer.getChannelData(0);
    const right = irBuffer.getChannelData(1);
    const decayConstant = 6.91 / safeDecay;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-decayConstant * t);
      left[i] = (Math.random() * 2 - 1) * envelope;
      right[i] = (Math.random() * 2 - 1) * envelope;
    }
    return irBuffer;
  }
  updateAll(settings) {
    this.setEqualizer(settings.eq);
    this.setCompressor(settings.compressor);
    this.setDelay(settings.delay);
    this.setReverb(settings.reverb);
  }
  dispose() {
    try {
      this.inputNode.disconnect();
      this.outputNode.disconnect();
      this.eqLowShelf.disconnect();
      this.eqMidPeak.disconnect();
      this.eqHighShelf.disconnect();
      this.compInputGain.disconnect();
      this.compNode.disconnect();
      this.compWetGain.disconnect();
      this.compDryGain.disconnect();
      this.compOutputGain.disconnect();
      this.delayInputGain.disconnect();
      this.delayNode.disconnect();
      this.delayFeedbackGain.disconnect();
      this.delayWetGain.disconnect();
      this.delayDryGain.disconnect();
      this.delayOutputGain.disconnect();
      this.reverbInputGain.disconnect();
      this.convolverNode.disconnect();
      this.reverbWetGain.disconnect();
      this.reverbDryGain.disconnect();
    } catch {
    }
  }
};

// src/audio/effects/EffectsManager.ts
var EffectsManager = class {
  trackSettings = /* @__PURE__ */ new Map();
  masterSettings = createDefaultTrackEffects();
  // Active Web Audio API Racks
  trackRacks = /* @__PURE__ */ new Map();
  masterRack = null;
  ctx = null;
  listeners = /* @__PURE__ */ new Set();
  constructor() {
    const defaultTrackIds = ["vocals", "drums", "bass", "other"];
    for (const tid of defaultTrackIds) {
      this.trackSettings.set(tid, createDefaultTrackEffects());
    }
  }
  setContext(ctx) {
    this.ctx = ctx;
  }
  getContext() {
    return this.ctx;
  }
  // -------------------------------------------------------------
  // State Accessors
  // -------------------------------------------------------------
  getTrackSettings(trackId) {
    const id = normalizeTrackId(trackId);
    let settings = this.trackSettings.get(id);
    if (!settings) {
      settings = createDefaultTrackEffects();
      this.trackSettings.set(id, settings);
    }
    return JSON.parse(JSON.stringify(settings));
  }
  getMasterSettings() {
    return JSON.parse(JSON.stringify(this.masterSettings));
  }
  // -------------------------------------------------------------
  // Track Effect Mutators
  // -------------------------------------------------------------
  setTrackEqualizer(trackId, eq) {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.eq = { ...settings.eq, ...eq };
    this.trackSettings.set(id, settings);
    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setEqualizer(settings.eq);
    }
    this.notify();
  }
  setTrackReverb(trackId, reverb) {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.reverb = { ...settings.reverb, ...reverb };
    this.trackSettings.set(id, settings);
    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setReverb(settings.reverb);
    }
    this.notify();
  }
  setTrackDelay(trackId, delay) {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.delay = { ...settings.delay, ...delay };
    this.trackSettings.set(id, settings);
    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setDelay(settings.delay);
    }
    this.notify();
  }
  setTrackCompressor(trackId, comp) {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.compressor = { ...settings.compressor, ...comp };
    this.trackSettings.set(id, settings);
    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setCompressor(settings.compressor);
    }
    this.notify();
  }
  // -------------------------------------------------------------
  // Master Effect Mutators
  // -------------------------------------------------------------
  setMasterEqualizer(eq) {
    this.masterSettings.eq = { ...this.masterSettings.eq, ...eq };
    if (this.masterRack) {
      this.masterRack.setEqualizer(this.masterSettings.eq);
    }
    this.notify();
  }
  setMasterReverb(reverb) {
    this.masterSettings.reverb = { ...this.masterSettings.reverb, ...reverb };
    if (this.masterRack) {
      this.masterRack.setReverb(this.masterSettings.reverb);
    }
    this.notify();
  }
  setMasterDelay(delay) {
    this.masterSettings.delay = { ...this.masterSettings.delay, ...delay };
    if (this.masterRack) {
      this.masterRack.setDelay(this.masterSettings.delay);
    }
    this.notify();
  }
  setMasterCompressor(comp) {
    this.masterSettings.compressor = { ...this.masterSettings.compressor, ...comp };
    if (this.masterRack) {
      this.masterRack.setCompressor(this.masterSettings.compressor);
    }
    this.notify();
  }
  // -------------------------------------------------------------
  // Web Audio Node Wiring (AudioEngine Live Playback)
  // -------------------------------------------------------------
  getOrCreateTrackRack(trackId, ctx) {
    const id = normalizeTrackId(trackId);
    let rack = this.trackRacks.get(id);
    if (!rack) {
      const settings = this.getTrackSettings(id);
      rack = new EffectsRack(ctx, settings);
      this.trackRacks.set(id, rack);
    }
    return rack;
  }
  getOrCreateMasterRack(ctx) {
    if (!this.masterRack) {
      this.masterRack = new EffectsRack(ctx, this.masterSettings);
    }
    return this.masterRack;
  }
  // -------------------------------------------------------------
  // Serialization & Project Persistence
  // -------------------------------------------------------------
  toJSON() {
    const tracksObj = {};
    for (const [id, settings] of this.trackSettings.entries()) {
      tracksObj[id] = JSON.parse(JSON.stringify(settings));
    }
    return {
      tracks: tracksObj,
      master: JSON.parse(JSON.stringify(this.masterSettings))
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (state.master) {
      this.masterSettings = { ...createDefaultTrackEffects(), ...state.master };
      if (this.masterRack) {
        this.masterRack.updateAll(this.masterSettings);
      }
    }
    if (state.tracks) {
      for (const [id, settings] of Object.entries(state.tracks)) {
        const merged = { ...createDefaultTrackEffects(), ...settings };
        this.trackSettings.set(id, merged);
        const rack = this.trackRacks.get(id);
        if (rack) {
          rack.updateAll(merged);
        }
      }
    }
    this.notify();
  }
  resetAll() {
    this.masterSettings = createDefaultTrackEffects();
    this.trackSettings.clear();
    this.masterRack = null;
    this.trackRacks.clear();
    this.notify();
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
  clear() {
    this.trackRacks.forEach((rack) => rack.dispose());
    this.trackRacks.clear();
    if (this.masterRack) {
      this.masterRack.dispose();
      this.masterRack = null;
    }
    this.trackSettings.clear();
    this.masterSettings = createDefaultTrackEffects();
    this.notify();
  }
};
var effectsManager = new EffectsManager();

// src/audio/AudioEngine.ts
var AudioEngine = class {
  ctx = null;
  masterGain = null;
  masterAnalyser = null;
  masterVolume = 1;
  masterMuted = false;
  // Multi-Track / Stems Management with shared clock
  tracks = /* @__PURE__ */ new Map();
  activeSources = /* @__PURE__ */ new Map();
  // Timeline Model Integration
  timelineModelRef = null;
  activeTimelineSources = /* @__PURE__ */ new Set();
  // Playback State
  isPlaying = false;
  playbackStartTime = 0;
  startOffset = 0;
  duration = 0;
  animFrameId = null;
  // Listeners
  onTimeUpdateListeners = /* @__PURE__ */ new Set();
  onPlayStateListeners = /* @__PURE__ */ new Set();
  onTrackStatesListeners = /* @__PURE__ */ new Set();
  constructor() {
  }
  /**
   * Initializes or resumes the shared Web Audio API AudioContext.
   */
  getContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      effectsManager.setContext(this.ctx);
      const masterRack = effectsManager.getOrCreateMasterRack(this.ctx);
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterGain.connect(masterRack.getInputNode());
      masterRack.getOutputNode().connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);
      if (this.graphProcessor) {
        this.wireGraphProcessor();
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch((e) => console.warn("AudioContext resume error:", e));
    }
    return this.ctx;
  }
  graphProcessor = null;
  connectGraphProcessor(processor) {
    this.graphProcessor = processor;
    if (this.ctx) {
      this.wireGraphProcessor();
    }
  }
  wireGraphProcessor() {
    if (!this.ctx || !this.graphProcessor || !this.masterGain || !this.masterAnalyser) return;
    this.graphProcessor.setContext(this.ctx);
    const inNode = this.graphProcessor.getInputNode();
    const outNode = this.graphProcessor.getOutputNode();
    const masterRack = effectsManager.getOrCreateMasterRack(this.ctx);
    if (inNode && outNode) {
      try {
        masterRack.getOutputNode().disconnect();
      } catch {
      }
      try {
        masterRack.getOutputNode().connect(inNode);
        outNode.connect(this.masterAnalyser);
      } catch (err) {
        console.warn("Failed to wire AudioGraphProcessor to master chain:", err);
        masterRack.getOutputNode().connect(this.masterAnalyser);
      }
    }
  }
  getGraphProcessor() {
    return this.graphProcessor;
  }
  /**
   * Connects TimelineModel so timeline edits directly drive audio playback.
   */
  setTimelineModel(model) {
    this.timelineModelRef = model;
    model.subscribe(() => {
      const totalDur = model.getTotalDuration();
      if (totalDur > 0) {
        this.duration = totalDur;
      }
      if (this.isPlaying) {
        this.rescheduleTimeline();
      } else {
        this.notifyTime(this.startOffset, this.duration);
      }
    });
  }
  getTimelineModel() {
    return this.timelineModelRef;
  }
  /**
   * Ensures audio routing nodes exist for a given trackId, mapping to canonical stem IDs.
   */
  ensureTrackNodes(trackId, name) {
    const id = normalizeTrackId(trackId);
    let track = this.tracks.get(id);
    if (!track) {
      const ctx = this.getContext();
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;
      let panNode = null;
      if (ctx.createStereoPanner) {
        panNode = ctx.createStereoPanner();
        panNode.pan.value = 0;
      }
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      const trackRack = effectsManager.getOrCreateTrackRack(id, ctx);
      if (panNode) {
        gainNode.connect(panNode);
        panNode.connect(trackRack.getInputNode());
      } else {
        gainNode.connect(trackRack.getInputNode());
      }
      trackRack.getOutputNode().connect(analyserNode);
      analyserNode.connect(this.masterGain);
      const defaultStemNames = {
        vocals: "Vocals",
        drums: "Drums",
        bass: "Bass",
        other: "Other",
        master: "Master Track"
      };
      const displayName = name && name !== trackId ? name : defaultStemNames[id] || id;
      track = {
        id,
        name: displayName,
        gainNode,
        panNode,
        analyserNode,
        volume: 1,
        muted: false,
        solo: false,
        pan: 0
      };
      this.tracks.set(id, track);
      this.updateEffectiveGains();
    }
    return track;
  }
  /**
   * Decodes raw array buffer using the shared AudioContext.
   */
  async decodeAudio(arrayBuffer) {
    const ctx = this.getContext();
    try {
      const copy = arrayBuffer.slice(0);
      return await ctx.decodeAudioData(copy);
    } catch (err) {
      throw new Error(
        `Web Audio decoding failed: ${err instanceof Error ? err.message : String(err)}. File format may not be supported by this browser.`
      );
    }
  }
  /**
   * Loads an audio track buffer into the engine as the primary or named track.
   */
  loadBuffer(buffer, trackId = "master", name) {
    if (this.isPlaying) {
      this.stop();
    }
    const id = normalizeTrackId(trackId);
    const defaultStemNames = {
      vocals: "Vocals",
      drums: "Drums",
      bass: "Bass",
      other: "Other",
      master: "Master Track"
    };
    const displayName = name || defaultStemNames[id] || id;
    const track = this.ensureTrackNodes(id, displayName);
    track.buffer = buffer;
    track.name = displayName;
    if (this.timelineModelRef && id !== "master") {
      this.timelineModelRef.registerAsset(id, buffer);
    }
    this.updateMaxDuration();
    this.updateEffectiveGains();
    this.notifyTime(this.startOffset, this.duration);
    this.notifyTrackStates();
  }
  removeTrack(trackId) {
    const id = normalizeTrackId(trackId);
    const source = this.activeSources.get(id);
    if (source) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
      }
      this.activeSources.delete(id);
    }
    const track = this.tracks.get(id);
    if (track) {
      try {
        track.gainNode.disconnect();
        track.panNode?.disconnect();
        track.analyserNode?.disconnect();
      } catch {
      }
      this.tracks.delete(id);
    }
    this.updateMaxDuration();
    this.updateEffectiveGains();
    this.notifyTrackStates();
  }
  clearAllTracks() {
    this.stop();
    Array.from(this.tracks.keys()).forEach((id) => this.removeTrack(id));
    this.duration = 0;
    this.startOffset = 0;
    this.notifyTime(0, 0);
    this.notifyTrackStates();
  }
  updateMaxDuration() {
    let max = 0;
    this.tracks.forEach((t) => {
      if (t.buffer && t.buffer.duration > max) max = t.buffer.duration;
    });
    if (this.timelineModelRef) {
      const timelineDur = this.timelineModelRef.getTotalDuration();
      if (timelineDur > max) max = timelineDur;
    }
    this.duration = max;
  }
  /**
   * Starts playback synchronized to the shared audio clock across all tracks and clips.
   */
  play(fromTime) {
    if (this.timelineModelRef && this.timelineModelRef.getAllClips().length > 0) {
      this.playFromTimeline(fromTime);
      return;
    }
    if (this.tracks.size === 0 || this.duration <= 0) return;
    const ctx = this.getContext();
    if (this.isPlaying) {
      this.stopAllActiveSources();
    }
    if (typeof fromTime === "number") {
      this.startOffset = Math.max(0, Math.min(this.duration, fromTime));
    }
    if (this.startOffset >= this.duration - 0.05) {
      this.startOffset = 0;
    }
    this.playbackStartTime = ctx.currentTime;
    this.activeSources.clear();
    this.updateEffectiveGains();
    let primarySource = null;
    for (const track of this.tracks.values()) {
      if (!track.buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.gainNode);
      const offset = this.startOffset;
      const durationRemaining = Math.max(0, track.buffer.duration - offset);
      if (durationRemaining > 0) {
        source.start(0, offset, durationRemaining);
        this.activeSources.set(track.id, source);
        if (!primarySource) {
          primarySource = source;
        }
      }
    }
    this.isPlaying = true;
    this.notifyPlayState(true);
    this.notifyTrackStates();
    if (primarySource) {
      const sourceRef = primarySource;
      sourceRef.onended = () => {
        if (this.isPlaying && this.activeSources.get("master") === sourceRef) {
          const elapsed = ctx.currentTime - this.playbackStartTime;
          if (this.startOffset + elapsed >= this.duration - 0.08) {
            this.stop();
          }
        }
      };
    }
    this.startTicker();
  }
  /**
   * Plays the non-destructive timeline clip arrangement.
   */
  playFromTimeline(fromTime) {
    if (!this.timelineModelRef) return;
    const ctx = this.getContext();
    if (this.isPlaying) {
      this.stopAllActiveSources();
    }
    this.duration = this.timelineModelRef.getTotalDuration();
    if (typeof fromTime === "number") {
      this.startOffset = Math.max(0, Math.min(this.duration, fromTime));
    }
    if (this.startOffset >= this.duration - 0.05) {
      this.startOffset = 0;
    }
    this.playbackStartTime = ctx.currentTime;
    this.activeTimelineSources.clear();
    this.updateEffectiveGains();
    const schedule = this.timelineModelRef.getScheduleForTime(this.startOffset);
    for (const item of schedule) {
      const buffer = this.timelineModelRef.getAsset(item.clip.assetId);
      if (!buffer) continue;
      const trackId = normalizeTrackId(item.trackId);
      const track = this.ensureTrackNodes(trackId);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(track.gainNode);
      const startTime = ctx.currentTime + item.delaySeconds;
      source.start(startTime, item.sourceOffset, item.playDuration);
      this.activeTimelineSources.add(source);
    }
    this.isPlaying = true;
    this.notifyPlayState(true);
    this.notifyTrackStates();
    this.startTicker();
  }
  /**
   * Dynamically reschedules timeline sources when clips are edited while actively playing.
   */
  rescheduleTimeline() {
    if (!this.isPlaying || !this.ctx || !this.timelineModelRef) return;
    const current = this.getCurrentTime();
    this.stopAllActiveSources();
    this.playFromTimeline(current);
  }
  /**
   * Pauses audio playback without losing current position.
   */
  pause() {
    if (!this.isPlaying || !this.ctx) return;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    this.startOffset = Math.min(this.duration, this.startOffset + elapsed);
    this.stopAllActiveSources();
    this.isPlaying = false;
    this.stopTicker();
    this.notifyPlayState(false);
    this.notifyTime(this.startOffset, this.duration);
    this.notifyTrackStates();
  }
  /**
   * Toggles play/pause state safely.
   */
  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }
  /**
   * Stops audio playback and rewinds playhead to 0.
   */
  stop() {
    this.stopAllActiveSources();
    this.isPlaying = false;
    this.startOffset = 0;
    this.stopTicker();
    this.notifyPlayState(false);
    this.notifyTime(0, this.duration);
    this.notifyTrackStates();
  }
  /**
   * Seeks to any position along the timeline.
   */
  seek(time) {
    if (this.duration <= 0) return;
    const clamped = Math.max(0, Math.min(this.duration, time));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.play(clamped);
    } else {
      this.startOffset = clamped;
      this.notifyTime(clamped, this.duration);
      this.notifyTrackStates();
    }
  }
  // -------------------------------------------------------------
  // Multi-Stem & Track Mixer Controls
  // -------------------------------------------------------------
  setTrackVolume(trackId, volume) {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.volume = Math.max(0, Math.min(1.5, volume));
    this.timelineModelRef?.setTrackVolume(id, track.volume);
    this.updateEffectiveGains();
  }
  setTrackMute(trackId, muted) {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.muted = muted !== void 0 ? muted : !track.muted;
    this.timelineModelRef?.setTrackMute(id, track.muted);
    this.updateEffectiveGains();
  }
  setTrackSolo(trackId, solo) {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.solo = solo !== void 0 ? solo : !track.solo;
    this.timelineModelRef?.setTrackSolo(id, track.solo);
    this.updateEffectiveGains();
  }
  setTrackPan(trackId, pan) {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.pan = Math.max(-1, Math.min(1, pan));
    if (track.panNode && this.ctx) {
      track.panNode.pan.setValueAtTime(track.pan, this.ctx.currentTime);
    }
    this.timelineModelRef?.setTrackPan(id, track.pan);
    this.notifyTrackStates();
  }
  /**
   * Directly auditions and plays a specific stem track in sync with the song clock.
   * Solos only this stem and triggers playback from the current position (or fromTime).
   */
  playStem(stemId, fromTime) {
    const id = normalizeTrackId(stemId);
    this.ensureTrackNodes(id);
    for (const [tid, track] of this.tracks.entries()) {
      const isTarget = tid === id;
      track.solo = isTarget;
      this.timelineModelRef?.setTrackSolo(tid, isTarget);
    }
    this.selectStem(id);
    this.updateEffectiveGains();
    const seekTime = typeof fromTime === "number" ? fromTime : this.getCurrentTime();
    if (!this.isPlaying) {
      this.play(seekTime);
    }
  }
  /**
   * Synchronizes stem selection between Timeline and Mixer.
   */
  selectStem(stemId) {
    const id = normalizeTrackId(stemId);
    this.timelineModelRef?.selectTrack(id);
    this.notifyTrackStates();
  }
  setMasterVolume(gain) {
    this.masterVolume = Math.max(0, Math.min(1.5, gain));
    this.applyMasterGain();
    this.notifyTrackStates();
  }
  setMasterMute(muted) {
    this.masterMuted = muted !== void 0 ? muted : !this.masterMuted;
    this.applyMasterGain();
    this.notifyTrackStates();
  }
  getMasterVolume() {
    return this.masterVolume;
  }
  getMasterMute() {
    return this.masterMuted;
  }
  updateEffectiveGains() {
    const hasSolo = Array.from(this.tracks.values()).some((t) => t.solo);
    const currentTime = this.ctx ? this.ctx.currentTime : 0;
    for (const track of this.tracks.values()) {
      let effectiveGain = 0;
      if (hasSolo) {
        effectiveGain = track.solo && !track.muted ? track.volume : 0;
      } else {
        effectiveGain = track.muted ? 0 : track.volume;
      }
      if (this.ctx) {
        track.gainNode.gain.setValueAtTime(effectiveGain, currentTime);
      } else {
        track.gainNode.gain.value = effectiveGain;
      }
    }
    this.notifyTrackStates();
  }
  applyMasterGain() {
    if (this.masterGain && this.ctx) {
      const effective = this.masterMuted ? 0 : this.masterVolume;
      this.masterGain.gain.setValueAtTime(effective, this.ctx.currentTime);
    }
  }
  getTrackStates() {
    const hasSolo = Array.from(this.tracks.values()).some((t) => t.solo);
    const selectedTrackId = this.timelineModelRef?.getSelectedTrackId();
    return Array.from(this.tracks.values()).map((t) => ({
      id: t.id,
      name: t.name,
      duration: t.buffer ? t.buffer.duration : this.duration,
      volume: t.volume,
      muted: t.muted,
      solo: t.solo,
      pan: t.pan,
      isActive: this.isPlaying && (!t.muted && (!hasSolo || t.solo)),
      isSelected: selectedTrackId === t.id
    }));
  }
  getTrackAnalyser(trackId) {
    const id = normalizeTrackId(trackId);
    return this.tracks.get(id)?.analyserNode || null;
  }
  getTrack(trackId) {
    const id = normalizeTrackId(trackId);
    return this.tracks.get(id);
  }
  getAllTracks() {
    return this.tracks;
  }
  stopAllActiveSources() {
    this.activeSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
      }
    });
    this.activeSources.clear();
    this.activeTimelineSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
      }
    });
    this.activeTimelineSources.clear();
  }
  startTicker() {
    this.stopTicker();
    const tick = () => {
      if (this.isPlaying && this.ctx) {
        const elapsed = this.ctx.currentTime - this.playbackStartTime;
        const current = Math.min(this.duration, this.startOffset + elapsed);
        this.notifyTime(current, this.duration);
        if (current >= this.duration) {
          this.stop();
          return;
        }
        this.animFrameId = requestAnimationFrame(tick);
      }
    };
    this.animFrameId = requestAnimationFrame(tick);
  }
  stopTicker() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
  getCurrentTime() {
    if (!this.isPlaying || !this.ctx) return this.startOffset;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    return Math.min(this.duration, this.startOffset + elapsed);
  }
  getDuration() {
    return this.duration;
  }
  getIsPlaying() {
    return this.isPlaying;
  }
  getAnalyser() {
    return this.masterAnalyser;
  }
  onTimeUpdate(cb) {
    this.onTimeUpdateListeners.add(cb);
    return () => this.onTimeUpdateListeners.delete(cb);
  }
  onPlayStateChange(cb) {
    this.onPlayStateListeners.add(cb);
    return () => this.onPlayStateListeners.delete(cb);
  }
  onTrackStatesChange(cb) {
    this.onTrackStatesListeners.add(cb);
    return () => this.onTrackStatesListeners.delete(cb);
  }
  notifyTime(current, duration) {
    this.onTimeUpdateListeners.forEach((cb) => cb(current, duration));
  }
  notifyPlayState(playing) {
    this.onPlayStateListeners.forEach((cb) => cb(playing));
  }
  notifyTrackStates() {
    const states = this.getTrackStates();
    this.onTrackStatesListeners.forEach((cb) => cb(states));
  }
};
var audioEngine = new AudioEngine();

// src/audio/export/AudioExportEngine.ts
var AudioExportEngine = class {
  static effectsInstance = effectsManager;
  static audioEngineInstance = null;
  static setEffectsManager(mgr) {
    this.effectsInstance = mgr;
  }
  static getEffectsManager() {
    return this.effectsInstance || effectsManager;
  }
  static setAudioEngine(engine) {
    this.audioEngineInstance = engine;
  }
  static getAudioEngine() {
    return this.audioEngineInstance;
  }
  /**
   * Main export execution entry point.
   */
  static async exportAudio(options, timeline, remixComposer, engine) {
    const sampleRate = options.sampleRate || 44100;
    const bitDepth = options.bitDepth || 16;
    const format = options.format || "wav";
    const activeEngine = engine || options.engine || this.getAudioEngine();
    let renderedBuffer;
    let baseFilename = options.filename || "AudioWeave_Project";
    if (options.target === "full_mix") {
      let clips = timeline.getAllClips();
      if (options.includedStems && options.includedStems.length > 0) {
        const allowed = new Set(options.includedStems);
        clips = clips.filter((c) => allowed.has(c.assetId) || allowed.has(c.trackId));
      }
      renderedBuffer = await this.renderTimelineClips(
        clips,
        timeline,
        sampleRate,
        options.regionStart,
        options.regionEnd,
        activeEngine
      );
      baseFilename += "_FullMix";
    } else if (options.target === "selected_track" && options.selectedTrackId) {
      const trackClips = timeline.getTrackClips(options.selectedTrackId);
      renderedBuffer = await this.renderTimelineClips(
        trackClips,
        timeline,
        sampleRate,
        options.regionStart,
        options.regionEnd,
        activeEngine
      );
      baseFilename += `_${options.selectedTrackId}`;
    } else if (options.target === "selected_region") {
      let clips = timeline.getAllClips();
      if (options.includedStems && options.includedStems.length > 0) {
        const allowed = new Set(options.includedStems);
        clips = clips.filter((c) => allowed.has(c.assetId) || allowed.has(c.trackId));
      }
      const start = options.regionStart ?? 0;
      const end = options.regionEnd ?? timeline.getTotalDuration();
      renderedBuffer = await this.renderTimelineClips(
        clips,
        timeline,
        sampleRate,
        start,
        end,
        activeEngine
      );
      baseFilename += `_Region_${start.toFixed(1)}s-${end.toFixed(1)}s`;
    } else if (options.target === "arrangement" && remixComposer) {
      const arr = remixComposer.getActiveArrangement();
      if (!arr || arr.blocks.length === 0) {
        throw new Error("Export failed: Active remix arrangement has no sections to render.");
      }
      const stemTrackMap = {
        vocals: "vocals",
        drums: "drums",
        bass: "bass",
        other: "other"
      };
      const stems = ["vocals", "drums", "bass", "other"];
      const hasStems = stems.some((s) => timeline.hasAsset(s));
      const arrangementClips = [];
      for (const block of arr.blocks) {
        if (hasStems) {
          for (const stem of stems) {
            if (block.activeStems[stem] && timeline.hasAsset(stem)) {
              if (!options.includedStems || options.includedStems.includes(stem)) {
                arrangementClips.push({
                  id: `arr-clip-${stem}-${block.id}`,
                  trackId: stemTrackMap[stem] || "vocals",
                  assetId: stem,
                  name: `${block.name} (${stem.toUpperCase()})`,
                  startOffset: block.timelineStart,
                  duration: block.duration,
                  sourceOffset: block.sourceStart,
                  color: block.color || "#3b82f6"
                });
              }
            }
          }
        } else {
          const registered = timeline.getRegisteredAssetIds();
          const fallbackId = registered.length > 0 ? registered[0] : "master";
          arrangementClips.push({
            id: `arr-clip-stereo-${block.id}`,
            trackId: "vocals",
            assetId: fallbackId,
            name: `${block.name} (Stereo)`,
            startOffset: block.timelineStart,
            duration: block.duration,
            sourceOffset: block.sourceStart,
            color: block.color || "#3b82f6"
          });
        }
      }
      const arrDuration = remixComposer.getArrangementDuration();
      renderedBuffer = await this.renderTimelineClips(
        arrangementClips,
        timeline,
        sampleRate,
        options.regionStart,
        options.regionEnd ?? arrDuration,
        activeEngine
      );
      baseFilename += `_${arr.name.replace(/\s+/g, "_")}`;
    } else {
      renderedBuffer = await this.renderTimelineClips(
        timeline.getAllClips(),
        timeline,
        sampleRate,
        void 0,
        void 0,
        activeEngine
      );
      baseFilename += "_Mix";
    }
    let finalBlob = this.encodeWav(renderedBuffer, bitDepth);
    let finalExt = "wav";
    if (format === "mp3") {
      try {
        finalBlob = await this.convertWavToMp3(finalBlob, options.mp3Bitrate || "320k");
        finalExt = "mp3";
      } catch (err) {
        console.warn("Backend MP3 conversion failed, falling back to 16-bit WAV:", err);
      }
    }
    const outputFilename = `${baseFilename}.${finalExt}`;
    const validation = await this.validateExportBlob(finalBlob, renderedBuffer.duration, sampleRate);
    return {
      blob: finalBlob,
      filename: outputFilename,
      validation
    };
  }
  /**
   * Renders a synchronized multi-track arrangement into an AudioBuffer using OfflineAudioContext.
   * Utilizes the identical Web Audio node graph as real-time playback:
   * Source -> Track Gain (Volume, Mute, Solo) -> Track Panner -> Track EffectsRack -> Master Gain -> Master EffectsRack -> Destination
   */
  static async renderTimelineClips(clips, timeline, sampleRate, regionStart, regionEnd, engine) {
    const totalDuration = timeline.getTotalDuration();
    const start = Math.max(0, regionStart ?? 0);
    const end = regionEnd !== void 0 ? regionEnd : totalDuration;
    const renderDuration = Math.max(0.1, end - start);
    const totalFrames = Math.ceil(renderDuration * sampleRate);
    const OfflineCtxClass = typeof window !== "undefined" && (window.OfflineAudioContext || window.webkitOfflineAudioContext) || typeof globalThis !== "undefined" && globalThis.OfflineAudioContext;
    if (!OfflineCtxClass) {
      throw new Error("OfflineAudioContext is not supported in this environment.");
    }
    const offlineCtx = new OfflineCtxClass(2, totalFrames, sampleRate);
    const activeEngine = engine || this.getAudioEngine();
    const masterVolume = activeEngine && typeof activeEngine.getMasterVolume === "function" ? activeEngine.getMasterVolume() : 1;
    const masterMuted = activeEngine && typeof activeEngine.getMasterMute === "function" ? activeEngine.getMasterMute() : false;
    const effectiveMasterGain = masterMuted ? 0 : Math.max(0, Math.min(1.5, masterVolume));
    const masterGainNode = offlineCtx.createGain();
    masterGainNode.gain.value = effectiveMasterGain;
    const masterEffectsSettings = this.getEffectsManager().getMasterSettings();
    const masterRack = new EffectsRack(offlineCtx, masterEffectsSettings);
    masterGainNode.connect(masterRack.getInputNode());
    masterRack.getOutputNode().connect(offlineCtx.destination);
    const trackMixerMap = /* @__PURE__ */ new Map();
    for (const t of timeline.getTracks()) {
      trackMixerMap.set(t.id, {
        volume: typeof t.volume === "number" ? t.volume : 1,
        pan: typeof t.pan === "number" ? t.pan : 0,
        muted: !!t.muted,
        solo: !!t.solo
      });
    }
    if (activeEngine && typeof activeEngine.getTrackStates === "function") {
      const states = activeEngine.getTrackStates();
      for (const st of states) {
        trackMixerMap.set(st.id, {
          volume: typeof st.volume === "number" ? st.volume : 1,
          pan: typeof st.pan === "number" ? st.pan : 0,
          muted: !!st.muted,
          solo: !!st.solo
        });
      }
    }
    const hasSolo = Array.from(trackMixerMap.values()).some((t) => t.solo);
    const trackChains = /* @__PURE__ */ new Map();
    const getOrCreateTrackChain = (trackId) => {
      let chain = trackChains.get(trackId);
      if (!chain) {
        const info = trackMixerMap.get(trackId) || { volume: 1, pan: 0, muted: false, solo: false };
        let effectiveGain = 0;
        if (hasSolo) {
          effectiveGain = info.solo && !info.muted ? info.volume : 0;
        } else {
          effectiveGain = info.muted ? 0 : info.volume;
        }
        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = Math.max(0, Math.min(1.5, effectiveGain));
        let panNode = null;
        if (typeof offlineCtx.createStereoPanner === "function") {
          const p = offlineCtx.createStereoPanner();
          p.pan.value = Math.max(-1, Math.min(1, info.pan));
          panNode = p;
        }
        const trackRack = new EffectsRack(offlineCtx, this.getEffectsManager().getTrackSettings(trackId));
        if (panNode) {
          gainNode.connect(panNode);
          panNode.connect(trackRack.getInputNode());
        } else {
          gainNode.connect(trackRack.getInputNode());
        }
        trackRack.getOutputNode().connect(masterGainNode);
        chain = { gainNode, panNode, effectsRack: trackRack };
        trackChains.set(trackId, chain);
      }
      return chain;
    };
    for (const clip of clips) {
      const clipEnd = clip.startOffset + clip.duration;
      if (clipEnd <= start || clip.startOffset >= end) continue;
      const buffer = timeline.getAsset(clip.assetId);
      if (!buffer) {
        console.warn(`Export warning: Asset "${clip.assetId}" for clip "${clip.name}" not found in timeline.`);
        continue;
      }
      const clipStartInRender = Math.max(0, clip.startOffset - start);
      const offsetIntoClip = start > clip.startOffset ? start - clip.startOffset : 0;
      const sourceOffset = clip.sourceOffset + offsetIntoClip;
      const playDuration = Math.min(clip.duration - offsetIntoClip, end - (clip.startOffset + offsetIntoClip));
      if (playDuration > 0) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        const chain = getOrCreateTrackChain(clip.trackId);
        source.connect(chain.gainNode);
        source.start(clipStartInRender, sourceOffset, playDuration);
      }
    }
    return offlineCtx.startRendering();
  }
  /**
   * Exports all 4 Demucs stems into individual synchronized WAV blobs.
   */
  static async exportStemSet(timeline, sampleRate = 44100, bitDepth = 16, engine) {
    const trackMapping = [
      { id: "vocals", stem: "vocals" },
      { id: "drums", stem: "drums" },
      { id: "bass", stem: "bass" },
      { id: "other", stem: "other" }
    ];
    const results = {};
    for (const item of trackMapping) {
      const clips = timeline.getTrackClips(item.id);
      const rendered = await this.renderTimelineClips(clips, timeline, sampleRate, void 0, void 0, engine);
      const blob = this.encodeWav(rendered, bitDepth);
      const filename = `AudioWeave_Stem_${item.stem.toUpperCase()}_${sampleRate}Hz.wav`;
      const validation = await this.validateExportBlob(blob, rendered.duration, sampleRate);
      results[item.stem] = {
        blob,
        filename,
        validation
      };
    }
    return results;
  }
  /**
   * Encodes an AudioBuffer into 16-bit or 24-bit PCM WAV format.
   */
  static encodeWav(buffer, bitDepth = 16) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = buffer.length * blockAlign;
    const bufferArray = new ArrayBuffer(44 + dataSize);
    const view = new DataView(bufferArray);
    const writeString = (offset2, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset2 + i, str.charCodeAt(i));
      }
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;
    let offset = 44;
    if (bitDepth === 16) {
      for (let i = 0; i < buffer.length; i++) {
        const s0 = Math.max(-1, Math.min(1, ch0[i]));
        const s1 = Math.max(-1, Math.min(1, ch1[i]));
        view.setInt16(offset, s0 < 0 ? s0 * 32768 : s0 * 32767, true);
        view.setInt16(offset + 2, s1 < 0 ? s1 * 32768 : s1 * 32767, true);
        offset += 4;
      }
    } else {
      for (let i = 0; i < buffer.length; i++) {
        const s0 = Math.max(-1, Math.min(1, ch0[i]));
        const s1 = Math.max(-1, Math.min(1, ch1[i]));
        const v0 = s0 < 0 ? Math.floor(s0 * 8388608) : Math.floor(s0 * 8388607);
        const v1 = s1 < 0 ? Math.floor(s1 * 8388608) : Math.floor(s1 * 8388607);
        view.setUint8(offset, v0 & 255);
        view.setUint8(offset + 1, v0 >> 8 & 255);
        view.setUint8(offset + 2, v0 >> 16 & 255);
        view.setUint8(offset + 3, v1 & 255);
        view.setUint8(offset + 4, v1 >> 8 & 255);
        view.setUint8(offset + 5, v1 >> 16 & 255);
        offset += 6;
      }
    }
    return new Blob([view], { type: "audio/wav" });
  }
  /**
   * Sends rendered WAV blob to backend for high-quality MP3 encoding via FFmpeg.
   */
  static async convertWavToMp3(wavBlob, bitrate = "320k") {
    const formData = new FormData();
    formData.append("file", wavBlob, "temp_render.wav");
    const res = await fetch(`/api/audio/export/mp3?bitrate=${bitrate}`, {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      throw new Error(`MP3 conversion server error: ${res.statusText}`);
    }
    return res.blob();
  }
  /**
   * Validates exported file by re-decoding it and verifying technical audio integrity.
   */
  static async validateExportBlob(blob, expectedDuration, expectedSampleRate) {
    if (blob.size <= 44) {
      return {
        isValid: false,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        maxPeak: 0,
        error: "Exported file is empty or corrupted (size <= 44 bytes)."
      };
    }
    try {
      const arrayBuffer = await blob.arrayBuffer();
      if (blob.type.includes("wav")) {
        const view = new DataView(arrayBuffer);
        const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
        if (riff !== "RIFF" || wave !== "WAVE") {
          return {
            isValid: false,
            duration: 0,
            sampleRate: 0,
            channels: 0,
            maxPeak: 0,
            error: "Invalid RIFF/WAVE header structure."
          };
        }
        const channels = view.getUint16(22, true);
        const sampleRate = view.getUint32(24, true);
        const bitDepth = view.getUint16(34, true);
        const dataSize = view.getUint32(40, true);
        const bytesPerSample = bitDepth / 8;
        const frames = dataSize / (channels * bytesPerSample);
        const duration = frames / sampleRate;
        let maxPeak = 0;
        const sampleOffset = 44;
        const numCheckPoints = Math.min(frames, 5e3);
        const step = Math.max(1, Math.floor(frames / numCheckPoints));
        for (let i = 0; i < frames; i += step) {
          let s = 0;
          if (bitDepth === 16) {
            s = Math.abs(view.getInt16(sampleOffset + i * channels * 2, true) / 32768);
          } else if (bitDepth === 24) {
            const b0 = view.getUint8(sampleOffset + i * channels * 3);
            const b1 = view.getUint8(sampleOffset + i * channels * 3 + 1);
            const b2 = view.getUint8(sampleOffset + i * channels * 3 + 2);
            let val = b2 << 16 | b1 << 8 | b0;
            if (val & 8388608) val |= ~16777215;
            s = Math.abs(val / 8388608);
          }
          if (s > maxPeak) maxPeak = s;
        }
        const durationMatch = Math.abs(duration - expectedDuration) < 0.15;
        const sampleRateMatch = sampleRate === expectedSampleRate;
        return {
          isValid: durationMatch && sampleRateMatch,
          duration: Number(duration.toFixed(3)),
          sampleRate,
          channels,
          maxPeak: Number(maxPeak.toFixed(4)),
          error: !durationMatch ? `Duration mismatch: expected ${expectedDuration.toFixed(1)}s, got ${duration.toFixed(1)}s` : !sampleRateMatch ? `Sample rate mismatch: expected ${expectedSampleRate}Hz, got ${sampleRate}Hz` : void 0
        };
      }
      return {
        isValid: blob.size > 1e3,
        duration: Number(expectedDuration.toFixed(3)),
        sampleRate: expectedSampleRate,
        channels: 2,
        maxPeak: 1
      };
    } catch (err) {
      return {
        isValid: false,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        maxPeak: 0,
        error: `Audio re-decoding validation failed: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  /**
   * Triggers client-side browser download of rendered audio blob.
   */
  static triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

// src/audio/project/ProjectManager.ts
var ProjectManager = class {
  currentProjectId = "proj-default";
  currentProjectName = "Untitled Session";
  lastSavedTime = Date.now();
  autoSaveTimer = null;
  listeners = /* @__PURE__ */ new Set();
  timeline;
  routingGraph;
  remixComposer;
  engine;
  storage;
  effects;
  // Additional persisted session state
  currentAnalysis = null;
  activeStemSetName = null;
  activeAssetId = null;
  constructor(timeline = timelineModel, routingGraph = audioGraphModel, remixComposer = remixComposerModel, engine = audioEngine, storage = assetStorage, effects = effectsManager) {
    this.timeline = timeline;
    this.routingGraph = routingGraph;
    this.remixComposer = remixComposer;
    this.engine = engine;
    this.storage = storage;
    this.effects = effects;
    this.startAutoSave();
  }
  setEffectsManager(effects) {
    this.effects = effects;
  }
  getEffectsManager() {
    return this.effects;
  }
  getCurrentProjectId() {
    return this.currentProjectId;
  }
  getCurrentProjectName() {
    return this.currentProjectName;
  }
  getLastSavedTime() {
    return this.lastSavedTime;
  }
  getAnalysisResult() {
    return this.currentAnalysis;
  }
  setAnalysisResult(analysis) {
    this.currentAnalysis = analysis;
    this.notify();
  }
  getActiveStemSetName() {
    return this.activeStemSetName;
  }
  setActiveStemSetName(name) {
    this.activeStemSetName = name;
    this.notify();
  }
  getActiveAssetId() {
    return this.activeAssetId;
  }
  setActiveAssetId(id) {
    this.activeAssetId = id;
    this.notify();
  }
  // -------------------------------------------------------------
  // Bundle Current State into Versioned Project Schema
  // -------------------------------------------------------------
  captureCurrentState() {
    const tracks = this.timeline.getTracks();
    const clips = this.timeline.getAllClips();
    const routingJson = this.routingGraph.toJSON();
    const activeArr = this.remixComposer.getActiveArrangement();
    const allArrangements = this.remixComposer.getAllArrangements();
    const detectedSections = this.remixComposer.getDetectedSections();
    const trackMixerSettings = {};
    for (const t of tracks) {
      const engTrack = this.engine.getTrack(t.id);
      trackMixerSettings[t.id] = {
        volume: engTrack !== void 0 ? engTrack.volume : t.volume,
        pan: engTrack !== void 0 ? engTrack.pan : t.pan,
        muted: engTrack !== void 0 ? engTrack.muted : t.muted,
        solo: engTrack !== void 0 ? engTrack.solo : t.solo
      };
    }
    const assetSet = /* @__PURE__ */ new Set();
    for (const c of clips) {
      if (c.assetId) assetSet.add(c.assetId);
    }
    if (this.activeAssetId) assetSet.add(this.activeAssetId);
    if (this.activeStemSetName) {
      for (const stem of ["vocals", "drums", "bass", "other"]) {
        assetSet.add(stem);
      }
    }
    const metadata = {
      id: this.currentProjectId,
      name: this.currentProjectName,
      schemaVersion: "2.0.0",
      createdAt: this.currentProjectId === "proj-default" ? Date.now() : Date.now(),
      updatedAt: Date.now(),
      bpm: activeArr?.bpm || this.currentAnalysis?.bpm || 120,
      timeSignature: [4, 4],
      duration: this.timeline.getTotalDuration()
    };
    return {
      metadata,
      tracks,
      clips,
      mixer: {
        tracks: trackMixerSettings,
        master: {
          volume: this.engine.getMasterVolume(),
          muted: this.engine.getMasterMute()
        }
      },
      routingGraph: routingJson,
      remixComposer: {
        detectedSections,
        arrangements: allArrangements,
        activeArrangementId: activeArr?.id || "arr-default"
      },
      effects: this.effects.toJSON(),
      analysis: this.currentAnalysis,
      activeStemSetName: this.activeStemSetName,
      activeAssetId: this.activeAssetId,
      assetReferences: Array.from(assetSet)
    };
  }
  // -------------------------------------------------------------
  // Apply Project State to All Models and Audio Engine
  // -------------------------------------------------------------
  applyState(project) {
    this.currentProjectId = project.metadata.id;
    this.currentProjectName = project.metadata.name;
    this.lastSavedTime = project.metadata.updatedAt;
    this.timeline.clearAll();
    for (const track of project.tracks) {
      this.timeline.addTrack(track);
    }
    for (const clip of project.clips) {
      this.timeline.addClip(clip, false);
    }
    if (project.routingGraph) {
      this.routingGraph.fromJSON(project.routingGraph);
    }
    if (project.remixComposer) {
      this.remixComposer.setDetectedSections(project.remixComposer.detectedSections || []);
      if (project.remixComposer.arrangements && project.remixComposer.arrangements.length > 0) {
        if (typeof this.remixComposer.setArrangements === "function") {
          this.remixComposer.setArrangements(project.remixComposer.arrangements);
        } else {
          for (const arr of project.remixComposer.arrangements) {
            if (!this.remixComposer.getAllArrangements().some((a) => a.id === arr.id)) {
              this.remixComposer.createArrangement(arr.name, "empty");
            }
          }
        }
        if (project.remixComposer.activeArrangementId) {
          this.remixComposer.selectArrangement(project.remixComposer.activeArrangementId);
        }
      }
    }
    if (project.mixer) {
      for (const [trackId, settings] of Object.entries(project.mixer.tracks || {})) {
        this.engine.setTrackVolume(trackId, settings.volume);
        this.engine.setTrackPan(trackId, settings.pan);
        this.engine.setTrackMute(trackId, settings.muted);
        this.engine.setTrackSolo(trackId, settings.solo);
        this.timeline.updateTrack(trackId, {
          volume: settings.volume,
          pan: settings.pan,
          muted: settings.muted,
          solo: settings.solo
        });
      }
      if (project.mixer.master) {
        this.engine.setMasterVolume(project.mixer.master.volume);
        this.engine.setMasterMute(project.mixer.master.muted);
      }
    }
    if (project.effects) {
      this.effects.fromJSON(project.effects);
    }
    this.currentAnalysis = project.analysis || null;
    this.activeStemSetName = project.activeStemSetName || null;
    this.activeAssetId = project.activeAssetId || null;
    this.notify();
  }
  // -------------------------------------------------------------
  // Project Actions
  // -------------------------------------------------------------
  newProject(name = "Untitled Session") {
    this.currentProjectId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    this.currentProjectName = name;
    this.lastSavedTime = Date.now();
    this.currentAnalysis = null;
    this.activeStemSetName = null;
    this.activeAssetId = null;
    this.timeline.clearAll();
    this.routingGraph.initDefaultGraph();
    this.effects.clear();
    this.engine.stop();
    this.notify();
  }
  async saveProject() {
    const state = this.captureCurrentState();
    state.metadata.updatedAt = Date.now();
    this.lastSavedTime = state.metadata.updatedAt;
    for (const assetId of state.assetReferences) {
      try {
        const hasBinary = await this.storage.hasAssetBinary(assetId);
        if (!hasBinary) {
          const inMemoryBuffer = this.timeline.getAsset(assetId);
          if (inMemoryBuffer) {
            const wavBlob = AudioExportEngine.encodeWav(inMemoryBuffer, 16);
            const rawBytes = await wavBlob.arrayBuffer();
            const existingAsset = await this.storage.getAsset(assetId);
            const assetToSave = existingAsset || {
              id: assetId,
              filename: `${assetId}.wav`,
              stored_filename: `${assetId}.wav`,
              stream_url: "",
              metadata: {
                filename: `${assetId}.wav`,
                format: "WAV",
                subtype: "PCM_16",
                duration_seconds: inMemoryBuffer.duration,
                duration_formatted: `${Math.floor(inMemoryBuffer.duration / 60)}:${Math.floor(inMemoryBuffer.duration % 60).toString().padStart(2, "0")}`,
                sample_rate: inMemoryBuffer.sampleRate,
                channels: inMemoryBuffer.numberOfChannels,
                channel_type: inMemoryBuffer.numberOfChannels === 2 ? "Stereo" : "Mono",
                frames: inMemoryBuffer.length,
                file_size_bytes: rawBytes.byteLength,
                file_size_formatted: `${(rawBytes.byteLength / (1024 * 1024)).toFixed(2)} MB`
              },
              peaks: [],
              rms: [],
              max_peak: 1,
              createdAt: Date.now()
            };
            await this.storage.saveAsset(assetToSave, rawBytes);
          }
        }
      } catch (err) {
        console.warn(`Could not persist binary for asset ${assetId}:`, err);
      }
    }
    await this.storage.saveProject(state);
    await this.storage.clearAutoSave();
    this.notify();
    return state;
  }
  async saveAs(newName) {
    const newId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    this.currentProjectId = newId;
    this.currentProjectName = newName;
    return this.saveProject();
  }
  async openProject(projectId) {
    const state = await this.storage.getProject(projectId);
    if (!state) {
      return {
        success: false,
        projectId,
        projectName: "",
        restoredClipsCount: 0,
        restoredAssetsCount: 0,
        missingAssets: [],
        corruptedAssets: [],
        analysisRestored: false,
        effectsRestored: false,
        mixerRestored: false,
        error: `Project with ID ${projectId} not found in IndexedDB`
      };
    }
    this.engine.stop();
    this.applyState(state);
    const assetIds = new Set(state.assetReferences || []);
    for (const clip of state.clips) {
      if (clip.assetId) assetIds.add(clip.assetId);
    }
    if (state.activeAssetId) assetIds.add(state.activeAssetId);
    const restoredAssetIds = [];
    const missingAssets = [];
    const corruptedAssets = [];
    for (const assetId of assetIds) {
      const expectedDuration = this.getExpectedAssetDuration(assetId, state.clips);
      try {
        const rawBytes = await this.storage.getAssetBinary(assetId);
        if (!rawBytes || rawBytes.byteLength === 0) {
          missingAssets.push(assetId);
          const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
          this.timeline.registerAsset(assetId, placeholder);
          if (["vocals", "drums", "bass", "other"].includes(assetId)) {
            this.engine.loadBuffer(placeholder, assetId, assetId.toUpperCase());
          }
          continue;
        }
        try {
          const decoded = await this.engine.decodeAudio(rawBytes);
          this.timeline.registerAsset(assetId, decoded);
          if (["vocals", "drums", "bass", "other"].includes(assetId)) {
            this.engine.loadBuffer(decoded, assetId, assetId.toUpperCase());
          }
          restoredAssetIds.push(assetId);
        } catch (decodeErr) {
          console.warn(`Corrupted audio binary for asset ${assetId}:`, decodeErr);
          corruptedAssets.push(assetId);
          const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
          this.timeline.registerAsset(assetId, placeholder);
          if (["vocals", "drums", "bass", "other"].includes(assetId)) {
            this.engine.loadBuffer(placeholder, assetId, assetId.toUpperCase());
          }
        }
      } catch (err) {
        missingAssets.push(assetId);
        const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
        this.timeline.registerAsset(assetId, placeholder);
      }
    }
    this.notify();
    return {
      success: true,
      projectId: state.metadata.id,
      projectName: state.metadata.name,
      restoredClipsCount: state.clips.length,
      restoredAssetsCount: restoredAssetIds.length,
      missingAssets,
      corruptedAssets,
      analysisRestored: !!state.analysis,
      effectsRestored: !!state.effects,
      mixerRestored: !!state.mixer
    };
  }
  createSilentPlaceholderBuffer(durationSec, sampleRate = 44100) {
    const safeDur = Math.max(0.5, durationSec || 10);
    const length = Math.ceil(safeDur * sampleRate);
    const ctx = this.engine.getContext();
    if (ctx && typeof ctx.createBuffer === "function") {
      return ctx.createBuffer(2, length, sampleRate);
    }
    const ch0 = new Float32Array(length);
    const ch1 = new Float32Array(length);
    return {
      numberOfChannels: 2,
      length,
      sampleRate,
      duration: safeDur,
      getChannelData: (ch) => ch === 1 ? ch1 : ch0,
      copyFromChannel: () => {
      },
      copyToChannel: () => {
      }
    };
  }
  getExpectedAssetDuration(assetId, clips) {
    let max = 0;
    for (const c of clips) {
      if (c.assetId === assetId) {
        const span = c.sourceOffset + c.duration;
        if (span > max) max = span;
      }
    }
    return max > 0 ? max : 15;
  }
  async renameProject(newName) {
    this.currentProjectName = newName;
    await this.saveProject();
  }
  async deleteProject(projectId) {
    await this.storage.deleteProject(projectId);
    if (this.currentProjectId === projectId) {
      this.newProject("Untitled Session");
    }
  }
  async listProjects() {
    return this.storage.getAllProjects();
  }
  // -------------------------------------------------------------
  // Auto-Save & Crash Recovery
  // -------------------------------------------------------------
  startAutoSave(intervalMs = 3e4) {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(async () => {
      try {
        if (this.timeline.getAllClips().length > 0) {
          const state = this.captureCurrentState();
          await this.storage.saveAutoSave(state);
        }
      } catch (err) {
        console.warn("Auto-save snapshot error:", err);
      }
    }, intervalMs);
    if (this.autoSaveTimer && typeof this.autoSaveTimer.unref === "function") {
      this.autoSaveTimer.unref();
    }
  }
  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
  async checkRecovery() {
    try {
      const autoSave = await this.storage.getAutoSave();
      if (!autoSave) return null;
      if (autoSave.savedAt > this.lastSavedTime + 5e3) {
        return autoSave.project;
      }
      return null;
    } catch {
      return null;
    }
  }
  async recoverProject(state) {
    this.applyState(state);
    const assetIds = new Set(state.assetReferences || []);
    for (const clip of state.clips) {
      if (clip.assetId) assetIds.add(clip.assetId);
    }
    if (state.activeAssetId) assetIds.add(state.activeAssetId);
    const restoredAssetIds = [];
    const missingAssets = [];
    const corruptedAssets = [];
    for (const assetId of assetIds) {
      const expectedDuration = this.getExpectedAssetDuration(assetId, state.clips);
      try {
        const rawBytes = await this.storage.getAssetBinary(assetId);
        if (rawBytes) {
          const decoded = await this.engine.decodeAudio(rawBytes);
          this.timeline.registerAsset(assetId, decoded);
          if (["vocals", "drums", "bass", "other"].includes(assetId)) {
            this.engine.loadBuffer(decoded, assetId, assetId.toUpperCase());
          }
          restoredAssetIds.push(assetId);
        } else {
          missingAssets.push(assetId);
          const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
          this.timeline.registerAsset(assetId, placeholder);
        }
      } catch {
        corruptedAssets.push(assetId);
        const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
        this.timeline.registerAsset(assetId, placeholder);
      }
    }
    await this.storage.clearAutoSave();
    this.notify();
    return {
      success: true,
      projectId: state.metadata.id,
      projectName: state.metadata.name,
      restoredClipsCount: state.clips.length,
      restoredAssetsCount: restoredAssetIds.length,
      missingAssets,
      corruptedAssets,
      analysisRestored: !!state.analysis,
      effectsRestored: !!state.effects,
      mixerRestored: !!state.mixer
    };
  }
  async dismissRecovery() {
    await this.storage.clearAutoSave();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    this.listeners.forEach((cb) => cb());
  }
};
var projectManager = new ProjectManager();
export {
  ProjectManager,
  projectManager
};
