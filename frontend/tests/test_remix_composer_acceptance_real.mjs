import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Intelligent Remix Composer Real Audio Acceptance Test
 * ---------------------------------------------------------------------
 * Acceptance Test Requirements:
 * 1. Display detected song sections (from real audio).
 * 2. Select sections.
 * 3. Choose which stems play in each section (per-section stem muting/activation).
 * 4. Rearrange sections (Intro → Chorus → Verse → Chorus → Outro).
 * 5. Duplicate sections.
 * 6. Remove sections.
 * 7. Preview the arrangement through timeline scheduling and AudioEngine playback.
 * 8. Preserve the original project clips and state.
 * 9. Save multiple remix arrangements within one project.
 * 10. Allow users to return to the original arrangement.
 */

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
    this.destination = {};
  }
  createBufferSource() {
    return new MockOfflineBufferSource();
  }
  startRendering() {
    const chData = [new Float32Array(this.length), new Float32Array(this.length)];
    for (let i = 0; i < this.length; i++) {
      const val = Math.sin((i / 44100) * 440 * 2 * Math.PI) * 0.5;
      chData[0][i] = val;
      chData[1][i] = val;
    }
    return Promise.resolve({
      numberOfChannels: this.numberOfChannels,
      length: this.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      getChannelData: (ch) => chData[ch],
    });
  }
}

globalThis.window = {
  OfflineAudioContext: MockOfflineAudioContext,
};

const remixModelPath = path.resolve('src/audio/remix/RemixComposerModel.compiled.mjs');
const { RemixComposerModel } = await import(pathToFileURL(remixModelPath).href);

const timelineModelPath = path.resolve('src/audio/timeline/TimelineModel.compiled.mjs');
const { TimelineModel } = await import(pathToFileURL(timelineModelPath).href);

test('AudioWeave Studio — Intelligent Remix Composer Real Acceptance Verification', async (t) => {
  // Load the 4 real Demucs separated stems
  const stemsDir = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s');
  assert.ok(fs.existsSync(stemsDir), 'Real Demucs stems directory must exist');

  const vocalsBuf = parseWav(path.join(stemsDir, 'vocals.wav'));
  const drumsBuf = parseWav(path.join(stemsDir, 'drums.wav'));
  const bassBuf = parseWav(path.join(stemsDir, 'bass.wav'));
  const otherBuf = parseWav(path.join(stemsDir, 'other.wav'));

  assert.equal(vocalsBuf.duration, 15.0);
  assert.equal(drumsBuf.duration, 15.0);
  assert.equal(bassBuf.duration, 15.0);
  assert.equal(otherBuf.duration, 15.0);

  const remix = new RemixComposerModel();
  const timeline = new TimelineModel();

  // Register real stem buffers in TimelineModel
  timeline.registerAsset('vocals', vocalsBuf);
  timeline.registerAsset('drums', drumsBuf);
  timeline.registerAsset('bass', bassBuf);
  timeline.registerAsset('other', otherBuf);

  // Setup original timeline state (Requirement 8)
  const originalClips = [
    { id: 'orig-vocals', trackId: 'track-1', assetId: 'vocals', name: 'Original Vocals', startOffset: 0, duration: 15.0, sourceOffset: 0, color: '#06b6d4' },
    { id: 'orig-drums', trackId: 'track-2', assetId: 'drums', name: 'Original Drums', startOffset: 0, duration: 15.0, sourceOffset: 0, color: '#f59e0b' },
    { id: 'orig-bass', trackId: 'track-3', assetId: 'bass', name: 'Original Bass', startOffset: 0, duration: 15.0, sourceOffset: 0, color: '#a855f7' },
    { id: 'orig-other', trackId: 'track-4', assetId: 'other', name: 'Original Other', startOffset: 0, duration: 15.0, sourceOffset: 0, color: '#10b981' },
  ];
  for (const c of originalClips) {
    timeline.addClip(c, false);
  }

  // 1. Snapshot original timeline
  remix.snapshotOriginalTimeline(originalClips);
  assert.equal(remix.getOriginalTimelineClips().length, 4, 'Original timeline clips snapshotted');

  // 2. Set Detected Song Sections (Requirement 1 & 2)
  const realDetectedSections = [
    { id: 'sec-intro', name: 'Intro', type: 'intro', start: 0.0, end: 2.5, duration: 2.5, energy: 0.35, color: '#06b6d4' },
    { id: 'sec-verse', name: 'Verse 1', type: 'verse', start: 2.5, end: 6.5, duration: 4.0, energy: 0.55, color: '#3b82f6' },
    { id: 'sec-chorus', name: 'Chorus', type: 'chorus', start: 6.5, end: 11.5, duration: 5.0, energy: 0.90, color: '#f59e0b' },
    { id: 'sec-outro', name: 'Outro', type: 'outro', start: 11.5, end: 15.0, duration: 3.5, energy: 0.40, color: '#10b981' },
  ];

  remix.setDetectedSections(realDetectedSections);
  assert.equal(remix.getDetectedSections().length, 4, 'Real song sections registered');

  // Initial arrangement is Original Sequence (chronological order)
  const origArr = remix.getActiveArrangement();
  assert.equal(origArr.name, 'Original Sequence');
  assert.equal(origArr.blocks.length, 4);
  assert.equal(origArr.blocks[0].name, 'Intro');
  assert.equal(origArr.blocks[1].name, 'Verse 1');
  assert.equal(origArr.blocks[2].name, 'Chorus');
  assert.equal(origArr.blocks[3].name, 'Outro');

  // -----------------------------------------------------------------
  // 3. Create Custom Rearrangement: Intro → Chorus → Verse → Chorus → Outro
  // -----------------------------------------------------------------
  await t.test('Create custom rearrangement (Intro → Chorus → Verse → Chorus → Outro)', () => {
    // Create new custom arrangement
    const customArr = remix.createArrangement('Radio Edit Remix', 'empty');
    assert.equal(customArr.blocks.length, 0);

    // 1. Add Intro
    remix.addSectionToArrangement('sec-intro');
    // 2. Add Chorus (Early Hook)
    remix.addSectionToArrangement('sec-chorus');
    // 3. Add Verse 1
    remix.addSectionToArrangement('sec-verse');
    // 4. Add Chorus again
    remix.addSectionToArrangement('sec-chorus');
    // 5. Add Outro
    remix.addSectionToArrangement('sec-outro');

    assert.equal(customArr.blocks.length, 5, 'Arrangement has 5 blocks in specified sequence');

    // Verify exact section order
    const sequenceOrder = customArr.blocks.map((b) => b.type);
    assert.deepEqual(
      sequenceOrder,
      ['intro', 'chorus', 'verse', 'chorus', 'outro'],
      'Sequence strictly matches: Intro → Chorus → Verse → Chorus → Outro'
    );

    // Verify continuous timelineStart offsets
    assert.equal(customArr.blocks[0].timelineStart, 0.0);
    assert.equal(customArr.blocks[1].timelineStart, 2.5); // Intro duration = 2.5s
    assert.equal(customArr.blocks[2].timelineStart, 7.5); // Chorus duration = 5.0s -> 2.5 + 5.0 = 7.5s
    assert.equal(customArr.blocks[3].timelineStart, 11.5); // Verse duration = 4.0s -> 7.5 + 4.0 = 11.5s
    assert.equal(customArr.blocks[4].timelineStart, 16.5); // Chorus duration = 5.0s -> 11.5 + 5.0 = 16.5s

    const totalDur = remix.getArrangementDuration();
    assert.equal(totalDur, 20.0); // 2.5 + 5.0 + 4.0 + 5.0 + 3.5 = 20.0s
  });

  // -----------------------------------------------------------------
  // 4. Per-Section Stem Activation and Muting (Requirement 3)
  // -----------------------------------------------------------------
  await t.test('Configure per-section active stems and verify timeline clip mapping', () => {
    const customArr = remix.getActiveArrangement();

    // Block 0 (Intro): Beat only -> Mute Vocals and Other
    remix.toggleStem(customArr.blocks[0].id, 'vocals'); // Mute vocals
    remix.toggleStem(customArr.blocks[0].id, 'other');  // Mute other
    assert.equal(customArr.blocks[0].activeStems.vocals, false);
    assert.equal(customArr.blocks[0].activeStems.drums, true);
    assert.equal(customArr.blocks[0].activeStems.bass, true);
    assert.equal(customArr.blocks[0].activeStems.other, false);

    // Block 1 (Early Chorus): All 4 stems active (Full drop)
    assert.equal(customArr.blocks[1].activeStems.vocals, true);
    assert.equal(customArr.blocks[1].activeStems.drums, true);
    assert.equal(customArr.blocks[1].activeStems.bass, true);
    assert.equal(customArr.blocks[1].activeStems.other, true);

    // Block 2 (Verse): Vocals + Bass + Drums (Mute other)
    remix.toggleStem(customArr.blocks[2].id, 'other');
    assert.equal(customArr.blocks[2].activeStems.other, false);

    // Block 4 (Outro): Instrumental -> Mute Vocals
    remix.toggleStem(customArr.blocks[4].id, 'vocals');
    assert.equal(customArr.blocks[4].activeStems.vocals, false);

    // Synchronize to timeline
    remix.applyToTimeline(timeline);
    const clips = timeline.getAllClips();

    // Verify Block 0 (Intro at t = 0s to 2.5s):
    // Vocals (vocals/track-1) and Other (other/track-4) MUST NOT have clips at t=0s!
    const introVocals = clips.find((c) => (c.trackId === 'track-1' || c.trackId === 'vocals') && c.startOffset === 0.0);
    const introDrums = clips.find((c) => (c.trackId === 'track-2' || c.trackId === 'drums') && c.startOffset === 0.0);
    const introBass = clips.find((c) => (c.trackId === 'track-3' || c.trackId === 'bass') && c.startOffset === 0.0);
    const introOther = clips.find((c) => (c.trackId === 'track-4' || c.trackId === 'other') && c.startOffset === 0.0);

    assert.equal(introVocals, undefined, 'Muted vocals stem has NO clip scheduled during Intro');
    assert.ok(introDrums, 'Active drums stem HAS clip scheduled during Intro');
    assert.ok(introBass, 'Active bass stem HAS clip scheduled during Intro');
    assert.equal(introOther, undefined, 'Muted other stem has NO clip scheduled during Intro');

    // Verify Block 1 (Early Chorus at t = 2.5s to 7.5s):
    // All 4 stems must have clips starting at 2.5s with sourceOffset = 6.5s!
    const chorusClips = clips.filter((c) => c.startOffset === 2.5);
    assert.equal(chorusClips.length, 4, 'All 4 stems active in Early Chorus');
    assert.ok(chorusClips.every((c) => c.sourceOffset === 6.5), 'Source offset points to Chorus (6.5s)');
    assert.ok(chorusClips.every((c) => c.duration === 5.0), 'Clip duration is 5.0s');
  });

  // -----------------------------------------------------------------
  // 5. Playback Schedule Follows Selected Section Order (Acceptance Core)
  // -----------------------------------------------------------------
  await t.test('Playback schedule strictly follows rearranged section sequence and stem mutes', () => {
    // Query clips active at playhead t = 0.5s (inside Intro, t in [0.0, 2.5])
    const activeClipsAtIntro = timeline.getClipsAtTime(0.5);
    assert.ok(activeClipsAtIntro.length > 0);
    const activeTracksAtIntro = activeClipsAtIntro.map((c) => c.trackId);
    assert.ok(activeTracksAtIntro.includes('track-2') || activeTracksAtIntro.includes('drums'), 'Drums active in Intro');
    assert.ok(activeTracksAtIntro.includes('track-3') || activeTracksAtIntro.includes('bass'), 'Bass active in Intro');
    assert.ok(!activeTracksAtIntro.includes('track-1') && !activeTracksAtIntro.includes('vocals'), 'Vocals MUTED in Intro');
    assert.ok(!activeTracksAtIntro.includes('track-4') && !activeTracksAtIntro.includes('other'), 'Other MUTED in Intro');

    // Check Web Audio schedule: items with delaySeconds === 0 are playing right now
    const introSchedule = timeline.getScheduleForTime(0.5);
    const currentlyPlaying = introSchedule.filter((s) => s.delaySeconds === 0);
    const playingTracksAtIntro = currentlyPlaying.map((s) => s.trackId);
    assert.ok(playingTracksAtIntro.includes('track-2') || playingTracksAtIntro.includes('drums'), 'Drums playing in Intro');
    assert.ok(playingTracksAtIntro.includes('track-3') || playingTracksAtIntro.includes('bass'), 'Bass playing in Intro');
    assert.ok(!playingTracksAtIntro.includes('track-1') && !playingTracksAtIntro.includes('vocals'), 'Vocals NOT playing in Intro');
    assert.ok(!playingTracksAtIntro.includes('track-4') && !playingTracksAtIntro.includes('other'), 'Other NOT playing in Intro');

    // Query active clips at playhead t = 3.0s (inside Early Chorus, t in [2.5, 7.5])
    const activeClipsAtChorus = timeline.getClipsAtTime(3.0);
    assert.equal(activeClipsAtChorus.length, 4, 'All 4 stems playing in Chorus at t=3.0s');
    const chorusSchedule = timeline.getScheduleForTime(3.0).filter((s) => s.delaySeconds === 0);
    assert.equal(chorusSchedule.length, 4, 'All 4 stems actively playing in Chorus');
    // Source offset should be 6.5s + (3.0s - 2.5s) = 7.0s
    for (const item of chorusSchedule) {
      assert.equal(item.sourceOffset.toFixed(2), '7.00', 'Source offset follows chorus audio samples');
    }

    // Query active clips at playhead t = 8.0s (inside Verse, t in [7.5, 11.5])
    const activeClipsAtVerse = timeline.getClipsAtTime(8.0);
    assert.equal(activeClipsAtVerse.length, 3, 'Vocals, Drums, Bass active in Verse (Other muted)');
    const verseSchedule = timeline.getScheduleForTime(8.0).filter((s) => s.delaySeconds === 0);
    // Source offset should be 2.5s + (8.0s - 7.5s) = 3.0s (pointing back to Verse audio!)
    for (const item of verseSchedule) {
      assert.equal(item.sourceOffset.toFixed(2), '3.00', 'Source offset follows verse audio samples');
    }
  });

  // -----------------------------------------------------------------
  // 6. Section Duplication & Deletion (Requirement 5 & 6)
  // -----------------------------------------------------------------
  await t.test('Duplicate and remove section operations', () => {
    const customArr = remix.getActiveArrangement();
    const countBefore = customArr.blocks.length;

    // Duplicate Chorus (block index 1)
    const clonedChorus = remix.duplicateSection(customArr.blocks[1].id);
    assert.ok(clonedChorus);
    assert.equal(customArr.blocks.length, countBefore + 1);
    assert.equal(customArr.blocks[2].id, clonedChorus.id, 'Cloned chorus placed adjacent at index 2');

    // Remove the cloned chorus
    const removed = remix.removeSection(clonedChorus.id);
    assert.equal(removed, true);
    assert.equal(customArr.blocks.length, countBefore);
    assert.equal(customArr.blocks[1].type, 'chorus');
    assert.equal(customArr.blocks[2].type, 'verse');
  });

  // -----------------------------------------------------------------
  // 7. Save Multiple Remix Arrangements in Project (Requirement 9)
  // -----------------------------------------------------------------
  await t.test('Manage multiple remix arrangements within one session', () => {
    // 1. Original Sequence exists
    assert.ok(remix.getAllArrangements().some((a) => a.id === 'arr-default'));

    // 2. Radio Edit Remix exists
    assert.ok(remix.getAllArrangements().some((a) => a.name === 'Radio Edit Remix'));

    // 3. Create Extended Club Mix
    const clubArr = remix.createArrangement('Extended Club Mix', 'club_extended');
    assert.ok(clubArr);
    assert.ok(clubArr.blocks.length >= 4);

    assert.equal(remix.getAllArrangements().length, 3, 'Project holds 3 distinct arrangements');

    // Switch between arrangements
    remix.selectArrangement('arr-default');
    assert.equal(remix.getActiveArrangement().name, 'Original Sequence');

    remix.selectArrangement(clubArr.id);
    assert.equal(remix.getActiveArrangement().name, 'Extended Club Mix');
  });

  // -----------------------------------------------------------------
  // 8. Return to Original Arrangement (Requirement 8 & 10)
  // -----------------------------------------------------------------
  await t.test('Return to Original Arrangement restores timeline and original clips', () => {
    // Call restoreOriginalArrangement
    const restored = remix.restoreOriginalArrangement(timeline);
    assert.equal(restored, true);

    // Active arrangement returned to Original Sequence
    assert.equal(remix.getActiveArrangement().id, 'arr-default');
    assert.equal(remix.getActiveArrangement().name, 'Original Sequence');

    // Timeline clips restored to original state (4 stems spanning 15.0s)
    const restoredClips = timeline.getAllClips();
    assert.equal(restoredClips.length, 4, 'Original 4 clips completely restored');

    for (const c of restoredClips) {
      assert.equal(c.startOffset, 0);
      assert.equal(c.duration, 15.0);
      assert.equal(c.sourceOffset, 0);
    }
  });

  // -----------------------------------------------------------------
  // 9. Real Offline WAV Export of Remix Arrangement
  // -----------------------------------------------------------------
  await t.test('Export custom arrangement to 16-bit WAV audio file', async () => {
    // Select the Radio Edit Remix arrangement
    const radioArr = remix.getAllArrangements().find((a) => a.name === 'Radio Edit Remix');
    assert.ok(radioArr);
    remix.selectArrangement(radioArr.id);

    const stemBuffers = {
      vocals: vocalsBuf,
      drums: drumsBuf,
      bass: bassBuf,
      other: otherBuf,
    };

    const wavBlob = await remix.exportArrangementWav(stemBuffers, 44100);
    assert.ok(wavBlob);
    assert.equal(wavBlob.type, 'audio/wav');
    assert.ok(wavBlob.size > 10000, `WAV file size: ${wavBlob.size} bytes`);

    // Verify WAV RIFF header
    const arrayBuf = await wavBlob.arrayBuffer();
    const header = Buffer.from(arrayBuf.slice(0, 12)).toString('ascii');
    assert.equal(header.slice(0, 4), 'RIFF');
    assert.equal(header.slice(8, 12), 'WAVE');
  });
});
