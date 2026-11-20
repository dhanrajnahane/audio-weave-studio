import { ProjectState, ProjectMetadata, ProjectSummary, ProjectOpenReport } from '../../types/project';
import { SongAnalysisResult } from '../../types/audio';
import { assetStorage } from '../../storage/indexedDB';
import { TimelineModel, timelineModel } from '../timeline/TimelineModel';
import { AudioClip } from '../timeline/types';
import { AudioGraphModel, audioGraphModel } from '../routing/AudioGraphModel';
import { RemixComposerModel, remixComposerModel } from '../remix/RemixComposerModel';
import { AudioEngine, audioEngine } from '../AudioEngine';
import { effectsManager } from '../effects/EffectsManager';
import { AudioExportEngine } from '../export/AudioExportEngine';

type ProjectChangeListener = () => void;

/**
 * Versioned Project Management Engine.
 * Handles: New Project, Save, Save As, Open, Rename, Delete, Auto-Save, Crash Recovery,
 * and complete binary audio asset persistence and restoration via IndexedDB.
 * Schema version: '2.0.0'
 */
export class ProjectManager {
  private currentProjectId: string = 'proj-default';
  private currentProjectName: string = 'Untitled Session';
  private lastSavedTime: number = Date.now();
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<ProjectChangeListener> = new Set();

  private timeline: TimelineModel;
  private routingGraph: AudioGraphModel;
  private remixComposer: RemixComposerModel;
  private engine: AudioEngine;
  private storage: typeof assetStorage;
  private effects: typeof effectsManager;

  // Additional persisted session state
  private currentAnalysis: SongAnalysisResult | null = null;
  private activeStemSetName: string | null = null;
  private activeAssetId: string | null = null;

  constructor(
    timeline: TimelineModel = timelineModel,
    routingGraph: AudioGraphModel = audioGraphModel,
    remixComposer: RemixComposerModel = remixComposerModel,
    engine: AudioEngine = audioEngine,
    storage: typeof assetStorage = assetStorage,
    effects: typeof effectsManager = effectsManager
  ) {
    this.timeline = timeline;
    this.routingGraph = routingGraph;
    this.remixComposer = remixComposer;
    this.engine = engine;
    this.storage = storage;
    this.effects = effects;

    this.startAutoSave();
  }

  setEffectsManager(effects: typeof effectsManager): void {
    this.effects = effects;
  }

  getEffectsManager(): typeof effectsManager {
    return this.effects;
  }

  getCurrentProjectId(): string {
    return this.currentProjectId;
  }

  getCurrentProjectName(): string {
    return this.currentProjectName;
  }

  getLastSavedTime(): number {
    return this.lastSavedTime;
  }

  getAnalysisResult(): SongAnalysisResult | null {
    return this.currentAnalysis;
  }

  setAnalysisResult(analysis: SongAnalysisResult | null): void {
    this.currentAnalysis = analysis;
    this.notify();
  }

  getActiveStemSetName(): string | null {
    return this.activeStemSetName;
  }

  setActiveStemSetName(name: string | null): void {
    this.activeStemSetName = name;
    this.notify();
  }

  getActiveAssetId(): string | null {
    return this.activeAssetId;
  }

  setActiveAssetId(id: string | null): void {
    this.activeAssetId = id;
    this.notify();
  }

  // -------------------------------------------------------------
  // Bundle Current State into Versioned Project Schema
  // -------------------------------------------------------------

  captureCurrentState(): ProjectState {
    const tracks = this.timeline.getTracks();
    const clips = this.timeline.getAllClips();
    const routingJson = this.routingGraph.toJSON();
    const activeArr = this.remixComposer.getActiveArrangement();
    const allArrangements = this.remixComposer.getAllArrangements();
    const detectedSections = this.remixComposer.getDetectedSections();

    // Mixer state
    const trackMixerSettings: Record<string, { volume: number; pan: number; muted: boolean; solo: boolean }> = {};
    for (const t of tracks) {
      const engTrack = this.engine.getTrack(t.id);
      trackMixerSettings[t.id] = {
        volume: engTrack !== undefined ? engTrack.volume : t.volume,
        pan: engTrack !== undefined ? engTrack.pan : t.pan,
        muted: engTrack !== undefined ? engTrack.muted : t.muted,
        solo: engTrack !== undefined ? engTrack.solo : t.solo,
      };
    }

    // Asset references (unique asset IDs used by clips or active project)
    const assetSet = new Set<string>();
    for (const c of clips) {
      if (c.assetId) assetSet.add(c.assetId);
    }
    if (this.activeAssetId) assetSet.add(this.activeAssetId);
    if (this.activeStemSetName) {
      for (const stem of ['vocals', 'drums', 'bass', 'other']) {
        assetSet.add(stem);
      }
    }

    const metadata: ProjectMetadata = {
      id: this.currentProjectId,
      name: this.currentProjectName,
      schemaVersion: '2.0.0',
      createdAt: this.currentProjectId === 'proj-default' ? Date.now() : Date.now(),
      updatedAt: Date.now(),
      bpm: activeArr?.bpm || this.currentAnalysis?.bpm || 120,
      timeSignature: [4, 4],
      duration: this.timeline.getTotalDuration(),
    };

    return {
      metadata,
      tracks,
      clips,
      mixer: {
        tracks: trackMixerSettings,
        master: {
          volume: this.engine.getMasterVolume(),
          muted: this.engine.getMasterMute(),
        },
      },
      routingGraph: routingJson,
      remixComposer: {
        detectedSections,
        arrangements: allArrangements,
        activeArrangementId: activeArr?.id || 'arr-default',
      },
      effects: this.effects.toJSON(),
      analysis: this.currentAnalysis,
      activeStemSetName: this.activeStemSetName,
      activeAssetId: this.activeAssetId,
      assetReferences: Array.from(assetSet),
    };
  }

  // -------------------------------------------------------------
  // Apply Project State to All Models and Audio Engine
  // -------------------------------------------------------------

  applyState(project: ProjectState): void {
    // 1. Restore Metadata
    this.currentProjectId = project.metadata.id;
    this.currentProjectName = project.metadata.name;
    this.lastSavedTime = project.metadata.updatedAt;

    // 2. Restore Timeline & Clips
    this.timeline.clearAll();
    for (const track of project.tracks) {
      this.timeline.addTrack(track);
    }
    for (const clip of project.clips) {
      this.timeline.addClip(clip, false);
    }

    // 3. Restore Routing Graph
    if (project.routingGraph) {
      this.routingGraph.fromJSON(project.routingGraph);
    }

    // 4. Restore Remix Composer
    if (project.remixComposer) {
      this.remixComposer.setDetectedSections(project.remixComposer.detectedSections || []);
      // Restore arrangements
      if (project.remixComposer.arrangements && project.remixComposer.arrangements.length > 0) {
        if (typeof (this.remixComposer as any).setArrangements === 'function') {
          (this.remixComposer as any).setArrangements(project.remixComposer.arrangements);
        } else {
          for (const arr of project.remixComposer.arrangements) {
            if (!this.remixComposer.getAllArrangements().some((a) => a.id === arr.id)) {
              this.remixComposer.createArrangement(arr.name, 'empty');
            }
          }
        }
        if (project.remixComposer.activeArrangementId) {
          this.remixComposer.selectArrangement(project.remixComposer.activeArrangementId);
        }
      }
    }

    // 5. Restore Mixer State
    if (project.mixer) {
      for (const [trackId, settings] of Object.entries(project.mixer.tracks || {})) {
        this.engine.setTrackVolume(trackId, settings.volume);
        this.engine.setTrackPan(trackId, settings.pan);
        this.engine.setTrackMute(trackId, settings.muted);
        this.engine.setTrackSolo(trackId, settings.solo);
        this.timeline.updateTrack(trackId, {
          volume: settings.volume,
          pan: settings.pan,
          muted: settings.muted,
          solo: settings.solo,
        });
      }
      if (project.mixer.master) {
        this.engine.setMasterVolume(project.mixer.master.volume);
        this.engine.setMasterMute(project.mixer.master.muted);
      }
    }

    // 6. Restore Effects Studio Settings
    if (project.effects) {
      this.effects.fromJSON(project.effects);
    }

    // 7. Restore Analysis Results & Active Asset/Stem Identifiers
    this.currentAnalysis = project.analysis || null;
    this.activeStemSetName = project.activeStemSetName || null;
    this.activeAssetId = project.activeAssetId || null;

    this.notify();
  }

  // -------------------------------------------------------------
  // Project Actions
  // -------------------------------------------------------------

  newProject(name: string = 'Untitled Session'): void {
    this.currentProjectId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    this.currentProjectName = name;
    this.lastSavedTime = Date.now();
    this.currentAnalysis = null;
    this.activeStemSetName = null;
    this.activeAssetId = null;

    this.timeline.clearAll();
    this.routingGraph.initDefaultGraph();
    this.effects.clear();
    this.engine.stop();
    this.notify();
  }

  async saveProject(): Promise<ProjectState> {
    const state = this.captureCurrentState();
    state.metadata.updatedAt = Date.now();
    this.lastSavedTime = state.metadata.updatedAt;

    // 1. Ensure all referenced audio assets are saved to IndexedDB binaries
    for (const assetId of state.assetReferences) {
      try {
        const hasBinary = await this.storage.hasAssetBinary(assetId);
        if (!hasBinary) {
          const inMemoryBuffer = this.timeline.getAsset(assetId);
          if (inMemoryBuffer) {
            // Encode in-memory AudioBuffer to PCM 16-bit WAV ArrayBuffer
            const wavBlob = AudioExportEngine.encodeWav(inMemoryBuffer, 16);
            const rawBytes = await wavBlob.arrayBuffer();

            // Save binary and asset metadata
            const existingAsset = await this.storage.getAsset(assetId);
            const assetToSave = existingAsset || {
              id: assetId,
              filename: `${assetId}.wav`,
              stored_filename: `${assetId}.wav`,
              stream_url: '',
              metadata: {
                filename: `${assetId}.wav`,
                format: 'WAV',
                subtype: 'PCM_16',
                duration_seconds: inMemoryBuffer.duration,
                duration_formatted: `${Math.floor(inMemoryBuffer.duration / 60)}:${Math.floor(inMemoryBuffer.duration % 60).toString().padStart(2, '0')}`,
                sample_rate: inMemoryBuffer.sampleRate,
                channels: inMemoryBuffer.numberOfChannels,
                channel_type: inMemoryBuffer.numberOfChannels === 2 ? 'Stereo' : 'Mono',
                frames: inMemoryBuffer.length,
                file_size_bytes: rawBytes.byteLength,
                file_size_formatted: `${(rawBytes.byteLength / (1024 * 1024)).toFixed(2)} MB`,
              },
              peaks: [],
              rms: [],
              max_peak: 1.0,
              createdAt: Date.now(),
            };
            await this.storage.saveAsset(assetToSave, rawBytes);
          }
        }
      } catch (err) {
        console.warn(`Could not persist binary for asset ${assetId}:`, err);
      }
    }

    // 2. Persist project state
    await this.storage.saveProject(state);
    // Clear auto-save once manual save completes
    await this.storage.clearAutoSave();

    this.notify();
    return state;
  }

  async saveAs(newName: string): Promise<ProjectState> {
    const newId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    this.currentProjectId = newId;
    this.currentProjectName = newName;

    return this.saveProject();
  }

  async openProject(projectId: string): Promise<ProjectOpenReport> {
    const state = await this.storage.getProject(projectId);
    if (!state) {
      return {
        success: false,
        projectId,
        projectName: '',
        restoredClipsCount: 0,
        restoredAssetsCount: 0,
        missingAssets: [],
        corruptedAssets: [],
        analysisRestored: false,
        effectsRestored: false,
        mixerRestored: false,
        error: `Project with ID ${projectId} not found in IndexedDB`,
      };
    }

    this.engine.stop();

    // 1. Restore state
    this.applyState(state);

    // 2. Restore audio assets & decode binaries
    const assetIds = new Set<string>(state.assetReferences || []);
    for (const clip of state.clips) {
      if (clip.assetId) assetIds.add(clip.assetId);
    }
    if (state.activeAssetId) assetIds.add(state.activeAssetId);

    const restoredAssetIds: string[] = [];
    const missingAssets: string[] = [];
    const corruptedAssets: string[] = [];

    for (const assetId of assetIds) {
      const expectedDuration = this.getExpectedAssetDuration(assetId, state.clips);
      try {
        const rawBytes = await this.storage.getAssetBinary(assetId);
        if (!rawBytes || rawBytes.byteLength === 0) {
          // Missing asset fallback
          missingAssets.push(assetId);
          const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
          this.timeline.registerAsset(assetId, placeholder);
          if (['vocals', 'drums', 'bass', 'other'].includes(assetId)) {
            this.engine.loadBuffer(placeholder, assetId, assetId.toUpperCase());
          }
          continue;
        }

        // Try decoding audio binary
        try {
          const decoded = await this.engine.decodeAudio(rawBytes);
          this.timeline.registerAsset(assetId, decoded);
          if (['vocals', 'drums', 'bass', 'other'].includes(assetId)) {
            this.engine.loadBuffer(decoded, assetId, assetId.toUpperCase());
          }
          restoredAssetIds.push(assetId);
        } catch (decodeErr) {
          // Corrupted binary audio! Graceful fallback
          console.warn(`Corrupted audio binary for asset ${assetId}:`, decodeErr);
          corruptedAssets.push(assetId);
          const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
          this.timeline.registerAsset(assetId, placeholder);
          if (['vocals', 'drums', 'bass', 'other'].includes(assetId)) {
            this.engine.loadBuffer(placeholder, assetId, assetId.toUpperCase());
          }
        }
      } catch (err) {
        missingAssets.push(assetId);
        const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
        this.timeline.registerAsset(assetId, placeholder);
      }
    }

    this.notify();

    return {
      success: true,
      projectId: state.metadata.id,
      projectName: state.metadata.name,
      restoredClipsCount: state.clips.length,
      restoredAssetsCount: restoredAssetIds.length,
      missingAssets,
      corruptedAssets,
      analysisRestored: !!state.analysis,
      effectsRestored: !!state.effects,
      mixerRestored: !!state.mixer,
    };
  }

  createSilentPlaceholderBuffer(durationSec: number, sampleRate: number = 44100): AudioBuffer {
    const safeDur = Math.max(0.5, durationSec || 10.0);
    const length = Math.ceil(safeDur * sampleRate);

    const ctx = this.engine.getContext();
    if (ctx && typeof (ctx as any).createBuffer === 'function') {
      return (ctx as any).createBuffer(2, length, sampleRate);
    }

    const ch0 = new Float32Array(length);
    const ch1 = new Float32Array(length);
    return {
      numberOfChannels: 2,
      length,
      sampleRate,
      duration: safeDur,
      getChannelData: (ch: number) => (ch === 1 ? ch1 : ch0),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  }

  private getExpectedAssetDuration(assetId: string, clips: AudioClip[]): number {
    let max = 0;
    for (const c of clips) {
      if (c.assetId === assetId) {
        const span = c.sourceOffset + c.duration;
        if (span > max) max = span;
      }
    }
    return max > 0 ? max : 15.0;
  }

  async renameProject(newName: string): Promise<void> {
    this.currentProjectName = newName;
    await this.saveProject();
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.storage.deleteProject(projectId);
    if (this.currentProjectId === projectId) {
      this.newProject('Untitled Session');
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.storage.getAllProjects();
  }

  // -------------------------------------------------------------
  // Auto-Save & Crash Recovery
  // -------------------------------------------------------------

  startAutoSave(intervalMs: number = 30000): void {
    this.stopAutoSave();

    // Auto-save every 30 seconds if timeline has content
    this.autoSaveTimer = setInterval(async () => {
      try {
        if (this.timeline.getAllClips().length > 0) {
          const state = this.captureCurrentState();
          await this.storage.saveAutoSave(state);
        }
      } catch (err) {
        console.warn('Auto-save snapshot error:', err);
      }
    }, intervalMs);

    if (this.autoSaveTimer && typeof (this.autoSaveTimer as any).unref === 'function') {
      (this.autoSaveTimer as any).unref();
    }
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  async checkRecovery(): Promise<ProjectState | null> {
    try {
      const autoSave = await this.storage.getAutoSave();
      if (!autoSave) return null;

      // If auto-save is newer than last saved project by > 5 seconds
      if (autoSave.savedAt > this.lastSavedTime + 5000) {
        return autoSave.project;
      }
      return null;
    } catch {
      return null;
    }
  }

  async recoverProject(state: ProjectState): Promise<ProjectOpenReport> {
    this.applyState(state);

    // Restore binary assets as well
    const assetIds = new Set<string>(state.assetReferences || []);
    for (const clip of state.clips) {
      if (clip.assetId) assetIds.add(clip.assetId);
    }
    if (state.activeAssetId) assetIds.add(state.activeAssetId);

    const restoredAssetIds: string[] = [];
    const missingAssets: string[] = [];
    const corruptedAssets: string[] = [];

    for (const assetId of assetIds) {
      const expectedDuration = this.getExpectedAssetDuration(assetId, state.clips);
      try {
        const rawBytes = await this.storage.getAssetBinary(assetId);
        if (rawBytes) {
          const decoded = await this.engine.decodeAudio(rawBytes);
          this.timeline.registerAsset(assetId, decoded);
          if (['vocals', 'drums', 'bass', 'other'].includes(assetId)) {
            this.engine.loadBuffer(decoded, assetId, assetId.toUpperCase());
          }
          restoredAssetIds.push(assetId);
        } else {
          missingAssets.push(assetId);
          const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
          this.timeline.registerAsset(assetId, placeholder);
        }
      } catch {
        corruptedAssets.push(assetId);
        const placeholder = this.createSilentPlaceholderBuffer(expectedDuration, 44100);
        this.timeline.registerAsset(assetId, placeholder);
      }
    }

    await this.storage.clearAutoSave();
    this.notify();

    return {
      success: true,
      projectId: state.metadata.id,
      projectName: state.metadata.name,
      restoredClipsCount: state.clips.length,
      restoredAssetsCount: restoredAssetIds.length,
      missingAssets,
      corruptedAssets,
      analysisRestored: !!state.analysis,
      effectsRestored: !!state.effects,
      mixerRestored: !!state.mixer,
    };
  }

  async dismissRecovery(): Promise<void> {
    await this.storage.clearAutoSave();
  }

  subscribe(listener: ProjectChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

export const projectManager = new ProjectManager();
