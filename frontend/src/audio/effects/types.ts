/**
 * Audio Effects Studio — Type Definitions
 * Covers Equalizer, Reverb, Delay, and Dynamics Compressor
 * for both per-stem / per-track channels and master output.
 */

export interface EqualizerSettings {
  enabled: boolean;
  lowGain: number;   // -24dB to +24dB
  midGain: number;   // -24dB to +24dB
  highGain: number;  // -24dB to +24dB
  lowFreq: number;   // 40Hz to 500Hz (default: 100Hz)
  midFreq: number;   // 200Hz to 5000Hz (default: 1000Hz)
  highFreq: number;  // 2000Hz to 16000Hz (default: 6000Hz)
}

export interface ReverbSettings {
  enabled: boolean;
  decay: number;     // 0.1s to 10.0s (reverb decay time)
  preDelay: number;  // 0.0s to 0.1s
  wet: number;       // 0.0 to 1.0 (wet mix ratio)
  dry: number;       // 0.0 to 1.0 (dry signal level)
}

export interface DelaySettings {
  enabled: boolean;
  time: number;      // 0.01s to 1.0s (delay time)
  feedback: number;  // 0.0 to 0.85 (feedback gain)
  wet: number;       // 0.0 to 1.0 (wet mix ratio)
  dry: number;       // 0.0 to 1.0 (dry signal level)
}

export interface CompressorSettings {
  enabled: boolean;
  threshold: number; // -60dB to 0dB
  knee: number;      // 0dB to 40dB
  ratio: number;     // 1:1 to 20:1
  attack: number;    // 0.001s to 1.0s
  release: number;   // 0.01s to 1.0s
}

export interface TrackEffectsSettings {
  eq: EqualizerSettings;
  reverb: ReverbSettings;
  delay: DelaySettings;
  compressor: CompressorSettings;
}

export interface EffectsProjectState {
  tracks: Record<string, TrackEffectsSettings>;
  master: TrackEffectsSettings;
}

export const createDefaultEQ = (): EqualizerSettings => ({
  enabled: false,
  lowGain: 0,
  midGain: 0,
  highGain: 0,
  lowFreq: 100,
  midFreq: 1000,
  highFreq: 6000,
});

export const createDefaultReverb = (): ReverbSettings => ({
  enabled: false,
  decay: 2.0,
  preDelay: 0.01,
  wet: 0.35,
  dry: 1.0,
});

export const createDefaultDelay = (): DelaySettings => ({
  enabled: false,
  time: 0.25,
  feedback: 0.35,
  wet: 0.3,
  dry: 1.0,
});

export const createDefaultCompressor = (): CompressorSettings => ({
  enabled: false,
  threshold: -24,
  knee: 30,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
});

export const createDefaultTrackEffects = (): TrackEffectsSettings => ({
  eq: createDefaultEQ(),
  reverb: createDefaultReverb(),
  delay: createDefaultDelay(),
  compressor: createDefaultCompressor(),
});
