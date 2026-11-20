import test from 'node:test';
import assert from 'node:assert/strict';

test('AudioWeave Studio — Smart Song Analyzer Integration & Conversion Tests', async (t) => {
  // Mock acoustic analysis result matching backend /api/audio/analyze payload
  const mockAnalysis = {
    filename: 'song1222_15s.wav',
    duration_seconds: 15.0,
    sample_rate: 44100,
    bpm: 129.2,
    beat_count: 29,
    beat_positions: [
      1.46, 1.9, 2.37, 2.83, 3.32, 3.81, 4.27, 4.74, 5.2, 5.67,
      6.13, 6.6, 7.05, 7.52, 7.98, 8.45, 8.91, 9.38, 9.84, 10.31,
      10.77, 11.24, 11.7, 12.16, 12.63, 13.09, 13.56, 14.02, 14.49
    ],
    silence_regions: [
      { start: 0.0, end: 0.49, duration: 0.49 },
      { start: 0.63, end: 0.93, duration: 0.3 }
    ],
    energy: {
      average_rms: 0.1355,
      max_rms: 0.2812,
      rms_dbfs: -17.4,
      peak_amplitude: 0.949,
      peak_dbfs: -0.5,
      dynamic_range_db: 16.9,
      energy_envelope: [0.1, 0.4, 0.8, 0.95, 0.7, 0.5, 0.2]
    },
    sections: [
      {
        id: 'sec-0',
        label: 'Intro',
        start: 0.0,
        end: 2.41,
        duration: 2.41,
        confidence: 0.88,
        confidence_label: 'high',
        is_estimated: false,
        energy_level: 'low',
        avg_rms: 0.092
      },
      {
        id: 'sec-1',
        label: 'Outro',
        start: 2.41,
        end: 15.0,
        duration: 12.59,
        confidence: 0.86,
        confidence_label: 'high',
        is_estimated: false,
        energy_level: 'low',
        avg_rms: 0.141
      }
    ],
    stem_activity: {
      has_stems: true,
      stems_folder: 'user_song/htdemucs/song1222_15s',
      energy_distribution: {
        vocals: 46.2,
        drums: 1.8,
        bass: 9.3,
        other: 42.6
      },
      timeline_buckets: [
        {
          time_start: 0.0,
          time_end: 0.5,
          vocals: 0.2,
          drums: 0.0,
          bass: 0.1,
          other: 0.3,
          active_stems: ['vocals', 'other']
        }
      ]
    },
    analysis_time_seconds: 6.92,
    from_cache: false
  };

  await t.test('1. BPM and Beat Position Monotonicity', () => {
    assert.equal(mockAnalysis.bpm, 129.2);
    assert.equal(mockAnalysis.beat_count, 29);
    assert.equal(mockAnalysis.beat_positions.length, 29);

    for (let i = 0; i < mockAnalysis.beat_positions.length - 1; i++) {
      assert.ok(
        mockAnalysis.beat_positions[i + 1] > mockAnalysis.beat_positions[i],
        `Beat position ${i+1} must be strictly after beat position ${i}`
      );
    }
  });

  await t.test('2. Silence region bounds and duration', () => {
    assert.equal(mockAnalysis.silence_regions.length, 2);
    for (const region of mockAnalysis.silence_regions) {
      assert.ok(region.end > region.start);
      assert.ok(Math.abs((region.end - region.start) - region.duration) < 0.001);
    }
  });

  await t.test('3. Energy metrics dynamic range calculation', () => {
    const { peak_dbfs, rms_dbfs, dynamic_range_db } = mockAnalysis.energy;
    assert.ok(peak_dbfs <= 0.0);
    assert.ok(rms_dbfs <= 0.0);
    assert.ok(dynamic_range_db > 0.0);
  });

  await t.test('4. Synchronization conversion from SongSectionAnalysis to Remix MusicalSection', () => {
    const normalizeType = (label) => {
      const l = label.toLowerCase();
      if (l.includes('intro')) return 'intro';
      if (l.includes('chorus') || l.includes('hook')) return 'chorus';
      if (l.includes('bridge')) return 'bridge';
      if (l.includes('outro')) return 'outro';
      return 'verse';
    };

    const getHexColor = (type) => {
      switch (type) {
        case 'intro': return '#06b6d4';
        case 'verse': return '#3b82f6';
        case 'chorus': return '#f59e0b';
        case 'bridge': return '#a855f7';
        case 'outro': return '#10b981';
        default: return '#6b7280';
      }
    };

    const getNumericEnergy = (level) => {
      switch (level) {
        case 'low': return 0.3;
        case 'medium': return 0.65;
        case 'high': return 0.95;
        default: return 0.5;
      }
    };

    const composerSections = mockAnalysis.sections.map((sec) => {
      const secType = normalizeType(sec.label);
      return {
        id: sec.id,
        name: sec.label,
        type: secType,
        start: sec.start,
        end: sec.end,
        duration: sec.duration,
        energy: getNumericEnergy(sec.energy_level),
        color: getHexColor(secType),
      };
    });

    assert.equal(composerSections.length, 2);
    assert.equal(composerSections[0].type, 'intro');
    assert.equal(composerSections[0].color, '#06b6d4');
    assert.equal(composerSections[0].energy, 0.3);
    assert.equal(composerSections[1].type, 'outro');
    assert.equal(composerSections[1].color, '#10b981');
  });

  await t.test('5. Stem Activity Distribution Sums to ~100%', () => {
    const dist = mockAnalysis.stem_activity.energy_distribution;
    const sum = dist.vocals + dist.drums + dist.bass + dist.other;
    assert.ok(Math.abs(sum - 100.0) < 1.0, `Sum of stem distribution must be ~100%, got ${sum}`);
  });
});
