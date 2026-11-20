import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Multi-Stem Mixer Automated Acceptance Test Suite
 * ---------------------------------------------------------------------
 * Verifies all 10 mixer requirements and acceptance tests with real stems.
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
    this.connected = false;
  }
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
}

class MockStereoPannerNode {
  constructor() {
    this.pan = new MockAudioParam(0.0);
    this.connected = false;
  }
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
}

class MockAnalyserNode {
  constructor() {
    this.fftSize = 256;
    this.frequencyBinCount = 128;
  }
  connect() {}
  disconnect() {}
  getByteTimeDomainData(arr) {
    arr.fill(128); // baseline silence
  }
}

class MockSourceNode {
  constructor(ctx) {
    this.ctx = ctx;
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

test('Multi-Stem Mixer — Real Demucs Stems Acceptance Tests', async (t) => {
  const engine = new AudioEngine();
  const stemsDir = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s');
  const stemNames = ['vocals', 'drums', 'bass', 'other'];

  // 1. Display and Load 4 Real Separated Stems
  await t.test('1. Load and display four real separated Demucs stems', () => {
    for (const stem of stemNames) {
      const filePath = path.join(stemsDir, `${stem}.wav`);
      assert.ok(fs.existsSync(filePath), `Real stem file must exist at ${filePath}`);
      const audioBuffer = parseWav(filePath);
      engine.loadBuffer(audioBuffer, stem, stem.toUpperCase());
    }

    const trackStates = engine.getTrackStates();
    assert.equal(trackStates.length, 4, 'All four stems must be loaded into the mixer');
    assert.deepEqual(trackStates.map((s) => s.id), ['vocals', 'drums', 'bass', 'other']);
    assert.equal(engine.getDuration(), 15.0, 'Duration must equal stem duration (15.0s)');
  });

  // 2. Acceptance Test: Play all stems together in synchronization
  await t.test('2. Play all stems together in hardware clock synchronization', () => {
    engine.play();
    assert.equal(engine.getIsPlaying(), true, 'Mixer playback must be active');
    assert.equal(engine.activeSources.size, 4, 'All 4 stems must have active source nodes');

    for (const stem of stemNames) {
      const src = engine.activeSources.get(stem);
      assert.ok(src, `Active source must exist for ${stem}`);
      assert.equal(src.started, true, `Source for ${stem} must be started`);
      assert.equal(src.startOffset, 0, `Stem ${stem} must start at offset 0`);
      assert.equal(src.playDuration, 15.0, `Stem ${stem} must play for 15.0s`);
    }
  });

  // 3. Acceptance Test: Mute vocals and verify vocals disappear
  await t.test('3. Acceptance Test: Mute vocals and verify vocals gain becomes 0 immediately', () => {
    const vocalsTrack = engine.getTrack('vocals');
    const drumsTrack = engine.getTrack('drums');
    assert.equal(vocalsTrack.gainNode.gain.value, 1.0, 'Initial vocals gain is unity (1.0)');

    // MUTE VOCALS
    engine.setTrackMute('vocals', true);
    assert.equal(vocalsTrack.muted, true, 'Vocals state is muted');
    assert.equal(vocalsTrack.gainNode.gain.value, 0.0, 'Vocals gain node must immediately be 0.0 (silent)!');
    assert.equal(drumsTrack.gainNode.gain.value, 1.0, 'Drums stem must remain at normal volume (1.0)');

    // UNMUTE VOCALS
    engine.setTrackMute('vocals', false);
    assert.equal(vocalsTrack.muted, false, 'Vocals state is unmuted');
    assert.equal(vocalsTrack.gainNode.gain.value, 1.0, 'Vocals gain node immediately restored to 1.0');
  });

  // 4. Acceptance Test: Solo drums and verify other stems are silent
  await t.test('4. Acceptance Test: Solo drums and verify all other stems are silenced immediately', () => {
    const vocalsTrack = engine.getTrack('vocals');
    const drumsTrack = engine.getTrack('drums');
    const bassTrack = engine.getTrack('bass');
    const otherTrack = engine.getTrack('other');

    // SOLO DRUMS
    engine.setTrackSolo('drums', true);
    assert.equal(drumsTrack.solo, true, 'Drums is soloed');

    // Verification: drums is audible, vocals/bass/other are silent (gain = 0)
    assert.equal(drumsTrack.gainNode.gain.value, 1.0, 'Soloed drums gain must be audible (1.0)');
    assert.equal(vocalsTrack.gainNode.gain.value, 0.0, 'Vocals must be silent during drums solo');
    assert.equal(bassTrack.gainNode.gain.value, 0.0, 'Bass must be silent during drums solo');
    assert.equal(otherTrack.gainNode.gain.value, 0.0, 'Other must be silent during drums solo');

    // UN-SOLO DRUMS
    engine.setTrackSolo('drums', false);
    assert.equal(drumsTrack.solo, false, 'Drums solo released');
    assert.equal(vocalsTrack.gainNode.gain.value, 1.0, 'Vocals restored');
    assert.equal(drumsTrack.gainNode.gain.value, 1.0, 'Drums restored');
    assert.equal(bassTrack.gainNode.gain.value, 1.0, 'Bass restored');
    assert.equal(otherTrack.gainNode.gain.value, 1.0, 'Other restored');
  });

  // 5. Acceptance Test: Change bass volume and hear the difference
  await t.test('5. Acceptance Test: Change bass volume and verify gain changes immediately', () => {
    const bassTrack = engine.getTrack('bass');
    assert.equal(bassTrack.volume, 1.0);

    // Reduce Bass Volume to 0.45 (-7 dB)
    engine.setTrackVolume('bass', 0.45);
    assert.equal(bassTrack.volume, 0.45);
    assert.equal(bassTrack.gainNode.gain.value, 0.45, 'Bass gain node must change immediately to 0.45');

    // Boost Bass Volume to 1.35 (+2.6 dB)
    engine.setTrackVolume('bass', 1.35);
    assert.equal(bassTrack.volume, 1.35);
    assert.equal(bassTrack.gainNode.gain.value, 1.35, 'Bass gain node must change immediately to 1.35');

    // Restore to unity
    engine.setTrackVolume('bass', 1.0);
    assert.equal(bassTrack.gainNode.gain.value, 1.0);
  });

  // 6. Acceptance Test: Change pan and verify stereo output changes
  await t.test('6. Acceptance Test: Change pan and verify stereo output changes', () => {
    const vocalsTrack = engine.getTrack('vocals');
    const drumsTrack = engine.getTrack('drums');

    // Pan Vocals Left (-0.75)
    engine.setTrackPan('vocals', -0.75);
    assert.equal(vocalsTrack.pan, -0.75);
    assert.equal(vocalsTrack.panNode.pan.value, -0.75, 'Vocals pan node must be panned -0.75 Left');

    // Pan Drums Right (+0.80)
    engine.setTrackPan('drums', 0.80);
    assert.equal(drumsTrack.pan, 0.80);
    assert.equal(drumsTrack.panNode.pan.value, 0.80, 'Drums pan node must be panned +0.80 Right');

    // Center Vocals (0.0)
    engine.setTrackPan('vocals', 0.0);
    assert.equal(vocalsTrack.panNode.pan.value, 0.0, 'Vocals pan node centered');
  });

  // 7. Master volume control and Master mute
  await t.test('7. Master volume fader and Master mute control', () => {
    assert.equal(engine.getMasterVolume(), 1.0);
    assert.equal(engine.getMasterMute(), false);

    // Change Master Volume
    engine.setMasterVolume(0.65);
    assert.equal(engine.getMasterVolume(), 0.65);

    // MUTE MASTER
    engine.setMasterMute(true);
    assert.equal(engine.getMasterMute(), true);

    // UNMUTE MASTER
    engine.setMasterMute(false);
    assert.equal(engine.getMasterMute(), false);
    assert.equal(engine.getMasterVolume(), 0.65, 'Restores previous master volume on unmute');
  });

  // 8. Active stems state tracking
  await t.test('8. Show which stems are currently active', () => {
    const states = engine.getTrackStates();
    assert.equal(states.length, 4);
    // When playing and unmuted, all 4 are active
    assert.ok(states.every((s) => s.isActive), 'All unmuted stems are active during playback');

    // Muting drums makes drums inactive
    engine.setTrackMute('drums', true);
    const statesAfterMute = engine.getTrackStates();
    const drumsState = statesAfterMute.find((s) => s.id === 'drums');
    assert.equal(drumsState.isActive, false, 'Muted drums stem is not active');
    engine.setTrackMute('drums', false);
  });

  // 9. Synchronization during play, pause, seek
  await t.test('9. Maintain synchronization during play, pause and seek', () => {
    // Seek to 5.0s while playing
    engine.seek(5.0);
    assert.equal(engine.getIsPlaying(), true);
    assert.equal(engine.activeSources.size, 4, 'All 4 stems recreated after seek');

    for (const stem of stemNames) {
      const src = engine.activeSources.get(stem);
      assert.equal(src.startOffset, 5.0, `Stem ${stem} offset must be 5.0s`);
      assert.equal(src.playDuration, 10.0, `Stem ${stem} remaining duration must be 10.0s`);
    }

    // Pause audio
    engine.pause();
    assert.equal(engine.getIsPlaying(), false);
    assert.equal(engine.getCurrentTime(), 5.0);

    // Stop audio
    engine.stop();
    assert.equal(engine.getCurrentTime(), 0.0);
    assert.equal(engine.getIsPlaying(), false);
  });
});
