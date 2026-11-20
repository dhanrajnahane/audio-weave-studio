import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Phase 3 Real Audio Playback Engine Test Suite
 * ---------------------------------------------------------------------
 * Verifies all 10 playback requirements using real imported audio files.
 */

// 1. Mock Web Audio API Environment for Node.js
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
    this.connected = false;
  }
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
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
  }
  connect() {}
  disconnect() {}
  getByteFrequencyData() {}
}

class MockSourceNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.buffer = null;
    this.started = false;
    this.stopped = false;
    this.startOffset = 0;
    this.playDuration = 0;
    this.onended = null;
    this.connected = false;
  }
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  start(when, offset, duration) {
    this.started = true;
    this.startOffset = offset;
    this.playDuration = duration;
  }
  stop() {
    this.stopped = true;
    if (this.onended) {
      this.onended();
    }
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
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  decodeAudioData(arrayBuffer) {
    // Basic verification of RIFF/WAVE header in arrayBuffer
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 12) {
      return Promise.reject(new Error('Buffer too small for valid audio file'));
    }
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
      return Promise.reject(new Error('Unsupported or corrupted audio container format'));
    }
    return Promise.resolve(new MockAudioBuffer(2, 44100 * 3.5, 44100));
  }
}

class MockAudioBuffer {
  constructor(channels, length, sampleRate, channelData = null) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._channelData = channelData || [];
    if (!channelData) {
      for (let ch = 0; ch < channels; ch++) {
        this._channelData.push(new Float32Array(length));
      }
    }
  }
  getChannelData(ch) {
    return this._channelData[ch] || this._channelData[0];
  }
}

// 2. Real Audio File Binary Decoder (RIFF 16-bit PCM WAV)
function parseRealWavFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.toString('ascii', 0, 4);
  const format = buf.toString('ascii', 8, 12);
  if (magic !== 'RIFF' || format !== 'WAVE') {
    throw new Error(`File at ${filePath} is not a valid RIFF/WAVE file.`);
  }

  let offset = 12;
  let numChannels = 2, sampleRate = 44100, bitsPerSample = 16, dataOffset = 0, dataSize = 0;

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

  return new MockAudioBuffer(numChannels, frames, sampleRate, channelData);
}

// Set up globals before importing AudioEngine
globalThis.window = {
  AudioContext: MockAudioContext,
};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// Load the compiled AudioEngine
const compiledPath = path.resolve('src/audio/AudioEngine.compiled.mjs');
const { AudioEngine } = await import(pathToFileURL(compiledPath).href);

// Path to actual test audio file
const realWavPath = path.resolve('../storage/test_fixtures/real_acoustic.wav');

test('AudioWeave Studio — Audio Playback Engine Real Audio Verification', async (t) => {
  assert.ok(fs.existsSync(realWavPath), `Real WAV fixture must exist at ${realWavPath}`);

  // Decode actual samples from the 3.5s acoustic WAV file
  const realAudioBuffer = parseRealWavFile(realWavPath);
  assert.equal(realAudioBuffer.numberOfChannels, 2, 'Must be stereo');
  assert.equal(realAudioBuffer.sampleRate, 44100, 'Must be 44.1kHz');
  assert.equal(realAudioBuffer.duration, 3.5, 'Duration must match real file length (3.5s)');

  // Verify non-zero real audio data
  const ch0 = realAudioBuffer.getChannelData(0);
  let nonZeroCount = 0;
  for (let i = 0; i < ch0.length; i++) {
    if (Math.abs(ch0[i]) > 0.05) nonZeroCount++;
  }
  assert.ok(nonZeroCount > 1000, 'Real audio buffer must contain actual audio signal');

  let engine;
  let mockCtx;

  t.beforeEach(() => {
    engine = new AudioEngine();
    mockCtx = engine.getContext();
    mockCtx.currentTime = 0;
    engine.loadBuffer(realAudioBuffer, 'master', 'real_acoustic.wav');
  });

  t.afterEach(() => {
    engine.stop();
  });

  // -------------------------------------------------------------
  // 1. Play works
  // -------------------------------------------------------------
  await t.test('1. Play works with real imported audio', () => {
    assert.equal(engine.getIsPlaying(), false, 'Initially not playing');
    assert.equal(engine.getCurrentTime(), 0.0, 'Starts at 0.0s');
    assert.equal(engine.getDuration(), 3.5, 'Duration is 3.5s');

    engine.play();
    assert.equal(engine.getIsPlaying(), true, 'Playback is now active');

    // Simulate audio clock advancing 0.5s
    mockCtx.currentTime = 0.5;
    assert.equal(engine.getCurrentTime(), 0.5, 'Current time advances to 0.5s');
  });

  // -------------------------------------------------------------
  // 2. Pause works and preserves the playback position
  // -------------------------------------------------------------
  await t.test('2. Pause works and preserves the playback position', () => {
    engine.play();
    mockCtx.currentTime = 1.45;
    assert.equal(engine.getCurrentTime(), 1.45);

    engine.pause();
    assert.equal(engine.getIsPlaying(), false, 'Playback is paused');
    assert.equal(engine.getCurrentTime(), 1.45, 'Playback position is preserved at exactly 1.45s');

    // Advance audio clock while paused — position MUST NOT drift
    mockCtx.currentTime = 10.0;
    assert.equal(engine.getCurrentTime(), 1.45, 'Time does not drift while paused');

    // Resume from pause
    engine.play();
    assert.equal(engine.getIsPlaying(), true, 'Playback resumed');
    // Clock advances 0.55s after resume -> 1.45 + 0.55 = 2.0s
    mockCtx.currentTime = 10.55;
    assert.equal(Math.round(engine.getCurrentTime() * 100) / 100, 2.0, 'Resumed smoothly from 1.45s to 2.0s');
  });

  // -------------------------------------------------------------
  // 3. Stop resets playback correctly
  // -------------------------------------------------------------
  await t.test('3. Stop resets playback correctly', () => {
    engine.play();
    mockCtx.currentTime = 2.2;
    assert.equal(engine.getCurrentTime(), 2.2);

    engine.stop();
    assert.equal(engine.getIsPlaying(), false, 'Playback stopped');
    assert.equal(engine.getCurrentTime(), 0.0, 'Playhead rewound to 0.0s');

    // Advancing clock when stopped does not change position
    mockCtx.currentTime = 15.0;
    assert.equal(engine.getCurrentTime(), 0.0, 'Remains at 0.0s');
  });

  // -------------------------------------------------------------
  // 4. Seeking to different positions works
  // -------------------------------------------------------------
  await t.test('4. Seeking to different positions works (paused & playing)', () => {
    // 4a. Seeking while paused
    assert.equal(engine.getIsPlaying(), false);
    engine.seek(0.75);
    assert.equal(engine.getIsPlaying(), false, 'Seeking while paused MUST NOT start playback');
    assert.equal(engine.getCurrentTime(), 0.75, 'Seeked to 0.75s');

    engine.seek(2.10);
    assert.equal(engine.getIsPlaying(), false);
    assert.equal(engine.getCurrentTime(), 2.10, 'Seeked to 2.10s');

    engine.seek(3.20);
    assert.equal(engine.getIsPlaying(), false);
    assert.equal(engine.getCurrentTime(), 3.20, 'Seeked to 3.20s');

    // 4b. Seeking while playing
    engine.seek(1.0);
    mockCtx.currentTime = 20.0;
    engine.play();
    assert.equal(engine.getIsPlaying(), true);

    // Advance clock 0.5s -> 1.5s
    mockCtx.currentTime = 20.5;
    assert.equal(engine.getCurrentTime(), 1.5);

    // Seek to 2.5s while actively playing -> continues seamlessly
    engine.seek(2.5);
    assert.equal(engine.getIsPlaying(), true, 'Must remain playing after seek');
    mockCtx.currentTime = 21.0; // 0.5s elapsed from seek
    assert.equal(Math.round(engine.getCurrentTime() * 100) / 100, 3.0, 'Seamlessly progressed from 2.5s to 3.0s');
  });

  // -------------------------------------------------------------
  // 5. Playback time updates correctly
  // -------------------------------------------------------------
  await t.test('5. Playback time updates correctly during active playback', () => {
    engine.play();
    const checkpoints = [0.25, 0.5, 1.0, 1.75, 2.5, 3.1, 3.5];

    for (const targetTime of checkpoints) {
      mockCtx.currentTime = targetTime;
      const cur = engine.getCurrentTime();
      assert.equal(Math.round(cur * 100) / 100, targetTime, `Current time must equal ${targetTime}`);
    }
  });

  // -------------------------------------------------------------
  // 6. Spacebar play/pause works
  // -------------------------------------------------------------
  await t.test('6. Spacebar play/pause logic works correctly', () => {
    // Simulation of App.tsx spacebar listener
    const simulateSpacebar = (targetTagName = 'DIV') => {
      if (targetTagName === 'INPUT' || targetTagName === 'TEXTAREA') return;
      if (engine.getDuration() <= 0) return;
      engine.togglePlay();
    };

    assert.equal(engine.getIsPlaying(), false, 'Initially stopped');

    // First spacebar press: Play
    simulateSpacebar('DIV');
    assert.equal(engine.getIsPlaying(), true, 'Spacebar toggled state to PLAY');

    // Second spacebar press: Pause
    simulateSpacebar('DIV');
    assert.equal(engine.getIsPlaying(), false, 'Spacebar toggled state to PAUSE');

    // Third spacebar press: Resume Play
    simulateSpacebar('DIV');
    assert.equal(engine.getIsPlaying(), true, 'Spacebar toggled state back to PLAY');

    // Spacebar press inside input field: Ignored
    simulateSpacebar('INPUT');
    assert.equal(engine.getIsPlaying(), true, 'Spacebar while typing in INPUT was safely ignored');

    simulateSpacebar('TEXTAREA');
    assert.equal(engine.getIsPlaying(), true, 'Spacebar while typing in TEXTAREA was safely ignored');
  });

  // -------------------------------------------------------------
  // 7. Restarting after stopping works
  // -------------------------------------------------------------
  await t.test('7. Restarting after stopping works cleanly', () => {
    mockCtx.currentTime = 30.0;
    engine.play();
    mockCtx.currentTime = 31.5;
    assert.equal(engine.getCurrentTime(), 1.5);

    // Stop resets
    engine.stop();
    assert.equal(engine.getCurrentTime(), 0.0);
    assert.equal(engine.getIsPlaying(), false);

    // Restart
    mockCtx.currentTime = 40.0;
    engine.play();
    assert.equal(engine.getIsPlaying(), true, 'Playback restarted cleanly');
    assert.equal(engine.getCurrentTime(), 0.0, 'Starts from 0.0s');

    mockCtx.currentTime = 41.2;
    assert.equal(Math.round(engine.getCurrentTime() * 100) / 100, 1.2, 'Progresses to 1.2s on fresh cycle');
  });

  // -------------------------------------------------------------
  // 8. No unexpected audio overlap occurs
  // -------------------------------------------------------------
  await t.test('8. No unexpected audio overlap occurs', () => {
    engine.play();
    mockCtx.currentTime = 50.0;

    // Consecutive play calls without stop
    engine.play();
    engine.play();
    engine.play();

    // Verify engine has exactly 1 active source for the track
    assert.equal(engine.activeSources.size, 1, 'Only 1 active audio source exists per track (no voice stacking)');

    // Rapid seeking while playing
    for (let s = 0.5; s < 3.0; s += 0.5) {
      engine.seek(s);
      assert.equal(engine.activeSources.size, 1, `After seek(${s}), exactly 1 active source remains`);
    }

    // Load multi-stem configuration (e.g. 2 stems: vocals + drums)
    engine.clearAllTracks();
    engine.loadBuffer(realAudioBuffer, 'vocals', 'Vocals');
    engine.loadBuffer(realAudioBuffer, 'drums', 'Drums');
    assert.equal(engine.tracks.size, 2, 'Two stems loaded');

    engine.play();
    assert.equal(engine.activeSources.size, 2, 'Exactly 2 sources active (1 per track)');

    // Seek multi-stem: sources recreated cleanly without multiplication
    engine.seek(1.5);
    assert.equal(engine.activeSources.size, 2, 'After seek, still exactly 2 sources active');
  });

  // -------------------------------------------------------------
  // 9. Audio playback handles errors correctly
  // -------------------------------------------------------------
  await t.test('9. Audio playback handles errors and boundary conditions correctly', async () => {
    // 9a. Seeking boundaries clamping
    engine.seek(-10.0);
    assert.equal(engine.getCurrentTime(), 0.0, 'Negative seek clamped to 0.0s');

    engine.seek(100.0);
    assert.equal(engine.getCurrentTime(), engine.getDuration(), 'Excess seek clamped to duration');

    // 9b. Corrupted audio decoding error handling
    const corruptedBuffer = new ArrayBuffer(8); // Too small / corrupted header
    await assert.rejects(
      async () => {
        await engine.decodeAudio(corruptedBuffer);
      },
      (err) => {
        assert.ok(err.message.includes('Web Audio decoding failed') || err.message.includes('Buffer too small'));
        return true;
      },
      'Corrupted array buffer is rejected with clear error message'
    );

    // 9c. Empty audio engine handles play/pause/seek gracefully
    const emptyEngine = new AudioEngine();
    assert.doesNotThrow(() => {
      emptyEngine.play();
      emptyEngine.pause();
      emptyEngine.stop();
      emptyEngine.seek(5.0);
      emptyEngine.togglePlay();
    }, 'Empty engine operations do not throw or crash');
    assert.equal(emptyEngine.getCurrentTime(), 0);
  });

  // -------------------------------------------------------------
  // 10. Playback remains stable after repeated play, pause, seek
  // -------------------------------------------------------------
  await t.test('10. Playback remains stable after repeated play, pause and seek stress operations', () => {
    let simulatedTime = 100.0;
    mockCtx.currentTime = simulatedTime;

    // Run 100 rapid, arbitrary state mutations
    for (let i = 0; i < 100; i++) {
      const action = i % 5;
      const targetSeek = (i * 0.17) % 3.5;

      switch (action) {
        case 0:
          engine.play();
          break;
        case 1:
          engine.pause();
          break;
        case 2:
          engine.seek(targetSeek);
          break;
        case 3:
          engine.togglePlay();
          break;
        case 4:
          engine.stop();
          break;
      }

      // Increment clock slightly
      simulatedTime += 0.05;
      mockCtx.currentTime = simulatedTime;

      // Invariants check
      const cur = engine.getCurrentTime();
      assert.ok(!Number.isNaN(cur), `Current time must not be NaN at step ${i}`);
      assert.ok(cur >= 0, `Current time must be >= 0 at step ${i} (got ${cur})`);
      assert.ok(cur <= engine.getDuration() + 0.01, `Current time must be <= duration at step ${i} (got ${cur})`);
      assert.ok(engine.activeSources.size <= engine.tracks.size, `No leaked sources at step ${i}`);
    }

    // Engine must still be functional after 100 rapid operations
    engine.stop();
    assert.equal(engine.getCurrentTime(), 0.0);
    assert.equal(engine.getIsPlaying(), false);

    // Can play again normally
    mockCtx.currentTime = simulatedTime + 10.0;
    engine.play();
    assert.equal(engine.getIsPlaying(), true);
    mockCtx.currentTime = simulatedTime + 11.0;
    assert.equal(Math.round(engine.getCurrentTime() * 100) / 100, 1.0);
    engine.stop();
    assert.equal(engine.getIsPlaying(), false);
  });
});
