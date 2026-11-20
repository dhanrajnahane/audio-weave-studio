import { AudioClip, Track, PlaybackScheduleItem } from './types';
import { TimelineIntervalTree } from './IntervalTree';
import { ClipLinkedList, ClipNode } from './ClipLinkedList';
import { UndoRedoStack } from './UndoRedoStack';

export { TimelineIntervalTree };
export { ClipLinkedList, ClipNode };
export { UndoRedoStack };

export const STEM_TRACK_IDS = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemTrackId = typeof STEM_TRACK_IDS[number];

/**
 * Normalizes any legacy or alias track identifier to the canonical stem track ID.
 * track-1 / track 1 / vocals -> vocals
 * track-2 / track 2 / drums  -> drums
 * track-3 / track 3 / bass   -> bass
 * track-4 / track 4 / other  -> other
 */
export function normalizeTrackId(id: string): string {
  if (!id) return id;
  const lower = id.toLowerCase().trim();
  if (lower === 'track-1' || lower === 'track 1' || lower === 'vocals' || lower === 'vocal') return 'vocals';
  if (lower === 'track-2' || lower === 'track 2' || lower === 'drums' || lower === 'drum') return 'drums';
  if (lower === 'track-3' || lower === 'track 3' || lower === 'bass') return 'bass';
  if (lower === 'track-4' || lower === 'track 4' || lower === 'other') return 'other';
  return id;
}

type ChangeListener = () => void;

/**
 * Non-Destructive Multi-Track Timeline Editor Core.
 * Combines 4 Classical Data Structures:
 * - Doubly Linked List: per-track chronological clip sequence and adjacent snap relationships.
 * - Hash Maps: O(1) clip, track, and source asset retrieval by unique ID.
 * - Augmented Interval Tree: timeline intersection, point queries, and overlap collision detection.
 * - Double Stack: persistent undo and redo editing command history.
 */
export class TimelineModel {
  // Hash Maps (O(1) retrieval)
  private clipsMap: Map<string, AudioClip> = new Map();
  private tracksMap: Map<string, Track> = new Map();
  private assetsMap: Map<string, AudioBuffer> = new Map();

  // Doubly Linked List (Ordered sequence per track)
  private trackLists: Map<string, ClipLinkedList> = new Map();

  // Augmented Interval Tree (1D Range queries)
  private intervalTree: TimelineIntervalTree = new TimelineIntervalTree();

  // Undo / Redo History (Double Stack)
  private history: UndoRedoStack = new UndoRedoStack();

  // Selection & UI State
  private selectedClipIds: Set<string> = new Set();
  private selectedTrackId: string | null = null;
  private listeners: Set<ChangeListener> = new Set();

  constructor() {
    this.initDefaultTracks();
  }

  private initDefaultTracks(): void {
    const defaultTracks: Track[] = [
      { id: 'vocals', name: 'Vocals', color: '#06b6d4', muted: false, solo: false, volume: 1.0, pan: 0.0 },
      { id: 'drums', name: 'Drums', color: '#f59e0b', muted: false, solo: false, volume: 1.0, pan: 0.0 },
      { id: 'bass', name: 'Bass', color: '#a855f7', muted: false, solo: false, volume: 1.0, pan: 0.0 },
      { id: 'other', name: 'Other', color: '#10b981', muted: false, solo: false, volume: 1.0, pan: 0.0 },
    ];

    defaultTracks.forEach((t) => {
      this.tracksMap.set(t.id, t);
      this.trackLists.set(t.id, new ClipLinkedList());
    });
  }

  // -------------------------------------------------------------
  // Asset Management (Preserves original AudioBuffer in entirety)
  // -------------------------------------------------------------

  registerAsset(assetId: string, buffer: AudioBuffer): void {
    this.assetsMap.set(assetId, buffer);
  }

  getAsset(assetId: string): AudioBuffer | undefined {
    if (this.assetsMap.has(assetId)) {
      return this.assetsMap.get(assetId);
    }
    const normalized = normalizeTrackId(assetId);
    if (this.assetsMap.has(normalized)) {
      return this.assetsMap.get(normalized);
    }
    for (const [key, buf] of this.assetsMap.entries()) {
      if (key.includes(normalized) || normalized.includes(key)) {
        return buf;
      }
    }
    return undefined;
  }

  hasAsset(assetId: string): boolean {
    return this.assetsMap.has(assetId);
  }

  getRegisteredAssetIds(): string[] {
    return Array.from(this.assetsMap.keys());
  }

  // -------------------------------------------------------------
  // Track Management
  // -------------------------------------------------------------

  getTracks(): Track[] {
    return Array.from(this.tracksMap.values());
  }

  getTrack(trackId: string): Track | undefined {
    const normalized = normalizeTrackId(trackId);
    return this.tracksMap.get(normalized) || this.tracksMap.get(trackId);
  }

  addTrack(track: Track): void {
    const normalizedId = normalizeTrackId(track.id);
    const normalizedTrack: Track = { ...track, id: normalizedId };
    this.tracksMap.set(normalizedId, normalizedTrack);
    if (!this.trackLists.has(normalizedId)) {
      this.trackLists.set(normalizedId, new ClipLinkedList());
    }
    this.notify();
  }

  updateTrack(trackId: string, updates: Partial<Track>): void {
    const normalized = normalizeTrackId(trackId);
    const track = this.tracksMap.get(normalized) || this.tracksMap.get(trackId);
    if (track) {
      this.tracksMap.set(track.id, { ...track, ...updates });
      this.notify();
    }
  }

  setTrackVolume(trackId: string, volume: number): void {
    this.updateTrack(trackId, { volume });
  }

  setTrackPan(trackId: string, pan: number): void {
    this.updateTrack(trackId, { pan });
  }

  setTrackMute(trackId: string, muted: boolean): void {
    this.updateTrack(trackId, { muted });
  }

  setTrackSolo(trackId: string, solo: boolean): void {
    this.updateTrack(trackId, { solo });
  }

  selectTrack(trackId: string | null): void {
    const normalized = trackId ? normalizeTrackId(trackId) : null;
    this.selectedTrackId = normalized;
    this.notify();
  }

  getSelectedTrackId(): string | null {
    return this.selectedTrackId;
  }

  // -------------------------------------------------------------
  // Clip Querying (Hash Map, Linked List, Interval Tree)
  // -------------------------------------------------------------

  getClip(clipId: string): AudioClip | undefined {
    return this.clipsMap.get(clipId);
  }

  getAllClips(): AudioClip[] {
    return Array.from(this.clipsMap.values());
  }

  getTrackClips(trackId: string): AudioClip[] {
    const normalized = normalizeTrackId(trackId);
    const list = this.trackLists.get(normalized) || this.trackLists.get(trackId);
    return list ? list.toArray() : [];
  }

  /**
   * Interval Tree Query: Find overlapping clips within [start, end].
   */
  getOverlappingClips(start: number, end: number, trackId?: string): AudioClip[] {
    const normalized = trackId ? normalizeTrackId(trackId) : undefined;
    return this.intervalTree.queryOverlaps(start, end, normalized);
  }

  /**
   * Interval Tree Point Query: Find which clip is active at a given time.
   */
  getClipsAtTime(time: number, trackId?: string): AudioClip[] {
    const normalized = trackId ? normalizeTrackId(trackId) : undefined;
    return this.intervalTree.queryAtTime(time, normalized);
  }

  /**
   * Doubly Linked List Navigation: Find neighboring clips.
   */
  getAdjacentClips(clipId: string): { prev: AudioClip | null; next: AudioClip | null } {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return { prev: null, next: null };
    const list = this.trackLists.get(clip.trackId);
    return list ? list.getAdjacent(clipId) : { prev: null, next: null };
  }

  // -------------------------------------------------------------
  // Internal Helpers for Data Structure Synchronization
  // -------------------------------------------------------------

  private doAdd(clip: AudioClip): void {
    const normTrackId = normalizeTrackId(clip.trackId);
    const normalizedClip = { ...clip, trackId: normTrackId };
    this.clipsMap.set(normalizedClip.id, normalizedClip);

    // Insert into Interval Tree
    this.intervalTree.insert(normalizedClip);

    // Insert into Doubly Linked List for that track
    let list = this.trackLists.get(normTrackId);
    if (!list) {
      list = new ClipLinkedList();
      this.trackLists.set(normTrackId, list);
    }
    list.insert(normalizedClip);
  }

  private doRemove(clipId: string): void {
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
  addClip(clip: AudioClip, recordHistory: boolean = true): void {
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
        },
      });
    } else {
      this.doAdd(addedClip);
      this.notify();
    }
  }

  /**
   * Feature 2: Move clip along timeline or to another track.
   */
  moveClip(clipId: string, newStartOffset: number, newTrackId?: string, recordHistory: boolean = true): boolean {
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
        },
      });
    } else {
      this.applyMove(clipId, clampedStart, targetTrackId);
      this.notify();
    }

    return true;
  }

  private applyMove(clipId: string, startOffset: number, trackId: string): void {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;

    const normTrackId = normalizeTrackId(trackId);

    // Remove from previous structures
    this.intervalTree.remove(clipId);
    this.trackLists.get(clip.trackId)?.remove(clipId);

    // Update clip fields
    clip.startOffset = startOffset;
    clip.trackId = normTrackId;

    // Re-insert into structures
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
  splitClip(clipId: string, splitTime: number, recordHistory: boolean = true): [AudioClip, AudioClip] | null {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return null;

    // Verify split position lies strictly within clip bounds
    if (splitTime <= clip.startOffset + 0.05 || splitTime >= clip.startOffset + clip.duration - 0.05) {
      return null;
    }

    const originalState = { ...clip };
    const leftDuration = splitTime - clip.startOffset;
    const rightDuration = clip.duration - leftDuration;
    const rightSourceOffset = clip.sourceOffset + leftDuration;

    // Left clip retains original ID with shortened duration
    const leftClip: AudioClip = {
      ...clip,
      duration: leftDuration,
    };

    // Right clip gets new unique ID referencing exact same source asset
    const rightClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const rightClip: AudioClip = {
      id: rightClipId,
      trackId: clip.trackId,
      assetId: clip.assetId,
      name: `${clip.name} (Part 2)`,
      startOffset: splitTime,
      duration: rightDuration,
      sourceOffset: rightSourceOffset,
      color: clip.color,
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
        },
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
  trimClip(
    clipId: string,
    newStartOffset: number,
    newDuration: number,
    newSourceOffset: number,
    recordHistory: boolean = true
  ): boolean {
    const clip = this.clipsMap.get(clipId);
    if (!clip || newDuration <= 0.05) return false;

    // Bounds check against source asset length if registered
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
        },
      });
    } else {
      this.applyTrim(clipId, newStartOffset, newDuration, newSourceOffset);
      this.notify();
    }

    return true;
  }

  private applyTrim(clipId: string, startOffset: number, duration: number, sourceOffset: number): void {
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
  duplicateClip(clipId: string, recordHistory: boolean = true): AudioClip | null {
    const original = this.clipsMap.get(clipId);
    if (!original) return null;

    const newClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const duplicate: AudioClip = {
      ...original,
      id: newClipId,
      name: `${original.name} (Copy)`,
      startOffset: original.startOffset + original.duration, // Placed adjacent to original
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
        },
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
  recordMoveHistory(
    clipId: string,
    oldStart: number,
    newStart: number,
    oldTrackId: string,
    newTrackId: string
  ): void {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    if (Math.abs(oldStart - newStart) < 0.001 && oldTrackId === newTrackId) return;

    this.history.pushCommand({
      description: `Move clip "${clip.name}" to ${newStart.toFixed(2)}s`,
      execute: () => {
        this.applyMove(clipId, newStart, newTrackId);
        this.notify();
      },
      undo: () => {
        this.applyMove(clipId, oldStart, oldTrackId);
        this.notify();
      },
    });
    this.notify();
  }

  /**
   * Records a user drag-trim gesture that was interactively applied in real-time.
   */
  recordTrimHistory(
    clipId: string,
    oldStart: number,
    oldDuration: number,
    oldSourceOffset: number,
    newStart: number,
    newDuration: number,
    newSourceOffset: number
  ): void {
    const clip = this.clipsMap.get(clipId);
    if (!clip) return;
    if (
      Math.abs(oldStart - newStart) < 0.001 &&
      Math.abs(oldDuration - newDuration) < 0.001 &&
      Math.abs(oldSourceOffset - newSourceOffset) < 0.001
    ) {
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
      },
    });
    this.notify();
  }

  /**
   * Feature 6: Delete clip.
   */
  deleteClip(clipId: string, recordHistory: boolean = true): boolean {
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
        },
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

  selectClip(clipId: string, multiSelect: boolean = false): void {
    if (!multiSelect) {
      this.selectedClipIds.clear();
    }
    if (this.clipsMap.has(clipId)) {
      this.selectedClipIds.add(clipId);
    }
    this.notify();
  }

  deselectAll(): void {
    this.selectedClipIds.clear();
    this.notify();
  }

  getSelectedClipIds(): string[] {
    return Array.from(this.selectedClipIds);
  }

  /**
   * Feature 9: Snaps time to grid and neighboring clip boundaries (using Doubly Linked List).
   */
  snapPosition(time: number, trackId?: string, gridSeconds: number = 0.25): number {
    let snappedTime = Math.round(time / gridSeconds) * gridSeconds;

    // Check neighboring clip boundary snapping using Doubly Linked List
    if (trackId) {
      const normTrackId = normalizeTrackId(trackId);
      const list = this.trackLists.get(normTrackId) || this.trackLists.get(trackId);
      if (list) {
        let curr: ClipNode | null = list.head;
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

  getTotalDuration(): number {
    let maxEnd = 0;
    for (const clip of this.clipsMap.values()) {
      const end = clip.startOffset + clip.duration;
      if (end > maxEnd) maxEnd = end;
    }
    return Math.max(10.0, maxEnd);
  }

  // -------------------------------------------------------------
  // Playback & Export Engine Connection (Actual Sample Offsets)
  // -------------------------------------------------------------

  /**
   * Generates exact sample and time offsets for Web Audio API AudioBufferSourceNodes.
   * Connects the non-destructive timeline clips directly to audio output.
   */
  getScheduleForTime(playheadTime: number): PlaybackScheduleItem[] {
    const items: PlaybackScheduleItem[] = [];

    for (const clip of this.clipsMap.values()) {
      const clipEnd = clip.startOffset + clip.duration;

      // Only schedule clips that have not completely finished before playhead
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
          playDuration,
        });
      }
    }

    return items;
  }

  // -------------------------------------------------------------
  // Undo / Redo Facade
  // -------------------------------------------------------------

  undo(): boolean {
    const res = this.history.undo();
    if (res) this.notify();
    return res;
  }

  redo(): boolean {
    const res = this.history.redo();
    if (res) this.notify();
    return res;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  getUndoCount(): number {
    return this.history.getUndoStackSize();
  }

  getRedoCount(): number {
    return this.history.getRedoStackSize();
  }

  getUndoText(): string | null {
    return this.history.getUndoDescription();
  }

  getRedoText(): string | null {
    return this.history.getRedoDescription();
  }

  getUndoHistory(): string[] {
    return this.history.getUndoHistory();
  }

  getRedoHistory(): string[] {
    return this.history.getRedoHistory();
  }

  // -------------------------------------------------------------
  // Change Subscriptions
  // -------------------------------------------------------------

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  clearAll(): void {
    this.clipsMap.clear();
    this.intervalTree.clear();
    this.trackLists.forEach((l) => l.clear());
    this.selectedClipIds.clear();
    this.history.clear();
    this.notify();
  }
}

export const timelineModel = new TimelineModel();
