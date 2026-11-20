import { AudioClip, Track } from '../audio/timeline/types';
import { AudioNodeData, AudioConnection } from '../audio/routing/types';
import { RemixArrangement, MusicalSection } from '../audio/remix/types';
import { EffectsProjectState } from '../audio/effects/types';
import { SongAnalysisResult } from './audio';

export interface ProjectMetadata {
  id: string;
  name: string;
  schemaVersion: '2.0.0';
  createdAt: number;
  updatedAt: number;
  bpm: number;
  timeSignature: [number, number];
  duration: number;
}

export interface TrackMixerSettings {
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

export interface MasterMixerSettings {
  volume: number;
  muted: boolean;
}

export interface ProjectState {
  metadata: ProjectMetadata;
  tracks: Track[];
  clips: AudioClip[];
  mixer: {
    tracks: Record<string, TrackMixerSettings>;
    master: MasterMixerSettings;
  };
  routingGraph: {
    nodes: AudioNodeData[];
    connections: AudioConnection[];
  };
  remixComposer: {
    detectedSections: MusicalSection[];
    arrangements: RemixArrangement[];
    activeArrangementId: string;
  };
  effects?: EffectsProjectState;
  analysis?: SongAnalysisResult | null;
  activeStemSetName?: string | null;
  activeAssetId?: string | null;
  assetReferences: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  schemaVersion: string;
  updatedAt: number;
  createdAt: number;
  clipCount: number;
  trackCount: number;
  duration: number;
}

export interface ProjectOpenReport {
  success: boolean;
  projectId: string;
  projectName: string;
  restoredClipsCount: number;
  restoredAssetsCount: number;
  missingAssets: string[];
  corruptedAssets: string[];
  analysisRestored: boolean;
  effectsRestored: boolean;
  mixerRestored: boolean;
  error?: string;
}
