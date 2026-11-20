import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Non-Destructive Timeline Editor Acceptance Tests
 * ---------------------------------------------------------------------
 * Verifies non-destructive multi-track editing, playback schedule matching,
 * and classical Data Structures (Doubly Linked List, Hash Maps, Interval Tree, Double Stack).
 */

class MockAudioParam {
  constructor(defaultValue = 1.0) {
    this.value = defaultValue;
  }
  setValueAtTime(v) {
    this.value = v;
  }
}

class MockGainNode {
  constructor() {
    this.gain = new MockAudioParam(1.0);
  }
  connect() {}
  disconnect() {}
}

class MockStereoPannerNode {
  constructor() {
    this.pan = new MockAudioParam(0.0);
  }
  connect() {}
  disconnect() {}
}

class MockAnalyserNode {
  constructor() {
    this.fftSize = 256;
    this.frequencyBinCount = 128;
  }
  connect() {}
  disconnect() {}
  getByteTimeDomainData(arr) {
    arr.fill(128);
  }
}

class MockSourceNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.started = false;
    this.stopped = false;
    this.startOffset = 0;
    this.playDuration = 0;
    this.startTime = 0;
    this.onended = null;
  }
  connect() {}
  disconnect() {}
  start(when, offset, duration) {
    this.started = true;
    this.startTime = when;
    this.startOffset = offset;
    this.playDuration = duration;
  }
  stop() {
    this.stopped = true;
    if (this.onended) this.onended();
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
  }
  createGain() { return new MockGainNode(); }
  createAnalyser() { return new MockAnalyserNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createBufferSource() { return new MockSourceNode(this); }
  resume() { return Promise.resolve(); }
}

globalThis.window = { AudioContext: MockAudioContext };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

function parseWav(filePath) {
  const buf = fs.readFileSync(filePath);
  let offset = 12, numChannels = 2, sampleRate = 44100, bitsPerSample = 16, dataOffset = 0, dataSize = 0;
  while (offset < buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkId === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 2);
      sampleRate = buf.readUInt32LE(offset + 4);
      bitsPerSample = buf.readUInt16LE(offset + 14);
    } else if (chunkId === 'data') {
      dataOffset = offset;
      dataSize = chunkSize;
      break;
    }
    offset += chunkSize;
  }
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataSize / (numChannels * bytesPerSample));
  const channelData = [new Float32Array(frames), new Float32Array(frames)];
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const idx = dataOffset + (i * numChannels + ch) * bytesPerSample;
      channelData[ch][i] = buf.readInt16LE(idx) / 32768.0;
    }
  }
  return {
    numberOfChannels: numChannels,
    sampleRate,
    length: frames,
    duration: frames / sampleRate,
    getChannelData: (ch) => channelData[ch]
  };
}

const compiledPath = path.resolve('src/audio/AudioEngine.compiled.mjs');
const { AudioEngine } = await import(pathToFileURL(compiledPath).href);

// Import Timeline Data Structures from compiled module
const timelineCompiledPath = path.resolve('src/audio/timeline/TimelineModel.compiled.mjs');
const { TimelineModel, ClipLinkedList, TimelineIntervalTree, UndoRedoStack } = await import(
  pathToFileURL(timelineCompiledPath).href
);

test('Non-Destructive Multi-Track Timeline Editor & DSA Verification', async (t) => {
  const wavPath = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s/vocals.wav');
  assert.ok(fs.existsSync(wavPath), 'Real audio source file must exist');
  const sourceBuffer = parseWav(wavPath);
  const originalDuration = sourceBuffer.duration; // 15.0s

  const timeline = new TimelineModel();
  const engine = new AudioEngine();
  engine.setTimelineModel(timeline);

  // -------------------------------------------------------------
  // 1. Preserve original audio asset
  // -------------------------------------------------------------
  await t.test('1. Preserve original audio asset in its entirety (non-destructive)', () => {
    timeline.registerAsset('asset-vocals', sourceBuffer);
    assert.ok(timeline.hasAsset('asset-vocals'), 'Asset must be stored in Hash Map');
    assert.equal(timeline.getAsset('asset-vocals')?.duration, 15.0, 'Source asset duration preserved');

    // Create 2 separate clips pointing to same source asset
    timeline.addClip({
      id: 'clip-1',
      trackId: 'track-1',
      assetId: 'asset-vocals',
      name: 'Vocals Intro',
      startOffset: 0.0,
      duration: 4.0,
      sourceOffset: 0.0,
    });

    timeline.addClip({
      id: 'clip-2',
      trackId: 'track-1',
      assetId: 'asset-vocals',
      name: 'Vocals Chorus',
      startOffset: 5.0,
      duration: 5.0,
      sourceOffset: 4.0,
    });

    // Verify source buffer is completely unaffected
    assert.equal(sourceBuffer.duration, 15.0, 'Underlying source audio buffer was NOT sliced or mutated');
    assert.equal(timeline.getAllClips().length, 2, 'Two non-destructive clips created');
  });

  // -------------------------------------------------------------
  // 2. Move clips along timeline (Hash Map + Doubly Linked List + Interval Tree)
  // -------------------------------------------------------------
  await t.test('2. Move clip along timeline and update data structures', () => {
    // Move clip-1 from 0.0s to 1.5s
    const success = timeline.moveClip('clip-1', 1.5);
    assert.equal(success, true);

    // Hash Map check
    const clip1 = timeline.getClip('clip-1');
    assert.equal(clip1?.startOffset, 1.5, 'Hash map has updated startOffset');

    // Interval Tree check: overlap query
    const overlaps = timeline.getOverlappingClips(1.0, 2.0, 'track-1');
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].id, 'clip-1', 'Interval tree found clip-1 at new position');

    // Past position query must NOT find clip-1
    const pastOverlaps = timeline.getOverlappingClips(0.0, 0.5, 'track-1');
    assert.equal(pastOverlaps.length, 0, 'Old position cleared in interval tree');

    // Doubly Linked List sequence check
    const trackClips = timeline.getTrackClips('track-1');
    assert.equal(trackClips[0].id, 'clip-1');
    assert.equal(trackClips[1].id, 'clip-2');
  });

  // -------------------------------------------------------------
  // 3. Split clips at playhead position
  // -------------------------------------------------------------
  await t.test('3. Split clip at playhead into two non-destructive slices', () => {
    // Split clip-2 ([5.0s to 10.0s], sourceOffset: 4.0s) at splitTime = 7.5s
    const splitResult = timeline.splitClip('clip-2', 7.5);
    assert.ok(splitResult, 'Split must succeed');
    const [partA, partB] = splitResult;

    // Part A: [5.0s to 7.5s] (duration: 2.5s, sourceOffset: 4.0s)
    assert.equal(partA.id, 'clip-2');
    assert.equal(partA.startOffset, 5.0);
    assert.equal(partA.duration, 2.5);
    assert.equal(partA.sourceOffset, 4.0);

    // Part B: [7.5s to 10.0s] (duration: 2.5s, sourceOffset: 6.5s)
    assert.equal(partB.startOffset, 7.5);
    assert.equal(partB.duration, 2.5);
    assert.equal(partB.sourceOffset, 6.5);
    assert.equal(partB.assetId, 'asset-vocals', 'Both slices reference the identical source asset');

    // Doubly Linked List neighbor relationship check
    const adj = timeline.getAdjacentClips(partB.id);
    assert.equal(adj.prev?.id, partA.id, 'Doubly linked list: Part B prev pointer links to Part A');

    // Total clips count is now 3
    assert.equal(timeline.getAllClips().length, 3);
  });

  // -------------------------------------------------------------
  // 4. Trim the beginning and end of clips
  // -------------------------------------------------------------
  await t.test('4. Trim beginning and end of clip non-destructively', () => {
    // Trim Part A ([5.0s to 7.5s], dur 2.5s, src 4.0s) -> trim end by 0.5s (new duration 2.0s)
    const successEnd = timeline.trimClip('clip-2', 5.0, 2.0, 4.0);
    assert.equal(successEnd, true);
    assert.equal(timeline.getClip('clip-2')?.duration, 2.0);

    // Trim beginning of clip-1 ([1.5s to 5.5s], dur 4.0s, src 0.0s) by +0.5s:
    // new start: 2.0s, new dur: 3.5s, new src: 0.5s
    const successStart = timeline.trimClip('clip-1', 2.0, 3.5, 0.5);
    assert.equal(successStart, true);
    const trimmed1 = timeline.getClip('clip-1');
    assert.equal(trimmed1?.startOffset, 2.0);
    assert.equal(trimmed1?.duration, 3.5);
    assert.equal(trimmed1?.sourceOffset, 0.5);
  });

  // -------------------------------------------------------------
  // 5. Duplicate clips
  // -------------------------------------------------------------
  await t.test('5. Duplicate clip creates cloned slice adjacent on timeline', () => {
    const dup = timeline.duplicateClip('clip-2');
    assert.ok(dup, 'Duplicate must succeed');
    assert.notEqual(dup.id, 'clip-2', 'Duplicate must have unique new ID');
    assert.equal(dup.startOffset, 5.0 + 2.0, 'Placed adjacent at 7.0s');
    assert.equal(dup.duration, 2.0, 'Matches original clip duration');
    assert.equal(dup.sourceOffset, 4.0, 'Matches original clip source offset');

    // Hash map check
    assert.ok(timeline.getClip(dup.id));
  });

  // -------------------------------------------------------------
  // 6. Delete clips
  // -------------------------------------------------------------
  await t.test('6. Delete clip removes from Hash Map, Linked List and Interval Tree', () => {
    const clipsBefore = timeline.getAllClips().length;
    const dupClip = timeline.getTrackClips('track-1').find((c) => c.name.includes('Copy'));
    assert.ok(dupClip);

    const deleted = timeline.deleteClip(dupClip.id);
    assert.equal(deleted, true);
    assert.equal(timeline.getAllClips().length, clipsBefore - 1);
    assert.equal(timeline.getClip(dupClip.id), undefined);

    // Interval tree check
    const query = timeline.getOverlappingClips(dupClip.startOffset, dupClip.startOffset + dupClip.duration);
    assert.ok(!query.some((c) => c.id === dupClip.id), 'Deleted clip absent from interval tree');
  });

  // -------------------------------------------------------------
  // 7. Interval Tree collision & intersection detection
  // -------------------------------------------------------------
  await t.test('7. Interval tree point query and collision detection', () => {
    // Point query at t = 2.5s: clip-1 spans [2.0s to 5.5s]
    const at25 = timeline.getClipsAtTime(2.5, 'track-1');
    assert.equal(at25.length, 1);
    assert.equal(at25[0].id, 'clip-1');

    // Query in empty space between clip-2 (ends 7.0s) and partB (starts 8.0s)
    const clips = timeline.getTrackClips('track-1');
    const partB = clips.find((c) => c.name.includes('Part 2'));
    if (partB) {
      timeline.moveClip(partB.id, 8.0);
    }

    const emptyQuery = timeline.getOverlappingClips(7.2, 7.8, 'track-1');
    assert.equal(emptyQuery.length, 0, 'No overlaps in empty gap between 7.0s and 8.0s');
  });

  // -------------------------------------------------------------
  // 8. Undo and Redo History (Double Stack)
  // -------------------------------------------------------------
  await t.test('8. Double-Stack Undo and Redo command history', () => {
    assert.equal(timeline.canUndo(), true);

    // Initial clip-1 startOffset is 2.0
    assert.equal(timeline.getClip('clip-1')?.startOffset, 2.0);

    // Perform an edit: move clip-1 to 3.0s
    timeline.moveClip('clip-1', 3.0);
    assert.equal(timeline.getClip('clip-1')?.startOffset, 3.0);

    // UNDO: should revert back to 2.0s
    const undoRes = timeline.undo();
    assert.equal(undoRes, true);
    assert.equal(timeline.getClip('clip-1')?.startOffset, 2.0, 'Undo reverted clip move');

    // REDO: should restore 3.0s
    const redoRes = timeline.redo();
    assert.equal(redoRes, true);
    assert.equal(timeline.getClip('clip-1')?.startOffset, 3.0, 'Redo re-applied clip move');

    // Undo again to leave it at 2.0s
    timeline.undo();
    assert.equal(timeline.getClip('clip-1')?.startOffset, 2.0);
  });

  // -------------------------------------------------------------
  // 9. Snapping System
  // -------------------------------------------------------------
  await t.test('9. Snapping to grid intervals and adjacent clip boundaries', () => {
    // Grid snapping at 0.25s: 1.13s -> 1.0s or 1.25s
    const snapped1 = timeline.snapPosition(1.13, undefined, 0.25);
    assert.equal(snapped1, 1.25, 'Snaps to nearest 0.25s grid');

    // Boundary snapping to clip-1 startOffset (2.0s)
    const nearStart = timeline.snapPosition(1.96, 'track-1', 0.25);
    assert.equal(nearStart, 2.0, 'Snaps to neighboring clip boundary at 2.0s');
  });

  // -------------------------------------------------------------
  // 10. Playback Schedule matches Edited Timeline
  // -------------------------------------------------------------
  await t.test('10. Playback schedule matches edited timeline arrangement', () => {
    // Query schedule from playhead = 0.0s
    const schedAt0 = timeline.getScheduleForTime(0.0);
    assert.ok(schedAt0.length > 0);

    // clip-1 starts at 2.0s: delay must be 2.0s, sourceOffset 0.5s, duration 3.5s
    const item1 = schedAt0.find((it) => it.clip.id === 'clip-1');
    assert.ok(item1);
    assert.equal(item1.delaySeconds, 2.0, 'Delay seconds must match startOffset from 0');
    assert.equal(item1.sourceOffset, 0.5, 'Source offset must match trimmed source position');
    assert.equal(item1.playDuration, 3.5, 'Play duration matches clip duration');

    // Query schedule when playhead is INSIDE clip-1 (e.g. t = 3.0s, which is 1.0s into clip-1)
    const schedAt3 = timeline.getScheduleForTime(3.0);
    const item1Active = schedAt3.find((it) => it.clip.id === 'clip-1');
    assert.ok(item1Active);
    assert.equal(item1Active.delaySeconds, 0.0, 'Delay is 0 for currently active clip');
    assert.equal(item1Active.sourceOffset, 1.5, 'Source offset advanced by 1.0s (0.5 + 1.0 = 1.5)');
    assert.equal(item1Active.playDuration, 2.5, 'Remaining duration is 2.5s (3.5 - 1.0 = 2.5)');

    // Start audio engine with timeline model
    engine.play(0.0);
    assert.equal(engine.getIsPlaying(), true, 'Engine plays timeline arrangement');
    engine.pause();
    assert.equal(engine.getIsPlaying(), false);
    engine.stop();
    assert.equal(engine.getCurrentTime(), 0.0);
  });
});
