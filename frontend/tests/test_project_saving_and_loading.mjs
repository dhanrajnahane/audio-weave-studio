import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * =====================================================================
 * AudioWeave Studio — Complete Project Saving & Loading Acceptance Tests
 * =====================================================================
 * Requirements Verified:
 * 1. Create a new project with a custom name.
 * 2. Save imported audio assets in IndexedDB.
 * 3. Save separated Demucs stems in IndexedDB with raw audio binaries.
 * 4. Save timeline clips, positions, durations, and non-destructive offsets.
 * 5. Save multi-stem and master mixer settings (faders, pans, mutes, solos).
 * 6. Save effects studio settings (EQ, reverb, delay, compressor per-stem & master).
 * 7. Save remix composer detected sections and multi-arrangement sequences.
 * 8. Save smart song analysis results (BPM, beat positions, energy, stem activity).
 * 9. Simulate application close/refresh (clear all in-memory studio models).
 * 10. Reopen existing project from IndexedDB.
 * 11. Restore the complete editing state and verify audio buffers are loaded.
 * 12. Gracefully handle missing or corrupted audio assets with silent placeholders.
 */

// ---------------------------------------------------------------------
// Mock Web Audio Context & Node.js AudioParam
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

class MockAudioNode {
  constructor() {
    this.connections = new Set();
  }
  connect(dest) {
    this.connections.add(dest);
    return dest;
  }
  disconnect(dest) {
    if (dest) this.connections.delete(dest);
    else this.connections.clear();
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = new MockAudioParam(1.0);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'lowshelf';
    this.frequency = new MockAudioParam(350);
    this.gain = new MockAudioParam(0);
    this.Q = new MockAudioParam(1);
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor() {
    super();
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
  }
}

class MockDelayNode extends MockAudioNode {
  constructor(maxDelayTime = 2.0) {
    super();
    this.maxDelayTime = maxDelayTime;
    this.delayTime = new MockAudioParam(0.25);
  }
}

class MockConvolverNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
  }
}

class MockStereoPannerNode extends MockAudioNode {
  constructor() {
    super();
    this.pan = new MockAudioParam(0);
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor() {
    super();
    this.frequencyBinCount = 1024;
  }
  getByteTimeDomainData(arr) {
    arr.fill(128);
  }
}

class MockSourceNode extends MockAudioNode {
  constructor(ctx) {
    super();
    this.context = ctx;
    this.buffer = null;
    this.playbackRate = new MockAudioParam(1);
    this.onended = null;
  }
  start() {}
  stop() {}
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = new MockGainNode();
  }
  createGain() { return new MockGainNode(); }
  createAnalyser() { return new MockAnalyserNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createDelay(max) { return new MockDelayNode(max); }
  createConvolver() { return new MockConvolverNode(); }
  createBufferSource() { return new MockSourceNode(this); }
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

class MockOfflineAudioContext extends MockAudioContext {
  constructor(channels, length, sampleRate) {
    super();
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  async startRendering() {
    return this.createBuffer(this.numberOfChannels, this.length, this.sampleRate);
  }
}

globalThis.window = {
  AudioContext: MockAudioContext,
  OfflineAudioContext: MockOfflineAudioContext,
};

// ---------------------------------------------------------------------
// WAV Parser & Encoder
// ---------------------------------------------------------------------
function parseWavBuffer(buf) {
  if (!buf || buf.length < 44) {
    throw new Error('Invalid WAV file: buffer too short or corrupted header');
  }
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV file: missing RIFF/WAVE header identifiers');
  }

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
    getChannelData: (ch) => channelData[ch],
  };
}

// ---------------------------------------------------------------------
// In-Memory Simulated IndexedDB Store
// ---------------------------------------------------------------------
class SimulatedIndexedDB {
  constructor() {
    this.projects = new Map();
    this.assets = new Map();
    this.binaries = new Map();
    this.autoSave = null;
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
      schemaVersion: p.metadata.schemaVersion,
      clipCount: p.clips.length,
      trackCount: p.tracks.length,
      duration: p.metadata.duration,
    }));
  }

  async deleteProject(id) {
    this.projects.delete(id);
  }

  async saveAsset(asset, rawBytes) {
    this.assets.set(asset.id, JSON.parse(JSON.stringify(asset)));
    if (rawBytes) {
      this.binaries.set(asset.id, rawBytes);
    }
  }

  async getAsset(assetId) {
    const a = this.assets.get(assetId);
    return a ? JSON.parse(JSON.stringify(a)) : null;
  }

  async getAllAssets() {
    return Array.from(this.assets.values());
  }

  async getAssetBinary(assetId) {
    const b = this.binaries.get(assetId);
    return b || null;
  }

  async hasAssetBinary(assetId) {
    return this.binaries.has(assetId);
  }

  async saveAssetBinary(assetId, rawBytes) {
    this.binaries.set(assetId, rawBytes);
  }

  async deleteAsset(assetId) {
    this.assets.delete(assetId);
    this.binaries.delete(assetId);
  }

  async saveAutoSave(project) {
    this.autoSave = {
      id: 'current_autosave',
      project: JSON.parse(JSON.stringify(project)),
      savedAt: Date.now(),
    };
  }

  async getAutoSave() {
    return this.autoSave ? JSON.parse(JSON.stringify(this.autoSave)) : null;
  }

  async clearAutoSave() {
    this.autoSave = null;
  }
}

// ---------------------------------------------------------------------
// Load Compiled Modules
// ---------------------------------------------------------------------
const timelinePath = path.resolve('src/audio/timeline/TimelineModel.compiled.mjs');
const { TimelineModel } = await import(pathToFileURL(timelinePath).href);

const graphPath = path.resolve('src/audio/routing/AudioGraphModel.compiled.mjs');
const { AudioGraphModel } = await import(pathToFileURL(graphPath).href);

const remixPath = path.resolve('src/audio/remix/RemixComposerModel.compiled.mjs');
const { RemixComposerModel } = await import(pathToFileURL(remixPath).href);

const enginePath = path.resolve('src/audio/AudioEngine.compiled.mjs');
const { AudioEngine } = await import(pathToFileURL(enginePath).href);

const effectsManagerPath = path.resolve('src/audio/effects/EffectsManager.compiled.mjs');
const { EffectsManager } = await import(pathToFileURL(effectsManagerPath).href);

const projectManagerPath = path.resolve('src/audio/project/ProjectManager.compiled.mjs');
const { ProjectManager } = await import(pathToFileURL(projectManagerPath).href);

// =====================================================================
// ACCEPTANCE TEST SUITE
// =====================================================================
test('AudioWeave Studio — Complete Project Saving and Loading Acceptance Suite', async (t) => {
  // Load real Demucs stem audio files
  const stemsDir = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s');
  assert.ok(fs.existsSync(stemsDir), 'Real Demucs stem directory must exist');

  const vocalsBytes = fs.readFileSync(path.join(stemsDir, 'vocals.wav')).buffer;
  const drumsBytes = fs.readFileSync(path.join(stemsDir, 'drums.wav')).buffer;
  const bassBytes = fs.readFileSync(path.join(stemsDir, 'bass.wav')).buffer;
  const otherBytes = fs.readFileSync(path.join(stemsDir, 'other.wav')).buffer;

  const vocalsBuffer = parseWavBuffer(Buffer.from(vocalsBytes));
  const drumsBuffer = parseWavBuffer(Buffer.from(drumsBytes));
  const bassBuffer = parseWavBuffer(Buffer.from(bassBytes));
  const otherBuffer = parseWavBuffer(Buffer.from(otherBytes));

  const storage = new SimulatedIndexedDB();

  // Create active studio models
  let timeline = new TimelineModel();
  let routing = new AudioGraphModel();
  let remix = new RemixComposerModel();
  let engine = new AudioEngine();
  let effects = new EffectsManager();
  let projManager = new ProjectManager(timeline, routing, remix, engine, storage, effects);

  let savedProjectId = '';

  // -------------------------------------------------------------------
  // 1. Create New Project & Name It (Requirements 1 & 2)
  // -------------------------------------------------------------------
  await t.test('1. Create a new project and assign a custom project name', () => {
    projManager.newProject('Summer Festival Remix Session');
    assert.equal(projManager.getCurrentProjectName(), 'Summer Festival Remix Session');
    assert.ok(projManager.getCurrentProjectId().startsWith('proj-'));
    assert.equal(timeline.getAllClips().length, 0);
  });

  // -------------------------------------------------------------------
  // 2. Save Imported Assets & Separated Stems to Storage (Req 3 & 4)
  // -------------------------------------------------------------------
  await t.test('2. Save imported audio assets and separated stems into IndexedDB with binary audio', async () => {
    // Save 4 real stems to IndexedDB
    const stemSpecs = [
      { id: 'vocals', name: 'vocals.wav', bytes: vocalsBytes, buffer: vocalsBuffer },
      { id: 'drums', name: 'drums.wav', bytes: drumsBytes, buffer: drumsBuffer },
      { id: 'bass', name: 'bass.wav', bytes: bassBytes, buffer: bassBuffer },
      { id: 'other', name: 'other.wav', bytes: otherBytes, buffer: otherBuffer },
    ];

    for (const s of stemSpecs) {
      await storage.saveAsset(
        {
          id: s.id,
          filename: s.name,
          stored_filename: `user_song/${s.name}`,
          stream_url: `/storage/stems/${s.name}`,
          metadata: {
            filename: s.name,
            format: 'WAV',
            subtype: 'PCM_16',
            duration_seconds: s.buffer.duration,
            duration_formatted: '0:15',
            sample_rate: s.buffer.sampleRate,
            channels: s.buffer.numberOfChannels,
            channel_type: 'Stereo',
            frames: s.buffer.length,
            file_size_bytes: s.bytes.byteLength,
            file_size_formatted: `${(s.bytes.byteLength / 1024).toFixed(1)} KB`,
          },
          peaks: [],
          rms: [],
          max_peak: 1.0,
          createdAt: Date.now(),
        },
        s.bytes
      );

      // Register buffer in TimelineModel
      timeline.registerAsset(s.id, s.buffer);
    }

    assert.equal(await storage.hasAssetBinary('vocals'), true);
    assert.equal(await storage.hasAssetBinary('drums'), true);
    assert.equal(await storage.hasAssetBinary('bass'), true);
    assert.equal(await storage.hasAssetBinary('other'), true);

    projManager.setActiveStemSetName('song1222_15s');
    projManager.setActiveAssetId('vocals');
  });

  // -------------------------------------------------------------------
  // 3. Edit Timeline Clips (Requirement 5)
  // -------------------------------------------------------------------
  await t.test('3. Arrange timeline clips with positions, trims, and splits', () => {
    // Track 1 (Vocals): Clip 1 (0 to 6s), Clip 2 (8s to 14s, sourceOffset 8s)
    timeline.addClip({
      id: 'clip-voc-1',
      trackId: 'track-1',
      assetId: 'vocals',
      name: 'Vocals Intro',
      startOffset: 0,
      duration: 6.0,
      sourceOffset: 0,
      color: '#06b6d4',
    }, false);

    timeline.addClip({
      id: 'clip-voc-2',
      trackId: 'track-1',
      assetId: 'vocals',
      name: 'Vocals Chorus',
      startOffset: 8.0,
      duration: 6.0,
      sourceOffset: 8.0,
      color: '#06b6d4',
    }, false);

    // Track 2 (Drums): Full drums clip placed at offset 1.0s
    timeline.addClip({
      id: 'clip-drm-1',
      trackId: 'track-2',
      assetId: 'drums',
      name: 'Drums Groove',
      startOffset: 1.0,
      duration: 14.0,
      sourceOffset: 0,
      color: '#f59e0b',
    }, false);

    // Track 3 (Bass): Bass clip
    timeline.addClip({
      id: 'clip-bas-1',
      trackId: 'track-3',
      assetId: 'bass',
      name: 'Bass Line',
      startOffset: 0,
      duration: 15.0,
      sourceOffset: 0,
      color: '#a855f7',
    }, false);

    assert.equal(timeline.getAllClips().length, 4);
  });

  // -------------------------------------------------------------------
  // 4. Configure Mixer Settings (Requirement 6)
  // -------------------------------------------------------------------
  await t.test('4. Configure track and master mixer faders, pans, mutes, and solos', () => {
    // Set custom track mixer levels
    timeline.setTrackVolume('track-1', 0.82);
    timeline.setTrackPan('track-1', -0.25);
    timeline.setTrackMute('track-1', false);
    timeline.setTrackSolo('track-1', false);

    timeline.setTrackVolume('track-2', 1.15);
    timeline.setTrackPan('track-2', 0.15);

    timeline.setTrackVolume('track-3', 0.90);
    timeline.setTrackSolo('track-3', true);

    timeline.setTrackVolume('track-4', 0.75);
    timeline.setTrackMute('track-4', true);

    engine.setMasterVolume(0.88);
    engine.setMasterMute(false);

    assert.equal(timeline.getTrack('track-1').volume, 0.82);
    assert.equal(timeline.getTrack('track-1').pan, -0.25);
    assert.equal(timeline.getTrack('track-3').solo, true);
    assert.equal(timeline.getTrack('track-4').muted, true);
    assert.equal(engine.getMasterVolume(), 0.88);
  });

  // -------------------------------------------------------------------
  // 5. Configure Effects Settings (Requirement 7)
  // -------------------------------------------------------------------
  await t.test('5. Configure effects studio parameters across tracks and master bus', () => {
    // Track-1 (Vocals): Vocal Air EQ (+6dB @ 6000Hz) and Hall Reverb (3.2s decay)
    effects.setTrackEqualizer('track-1', { enabled: true, highGain: 6.0, highFreq: 6000 });
    effects.setTrackReverb('track-1', { enabled: true, decay: 3.2, wet: 0.45 });

    // Track-2 (Drums): Punchy Dynamics Compressor
    effects.setTrackCompressor('track-2', { enabled: true, threshold: -18, ratio: 6.0 });

    // Track-3 (Bass): Warm Bass Boost EQ (+7dB @ 100Hz)
    effects.setTrackEqualizer('track-3', { enabled: true, lowGain: 7.0, lowFreq: 100 });

    // Master Bus: Master Space Delay
    effects.setMasterDelay({ enabled: true, time: 0.35, feedback: 0.45, wet: 0.3 });

    assert.equal(effects.getTrackSettings('track-1').eq.highGain, 6.0);
    assert.equal(effects.getTrackSettings('track-1').reverb.decay, 3.2);
    assert.equal(effects.getTrackSettings('track-2').compressor.ratio, 6.0);
    assert.equal(effects.getMasterSettings().delay.time, 0.35);
  });

  // -------------------------------------------------------------------
  // 6. Configure Remix Composer Arrangements (Requirement 8)
  // -------------------------------------------------------------------
  await t.test('6. Save detected sections and multi-arrangement remix sequences', () => {
    const sections = [
      { id: 'sec-intro', name: 'Intro', type: 'intro', start: 0, end: 3.5, duration: 3.5, color: '#06b6d4' },
      { id: 'sec-verse', name: 'Verse 1', type: 'verse', start: 3.5, end: 8.0, duration: 4.5, color: '#10b981' },
      { id: 'sec-chorus', name: 'Chorus', type: 'chorus', start: 8.0, end: 12.0, duration: 4.0, color: '#f59e0b' },
      { id: 'sec-outro', name: 'Outro', type: 'outro', start: 12.0, end: 15.0, duration: 3.0, color: '#a855f7' },
    ];
    remix.setDetectedSections(sections);

    // Create alternative arrangement: "Club Extended Remix"
    const clubArr = remix.createArrangement('Club Extended Remix', 'club_extended');
    remix.selectArrangement(clubArr.id);

    assert.equal(remix.getActiveArrangement().name, 'Club Extended Remix');
    assert.ok(remix.getActiveArrangement().blocks.length >= 4);
  });

  // -------------------------------------------------------------------
  // 7. Save Smart Song Analysis Results (Requirement 9)
  // -------------------------------------------------------------------
  await t.test('7. Save smart song analysis results (BPM, beats, energy, stem activity)', () => {
    const analysisData = {
      filename: 'song1222_15s.wav',
      duration_seconds: 15.0,
      sample_rate: 44100,
      bpm: 126.0,
      beat_count: 31,
      beat_positions: [0.0, 0.48, 0.96, 1.44, 1.92, 2.4, 2.88, 3.36],
      silence_regions: [{ start: 0, end: 0.1, duration: 0.1 }],
      silence_count: 1,
      energy: {
        average_rms: 0.28,
        max_rms: 0.65,
        rms_dbfs: -11.0,
        peak_amplitude: 0.98,
        peak_dbfs: -0.18,
        dynamic_range_db: 10.82,
        energy_envelope: [0.1, 0.2, 0.4, 0.6, 0.8, 0.5],
      },
      sections: [
        { id: 's1', label: 'Intro', start: 0, end: 3.5, duration: 3.5, confidence: 0.92, is_estimated: false, confidence_label: 'high', energy_level: 'medium', avg_rms: 0.22 },
        { id: 's2', label: 'Verse', start: 3.5, end: 8.0, duration: 4.5, confidence: 0.88, is_estimated: false, confidence_label: 'high', energy_level: 'high', avg_rms: 0.35 },
      ],
      section_count: 2,
      stem_activity: {
        has_stems: true,
        stems_folder: 'song1222_15s',
        energy_distribution: { vocals: 28, drums: 34, bass: 22, other: 16 },
        timeline_buckets: [],
      },
      analysis_time_seconds: 0.45,
      analyzed_at: Date.now(),
      from_cache: false,
    };

    projManager.setAnalysisResult(analysisData);
    assert.equal(projManager.getAnalysisResult().bpm, 126.0);
    assert.equal(projManager.getAnalysisResult().energy.dynamic_range_db, 10.82);
  });

  // -------------------------------------------------------------------
  // 8. Save Project to Storage
  // -------------------------------------------------------------------
  await t.test('8. Save complete project to IndexedDB storage', async () => {
    const savedState = await projManager.saveProject();
    savedProjectId = savedState.metadata.id;

    assert.ok(savedProjectId);
    assert.equal(savedState.metadata.name, 'Summer Festival Remix Session');
    assert.equal(savedState.clips.length, 4);
    assert.ok(savedState.effects);
    assert.ok(savedState.analysis);
    assert.equal(savedState.analysis.bpm, 126.0);
    assert.equal(savedState.activeStemSetName, 'song1222_15s');

    // Verify raw binaries exist in storage for all 4 stems
    assert.ok(await storage.hasAssetBinary('vocals'));
    assert.ok(await storage.hasAssetBinary('drums'));
    assert.ok(await storage.hasAssetBinary('bass'));
    assert.ok(await storage.hasAssetBinary('other'));
  });

  // -------------------------------------------------------------------
  // 9. Simulate Application Close / Refresh (Clear all in-memory instances)
  // -------------------------------------------------------------------
  await t.test('9. Simulate app restart: Destroy in-memory state and verify clean slate', () => {
    timeline = new TimelineModel();
    routing = new AudioGraphModel();
    remix = new RemixComposerModel();
    engine = new AudioEngine();
    effects = new EffectsManager();
    projManager = new ProjectManager(timeline, routing, remix, engine, storage, effects);

    // Verify completely empty state
    assert.equal(timeline.getAllClips().length, 0);
    assert.equal(timeline.getAsset('vocals'), undefined);
    assert.equal(timeline.getAsset('drums'), undefined);
    assert.equal(projManager.getCurrentProjectName(), 'Untitled Session');
    assert.equal(projManager.getAnalysisResult(), null);
    assert.equal(effects.getTrackSettings('track-1').eq.highGain, 0.0);
  });

  // -------------------------------------------------------------------
  // 10. Reopen Saved Project from IndexedDB (Requirements 10 & 11)
  // -------------------------------------------------------------------
  await t.test('10. Reopen saved project and verify full restoration of audio and editing state', async () => {
    const report = await projManager.openProject(savedProjectId);

    assert.equal(report.success, true);
    assert.equal(report.projectId, savedProjectId);
    assert.equal(report.projectName, 'Summer Festival Remix Session');
    assert.equal(report.restoredClipsCount, 4);
    assert.equal(report.restoredAssetsCount, 4);
    assert.equal(report.missingAssets.length, 0);
    assert.equal(report.corruptedAssets.length, 0);
    assert.equal(report.analysisRestored, true);
    assert.equal(report.effectsRestored, true);
    assert.equal(report.mixerRestored, true);

    // Verify Audio Buffers are completely restored in TimelineModel
    const restoredVocals = timeline.getAsset('vocals');
    const restoredDrums = timeline.getAsset('drums');
    const restoredBass = timeline.getAsset('bass');
    const restoredOther = timeline.getAsset('other');

    assert.ok(restoredVocals, 'Vocals AudioBuffer must be restored in TimelineModel');
    assert.ok(restoredDrums, 'Drums AudioBuffer must be restored in TimelineModel');
    assert.ok(restoredBass, 'Bass AudioBuffer must be restored in TimelineModel');
    assert.ok(restoredOther, 'Other AudioBuffer must be restored in TimelineModel');

    assert.equal(restoredVocals.duration, 15.0);
    assert.equal(restoredDrums.duration, 15.0);
    assert.equal(restoredBass.duration, 15.0);
    assert.equal(restoredOther.duration, 15.0);

    // Verify Timeline Clips
    const clips = timeline.getAllClips();
    assert.equal(clips.length, 4);

    const voc1 = clips.find((c) => c.id === 'clip-voc-1');
    assert.ok(voc1);
    assert.equal(voc1.startOffset, 0);
    assert.equal(voc1.duration, 6.0);
    assert.equal(voc1.sourceOffset, 0);

    const voc2 = clips.find((c) => c.id === 'clip-voc-2');
    assert.ok(voc2);
    assert.equal(voc2.startOffset, 8.0);
    assert.equal(voc2.duration, 6.0);
    assert.equal(voc2.sourceOffset, 8.0);

    const drm1 = clips.find((c) => c.id === 'clip-drm-1');
    assert.ok(drm1);
    assert.equal(drm1.startOffset, 1.0);
    assert.equal(drm1.duration, 14.0);

    // Verify Mixer Settings Restored
    assert.equal(timeline.getTrack('track-1').volume, 0.82);
    assert.equal(timeline.getTrack('track-1').pan, -0.25);
    assert.equal(timeline.getTrack('track-3').solo, true);
    assert.equal(timeline.getTrack('track-4').muted, true);
    assert.equal(engine.getMasterVolume(), 0.88);

    // Verify Effects Studio Restored
    assert.equal(effects.getTrackSettings('track-1').eq.highGain, 6.0);
    assert.equal(effects.getTrackSettings('track-1').reverb.decay, 3.2);
    assert.equal(effects.getTrackSettings('track-2').compressor.ratio, 6.0);
    assert.equal(effects.getMasterSettings().delay.time, 0.35);

    // Verify Remix Composer Restored
    assert.equal(remix.getDetectedSections().length, 4);
    assert.equal(remix.getActiveArrangement().name, 'Club Extended Remix');
    assert.ok(remix.getActiveArrangement().blocks.length >= 4);

    // Verify Song Analysis Restored
    const restoredAnalysis = projManager.getAnalysisResult();
    assert.ok(restoredAnalysis);
    assert.equal(restoredAnalysis.bpm, 126.0);
    assert.equal(restoredAnalysis.energy.dynamic_range_db, 10.82);
    assert.equal(restoredAnalysis.stem_activity.energy_distribution.drums, 34);

    // Verify Playback Engine is loaded with active tracks
    assert.ok(engine.getTrack('vocals')?.buffer, 'Engine must have vocals buffer ready to play');
    assert.ok(engine.getTrack('drums')?.buffer, 'Engine must have drums buffer ready to play');
    assert.equal(projManager.getActiveStemSetName(), 'song1222_15s');
  });

  // -------------------------------------------------------------------
  // 11. Graceful Handling of Missing and Corrupted Assets (Requirement 12)
  // -------------------------------------------------------------------
  await t.test('11. Graceful handling: Missing and corrupted audio assets are replaced with safe placeholders', async () => {
    // Deliberately simulate:
    // 1. Missing asset: Delete 'drums' binary from IndexedDB
    await storage.deleteAsset('drums');

    // 2. Corrupted asset: Overwrite 'bass' binary with invalid corrupted garbage
    const garbageBytes = new Uint8Array([0x00, 0xff, 0xee, 0xdd, 0x11, 0x22]).buffer;
    await storage.saveAssetBinary('bass', garbageBytes);

    // Re-initialize clean in-memory studio
    timeline = new TimelineModel();
    routing = new AudioGraphModel();
    remix = new RemixComposerModel();
    engine = new AudioEngine();
    effects = new EffectsManager();
    projManager = new ProjectManager(timeline, routing, remix, engine, storage, effects);

    // Reopen project with corrupted/missing assets
    const report = await projManager.openProject(savedProjectId);

    // Project should open cleanly without unhandled exception!
    assert.equal(report.success, true);
    assert.equal(report.restoredClipsCount, 4);

    // Verify detection of missing and corrupted assets
    assert.ok(report.missingAssets.includes('drums'), 'Drums must be detected as missing asset');
    assert.ok(report.corruptedAssets.includes('bass'), 'Bass must be detected as corrupted asset');

    // Verify silent placeholder buffers were created to preserve timeline integrity
    const drumsPlaceholder = timeline.getAsset('drums');
    assert.ok(drumsPlaceholder, 'Silent placeholder buffer must be created for missing drums');
    assert.ok(drumsPlaceholder.duration >= 14.0, 'Placeholder duration must cover clip span');

    const bassPlaceholder = timeline.getAsset('bass');
    assert.ok(bassPlaceholder, 'Silent placeholder buffer must be created for corrupted bass');
    assert.ok(bassPlaceholder.duration >= 15.0, 'Placeholder duration must cover clip span');

    // Verify healthy audio asset (vocals) still restored with real audio
    const healthyVocals = timeline.getAsset('vocals');
    assert.ok(healthyVocals);
    assert.equal(healthyVocals.duration, 15.0);

    // Verify timeline editing operations still work smoothly with placeholders
    const allClips = timeline.getAllClips();
    assert.equal(allClips.length, 4);

    // Moving or trimming a clip on the missing track proceeds without error
    const moved = timeline.moveClip('clip-drm-1', 2.5, false);
    assert.equal(moved, true);
    assert.equal(timeline.getClip('clip-drm-1').startOffset, 2.5);
  });
});
