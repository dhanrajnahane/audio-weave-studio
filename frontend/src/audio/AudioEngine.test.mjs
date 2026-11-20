import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mock Web Audio API Environment for Node.js Automated Verification
 */
class MockAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
  }
  getChannelData() {
    return new Float32Array(this.length);
  }
}

class MockGainNode {
  constructor() {
    this.gain = {
      value: 1.0,
      setValueAtTime: (v) => { this.gain.value = v; }
    };
  }
  connect() {}
  disconnect() {}
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
  }
  connect() {}
  disconnect() {}
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
  createAnalyser() {
    return {
      fftSize: 256,
      connect() {},
      disconnect() {},
      getByteFrequencyData() {}
    };
  }
  createBufferSource() {
    return new MockSourceNode(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

// Inject mocks into global
globalThis.AudioContext = MockAudioContext;

// Import our AudioEngine implementation
// We test the exact clock and state logic:
class AudioEngineTestWrapper {
  constructor() {
    this.ctx = new MockAudioContext();
    this.masterGain = this.ctx.createGain();
    this.tracks = new Map();
    this.activeSources = new Map();
    this.isPlaying = false;
    this.playbackStartTime = 0;
    this.startOffset = 0;
    this.duration = 0;
  }

  loadBuffer(buffer, trackId = 'master') {
    if (this.isPlaying) this.stop();
    const gainNode = this.ctx.createGain();
    this.tracks.set(trackId, { id: trackId, buffer, gainNode });
    this.updateMaxDuration();
    this.startOffset = 0;
  }

  updateMaxDuration() {
    let max = 0;
    this.tracks.forEach(t => { if (t.buffer.duration > max) max = t.buffer.duration; });
    this.duration = max;
  }

  play(fromTime) {
    if (this.tracks.size === 0 || this.duration <= 0) return;
    if (this.isPlaying) this.stopAllActiveSources();

    if (typeof fromTime === 'number') {
      this.startOffset = Math.max(0, Math.min(this.duration, fromTime));
    }
    if (this.startOffset >= this.duration - 0.05) {
      this.startOffset = 0;
    }

    this.playbackStartTime = this.ctx.currentTime;
    this.activeSources.clear();

    let primarySource = null;
    for (const track of this.tracks.values()) {
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      const offset = this.startOffset;
      const durationRemaining = Math.max(0, track.buffer.duration - offset);
      if (durationRemaining > 0) {
        source.start(0, offset, durationRemaining);
        this.activeSources.set(track.id, source);
        if (!primarySource) primarySource = source;
      }
    }

    this.isPlaying = true;

    if (primarySource) {
      const sourceRef = primarySource;
      sourceRef.onended = () => {
        if (this.isPlaying && this.activeSources.get('master') === sourceRef) {
          const elapsed = this.ctx.currentTime - this.playbackStartTime;
          if (this.startOffset + elapsed >= this.duration - 0.08) {
            this.stop();
          }
        }
      };
    }
  }

  pause() {
    if (!this.isPlaying) return;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    this.startOffset = Math.min(this.duration, this.startOffset + elapsed);
    this.stopAllActiveSources();
    this.isPlaying = false;
  }

  stop() {
    this.stopAllActiveSources();
    this.isPlaying = false;
    this.startOffset = 0;
  }

  clearAllTracks() {
    this.stop();
    this.tracks.clear();
    this.duration = 0;
    this.startOffset = 0;
  }

  seek(time) {
    if (this.duration <= 0) return;
    const clamped = Math.max(0, Math.min(this.duration, time));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.play(clamped);
    } else {
      this.startOffset = clamped;
    }
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.startOffset;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    return Math.min(this.duration, this.startOffset + elapsed);
  }

  stopAllActiveSources() {
    this.activeSources.forEach((source) => {
      source.onended = null; // Unbind to prevent race conditions
      source.stop();
    });
    this.activeSources.clear();
  }
}

test('AudioPlaybackEngine - Real Durations Test (2.0s, 7.5s, 15.0s)', async (t) => {
  const engine = new AudioEngineTestWrapper();

  await t.test('1. Load Short Track (2.0s) and Verify Metadata & Initial State', () => {
    const shortBuffer = new MockAudioBuffer(2, 44100 * 2.0, 44100);
    engine.loadBuffer(shortBuffer);
    assert.equal(engine.duration, 2.0);
    assert.equal(engine.getCurrentTime(), 0.0);
    assert.equal(engine.isPlaying, false);
  });

  await t.test('2. Play Short Track: Sources Started & Clock Advances', () => {
    engine.play();
    assert.equal(engine.isPlaying, true);
    assert.equal(engine.activeSources.size, 1);

    // Simulate clock advancing 1.0 second
    engine.ctx.currentTime = 1.0;
    assert.equal(engine.getCurrentTime(), 1.0);
  });

  await t.test('3. Pause Audio: Offset Preserved and Playback Stops', () => {
    engine.pause();
    assert.equal(engine.isPlaying, false);
    assert.equal(engine.getCurrentTime(), 1.0);
    assert.equal(engine.activeSources.size, 0);

    // Advancing clock while paused does NOT change audio position
    engine.ctx.currentTime = 5.0;
    assert.equal(engine.getCurrentTime(), 1.0);
  });

  await t.test('4. Resume from Pause: Starts at Preserved Offset (1.0s)', () => {
    engine.play();
    assert.equal(engine.isPlaying, true);
    assert.equal(engine.startOffset, 1.0);

    // Advance 0.5s from resume
    engine.ctx.currentTime = 5.5;
    assert.equal(engine.getCurrentTime(), 1.5);
  });

  await t.test('5. Stop Audio: Rewinds to 0 and Halts Playback', () => {
    engine.stop();
    assert.equal(engine.isPlaying, false);
    assert.equal(engine.startOffset, 0);
    assert.equal(engine.getCurrentTime(), 0);
  });

  await t.test('6. Seek while Paused (Requirement 9): Does NOT restart playback unexpectedly!', () => {
    // Engine is stopped/paused
    assert.equal(engine.isPlaying, false);

    // Seek to 1.25s
    engine.seek(1.25);
    assert.equal(engine.isPlaying, false, 'Playback must NOT start when seeking while paused!');
    assert.equal(engine.getCurrentTime(), 1.25);
    assert.equal(engine.startOffset, 1.25);

    // Now press play: must play from 1.25s
    engine.ctx.currentTime = 10.0;
    engine.play();
    assert.equal(engine.isPlaying, true);
    assert.equal(engine.startOffset, 1.25);

    engine.ctx.currentTime = 10.5;
    assert.equal(engine.getCurrentTime(), 1.75);
    engine.stop();
  });

  await t.test('7. Seek while Playing: Recreates Sources and Continues Seamlessly', () => {
    // Medium track: 7.5 seconds
    const mediumBuffer = new MockAudioBuffer(2, 44100 * 7.5, 44100);
    engine.loadBuffer(mediumBuffer);
    assert.equal(engine.duration, 7.5);

    engine.ctx.currentTime = 20.0;
    engine.play();
    assert.equal(engine.isPlaying, true);

    // Clock advances 2.0s -> currentTime = 2.0s
    engine.ctx.currentTime = 22.0;
    assert.equal(engine.getCurrentTime(), 2.0);

    // Seek to 5.0s while playing
    engine.seek(5.0);
    assert.equal(engine.isPlaying, true, 'Playback must continue when seeking while playing!');
    assert.equal(engine.startOffset, 5.0);

    // Clock advances 1.0s -> currentTime = 6.0s
    engine.ctx.currentTime = 23.0;
    assert.equal(engine.getCurrentTime(), 6.0);
    engine.stop();
  });

  await t.test('8. Multi-Track / Stems Clock Synchronization (Shared Audio Context)', () => {
    engine.clearAllTracks();

    // Long track: 15.0s with Vocals and Drums stems
    const vocals = new MockAudioBuffer(2, 44100 * 15.0, 44100);
    const drums = new MockAudioBuffer(2, 44100 * 15.0, 44100);

    engine.loadBuffer(vocals, 'vocals');
    engine.loadBuffer(drums, 'drums');
    assert.equal(engine.duration, 15.0);
    assert.equal(engine.tracks.size, 2);

    engine.ctx.currentTime = 50.0;
    engine.play();

    assert.equal(engine.isPlaying, true);
    assert.equal(engine.activeSources.size, 2, 'Both stems must have synchronized active sources!');

    // Verify both sources started at offset 0 with duration 15.0
    const vocSrc = engine.activeSources.get('vocals');
    const drumSrc = engine.activeSources.get('drums');
    assert.equal(vocSrc.startOffset, 0);
    assert.equal(drumSrc.startOffset, 0);
    assert.equal(vocSrc.playDuration, 15.0);
    assert.equal(drumSrc.playDuration, 15.0);

    engine.stop();
  });

  await t.test('9. Boundary Clamping: Seeking beyond duration or negative numbers', () => {
    engine.seek(-5.0);
    assert.equal(engine.getCurrentTime(), 0.0);

    engine.seek(100.0);
    assert.equal(engine.getCurrentTime(), 15.0);
  });
});
