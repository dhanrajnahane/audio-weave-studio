export interface AudioClip {
  id: string;
  trackId: string;
  assetId: string;
  name: string;
  startOffset: number;    // Timeline start position in seconds
  duration: number;       // Duration on timeline in seconds
  sourceOffset: number;   // Offset into original source audio in seconds
  color?: string;
  selected?: boolean;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
}

export interface PlaybackScheduleItem {
  clip: AudioClip;
  trackId: string;
  sourceOffset: number;    // Where to start in the AudioBuffer
  delaySeconds: number;    // Delay from current audio clock (0 if currently playing)
  playDuration: number;    // Duration to play from this clip
}

export interface TimelineState {
  tracks: Track[];
  clips: AudioClip[];
  selectedClipIds: string[];
  zoom: number;            // Pixels per second factor
  snapEnabled: boolean;
  snapGridSeconds: number; // e.g. 0.25s, 0.5s, 1.0s
}
