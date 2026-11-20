export interface AudioMetadata {
  filename: string;
  format: string;
  subtype: string;
  duration_seconds: number;
  duration_formatted: string;
  sample_rate: number;
  channels: number;
  channel_type: string;
  frames: number;
  file_size_bytes: number;
  file_size_formatted: string;
}

export interface WaveformData {
  peaks: [number, number][]; // [min, max] amplitude pairs
  rms: number[];
  num_bins: number;
  max_peak: number;
}

export interface AudioAsset {
  id: string;
  filename: string;
  stored_filename: string;
  stream_url: string;
  metadata: AudioMetadata;
  peaks: [number, number][];
  rms: number[];
  max_peak: number;
  createdAt: number;
  rawArrayBuffer?: ArrayBuffer; // Optional in-memory or IndexedDB cached raw bytes
}

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'processing';

export interface StemInfo {
  stem: string;
  filename: string;
  stream_url: string;
  metadata: {
    duration_seconds: number;
    sample_rate: number;
    channels: number;
  };
}

export interface StemSetInfo {
  id: string;
  name: string;
  relative_path: string;
  stems: {
    [key: string]: StemInfo;
  };
}

export interface UploadResponse {
  id: string;
  filename: string;
  stored_filename: string;
  file_path: string;
  stream_url: string;
  metadata: AudioMetadata;
  peaks: [number, number][];
  rms: number[];
  max_peak: number;
}

export interface BackendStatus {
  connectionState: ConnectionState;
  connected: boolean;
  status: string;
  device: string;
  supportedFormats: string[];
  retryCount?: number;
  lastChecked?: number;
  errorMessage?: string;
}

export interface SeparationJob {
  job_id: string;
  stored_filename: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  progress: number;
  stage: string;
  result?: any;
  error?: string;
  created_at?: number;
  updated_at?: number;
}

export interface SongSectionAnalysis {
  id: string;
  label: string;
  start: number;
  end: number;
  duration: number;
  confidence: number;
  is_estimated: boolean;
  confidence_label: string;
  energy_level: 'low' | 'medium' | 'high';
  avg_rms: number;
}

export interface SilenceRegion {
  start: number;
  end: number;
  duration: number;
}

export interface EnergyMetrics {
  average_rms: number;
  max_rms: number;
  rms_dbfs: number;
  peak_amplitude: number;
  peak_dbfs: number;
  dynamic_range_db: number;
  energy_envelope: number[];
}

export interface StemTimelineBucket {
  time_start: number;
  time_end: number;
  vocals: number;
  drums: number;
  bass: number;
  other: number;
  active_stems: string[];
}

export interface StemActivityMap {
  has_stems: boolean;
  stems_folder: string;
  energy_distribution: {
    vocals: number;
    drums: number;
    bass: number;
    other: number;
  };
  timeline_buckets: StemTimelineBucket[];
}

export interface SongAnalysisResult {
  filename: string;
  duration_seconds: number;
  sample_rate: number;
  bpm: number;
  beat_count: number;
  beat_positions: number[];
  silence_regions: SilenceRegion[];
  silence_count: number;
  energy: EnergyMetrics;
  sections: SongSectionAnalysis[];
  section_count: number;
  stem_activity?: StemActivityMap | null;
  analysis_time_seconds: number;
  analyzed_at: number;
  from_cache: boolean;
}
