import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ============================================================================
 * AudioWeave Studio — Stem Track Connection & Data Flow Regression Test Suite
 * ============================================================================
 * Verifies:
 * 1. Real Demucs 15-second stem audio files (Vocals, Drums, Bass, Other).
 * 2. Distinctness, RMS, peak amplitudes, and sample rate integrity.
 * 3. Single Source of Truth for stem IDs across:
 *    - Timeline tracks
 *    - Timeline clips
 *    - Mixer channels
 *    - AudioEngine playback nodes
 *    - Mute/solo gain routing
 * 4. Direct stem playback & auditioning at preserved timeline position.
 * 5. Independent solo & mute per stem.
 * 6. Simultaneous synchronized 4-stem playback.
 * 7. Track selection synchronization between Timeline and Mixer.
 * 8. Zero duplicate generic tracks.
 * ============================================================================
 */

// -------------------------------------------------------------
// Web Audio API Node.js Mock Environment
// -------------------------------------------------------------

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
    this.sampleRate = 44100;
    this.destination = {};
  }
  createGain() { return new MockGainNode(); }
  createAnalyser() { return new MockAnalyserNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createBufferSource() { return new MockSourceNode(this); }
  resume() { return Promise.resolve(); }
}

globalThis.window = {
  AudioContext: MockAudioContext,
  webkitAudioContext: MockAudioContext,
};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// -------------------------------------------------------------
// Real WAV Parser (Reads raw 16-bit PCM samples into Float32)
// -------------------------------------------------------------

function parseRealWav(filePath) {
  const buf = fs.readFileSync(filePath);
  let offset = 12;
  let numChannels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

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
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(new Float32Array(frames));
  }

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

function calculateRMS(floatArray) {
  let sumSq = 0;
  for (let i = 0; i < floatArray.length; i++) {
    sumSq += floatArray[i] * floatArray[i];
  }
  return Math.sqrt(sumSq / floatArray.length);
}

function calculatePeak(floatArray) {
  let peak = 0;
  for (let i = 0; i < floatArray.length; i++) {
    const abs = Math.abs(floatArray[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

// -------------------------------------------------------------
// Import Compiled Modules
// -------------------------------------------------------------

const engineModulePath = pathToFileURL(path.resolve('src/audio/AudioEngine.compiled.mjs')).href;
const timelineModulePath = pathToFileURL(path.resolve('src/audio/timeline/TimelineModel.compiled.mjs')).href;

const { AudioEngine } = await import(engineModulePath);
const { TimelineModel, normalizeTrackId, STEM_TRACK_IDS } = await import(timelineModulePath);

// -------------------------------------------------------------
// Test Execution
// -------------------------------------------------------------

test('AudioWeave Studio — Stem Track Connection & Data Flow Regression Suite', async (t) => {
  const stemsBaseDir = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s');
  const stemFiles = {
    vocals: path.join(stemsBaseDir, 'vocals.wav'),
    drums: path.join(stemsBaseDir, 'drums.wav'),
    bass: path.join(stemsBaseDir, 'bass.wav'),
    other: path.join(stemsBaseDir, 'other.wav'),
  };

  // Verify all 4 real Demucs stem files exist on disk
  for (const [stem, filePath] of Object.entries(stemFiles)) {
    assert.ok(fs.existsSync(filePath), `Real Demucs stem file for '${stem}' must exist at ${filePath}`);
  }

  // -------------------------------------------------------------
  // STEP 6: Real Audio Sample Verification
  // -------------------------------------------------------------
  await t.test('Step 6. Real Demucs Audio Verification: Samples, Duration, RMS, Peaks, Sample Rate', () => {
    const parsedBuffers = {};
    const rmsValues = {};
    const peakValues = {};

    for (const [stem, filePath] of Object.entries(stemFiles)) {
      const parsed = parseRealWav(filePath);
      parsedBuffers[stem] = parsed;

      // 1. Duration check
      assert.ok(
        Math.abs(parsed.duration - 15.0) < 0.1,
        `Stem '${stem}' duration should be ~15.0s, got ${parsed.duration.toFixed(3)}s`
      );

      // 2. Sample rate check
      assert.equal(parsed.sampleRate, 44100, `Stem '${stem}' sample rate must be 44100Hz`);
      assert.equal(parsed.numberOfChannels, 2, `Stem '${stem}' must be 2-channel stereo`);

      // 3. Audio RMS & Peak
      const ch0 = parsed.getChannelData(0);
      const rms = calculateRMS(ch0);
      const peak = calculatePeak(ch0);

      rmsValues[stem] = rms;
      peakValues[stem] = peak;

      assert.ok(rms > 0.005, `Stem '${stem}' RMS (${rms.toFixed(4)}) must contain audible audio`);
      assert.ok(peak > 0.05, `Stem '${stem}' Peak (${peak.toFixed(4)}) must have dynamic peaks`);
      assert.ok(peak <= 1.0, `Stem '${stem}' Peak must not clip (> 1.0)`);
    }

    // 4. Confirm Vocals, Drums, Bass, Other contain distinct audio
    // Compare mean absolute difference across full audio length
    const stems = ['vocals', 'drums', 'bass', 'other'];
    for (let i = 0; i < stems.length; i++) {
      for (let j = i + 1; j < stems.length; j++) {
        const s1 = stems[i];
        const s2 = stems[j];
        const d1 = parsedBuffers[s1].getChannelData(0);
        const d2 = parsedBuffers[s2].getChannelData(0);

        let diffSum = 0;
        const sampleCount = Math.min(d1.length, d2.length);
        for (let k = 0; k < sampleCount; k++) {
          diffSum += Math.abs(d1[k] - d2[k]);
        }
        const meanDiff = diffSum / sampleCount;
        assert.ok(
          meanDiff > 0.01,
          `Stems '${s1}' and '${s2}' must contain distinct acoustic audio (mean diff: ${meanDiff.toFixed(4)})`
        );
      }
    }
  });

  // -------------------------------------------------------------
  // STEP 2: Single Source of Truth
  // -------------------------------------------------------------
  await t.test('Step 2. Single Source of Truth: Canonical Stem IDs across Timeline, Clips, Engine, and Mixer', () => {
    const timeline = new TimelineModel();
    const engine = new AudioEngine();
    engine.setTimelineModel(timeline);

    const defaultTracks = timeline.getTracks();
    assert.equal(defaultTracks.length, 4, 'Timeline must initialize with exactly 4 tracks');

    const expectedStemIds = ['vocals', 'drums', 'bass', 'other'];
    const trackIds = defaultTracks.map((t) => t.id);

    assert.deepEqual(trackIds, expectedStemIds, 'Timeline tracks must use canonical stem IDs');

    // Test canonical normalizer
    assert.equal(normalizeTrackId('track-1'), 'vocals');
    assert.equal(normalizeTrackId('track-2'), 'drums');
    assert.equal(normalizeTrackId('track-3'), 'bass');
    assert.equal(normalizeTrackId('track-4'), 'other');
    assert.equal(normalizeTrackId('vocals'), 'vocals');
    assert.equal(normalizeTrackId('Vocals'), 'vocals');

    // Backward-compatible query
    const vocTrack = timeline.getTrack('track-1');
    assert.ok(vocTrack, 'Querying track-1 must return Vocals track');
    assert.equal(vocTrack.id, 'vocals');
    assert.equal(vocTrack.name, 'Vocals');

    // Load real stem buffers into engine and timeline
    for (const stem of expectedStemIds) {
      const parsed = parseRealWav(stemFiles[stem]);
      engine.loadBuffer(parsed, stem, stem.toUpperCase());
      timeline.registerAsset(stem, parsed);
      timeline.addClip({
        id: `clip-${stem}`,
        trackId: stem,
        assetId: stem,
        name: stem.toUpperCase(),
        startOffset: 0,
        duration: parsed.duration,
        sourceOffset: 0,
      }, false);
    }

    // Verify clips placed on canonical tracks
    for (const stem of expectedStemIds) {
      const clips = timeline.getTrackClips(stem);
      assert.equal(clips.length, 1, `Track '${stem}' must contain exactly 1 clip`);
      assert.equal(clips[0].trackId, stem);
      assert.equal(clips[0].assetId, stem);
    }

    // Verify Engine and Mixer share the exact same track IDs
    const mixerTracks = engine.getTrackStates();
    assert.equal(mixerTracks.length, 4, 'Mixer must have exactly 4 channels loaded');
    const mixerIds = mixerTracks.map((t) => t.id);
    assert.deepEqual(mixerIds, expectedStemIds, 'Mixer channels must strictly match canonical stem IDs');
  });

  // -------------------------------------------------------------
  // STEP 3: Direct Playback of Named Stems & Synchronized Position
  // -------------------------------------------------------------
  await t.test('Step 3. Direct Playback: Clicking or auditioning named stem solos & plays it at timeline position', () => {
    const timeline = new TimelineModel();
    const engine = new AudioEngine();
    engine.setTimelineModel(timeline);

    for (const stem of ['vocals', 'drums', 'bass', 'other']) {
      const parsed = parseRealWav(stemFiles[stem]);
      engine.loadBuffer(parsed, stem, stem.toUpperCase());
      timeline.registerAsset(stem, parsed);
      timeline.addClip({
        id: `clip-${stem}`,
        trackId: stem,
        assetId: stem,
        name: stem.toUpperCase(),
        startOffset: 0,
        duration: parsed.duration,
        sourceOffset: 0,
      }, false);
    }

    // 1. Audition Vocals from t = 3.5s
    engine.playStem('vocals', 3.5);

    assert.equal(engine.getIsPlaying(), true, 'Engine must be playing');
    assert.equal(engine.getCurrentTime(), 3.5, 'Playback must start at specified timeline offset (3.5s)');

    // Verify only vocals is soloed
    const vocalsNode = engine.getTrack('vocals');
    const drumsNode = engine.getTrack('drums');
    const bassNode = engine.getTrack('bass');
    const otherNode = engine.getTrack('other');

    assert.equal(vocalsNode.solo, true, 'Vocals must be soloed');
    assert.equal(drumsNode.solo, false, 'Drums must not be soloed');
    assert.equal(bassNode.solo, false, 'Bass must not be soloed');
    assert.equal(otherNode.solo, false, 'Other must not be soloed');

    assert.equal(vocalsNode.gainNode.gain.value, 1.0, 'Vocals gain must be 1.0 (audible)');
    assert.equal(drumsNode.gainNode.gain.value, 0.0, 'Drums gain must be silenced immediately');
    assert.equal(bassNode.gainNode.gain.value, 0.0, 'Bass gain must be silenced immediately');
    assert.equal(otherNode.gainNode.gain.value, 0.0, 'Other gain must be silenced immediately');

    // 2. Switch to Drums audition at current position
    engine.playStem('drums');
    assert.equal(vocalsNode.gainNode.gain.value, 0.0, 'Vocals must be silenced when Drums auditioned');
    assert.equal(drumsNode.gainNode.gain.value, 1.0, 'Drums must become audible');
    assert.equal(drumsNode.solo, true);
    assert.equal(vocalsNode.solo, false);

    engine.stop();
  });

  // -------------------------------------------------------------
  // STEP 4: Mixer Controls (Solo, Mute, Volume, Pan)
  // -------------------------------------------------------------
  await t.test('Step 4. Mixer Controls: Solo, Mute, Volume, Pan operate directly on stem audio', () => {
    const timeline = new TimelineModel();
    const engine = new AudioEngine();
    engine.setTimelineModel(timeline);

    for (const stem of ['vocals', 'drums', 'bass', 'other']) {
      const parsed = parseRealWav(stemFiles[stem]);
      engine.loadBuffer(parsed, stem, stem.toUpperCase());
      timeline.registerAsset(stem, parsed);
      timeline.addClip({
        id: `clip-${stem}`,
        trackId: stem,
        assetId: stem,
        name: stem.toUpperCase(),
        startOffset: 0,
        duration: parsed.duration,
        sourceOffset: 0,
      }, false);
    }

    engine.play(0);

    // 1. Independent Solo: Solo Bass
    engine.setTrackSolo('bass', true);
    assert.equal(engine.getTrack('bass').gainNode.gain.value, 1.0, 'Soloed Bass must have full gain');
    assert.equal(engine.getTrack('vocals').gainNode.gain.value, 0.0, 'Non-soloed Vocals must have 0 gain');
    assert.equal(engine.getTrack('drums').gainNode.gain.value, 0.0, 'Non-soloed Drums must have 0 gain');
    assert.equal(engine.getTrack('other').gainNode.gain.value, 0.0, 'Non-soloed Other must have 0 gain');

    // Un-solo Bass
    engine.setTrackSolo('bass', false);
    assert.equal(engine.getTrack('bass').gainNode.gain.value, 1.0);
    assert.equal(engine.getTrack('vocals').gainNode.gain.value, 1.0);
    assert.equal(engine.getTrack('drums').gainNode.gain.value, 1.0);
    assert.equal(engine.getTrack('other').gainNode.gain.value, 1.0);

    // 2. Independent Mute: Mute Other
    engine.setTrackMute('other', true);
    assert.equal(engine.getTrack('other').gainNode.gain.value, 0.0, 'Muted Other stem must be 0 gain');
    assert.equal(engine.getTrack('vocals').gainNode.gain.value, 1.0, 'Vocals must remain audible');
    assert.equal(engine.getTrack('drums').gainNode.gain.value, 1.0, 'Drums must remain audible');
    assert.equal(engine.getTrack('bass').gainNode.gain.value, 1.0, 'Bass must remain audible');

    engine.setTrackMute('other', false);
    assert.equal(engine.getTrack('other').gainNode.gain.value, 1.0);

    // 3. Volume Adjustment on Vocals
    engine.setTrackVolume('vocals', 0.65);
    assert.equal(engine.getTrack('vocals').volume, 0.65);
    assert.equal(engine.getTrack('vocals').gainNode.gain.value, 0.65);
    assert.equal(timeline.getTrack('vocals').volume, 0.65, 'Timeline track volume must sync with engine');

    // 4. Pan Adjustment on Drums
    engine.setTrackPan('drums', -0.5);
    assert.equal(engine.getTrack('drums').pan, -0.5);
    assert.equal(timeline.getTrack('drums').pan, -0.5, 'Timeline track pan must sync with engine');

    engine.stop();
  });

  // -------------------------------------------------------------
  // STEP 5: Remove Duplicate Tracks
  // -------------------------------------------------------------
  await t.test('Step 5. Remove Duplicate Tracks: Timeline and Mixer have exactly 4 primary stems', () => {
    const timeline = new TimelineModel();
    const engine = new AudioEngine();
    engine.setTimelineModel(timeline);

    for (const stem of ['vocals', 'drums', 'bass', 'other']) {
      const parsed = parseRealWav(stemFiles[stem]);
      engine.loadBuffer(parsed, stem, stem.toUpperCase());
      timeline.registerAsset(stem, parsed);
      timeline.addClip({
        id: `clip-${stem}`,
        trackId: stem,
        assetId: stem,
        name: stem.toUpperCase(),
        startOffset: 0,
        duration: parsed.duration,
        sourceOffset: 0,
      }, false);
    }

    const timelineTracks = timeline.getTracks();
    assert.equal(timelineTracks.length, 4, 'Timeline must contain only 4 primary stem tracks');
    assert.deepEqual(
      timelineTracks.map((t) => t.id),
      ['vocals', 'drums', 'bass', 'other'],
      'No duplicate track-1..4 tracks allowed on timeline'
    );

    const engineTracks = engine.getTrackStates();
    assert.equal(engineTracks.length, 4, 'Engine must contain only 4 primary stem tracks');
    assert.deepEqual(
      engineTracks.map((t) => t.id),
      ['vocals', 'drums', 'bass', 'other'],
      'No duplicate track nodes in AudioEngine'
    );
  });

  // -------------------------------------------------------------
  // STEP 7: Track Selection Synchronization between Timeline and Mixer
  // -------------------------------------------------------------
  await t.test('Step 7. Track Selection Synchronization between Timeline and Mixer', () => {
    const timeline = new TimelineModel();
    const engine = new AudioEngine();
    engine.setTimelineModel(timeline);

    for (const stem of ['vocals', 'drums', 'bass', 'other']) {
      const parsed = parseRealWav(stemFiles[stem]);
      engine.loadBuffer(parsed, stem, stem.toUpperCase());
      timeline.registerAsset(stem, parsed);
    }

    // 1. Select track from TimelineModel
    timeline.selectTrack('drums');
    assert.equal(timeline.getSelectedTrackId(), 'drums');

    let states = engine.getTrackStates();
    const drumsState = states.find((s) => s.id === 'drums');
    const vocalsState = states.find((s) => s.id === 'vocals');

    assert.equal(drumsState.isSelected, true, 'Mixer must reflect Drums as isSelected = true');
    assert.equal(vocalsState.isSelected, false, 'Mixer must reflect Vocals as isSelected = false');

    // 2. Select track from AudioEngine (Mixer channel click)
    engine.selectStem('bass');
    assert.equal(timeline.getSelectedTrackId(), 'bass', 'Timeline must update selected track when mixer channel clicked');

    states = engine.getTrackStates();
    const bassState = states.find((s) => s.id === 'bass');
    assert.equal(bassState.isSelected, true, 'Mixer must reflect Bass as isSelected = true');

    // 3. Backward-compatible track selection
    timeline.selectTrack('track-1');
    assert.equal(timeline.getSelectedTrackId(), 'vocals', 'Selecting track-1 must normalize to vocals');
    states = engine.getTrackStates();
    assert.equal(states.find((s) => s.id === 'vocals').isSelected, true);
  });
});
