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
export {
  EffectsManager,
  effectsManager
};
