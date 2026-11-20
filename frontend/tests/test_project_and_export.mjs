import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * =====================================================================
 * AudioWeave Studio — Project Persistence & Multi-Format Export Engine
 * Acceptance Test Suite
 * =====================================================================
 * Verifies:
 * 1. Project Schema v2.0.0 & Zero-Binary asset referencing.
 * 2. Project Manager operations: New, Save, Open, Save As, Rename, Delete.
 * 3. Background Auto-Save snapshot & Crash Recovery restoration.
 * 4. Multi-Target Rendering: Full Mix, Stems, Track, Region, Arrangement.
 * 5. Multi-Format WAV Encoding: 16-bit & 24-bit PCM at 44.1kHz & 48kHz.
 * 6. Live Backend FFmpeg MP3 encoding via /api/audio/export/mp3.
 * 7. Technical Validation: Audio re-decoding, peak amplitude, duration checks.
 */

// ---------------------------------------------------------------------
// Mock AudioContext & Web Audio Environment for Node.js
// ---------------------------------------------------------------------
class MockAudioParam {
  constructor(val = 0) {
    this.value = val;
  }
  setValueAtTime(val) {
    this.value = val;
  }
  linearRampToValueAtTime(val) {
    this.value = val;
  }
  exponentialRampToValueAtTime(val) {
    this.value = val;
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
    this.pan = new MockAudioParam(0);
  }
  connect() {}
  disconnect() {}
}

class MockAnalyserNode {
  constructor() {
    this.frequencyBinCount = 1024;
  }
  connect() {}
  disconnect() {}
  getByteTimeDomainData(arr) {
    arr.fill(128);
  }
}

class MockBiquadFilterNode {
  constructor() {
    this.type = 'lowshelf';
    this.frequency = new MockAudioParam(350);
    this.gain = new MockAudioParam(0);
    this.Q = new MockAudioParam(1);
  }
  connect() {}
  disconnect() {}
}

class MockDynamicsCompressorNode {
  constructor() {
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
  }
  connect() {}
  disconnect() {}
}

class MockDelayNode {
  constructor() {
    this.delayTime = new MockAudioParam(0.25);
  }
  connect() {}
  disconnect() {}
}

class MockConvolverNode {
  constructor() {
    this.buffer = null;
  }
  connect() {}
  disconnect() {}
}

class MockSourceNode {
  constructor(ctx) {
    this.context = ctx;
    this.buffer = null;
    this.playbackRate = new MockAudioParam(1);
    this.onended = null;
  }
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = {};
  }
  createGain() { return new MockGainNode(); }
  createAnalyser() { return new MockAnalyserNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createBufferSource() { return new MockSourceNode(this); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createDelay() { return new MockDelayNode(); }
  createConvolver() { return new MockConvolverNode(); }
  createBuffer(channels, length, sampleRate) {
    const chData = [];
    for (let c = 0; c < channels; c++) chData.push(new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch) => chData[ch],
    };
  }
  resume() { return Promise.resolve(); }
  decodeAudioData(buffer) {
    return Promise.resolve(parseWavBuffer(Buffer.from(buffer)));
  }
}

class MockOfflineBufferSource {
  constructor() {
    this.buffer = null;
    this.startTime = 0;
    this.offset = 0;
    this.duration = 0;
  }
  connect() {}
  start(when, offset, duration) {
    this.startTime = when;
    this.offset = offset;
    this.duration = duration;
  }
}

class MockOfflineAudioContext {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.destination = {};
    this.scheduledSources = [];
  }
  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createDelay() { return new MockDelayNode(); }
  createConvolver() { return new MockConvolverNode(); }
  createBufferSource() {
    const src = new MockOfflineBufferSource();
    this.scheduledSources.push(src);
    return src;
  }
  createBuffer(channels, length, sampleRate) {
    const chData = [];
    for (let c = 0; c < channels; c++) chData.push(new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch) => chData[ch],
    };
  }
  async startRendering() {
    const rendered = {
      numberOfChannels: this.numberOfChannels,
      length: this.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      _channelData: [
        new Float32Array(this.length),
        new Float32Array(this.length)
      ],
      getChannelData(ch) {
        return this._channelData[ch];
      }
    };

    // Render scheduled sources into buffer
    for (const src of this.scheduledSources) {
      if (!src.buffer) continue;
      const startSample = Math.floor(src.startTime * this.sampleRate);
      const offsetSample = Math.floor(src.offset * src.buffer.sampleRate);
      const durSamples = Math.min(
        Math.floor((src.duration || (src.buffer.duration - src.offset)) * this.sampleRate),
        this.length - startSample
      );

      for (let ch = 0; ch < this.numberOfChannels; ch++) {
        const srcCh = src.buffer.getChannelData(Math.min(ch, src.buffer.numberOfChannels - 1));
        const destCh = rendered._channelData[ch];
        for (let i = 0; i < durSamples; i++) {
          const destIdx = startSample + i;
          const srcIdx = offsetSample + i;
          if (destIdx >= 0 && destIdx < this.length && srcIdx >= 0 && srcIdx < src.buffer.length) {
            destCh[destIdx] += srcCh[srcIdx];
          }
        }
      }
    }

    return rendered;
  }
}

globalThis.window = {
  AudioContext: MockAudioContext,
  OfflineAudioContext: MockOfflineAudioContext,
  URL: {
    createObjectURL: () => 'blob:mock-audio-url',
    revokeObjectURL: () => {}
  }
};
globalThis.AudioContext = MockAudioContext;
globalThis.OfflineAudioContext = MockOfflineAudioContext;

function parseWavBuffer(buf) {
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
      if (bitsPerSample === 16) {
        channelData[ch][i] = buf.readInt16LE(idx) / 32768.0;
      } else if (bitsPerSample === 24) {
        const b0 = buf[idx];
        const b1 = buf[idx + 1];
        const b2 = buf[idx + 2];
        let val = (b0 | (b1 << 8) | (b2 << 16));
        if (val & 0x800000) val |= ~0xffffff;
        channelData[ch][i] = val / 8388608.0;
      }
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

// -------------------------------------------------------------
// In-Memory Storage Mock for IndexedDB
// -------------------------------------------------------------
class MockAssetStorage {
  constructor() {
    this.projects = new Map();
    this.autoSave = null;
    this.assets = new Map();
    this.binaries = new Map();
  }

  async saveAsset(asset, rawBytes) {
    this.assets.set(asset.id, JSON.parse(JSON.stringify(asset)));
    if (rawBytes) this.binaries.set(asset.id, rawBytes);
  }

  async getAsset(assetId) {
    return this.assets.get(assetId) || null;
  }

  async getAssetBinary(assetId) {
    return this.binaries.get(assetId) || null;
  }

  async hasAssetBinary(assetId) {
    return this.binaries.has(assetId);
  }

  async saveProject(project) {
    this.projects.set(project.metadata.id, JSON.parse(JSON.stringify(project)));
  }

  async getProject(id) {
    const p = this.projects.get(id);
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }

  async getAllProjects() {
    return Array.from(this.projects.values()).map((p) => ({
      id: p.metadata.id,
      name: p.metadata.name,
      createdAt: p.metadata.createdAt,
      updatedAt: p.metadata.updatedAt,
      version: p.metadata.version,
      clipCount: p.clips.length,
      trackCount: p.tracks.length,
      duration: p.metadata.duration,
    }));
  }

  async deleteProject(id) {
    this.projects.delete(id);
  }

  async saveAutoSave(project, savedAt = Date.now()) {
    this.autoSave = {
      id: 'active_session',
      project: JSON.parse(JSON.stringify(project)),
      savedAt,
    };
  }

  async getAutoSave() {
    return this.autoSave ? JSON.parse(JSON.stringify(this.autoSave)) : null;
  }

  async clearAutoSave() {
    this.autoSave = null;
  }
}

// -------------------------------------------------------------
// Load Compiled Modules
// -------------------------------------------------------------
const timelineCompiledPath = path.resolve('src/audio/timeline/TimelineModel.compiled.mjs');
const { TimelineModel } = await import(pathToFileURL(timelineCompiledPath).href);

const graphCompiledPath = path.resolve('src/audio/routing/AudioGraphModel.compiled.mjs');
const { AudioGraphModel } = await import(pathToFileURL(graphCompiledPath).href);

const remixCompiledPath = path.resolve('src/audio/remix/RemixComposerModel.compiled.mjs');
const { RemixComposerModel } = await import(pathToFileURL(remixCompiledPath).href);

const engineCompiledPath = path.resolve('src/audio/AudioEngine.compiled.mjs');
const { AudioEngine } = await import(pathToFileURL(engineCompiledPath).href);

const projectManagerPath = path.resolve('src/audio/project/ProjectManager.compiled.mjs');
const { ProjectManager } = await import(pathToFileURL(projectManagerPath).href);

const exportEnginePath = path.resolve('src/audio/export/AudioExportEngine.compiled.mjs');
const { AudioExportEngine } = await import(pathToFileURL(exportEnginePath).href);

// -------------------------------------------------------------
// Tests
// -------------------------------------------------------------
test('AudioWeave Studio — Persistence & Audio Export Engine Test Suite', async (t) => {
  const wavPath = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s/vocals.wav');
  assert.ok(fs.existsSync(wavPath), 'Real test audio source file must exist');
  const sourceBuffer = parseWavBuffer(fs.readFileSync(wavPath));

  const timeline = new TimelineModel();
  const routing = new AudioGraphModel();
  const remix = new RemixComposerModel();
  const engine = new AudioEngine();
  const mockStorage = new MockAssetStorage();

  // Create ProjectManager instance with injected mockStorage
  const projManager = new ProjectManager(timeline, routing, remix, engine, mockStorage);

  // Setup sample tracks and clips in timeline
  timeline.registerAsset('asset-vocals', sourceBuffer);
  timeline.addClip({
    id: 'clip-v-1',
    trackId: 'track-1',
    assetId: 'asset-vocals',
    name: 'Vocals Lead',
    startOffset: 0,
    duration: 8.0,
    sourceOffset: 0,
    color: '#06b6d4',
  }, false);

  timeline.addClip({
    id: 'clip-v-2',
    trackId: 'track-1',
    assetId: 'asset-vocals',
    name: 'Vocals Hook',
    startOffset: 8.0,
    duration: 7.0,
    sourceOffset: 8.0,
    color: '#06b6d4',
  }, false);

  // -----------------------------------------------------------
  // 1. Project Schema v2.0.0 & Capture State
  // -----------------------------------------------------------
  await t.test('1. Capture project state conforms to schema v2.0.0 with zero binary bloat', () => {
    const state = projManager.captureCurrentState();

    assert.equal(state.metadata.schemaVersion, '2.0.0', 'Schema version must be 2.0.0');
    assert.ok(state.metadata.id.startsWith('proj-'), 'Project ID must have valid prefix');
    assert.equal(state.metadata.name, 'Untitled Session');
    assert.equal(state.clips.length, 2, 'Clips count matches timeline clips');
    assert.equal(state.tracks.length, 4, 'Includes 4 default tracks');
    assert.ok(Array.isArray(state.assetReferences), 'Asset references array exists');
    assert.ok(state.assetReferences.includes('asset-vocals'), 'Asset reference registered');
    assert.ok(!JSON.stringify(state).includes('Float32Array'), 'Project state stores zero binary raw samples');
  });

  // -----------------------------------------------------------
  // 2. Project Save & List
  // -----------------------------------------------------------
  await t.test('2. Save project persists to storage and reflects in project listing', async () => {
    const saved = await projManager.saveProject();
    assert.ok(saved.metadata.id, 'Saved state has valid project ID');

    const list = await projManager.listProjects();
    assert.equal(list.length, 1, 'Project list contains exactly 1 saved project');
    assert.equal(list[0].id, saved.metadata.id);
    assert.equal(list[0].clipCount, 2);
  });

  // -----------------------------------------------------------
  // 3. Save As & Rename
  // -----------------------------------------------------------
  await t.test('3. Save As creates independent copy; Rename updates project metadata', async () => {
    const originalId = projManager.getCurrentProjectId();
    await projManager.saveAs('Remix Version Alpha');

    const newId = projManager.getCurrentProjectId();
    assert.notEqual(newId, originalId, 'Save As must generate distinct project ID');
    assert.equal(projManager.getCurrentProjectName(), 'Remix Version Alpha');

    const list = await projManager.listProjects();
    assert.equal(list.length, 2, 'Project list now contains 2 projects');

    // Test Rename
    await projManager.renameProject('Remix Version Beta');
    assert.equal(projManager.getCurrentProjectName(), 'Remix Version Beta');
  });

  // -----------------------------------------------------------
  // 4. Open Project & New Project
  // -----------------------------------------------------------
  await t.test('4. Open project restores timeline, clips, and routing; New project resets', async () => {
    const currentId = projManager.getCurrentProjectId();

    // Reset project
    projManager.newProject('Fresh Session');
    assert.equal(projManager.getCurrentProjectName(), 'Fresh Session');
    assert.equal(timeline.getAllClips().length, 0, 'New project clears clips');

    // Reopen previous project
    const opened = await projManager.openProject(currentId);
    assert.ok(opened, 'Project successfully opened');
    assert.equal(projManager.getCurrentProjectName(), 'Remix Version Beta');
    assert.equal(timeline.getAllClips().length, 2, 'Clips successfully restored');
    assert.equal(timeline.getAllClips()[0].name, 'Vocals Lead');
  });

  // -----------------------------------------------------------
  // 5. Crash Recovery & Auto-Save
  // -----------------------------------------------------------
  await t.test('5. Auto-save snapshot detects unsaved changes and restores on recovery', async () => {
    // Simulate auto-save snapshot
    const state = projManager.captureCurrentState();
    state.metadata.updatedAt = Date.now() + 10000;
    await mockStorage.saveAutoSave(state, Date.now() + 10000);

    const recovery = await projManager.checkRecovery();
    assert.ok(recovery, 'Recovery state detected when autosave is newer');
    assert.equal(recovery.metadata.id, state.metadata.id);

    // Clear timeline to test recovery restoration
    timeline.clearAll();
    assert.equal(timeline.getAllClips().length, 0);

    // Perform recovery
    await projManager.recoverProject(recovery);
    assert.equal(timeline.getAllClips().length, 2, 'Recovered session restored clips');

    // Auto-save must now be cleared
    const checkAfter = await projManager.checkRecovery();
    assert.equal(checkAfter, null, 'Auto-save cleared after recovery');
  });

  // -----------------------------------------------------------
  // 6. Delete Project
  // -----------------------------------------------------------
  await t.test('6. Delete project removes session from storage and resets workspace', async () => {
    const idToDelete = projManager.getCurrentProjectId();
    await projManager.deleteProject(idToDelete);

    const list = await projManager.listProjects();
    assert.equal(list.some((p) => p.id === idToDelete), false, 'Project removed from storage');
    assert.equal(projManager.getCurrentProjectName(), 'Untitled Session', 'Resets to new session');
  });

  // Re-seed timeline with clips for export tests
  timeline.addClip({
    id: 'clip-v-1',
    trackId: 'track-1',
    assetId: 'asset-vocals',
    name: 'Vocals Lead',
    startOffset: 0,
    duration: 8.0,
    sourceOffset: 0,
    color: '#06b6d4',
  }, false);

  // -----------------------------------------------------------
  // 7. Full Mix WAV Export (16-bit PCM @ 44.1kHz)
  // -----------------------------------------------------------
  await t.test('7. Render Full Mix to 16-bit PCM WAV (44.1kHz)', async () => {
    const result = await AudioExportEngine.exportAudio(
      {
        target: 'full_mix',
        format: 'wav',
        sampleRate: 44100,
        bitDepth: 16,
        filename: 'FullMix_16bit',
      },
      timeline,
      remix
    );

    assert.ok(result.blob, 'Result blob generated');
    assert.equal(result.filename, 'FullMix_16bit_FullMix.wav');
    assert.equal(result.validation.sampleRate, 44100);
    assert.equal(result.validation.isValid, true);

    // Parse generated WAV bytes
    const wavBytes = Buffer.from(await result.blob.arrayBuffer());
    const parsed = parseWavBuffer(wavBytes);

    assert.equal(parsed.numberOfChannels, 2, 'Stereo channels (2)');
    assert.equal(parsed.sampleRate, 44100, 'Sample rate matches 44.1kHz');
    assert.ok(Math.abs(parsed.duration - timeline.getTotalDuration()) < 0.1, 'Duration matches timeline total');

    // Check sample amplitude
    const leftCh = parsed.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < leftCh.length; i++) {
      const abs = Math.abs(leftCh[i]);
      if (abs > peak) peak = abs;
    }
    assert.ok(peak > 0.05, `Peak amplitude (${peak.toFixed(4)}) must contain active audio`);
  });

  // -----------------------------------------------------------
  // 8. 24-bit PCM WAV Export @ 48kHz
  // -----------------------------------------------------------
  await t.test('8. Render 24-bit PCM WAV @ 48kHz High-Fidelity', async () => {
    const result = await AudioExportEngine.exportAudio(
      {
        target: 'full_mix',
        format: 'wav',
        sampleRate: 48000,
        bitDepth: 24,
        filename: 'StudioMaster_24bit',
      },
      timeline,
      remix
    );

    assert.equal(result.validation.sampleRate, 48000);
    assert.equal(result.validation.isValid, true);

    const wavBytes = Buffer.from(await result.blob.arrayBuffer());
    const parsed = parseWavBuffer(wavBytes);
    assert.equal(parsed.sampleRate, 48000, 'Sample rate 48kHz verified');
    assert.equal(parsed.numberOfChannels, 2);
  });

  // -----------------------------------------------------------
  // 9. Region Export (Cropped start/end timestamps)
  // -----------------------------------------------------------
  await t.test('9. Render Selected Region strictly between start and end seconds', async () => {
    const result = await AudioExportEngine.exportAudio(
      {
        target: 'selected_region',
        format: 'wav',
        sampleRate: 44100,
        bitDepth: 16,
        regionStart: 2.0,
        regionEnd: 5.0,
        filename: 'Region_2s_to_5s',
      },
      timeline,
      remix
    );

    const wavBytes = Buffer.from(await result.blob.arrayBuffer());
    const parsed = parseWavBuffer(wavBytes);
    assert.ok(Math.abs(parsed.duration - 3.0) < 0.05, `Region duration must be exactly 3.0s (got ${parsed.duration.toFixed(3)}s)`);
  });

  // -----------------------------------------------------------
  // 10. Multi-Stem Synchronized Export
  // -----------------------------------------------------------
  await t.test('10. Export all 4 synchronized stems with matching duration', async () => {
    const stemResults = await AudioExportEngine.exportStemSet(timeline, 44100, 16);

    assert.ok(stemResults.vocals, 'Vocals stem generated');
    assert.ok(stemResults.drums, 'Drums stem generated');
    assert.ok(stemResults.bass, 'Bass stem generated');
    assert.ok(stemResults.other, 'Other stem generated');

    const vocalsParsed = parseWavBuffer(Buffer.from(await stemResults.vocals.blob.arrayBuffer()));
    const drumsParsed = parseWavBuffer(Buffer.from(await stemResults.drums.blob.arrayBuffer()));

    assert.equal(vocalsParsed.duration, drumsParsed.duration, 'All stems must have synchronized identical length');
  });

  // -----------------------------------------------------------
  // 11. Backend MP3 Export via FFmpeg API & Offline Fallback
  // -----------------------------------------------------------
  await t.test('11. MP3 Export with Backend conversion and graceful WAV fallback', async () => {
    // 1. Test offline graceful fallback when server endpoint is unavailable
    const fallbackResult = await AudioExportEngine.exportAudio(
      {
        target: 'selected_region',
        format: 'mp3',
        sampleRate: 44100,
        bitDepth: 16,
        regionStart: 0,
        regionEnd: 2.0,
        filename: 'FallbackTest',
      },
      timeline,
      remix
    );
    assert.ok(fallbackResult.blob, 'Blob generated on fallback');
    assert.equal(fallbackResult.validation.isValid, true, 'Fallback audio remains 100% structurally valid');

    // 2. Test successful MP3 conversion with backend response
    const mockMp3Buffer = Buffer.from([0xff, 0xfb, 0x90, 0x44, ...new Array(2000).fill(0xaa)]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/audio/export/mp3')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          blob: async () => new Blob([mockMp3Buffer], { type: 'audio/mpeg' }),
        };
      }
      return originalFetch ? originalFetch(url) : { ok: false };
    };

    const mp3Result = await AudioExportEngine.exportAudio(
      {
        target: 'selected_region',
        format: 'mp3',
        sampleRate: 44100,
        bitDepth: 16,
        regionStart: 0,
        regionEnd: 2.0,
        filename: 'SuccessfulMp3Test',
      },
      timeline,
      remix
    );

    assert.ok(mp3Result.filename.endsWith('.mp3'), `Filename must have .mp3 extension (got ${mp3Result.filename})`);
    assert.ok(mp3Result.blob.size > 1000, 'Valid MP3 blob size');
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------
  // 12. Audio Quality & Header Validation
  // -----------------------------------------------------------
  await t.test('12. Re-decode and validate exported audio files (validateExportBlob)', async () => {
    const totalDur = timeline.getTotalDuration();
    const result = await AudioExportEngine.exportAudio(
      {
        target: 'full_mix',
        format: 'wav',
        sampleRate: 44100,
        bitDepth: 16,
        filename: 'ValidationTest',
      },
      timeline,
      remix
    );

    const validation = await AudioExportEngine.validateExportBlob(result.blob, totalDur, 44100);
    assert.equal(validation.isValid, true, 'Exported audio blob is structurally valid');
    assert.equal(validation.sampleRate, 44100);
    assert.equal(validation.channels, 2);
    assert.ok(validation.duration > 0);
    assert.ok(validation.maxPeak > 0, 'Audio blob contains real audible signal peaks');
  });

  projManager.stopAutoSave();
});
