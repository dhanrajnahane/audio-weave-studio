/**
 * Remix Composer — Type Definitions
 */

export type MusicalSectionType =
  | 'intro'
  | 'verse'
  | 'pre_chorus'
  | 'chorus'
  | 'bridge'
  | 'drop'
  | 'solo'
  | 'outro';

export interface MusicalSection {
  id: string;
  name: string;
  type: MusicalSectionType;
  start: number;
  end: number;
  duration: number;
  energy: number; // 0.0 - 1.0
  color: string;
}

export interface ArrangementBlock {
  id: string;
  sectionId: string;
  name: string;
  type: MusicalSectionType;
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  timelineStart: number;
  activeStems: {
    vocals: boolean;
    drums: boolean;
    bass: boolean;
    other: boolean;
  };
  color: string;
}

export interface RemixArrangement {
  id: string;
  name: string;
  bpm: number;
  blocks: ArrangementBlock[];
  createdAt: number;
  updatedAt: number;
}
