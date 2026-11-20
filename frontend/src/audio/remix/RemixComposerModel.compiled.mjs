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
export {
  RemixComposerModel,
  remixComposerModel
};
