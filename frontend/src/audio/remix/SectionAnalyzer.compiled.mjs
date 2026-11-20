// src/audio/remix/SectionAnalyzer.ts
var SectionAnalyzer = class {
  static SECTION_COLORS = {
    intro: "#3b82f6",
    // Blue
    verse: "#06b6d4",
    // Cyan
    pre_chorus: "#8b5cf6",
    // Violet
    chorus: "#f59e0b",
    // Amber / Gold
    drop: "#ef4444",
    // Red
    bridge: "#ec4899",
    // Pink
    solo: "#10b981",
    // Emerald
    outro: "#64748b"
    // Slate
  };
  /**
   * Analyzes an AudioBuffer and partitions it into structured musical sections.
   */
  static detectSections(buffer, _bpm = 120) {
    const duration = buffer.duration;
    if (duration <= 0) return [];
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const totalFrames = buffer.length;
    const windowSec = 0.25;
    const windowFrames = Math.floor(sampleRate * windowSec);
    const numWindows = Math.floor(totalFrames / windowFrames);
    const energyProfile = new Array(numWindows);
    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;
    let maxRms = 1e-4;
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
    for (let w = 0; w < numWindows; w++) {
      energyProfile[w] = energyProfile[w] / maxRms;
    }
    const sections = [];
    if (duration <= 20) {
      const secCount = 4;
      const step = duration / secCount;
      const types = ["intro", "verse", "chorus", "outro"];
      const names = ["Intro (Theme)", "Main Verse", "Power Chorus", "Outro Fade"];
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
          color: this.SECTION_COLORS[type]
        });
      }
    } else if (duration <= 45) {
      const cuts = [0, duration * 0.2, duration * 0.45, duration * 0.75, duration];
      const types = ["intro", "verse", "chorus", "outro"];
      const names = ["Intro Hook", "Dynamic Verse", "Peak Chorus", "Outro"];
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
          color: this.SECTION_COLORS[type]
        });
      }
    } else {
      const cuts = [
        0,
        duration * 0.1,
        duration * 0.28,
        duration * 0.46,
        duration * 0.64,
        duration * 0.82,
        duration * 0.92,
        duration
      ];
      const types = ["intro", "verse", "chorus", "verse", "chorus", "bridge", "outro"];
      const names = [
        "Intro",
        "Verse 1",
        "Chorus 1",
        "Verse 2",
        "Chorus 2",
        "Bridge / Breakdown",
        "Outro"
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
          color: this.SECTION_COLORS[type]
        });
      }
    }
    return sections;
  }
  static computeWindowEnergy(profile, startSec, endSec, windowSec) {
    const startW = Math.max(0, Math.floor(startSec / windowSec));
    const endW = Math.min(profile.length, Math.ceil(endSec / windowSec));
    if (endW <= startW) return 0.5;
    let sum = 0;
    for (let w = startW; w < endW; w++) {
      sum += profile[w] || 0;
    }
    const avg = sum / (endW - startW);
    return Number(Math.max(0.1, Math.min(1, avg)).toFixed(2));
  }
};
export {
  SectionAnalyzer
};
