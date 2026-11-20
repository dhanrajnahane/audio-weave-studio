import {
  TrackEffectsSettings,
  EqualizerSettings,
  ReverbSettings,
  DelaySettings,
  CompressorSettings,
  EffectsProjectState,
  createDefaultTrackEffects,
} from './types';
import { EffectsRack } from './EffectsRack';
import { normalizeTrackId } from '../timeline/TimelineModel';

type EffectsChangeListener = () => void;

/**
 * EffectsManager
 * Central state and Web Audio API node coordinator for all audio effects.
 * Manages per-track and master EffectsRack instances with instant parameter updates,
 * real-time auditioning, serialization, and project persistence.
 */
export class EffectsManager {
  private trackSettings: Map<string, TrackEffectsSettings> = new Map();
  private masterSettings: TrackEffectsSettings = createDefaultTrackEffects();

  // Active Web Audio API Racks
  private trackRacks: Map<string, EffectsRack> = new Map();
  private masterRack: EffectsRack | null = null;
  private ctx: BaseAudioContext | null = null;

  private listeners: Set<EffectsChangeListener> = new Set();

  constructor() {
    // Initialize default canonical stem tracks and aliases
    const defaultTrackIds = ['vocals', 'drums', 'bass', 'other'];
    for (const tid of defaultTrackIds) {
      this.trackSettings.set(tid, createDefaultTrackEffects());
    }
  }

  setContext(ctx: BaseAudioContext): void {
    this.ctx = ctx;
  }

  getContext(): BaseAudioContext | null {
    return this.ctx;
  }

  // -------------------------------------------------------------
  // State Accessors
  // -------------------------------------------------------------

  getTrackSettings(trackId: string): TrackEffectsSettings {
    const id = normalizeTrackId(trackId);
    let settings = this.trackSettings.get(id);
    if (!settings) {
      settings = createDefaultTrackEffects();
      this.trackSettings.set(id, settings);
    }
    return JSON.parse(JSON.stringify(settings));
  }

  getMasterSettings(): TrackEffectsSettings {
    return JSON.parse(JSON.stringify(this.masterSettings));
  }

  // -------------------------------------------------------------
  // Track Effect Mutators
  // -------------------------------------------------------------

  setTrackEqualizer(trackId: string, eq: Partial<EqualizerSettings>): void {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.eq = { ...settings.eq, ...eq };
    this.trackSettings.set(id, settings);

    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setEqualizer(settings.eq);
    }
    this.notify();
  }

  setTrackReverb(trackId: string, reverb: Partial<ReverbSettings>): void {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.reverb = { ...settings.reverb, ...reverb };
    this.trackSettings.set(id, settings);

    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setReverb(settings.reverb);
    }
    this.notify();
  }

  setTrackDelay(trackId: string, delay: Partial<DelaySettings>): void {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.delay = { ...settings.delay, ...delay };
    this.trackSettings.set(id, settings);

    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setDelay(settings.delay);
    }
    this.notify();
  }

  setTrackCompressor(trackId: string, comp: Partial<CompressorSettings>): void {
    const id = normalizeTrackId(trackId);
    const settings = this.getTrackSettings(id);
    settings.compressor = { ...settings.compressor, ...comp };
    this.trackSettings.set(id, settings);

    const rack = this.trackRacks.get(id);
    if (rack) {
      rack.setCompressor(settings.compressor);
    }
    this.notify();
  }

  // -------------------------------------------------------------
  // Master Effect Mutators
  // -------------------------------------------------------------

  setMasterEqualizer(eq: Partial<EqualizerSettings>): void {
    this.masterSettings.eq = { ...this.masterSettings.eq, ...eq };
    if (this.masterRack) {
      this.masterRack.setEqualizer(this.masterSettings.eq);
    }
    this.notify();
  }

  setMasterReverb(reverb: Partial<ReverbSettings>): void {
    this.masterSettings.reverb = { ...this.masterSettings.reverb, ...reverb };
    if (this.masterRack) {
      this.masterRack.setReverb(this.masterSettings.reverb);
    }
    this.notify();
  }

  setMasterDelay(delay: Partial<DelaySettings>): void {
    this.masterSettings.delay = { ...this.masterSettings.delay, ...delay };
    if (this.masterRack) {
      this.masterRack.setDelay(this.masterSettings.delay);
    }
    this.notify();
  }

  setMasterCompressor(comp: Partial<CompressorSettings>): void {
    this.masterSettings.compressor = { ...this.masterSettings.compressor, ...comp };
    if (this.masterRack) {
      this.masterRack.setCompressor(this.masterSettings.compressor);
    }
    this.notify();
  }

  // -------------------------------------------------------------
  // Web Audio Node Wiring (AudioEngine Live Playback)
  // -------------------------------------------------------------

  getOrCreateTrackRack(trackId: string, ctx: BaseAudioContext): EffectsRack {
    const id = normalizeTrackId(trackId);
    let rack = this.trackRacks.get(id);
    if (!rack) {
      const settings = this.getTrackSettings(id);
      rack = new EffectsRack(ctx, settings);
      this.trackRacks.set(id, rack);
    }
    return rack;
  }

  getOrCreateMasterRack(ctx: BaseAudioContext): EffectsRack {
    if (!this.masterRack) {
      this.masterRack = new EffectsRack(ctx, this.masterSettings);
    }
    return this.masterRack;
  }

  // -------------------------------------------------------------
  // Serialization & Project Persistence
  // -------------------------------------------------------------

  toJSON(): EffectsProjectState {
    const tracksObj: Record<string, TrackEffectsSettings> = {};
    for (const [id, settings] of this.trackSettings.entries()) {
      tracksObj[id] = JSON.parse(JSON.stringify(settings));
    }
    return {
      tracks: tracksObj,
      master: JSON.parse(JSON.stringify(this.masterSettings)),
    };
  }

  fromJSON(state: EffectsProjectState): void {
    if (!state) return;

    if (state.master) {
      this.masterSettings = { ...createDefaultTrackEffects(), ...state.master };
      if (this.masterRack) {
        this.masterRack.updateAll(this.masterSettings);
      }
    }

    if (state.tracks) {
      for (const [id, settings] of Object.entries(state.tracks)) {
        const merged = { ...createDefaultTrackEffects(), ...settings };
        this.trackSettings.set(id, merged);
        const rack = this.trackRacks.get(id);
        if (rack) {
          rack.updateAll(merged);
        }
      }
    }

    this.notify();
  }

  resetAll(): void {
    this.masterSettings = createDefaultTrackEffects();
    this.trackSettings.clear();
    this.masterRack = null;
    this.trackRacks.clear();
    this.notify();
  }

  // -------------------------------------------------------------
  // Change Subscriptions
  // -------------------------------------------------------------

  subscribe(listener: EffectsChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  clear(): void {
    this.trackRacks.forEach((rack) => rack.dispose());
    this.trackRacks.clear();
    if (this.masterRack) {
      this.masterRack.dispose();
      this.masterRack = null;
    }
    this.trackSettings.clear();
    this.masterSettings = createDefaultTrackEffects();
    this.notify();
  }
}

export const effectsManager = new EffectsManager();
