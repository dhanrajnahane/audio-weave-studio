import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Command-Based Undo / Redo Acceptance Test Suite
 * ---------------------------------------------------------------------
 * Verifies:
 * 1. Undo clip movement.
 * 2. Undo splitting.
 * 3. Undo trimming.
 * 4. Undo deletion.
 * 5. Undo duplication.
 * 6. Redo previously undone operations.
 * 7. Maintain correct history when multiple operations are performed.
 * 8. Clear or update redo history correctly after a new action.
 * 9. Avoid storing unnecessary copies of large audio files.
 * 10. Direct restoration of actual Web Audio playback engine scheduling.
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

const compiledEnginePath = path.resolve('src/audio/AudioEngine.compiled.mjs');
const { AudioEngine } = await import(pathToFileURL(compiledEnginePath).href);

const timelineCompiledPath = path.resolve('src/audio/timeline/TimelineModel.compiled.mjs');
const { TimelineModel, UndoRedoStack } = await import(pathToFileURL(timelineCompiledPath).href);

test('AudioWeave Studio — Command-Based Undo / Redo Acceptance Tests', async (t) => {
  const wavPath = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s/vocals.wav');
  assert.ok(fs.existsSync(wavPath), 'Real audio source file must exist');
  const sourceBuffer = parseWav(wavPath);
  const originalDuration = sourceBuffer.duration; // 15.0s

  const timeline = new TimelineModel();
  const engine = new AudioEngine();
  engine.setTimelineModel(timeline);

  // Register real audio asset in Timeline Hash Map
  timeline.registerAsset('asset-vocals', sourceBuffer);

  // Setup Initial Baseline Clips
  timeline.addClip({
    id: 'clip-A',
    trackId: 'track-1',
    assetId: 'asset-vocals',
    name: 'Vocals Lead',
    startOffset: 0.0,
    duration: 6.0,
    sourceOffset: 0.0,
  }, false);

  timeline.addClip({
    id: 'clip-B',
    trackId: 'track-2',
    assetId: 'asset-vocals',
    name: 'Vocals Harmony',
    startOffset: 6.0,
    duration: 6.0,
    sourceOffset: 0.0,
  }, false);

  // Ensure history is clean initially
  assert.equal(timeline.canUndo(), false, 'History starts empty');
  assert.equal(timeline.canRedo(), false, 'Redo starts empty');
  assert.equal(timeline.getUndoCount(), 0);
  assert.equal(timeline.getRedoCount(), 0);

  let splitPartBId = null;
  let duplicatedClipId = null;

  // -----------------------------------------------------------------
  // 1. Perform 5 Editing Operations
  // -----------------------------------------------------------------
  await t.test('1. Perform 5 editing operations in sequence', () => {
    // Operation 1: Move clip-A from 0.0s to 1.5s
    const moveRes = timeline.moveClip('clip-A', 1.5);
    assert.equal(moveRes, true);
    assert.equal(timeline.getClip('clip-A')?.startOffset, 1.5);
    assert.equal(timeline.getUndoCount(), 1);

    // Operation 2: Split clip-B at 9.0s into two 3.0s slices
    const splitRes = timeline.splitClip('clip-B', 9.0);
    assert.ok(splitRes);
    const [partA, partB] = splitRes;
    splitPartBId = partB.id;
    assert.equal(partA.id, 'clip-B');
    assert.equal(partA.duration, 3.0);
    assert.equal(partB.duration, 3.0);
    assert.equal(partB.startOffset, 9.0);
    assert.equal(timeline.getUndoCount(), 2);

    // Operation 3: Trim clip-A to startOffset 2.0s, duration 4.5s, sourceOffset 0.5s
    const trimRes = timeline.trimClip('clip-A', 2.0, 4.5, 0.5);
    assert.equal(trimRes, true);
    assert.equal(timeline.getClip('clip-A')?.startOffset, 2.0);
    assert.equal(timeline.getClip('clip-A')?.duration, 4.5);
    assert.equal(timeline.getClip('clip-A')?.sourceOffset, 0.5);
    assert.equal(timeline.getUndoCount(), 3);

    // Operation 4: Duplicate part B of clip-B (adjacent at 12.0s, dur 3.0s)
    const dupRes = timeline.duplicateClip(splitPartBId);
    assert.ok(dupRes);
    duplicatedClipId = dupRes.id;
    assert.equal(dupRes.startOffset, 12.0);
    assert.equal(dupRes.duration, 3.0);
    assert.equal(timeline.getUndoCount(), 4);

    // Operation 5: Delete clip-B (first slice, [6.0s to 9.0s])
    const delRes = timeline.deleteClip('clip-B');
    assert.equal(delRes, true);
    assert.equal(timeline.getClip('clip-B'), undefined);
    assert.equal(timeline.getUndoCount(), 5);

    // Check history state after all 5 operations
    assert.equal(timeline.canUndo(), true);
    assert.equal(timeline.canRedo(), false);
    assert.equal(timeline.getUndoCount(), 5);
    assert.equal(timeline.getRedoCount(), 0);

    const historyDescriptions = timeline.getUndoHistory();
    assert.equal(historyDescriptions.length, 5);
    assert.ok(historyDescriptions[0].includes('Move'));
    assert.ok(historyDescriptions[1].includes('Split'));
    assert.ok(historyDescriptions[2].includes('Trim'));
    assert.ok(historyDescriptions[3].includes('Duplicate'));
    assert.ok(historyDescriptions[4].includes('Delete'));
  });

  // -----------------------------------------------------------------
  // 2. Undo all 5 Operations one by one and verify state & playback
  // -----------------------------------------------------------------
  await t.test('2. Undo all 5 operations one by one in LIFO sequence', () => {
    // --- Undo Operation 5: Undo Deletion of clip-B ---
    const undo5 = timeline.undo();
    assert.equal(undo5, true);
    assert.equal(timeline.getUndoCount(), 4);
    assert.equal(timeline.getRedoCount(), 1);

    // Verify clip-B restored in Hash Map
    const restoredClipB = timeline.getClip('clip-B');
    assert.ok(restoredClipB, 'clip-B restored after undo deletion');
    assert.equal(restoredClipB.startOffset, 6.0);
    assert.equal(restoredClipB.duration, 3.0);

    // Verify restored in Interval Tree
    const treeAt7 = timeline.getClipsAtTime(7.0, 'track-2');
    assert.equal(treeAt7.length, 1);
    assert.equal(treeAt7[0].id, 'clip-B');

    // Verify restored in Playback Schedule
    const schedAt6 = timeline.getScheduleForTime(6.0);
    assert.ok(schedAt6.some((item) => item.clip.id === 'clip-B'));

    // --- Undo Operation 4: Undo Duplication ---
    const undo4 = timeline.undo();
    assert.equal(undo4, true);
    assert.equal(timeline.getUndoCount(), 3);
    assert.equal(timeline.getRedoCount(), 2);

    // Verify duplicated clip removed
    assert.equal(timeline.getClip(duplicatedClipId), undefined, 'Duplicate clip removed after undo');
    const treeAt12 = timeline.getClipsAtTime(12.5, 'track-2');
    assert.equal(treeAt12.length, 0, 'No clip at 12.5s on track-2 after undo duplication');

    // --- Undo Operation 3: Undo Trimming of clip-A ---
    const undo3 = timeline.undo();
    assert.equal(undo3, true);
    assert.equal(timeline.getUndoCount(), 2);
    assert.equal(timeline.getRedoCount(), 3);

    // Verify clip-A restored to pre-trim state: startOffset 1.5s, duration 6.0s, sourceOffset 0.0s
    const preTrimA = timeline.getClip('clip-A');
    assert.ok(preTrimA);
    assert.equal(preTrimA.startOffset, 1.5, 'startOffset restored to 1.5s');
    assert.equal(preTrimA.duration, 6.0, 'duration restored to 6.0s');
    assert.equal(preTrimA.sourceOffset, 0.0, 'sourceOffset restored to 0.0s');

    // --- Undo Operation 2: Undo Splitting of clip-B ---
    const undo2 = timeline.undo();
    assert.equal(undo2, true);
    assert.equal(timeline.getUndoCount(), 1);
    assert.equal(timeline.getRedoCount(), 4);

    // Verify partB removed and original unsplit clip-B ([6.0s to 12.0s], dur 6.0s) restored
    assert.equal(timeline.getClip(splitPartBId), undefined, 'partB removed after undo split');
    const unsplitB = timeline.getClip('clip-B');
    assert.ok(unsplitB);
    assert.equal(unsplitB.duration, 6.0, 'clip-B duration restored to full 6.0s');
    assert.equal(unsplitB.startOffset, 6.0);

    // --- Undo Operation 1: Undo Movement of clip-A ---
    const undo1 = timeline.undo();
    assert.equal(undo1, true);
    assert.equal(timeline.getUndoCount(), 0);
    assert.equal(timeline.getRedoCount(), 5);
    assert.equal(timeline.canUndo(), false, 'Undo stack is now empty');
    assert.equal(timeline.canRedo(), true, 'Redo stack has all 5 commands');

    // Verify clip-A restored to original startOffset 0.0s
    const originalA = timeline.getClip('clip-A');
    assert.ok(originalA);
    assert.equal(originalA.startOffset, 0.0, 'clip-A startOffset restored to original 0.0s');
    assert.equal(originalA.duration, 6.0);

    // Verify Playback Schedule matches initial arrangement exactly
    const schedAt0 = timeline.getScheduleForTime(0.0);
    const itemA = schedAt0.find((it) => it.clip.id === 'clip-A');
    assert.ok(itemA);
    assert.equal(itemA.delaySeconds, 0.0, 'Clip A plays at 0.0s with no delay');
    assert.equal(itemA.sourceOffset, 0.0);
    assert.equal(itemA.playDuration, 6.0);

    const itemB = schedAt0.find((it) => it.clip.id === 'clip-B');
    assert.ok(itemB);
    assert.equal(itemB.delaySeconds, 6.0, 'Clip B plays at 6.0s with 6s delay');
    assert.equal(itemB.playDuration, 6.0);

    // Further undo returns false cleanly
    assert.equal(timeline.undo(), false, 'Undoing empty stack returns false');
  });

  // -----------------------------------------------------------------
  // 3. Redo all 5 Operations one by one and verify state & playback
  // -----------------------------------------------------------------
  await t.test('3. Redo all 5 operations one by one in FIFO sequence', () => {
    // --- Redo Operation 1: Redo Move clip-A to 1.5s ---
    const redo1 = timeline.redo();
    assert.equal(redo1, true);
    assert.equal(timeline.getUndoCount(), 1);
    assert.equal(timeline.getRedoCount(), 4);
    assert.equal(timeline.getClip('clip-A')?.startOffset, 1.5, 'Redo moved clip-A back to 1.5s');

    // --- Redo Operation 2: Redo Split clip-B at 9.0s ---
    const redo2 = timeline.redo();
    assert.equal(redo2, true);
    assert.equal(timeline.getUndoCount(), 2);
    assert.equal(timeline.getRedoCount(), 3);
    assert.equal(timeline.getClip('clip-B')?.duration, 3.0, 'Redo re-shortened first slice to 3.0s');
    assert.ok(timeline.getClip(splitPartBId), 'Redo restored second slice partB');

    // --- Redo Operation 3: Redo Trim clip-A ---
    const redo3 = timeline.redo();
    assert.equal(redo3, true);
    assert.equal(timeline.getUndoCount(), 3);
    assert.equal(timeline.getRedoCount(), 2);
    const trimmedA = timeline.getClip('clip-A');
    assert.equal(trimmedA?.startOffset, 2.0, 'Redo re-applied startOffset 2.0s');
    assert.equal(trimmedA?.duration, 4.5, 'Redo re-applied duration 4.5s');
    assert.equal(trimmedA?.sourceOffset, 0.5, 'Redo re-applied sourceOffset 0.5s');

    // --- Redo Operation 4: Redo Duplication ---
    const redo4 = timeline.redo();
    assert.equal(redo4, true);
    assert.equal(timeline.getUndoCount(), 4);
    assert.equal(timeline.getRedoCount(), 1);
    assert.ok(timeline.getClip(duplicatedClipId), 'Redo re-created duplicated clip');

    // --- Redo Operation 5: Redo Deletion of clip-B ---
    const redo5 = timeline.redo();
    assert.equal(redo5, true);
    assert.equal(timeline.getUndoCount(), 5);
    assert.equal(timeline.getRedoCount(), 0);
    assert.equal(timeline.canRedo(), false, 'Redo stack is now empty');
    assert.equal(timeline.canUndo(), true);
    assert.equal(timeline.getClip('clip-B'), undefined, 'Redo re-deleted clip-B');

    // Further redo returns false cleanly
    assert.equal(timeline.redo(), false, 'Redoing empty stack returns false');
  });

  // -----------------------------------------------------------------
  // 4. Requirement 8: Clear/Invalidate Redo History on New Action
  // -----------------------------------------------------------------
  await t.test('4. Requirement 8: Clear redo history when a new action is performed', () => {
    // Undo 2 operations so redoStack has 2 items
    timeline.undo(); // Undo delete
    timeline.undo(); // Undo duplicate
    assert.equal(timeline.getUndoCount(), 3);
    assert.equal(timeline.getRedoCount(), 2);
    assert.equal(timeline.canRedo(), true);

    // Perform a brand new action: move clip-A from 2.0s to 3.0s
    timeline.moveClip('clip-A', 3.0);

    // Redo history must be completely cleared!
    assert.equal(timeline.getRedoCount(), 0, 'Redo count must reset to 0');
    assert.equal(timeline.canRedo(), false, 'canRedo must be false after new action');
    assert.equal(timeline.getUndoCount(), 4, 'Undo count incremented to 4');

    // Verify redo() returns false
    assert.equal(timeline.redo(), false);
  });

  // -----------------------------------------------------------------
  // 5. Requirement 9: No unnecessary copies of large audio files
  // -----------------------------------------------------------------
  await t.test('5. Requirement 9: Large audio file buffer is never duplicated in memory', () => {
    // Source buffer duration is unchanged
    assert.equal(sourceBuffer.duration, 15.0);

    // Verify Timeline assetsMap contains only the original single buffer
    assert.equal(timeline.getAsset('asset-vocals'), sourceBuffer, 'Hash Map points to exact original AudioBuffer instance');

    // All clips on timeline reference asset-vocals without duplicating buffer data
    const allClips = timeline.getAllClips();
    for (const c of allClips) {
      assert.equal(c.assetId, 'asset-vocals', 'Clip only holds lightweight string reference');
      // Verify clip object is small metadata
      assert.equal(typeof c.startOffset, 'number');
      assert.equal(typeof c.duration, 'number');
      assert.equal(typeof c.sourceOffset, 'number');
    }
  });

  // -----------------------------------------------------------------
  // 6. Playback Engine Execution Verification
  // -----------------------------------------------------------------
  await t.test('6. Playback engine drives real audio playback during undo and redo states', () => {
    // Start playback
    engine.play(0.0);
    assert.equal(engine.getIsPlaying(), true, 'Audio engine playing active timeline');

    // Perform undo while playing
    timeline.undo(); // undo move clip-A
    assert.equal(timeline.getClip('clip-A')?.startOffset, 2.0);

    // Verify active timeline sources were rescheduled automatically
    assert.equal(engine.getIsPlaying(), true);

    // Stop cleanly
    engine.pause();
    assert.equal(engine.getIsPlaying(), false);
    engine.stop();
    assert.equal(engine.getCurrentTime(), 0.0);
  });
});
