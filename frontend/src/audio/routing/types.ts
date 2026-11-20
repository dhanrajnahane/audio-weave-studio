/**
 * Audio Routing Graph — Type Definitions
 * Represents a Directed Acyclic Graph (DAG) for modular audio signal routing.
 */

export type AudioNodeType =
  | 'input'
  | 'gain'
  | 'eq'
  | 'compressor'
  | 'reverb'
  | 'delay'
  | 'lowpass'
  | 'highpass'
  | 'pan'
  | 'output';

export interface AudioNodeData {
  id: string;
  type: AudioNodeType;
  name: string;
  x: number;
  y: number;
  bypassed: boolean;
  params: Record<string, number>;
}

export interface AudioConnection {
  id: string;
  fromNodeId: string;
  fromPort: 'out';
  toNodeId: string;
  toPort: 'in';
}

export interface GraphValidationResult {
  isValid: boolean;
  error?: string;
  hasCycle: boolean;
  topologicalOrder?: string[];
}

export interface AudioNodeParamConfig {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
}

export const NODE_PARAM_DEFINITIONS: Record<AudioNodeType, AudioNodeParamConfig[]> = {
  input: [],
  output: [
    { name: 'masterGain', label: 'Output Level', min: 0, max: 2, step: 0.01, defaultValue: 1.0, unit: 'x' },
  ],
  gain: [
    { name: 'gain', label: 'Gain', min: 0, max: 2.0, step: 0.01, defaultValue: 1.0, unit: 'x' },
  ],
  eq: [
    { name: 'lowGain', label: 'Low (320Hz)', min: -24, max: 24, step: 0.5, defaultValue: 0, unit: 'dB' },
    { name: 'midGain', label: 'Mid (1kHz)', min: -24, max: 24, step: 0.5, defaultValue: 0, unit: 'dB' },
    { name: 'highGain', label: 'High (3.2kHz)', min: -24, max: 24, step: 0.5, defaultValue: 0, unit: 'dB' },
  ],
  compressor: [
    { name: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, defaultValue: -24, unit: 'dB' },
    { name: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, defaultValue: 4, unit: ':1' },
    { name: 'knee', label: 'Knee', min: 0, max: 40, step: 1, defaultValue: 10, unit: 'dB' },
    { name: 'attack', label: 'Attack', min: 0.001, max: 0.5, step: 0.005, defaultValue: 0.01, unit: 's' },
    { name: 'release', label: 'Release', min: 0.05, max: 1.0, step: 0.05, defaultValue: 0.25, unit: 's' },
  ],
  reverb: [
    { name: 'decay', label: 'Decay Time', min: 0.2, max: 6.0, step: 0.1, defaultValue: 2.0, unit: 's' },
    { name: 'wet', label: 'Wet Mix', min: 0, max: 1.0, step: 0.02, defaultValue: 0.35, unit: '%' },
    { name: 'dry', label: 'Dry Mix', min: 0, max: 1.0, step: 0.02, defaultValue: 1.0, unit: '%' },
  ],
  delay: [
    { name: 'delayTime', label: 'Delay Time', min: 0.02, max: 1.5, step: 0.02, defaultValue: 0.3, unit: 's' },
    { name: 'feedback', label: 'Feedback', min: 0, max: 0.85, step: 0.02, defaultValue: 0.35, unit: '%' },
    { name: 'wet', label: 'Wet Level', min: 0, max: 1.0, step: 0.02, defaultValue: 0.4, unit: '%' },
  ],
  lowpass: [
    { name: 'frequency', label: 'Cutoff Freq', min: 100, max: 18000, step: 50, defaultValue: 2500, unit: 'Hz' },
    { name: 'q', label: 'Resonance (Q)', min: 0.5, max: 12, step: 0.1, defaultValue: 1.0, unit: '' },
  ],
  highpass: [
    { name: 'frequency', label: 'Cutoff Freq', min: 20, max: 4000, step: 20, defaultValue: 150, unit: 'Hz' },
    { name: 'q', label: 'Resonance (Q)', min: 0.5, max: 12, step: 0.1, defaultValue: 1.0, unit: '' },
  ],
  pan: [
    { name: 'pan', label: 'Pan', min: -1.0, max: 1.0, step: 0.05, defaultValue: 0.0, unit: '' },
  ],
};
