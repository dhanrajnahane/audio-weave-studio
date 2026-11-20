import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Intelligent Remix Composer Acceptance Test Suite
 * ---------------------------------------------------------------------
 * Verifies:
 * 1. Musical section detection from real audio buffer.
 * 2. Select & add detected musical sections to arrangement.
 * 3. Duplicate sections.
 * 4. Rearrange sections with automatic timeline offset recalculation.
 * 5. Remove sections.
 * 6. Select stems active in each section.
 * 7. Alternative arrangements creation (Radio Edit, Club Extended, Custom).
 * 8. Synchronization to TimelineModel for immediate playback.
 * 9. Real Offline WAV Audio Export with PCM byte encoding.
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
    // Fill with simple test tone
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

const analyzerPath = path.resolve('src/audio/remix/SectionAnalyzer.compiled.mjs');
const { SectionAnalyzer } = await import(pathToFileURL(analyzerPath).href);

const remixModelPath = path.resolve('src/audio/remix/RemixComposerModel.compiled.mjs');
const { RemixComposerModel } = await import(pathToFileURL(remixModelPath).href);

const timelineModelPath = path.resolve('src/audio/timeline/TimelineModel.compiled.mjs');
const { TimelineModel } = await import(pathToFileURL(timelineModelPath).href);

test('Remix Composer Acceptance Tests', async (t) => {
  const wavPath = path.resolve('../storage/stems/user_song/htdemucs/song1222_15s/vocals.wav');
  assert.ok(fs.existsSync(wavPath), 'Real audio source file must exist');
  const sourceBuffer = parseWav(wavPath);
  assert.equal(sourceBuffer.duration, 15.0);

  const remix = new RemixComposerModel();
  const timeline = new TimelineModel();

  // Register stem buffer in timeline
  timeline.registerAsset('vocals', sourceBuffer);
  timeline.registerAsset('drums', sourceBuffer);
  timeline.registerAsset('bass', sourceBuffer);
  timeline.registerAsset('other', sourceBuffer);

  // -----------------------------------------------------------------
  // 1. Musical Section Detection
  // -----------------------------------------------------------------
  let detected = [];
  await t.test('1. Detect musical sections from real audio buffer', () => {
    detected = SectionAnalyzer.detectSections(sourceBuffer);
    assert.ok(detected.length >= 4, 'Detected at least 4 musical sections');
    assert.equal(detected[0].type, 'intro');
    assert.ok(detected.some((s) => s.type === 'chorus'));
    assert.ok(detected.some((s) => s.type === 'outro'));

    for (const sec of detected) {
      assert.ok(sec.duration > 0);
      assert.ok(sec.energy >= 0 && sec.energy <= 1.0);
      assert.ok(sec.color.startsWith('#'));
    }

    remix.setDetectedSections(detected);
    assert.equal(remix.getDetectedSections().length, detected.length);
  });

  // -----------------------------------------------------------------
  // 2. Select and Add Sections to Arrangement
  // -----------------------------------------------------------------
  await t.test('2. Add detected sections to active arrangement', () => {
    const active = remix.getActiveArrangement();
    const initialCount = active.blocks.length;

    // Add chorus section explicitly
    const chorusSec = detected.find((s) => s.type === 'chorus');
    assert.ok(chorusSec);

    const added = remix.addSectionToArrangement(chorusSec.id);
    assert.ok(added);
    assert.equal(added.sectionId, chorusSec.id);
    assert.equal(active.blocks.length, initialCount + 1);

    // Verify timelineStart is calculated
    const last = active.blocks[active.blocks.length - 1];
    assert.equal(last.id, added.id);
    assert.ok(last.timelineStart > 0);
  });

  // -----------------------------------------------------------------
  // 3. Duplicate Section Block
  // -----------------------------------------------------------------
  let duplicatedBlockId = null;
  await t.test('3. Duplicate section in arrangement', () => {
    const active = remix.getActiveArrangement();
    const targetBlock = active.blocks[1];
    assert.ok(targetBlock);

    const dup = remix.duplicateSection(targetBlock.id);
    assert.ok(dup);
    duplicatedBlockId = dup.id;

    assert.equal(dup.sourceStart, targetBlock.sourceStart);
    assert.equal(dup.duration, targetBlock.duration);
    assert.ok(dup.name.includes('Copy'));

    // Verify adjacent placement
    const dupIdx = active.blocks.findIndex((b) => b.id === dup.id);
    const targetIdx = active.blocks.findIndex((b) => b.id === targetBlock.id);
    assert.equal(dupIdx, targetIdx + 1, 'Duplicate is adjacent to target');
  });

  // -----------------------------------------------------------------
  // 4. Rearrange Sections with Automatic Offset Recalculation
  // -----------------------------------------------------------------
  await t.test('4. Rearrange sections and verify timeline start offsets', () => {
    const active = remix.getActiveArrangement();
    const firstBlockId = active.blocks[0].id;

    // Move first section to index 3
    const success = remix.rearrangeSection(firstBlockId, 3);
    assert.equal(success, true);
    assert.equal(active.blocks[3].id, firstBlockId);

    // Verify that every block's timelineStart is strictly continuous
    let expectedOffset = 0;
    for (const b of active.blocks) {
      assert.equal(b.timelineStart, Number(expectedOffset.toFixed(2)));
      expectedOffset += b.duration;
    }
  });

  // -----------------------------------------------------------------
  // 5. Remove Section Block
  // -----------------------------------------------------------------
  await t.test('5. Remove section and update arrangement', () => {
    const active = remix.getActiveArrangement();
    const countBefore = active.blocks.length;

    assert.ok(duplicatedBlockId);
    const removed = remix.removeSection(duplicatedBlockId);
    assert.equal(removed, true);
    assert.equal(active.blocks.length, countBefore - 1);
    assert.equal(active.blocks.find((b) => b.id === duplicatedBlockId), undefined);
  });

  // -----------------------------------------------------------------
  // 6. Select Stems Active in Each Section
  // -----------------------------------------------------------------
  await t.test('6. Toggle stems active in individual sections', () => {
    const active = remix.getActiveArrangement();
    const block0 = active.blocks[0];

    // Initially all 4 stems active
    assert.equal(block0.activeStems.vocals, true);
    assert.equal(block0.activeStems.drums, true);

    // Mute vocals in section 0
    remix.toggleStem(block0.id, 'vocals');
    assert.equal(block0.activeStems.vocals, false, 'Vocals muted in block 0');
    assert.equal(block0.activeStems.drums, true, 'Drums remain active in block 0');

    // Mute bass in section 0
    remix.toggleStem(block0.id, 'bass');
    assert.equal(block0.activeStems.bass, false, 'Bass muted in block 0');

    // Unmute vocals
    remix.toggleStem(block0.id, 'vocals');
    assert.equal(block0.activeStems.vocals, true, 'Vocals unmuted');
  });

  // -----------------------------------------------------------------
  // 7. Alternative Arrangements (Radio Edit, Club Extended)
  // -----------------------------------------------------------------
  await t.test('7. Create and switch between alternative arrangements', () => {
    // Create Radio Edit template
    const radioArr = remix.createArrangement('Radio Edit 2026', 'radio_edit');
    assert.ok(radioArr);
    assert.equal(remix.getActiveArrangement().id, radioArr.id);
    assert.ok(radioArr.blocks.length >= 3);

    // Create Club Extended template
    const clubArr = remix.createArrangement('Extended Club Mix', 'club_extended');
    assert.ok(clubArr);
    assert.equal(remix.getActiveArrangement().id, clubArr.id);
    assert.ok(clubArr.blocks.length >= 4);

    // Switch back to Radio Edit
    remix.selectArrangement(radioArr.id);
    assert.equal(remix.getActiveArrangement().name, 'Radio Edit 2026');

    assert.ok(remix.getAllArrangements().length >= 3);
  });

  // -----------------------------------------------------------------
  // 8. Integration with TimelineModel: Editable & Playable
  // -----------------------------------------------------------------
  await t.test('8. Apply remix arrangement to TimelineModel for immediate playback', () => {
    // Apply current arrangement to timeline
    remix.applyToTimeline(timeline);

    const timelineClips = timeline.getAllClips();
    assert.ok(timelineClips.length > 0, 'Timeline clips generated from remix arrangement');

    // Mute drums in block 0 of active arrangement and re-apply
    const active = remix.getActiveArrangement();
    remix.toggleStem(active.blocks[0].id, 'drums'); // turn drums off in block 0
    remix.applyToTimeline(timeline);

    const clipsAfterMute = timeline.getAllClips();
    const drumClipsAtBlock0 = clipsAfterMute.filter(
      (c) => c.trackId === 'track-2' && c.startOffset === active.blocks[0].timelineStart
    );
    assert.equal(drumClipsAtBlock0.length, 0, 'Muted drums stem omitted from timeline at block 0');

    // Verify playback schedule can be queried for AudioEngine
    const schedule = timeline.getScheduleForTime(0.0);
    assert.ok(schedule.length > 0, 'Playback schedule successfully generated for remix');
  });

  // -----------------------------------------------------------------
  // 9. Real Offline WAV Audio Export
  // -----------------------------------------------------------------
  await t.test('9. Export arrangement to real 16-bit PCM WAV Blob', async () => {
    const stemBuffers = {
      vocals: sourceBuffer,
      drums: sourceBuffer,
      bass: sourceBuffer,
      other: sourceBuffer,
    };

    const wavBlob = await remix.exportArrangementWav(stemBuffers, 44100);
    assert.ok(wavBlob, 'WAV Blob created');
    assert.equal(wavBlob.type, 'audio/wav');
    assert.ok(wavBlob.size > 44, 'WAV Blob has header and audio PCM data');

    // Verify RIFF and WAVE header bytes
    const arrayBuffer = await wavBlob.arrayBuffer();
    const headerBuf = Buffer.from(arrayBuffer.slice(0, 12));
    assert.equal(headerBuf.toString('ascii', 0, 4), 'RIFF');
    assert.equal(headerBuf.toString('ascii', 8, 12), 'WAVE');
  });
});
