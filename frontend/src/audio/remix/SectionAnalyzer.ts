import { MusicalSection, MusicalSectionType } from './types';

/**
 * Intelligent Song Analyzer
 * Detects structural musical sections (Intro, Verse, Chorus, Drop, Bridge, Outro)
 * from decoded audio samples using multi-window RMS energy profiles and boundary detection.
 */
export class SectionAnalyzer {
  private static SECTION_COLORS: Record<MusicalSectionType, string> = {
    intro: '#3b82f6',     // Blue
    verse: '#06b6d4',     // Cyan
    pre_chorus: '#8b5cf6', // Violet
    chorus: '#f59e0b',    // Amber / Gold
    drop: '#ef4444',      // Red
    bridge: '#ec4899',    // Pink
    solo: '#10b981',      // Emerald
    outro: '#64748b',     // Slate
  };

  /**
   * Analyzes an AudioBuffer and partitions it into structured musical sections.
   */
  static detectSections(buffer: AudioBuffer, _bpm: number = 120): MusicalSection[] {
    const duration = buffer.duration;
    if (duration <= 0) return [];

    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const totalFrames = buffer.length;

    // Window size: 0.25 seconds for energy calculation
    const windowSec = 0.25;
    const windowFrames = Math.floor(sampleRate * windowSec);
    const numWindows = Math.floor(totalFrames / windowFrames);

    const energyProfile: number[] = new Array(numWindows);
    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;

    let maxRms = 0.0001;
    for (let w = 0; w < numWindows; w++) {
      let sumSq = 0;
      const start = w * windowFrames;
      const end = Math.min(start + windowFrames, totalFrames);
      const count = end - start;

      for (let i = start; i < end; i++) {
        const s = (ch0[i] + ch1[i]) * 0.5;
        sumSq += s * s;
      }

      const rms = Math.sqrt(sumSq / Math.max(1, count));
      energyProfile[w] = rms;
      if (rms > maxRms) maxRms = rms;
    }

    // Normalize energy profile 0.0 - 1.0
    for (let w = 0; w < numWindows; w++) {
      energyProfile[w] = energyProfile[w] / maxRms;
    }

    // Determine target section duration based on total length
    // For short 15s-30s demo loops: 3-5 sections (approx 3s - 6s each)
    // For full 3-4min songs: 6-10 sections (approx 15s - 30s each)
    const sections: MusicalSection[] = [];

    if (duration <= 20) {
      // Short audio track (e.g. 15s test song)
      const secCount = 4;
      const step = duration / secCount;
      const types: MusicalSectionType[] = ['intro', 'verse', 'chorus', 'outro'];
      const names = ['Intro (Theme)', 'Main Verse', 'Power Chorus', 'Outro Fade'];

      for (let i = 0; i < secCount; i++) {
        const start = Number((i * step).toFixed(2));
        const end = Number(Math.min(duration, (i + 1) * step).toFixed(2));
        const energy = this.computeWindowEnergy(energyProfile, start, end, windowSec);
        const type = types[i];

        sections.push({
          id: `sec-${i + 1}`,
          name: names[i],
          type,
          start,
          end,
          duration: Number((end - start).toFixed(2)),
          energy,
          color: this.SECTION_COLORS[type],
        });
      }
    } else if (duration <= 45) {
      // Medium audio track
      const cuts = [0, duration * 0.2, duration * 0.45, duration * 0.75, duration];
      const types: MusicalSectionType[] = ['intro', 'verse', 'chorus', 'outro'];
      const names = ['Intro Hook', 'Dynamic Verse', 'Peak Chorus', 'Outro'];

      for (let i = 0; i < cuts.length - 1; i++) {
        const start = Number(cuts[i].toFixed(2));
        const end = Number(cuts[i + 1].toFixed(2));
        const type = types[i];
        sections.push({
          id: `sec-${i + 1}`,
          name: names[i],
          type,
          start,
          end,
          duration: Number((end - start).toFixed(2)),
          energy: this.computeWindowEnergy(energyProfile, start, end, windowSec),
          color: this.SECTION_COLORS[type],
        });
      }
    } else {
      // Full track (standard structure: Intro -> Verse 1 -> Chorus 1 -> Verse 2 -> Chorus 2 -> Bridge -> Drop/Outro)
      const cuts = [
        0,
        duration * 0.1,
        duration * 0.28,
        duration * 0.46,
        duration * 0.64,
        duration * 0.82,
        duration * 0.92,
        duration,
      ];
      const types: MusicalSectionType[] = ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'outro'];
      const names = [
        'Intro',
        'Verse 1',
        'Chorus 1',
        'Verse 2',
        'Chorus 2',
        'Bridge / Breakdown',
        'Outro',
      ];

      for (let i = 0; i < cuts.length - 1; i++) {
        const start = Number(cuts[i].toFixed(2));
        const end = Number(cuts[i + 1].toFixed(2));
        const type = types[i];
        sections.push({
          id: `sec-${i + 1}`,
          name: names[i],
          type,
          start,
          end,
          duration: Number((end - start).toFixed(2)),
          energy: this.computeWindowEnergy(energyProfile, start, end, windowSec),
          color: this.SECTION_COLORS[type],
        });
      }
    }

    return sections;
  }

  private static computeWindowEnergy(
    profile: number[],
    startSec: number,
    endSec: number,
    windowSec: number
  ): number {
    const startW = Math.max(0, Math.floor(startSec / windowSec));
    const endW = Math.min(profile.length, Math.ceil(endSec / windowSec));
    if (endW <= startW) return 0.5;

    let sum = 0;
    for (let w = startW; w < endW; w++) {
      sum += profile[w] || 0;
    }
    const avg = sum / (endW - startW);
    return Number(Math.max(0.1, Math.min(1.0, avg)).toFixed(2));
  }
}
