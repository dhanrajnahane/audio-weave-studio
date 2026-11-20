import { TimelineModel, normalizeTrackId } from './timeline/TimelineModel';
import { effectsManager } from './effects/EffectsManager';

type TimeUpdateCallback = (currentTime: number, duration: number) => void;
type PlayStateCallback = (isPlaying: boolean) => void;
type TrackStatesCallback = (tracks: TrackInfo[]) => void;

export interface TrackInfo {
  id: string;
  name: string;
  duration: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  isActive: boolean;
  isSelected?: boolean;
}

export interface TrackNode {
  id: string;
  name: string;
  buffer?: AudioBuffer;
  gainNode: GainNode;
  panNode: StereoPannerNode | null;
  analyserNode: AnalyserNode | null;
  volume: number;
  muted: boolean;
  solo: boolean;
  pan: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterVolume: number = 1.0;
  private masterMuted: boolean = false;

  // Multi-Track / Stems Management with shared clock
  private tracks: Map<string, TrackNode> = new Map();
  private activeSources: Map<string, AudioBufferSourceNode> = new Map();

  // Timeline Model Integration
  private timelineModelRef: TimelineModel | null = null;
  private activeTimelineSources: Set<AudioBufferSourceNode> = new Set();

  // Playback State
  private isPlaying: boolean = false;
  private playbackStartTime: number = 0;
  private startOffset: number = 0;
  private duration: number = 0;
  private animFrameId: number | null = null;

  // Listeners
  private onTimeUpdateListeners: Set<TimeUpdateCallback> = new Set();
  private onPlayStateListeners: Set<PlayStateCallback> = new Set();
  private onTrackStatesListeners: Set<TrackStatesCallback> = new Set();

  constructor() {
    // Shared AudioContext initialized on demand
  }

  /**
   * Initializes or resumes the shared Web Audio API AudioContext.
   */
  getContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Gain -> Master Effects Rack -> Master Analyser -> Destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;

      effectsManager.setContext(this.ctx);
      const masterRack = effectsManager.getOrCreateMasterRack(this.ctx);

      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 256;

      this.masterGain.connect(masterRack.getInputNode());
      masterRack.getOutputNode().connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

      // Connect Audio Graph Processor (DAG) if available
      if (this.graphProcessor) {
        this.wireGraphProcessor();
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch((e) => console.warn('AudioContext resume error:', e));
    }

    return this.ctx;
  }

  private graphProcessor: any = null;

  connectGraphProcessor(processor: any): void {
    this.graphProcessor = processor;
    if (this.ctx) {
      this.wireGraphProcessor();
    }
  }

  private wireGraphProcessor(): void {
    if (!this.ctx || !this.graphProcessor || !this.masterGain || !this.masterAnalyser) return;

    this.graphProcessor.setContext(this.ctx);
    const inNode = this.graphProcessor.getInputNode();
    const outNode = this.graphProcessor.getOutputNode();
    const masterRack = effectsManager.getOrCreateMasterRack(this.ctx);

    if (inNode && outNode) {
      try {
        masterRack.getOutputNode().disconnect();
      } catch {}

      try {
        // masterGain -> masterRack -> DAG inNode -> [Topological Node Chain] -> DAG outNode -> masterAnalyser -> destination
        masterRack.getOutputNode().connect(inNode);
        outNode.connect(this.masterAnalyser);
      } catch (err) {
        console.warn('Failed to wire AudioGraphProcessor to master chain:', err);
        masterRack.getOutputNode().connect(this.masterAnalyser);
      }
    }
  }

  getGraphProcessor(): any {
    return this.graphProcessor;
  }

  /**
   * Connects TimelineModel so timeline edits directly drive audio playback.
   */
  setTimelineModel(model: TimelineModel): void {
    this.timelineModelRef = model;
    model.subscribe(() => {
      const totalDur = model.getTotalDuration();
      if (totalDur > 0) {
        this.duration = totalDur;
      }
      if (this.isPlaying) {
        this.rescheduleTimeline();
      } else {
        this.notifyTime(this.startOffset, this.duration);
      }
    });
  }

  getTimelineModel(): TimelineModel | null {
    return this.timelineModelRef;
  }

  /**
   * Ensures audio routing nodes exist for a given trackId, mapping to canonical stem IDs.
   */
  ensureTrackNodes(trackId: string, name?: string): TrackNode {
    const id = normalizeTrackId(trackId);
    let track = this.tracks.get(id);
    if (!track) {
      const ctx = this.getContext();
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;

      let panNode: StereoPannerNode | null = null;
      if (ctx.createStereoPanner) {
        panNode = ctx.createStereoPanner();
        panNode.pan.value = 0.0;
      }

      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;

      const trackRack = effectsManager.getOrCreateTrackRack(id, ctx);

      if (panNode) {
        gainNode.connect(panNode);
        panNode.connect(trackRack.getInputNode());
      } else {
        gainNode.connect(trackRack.getInputNode());
      }
      trackRack.getOutputNode().connect(analyserNode);
      analyserNode.connect(this.masterGain!);

      const defaultStemNames: Record<string, string> = {
        vocals: 'Vocals',
        drums: 'Drums',
        bass: 'Bass',
        other: 'Other',
        master: 'Master Track',
      };
      const displayName = name && name !== trackId ? name : (defaultStemNames[id] || id);

      track = {
        id,
        name: displayName,
        gainNode,
        panNode,
        analyserNode,
        volume: 1.0,
        muted: false,
        solo: false,
        pan: 0.0,
      };

      this.tracks.set(id, track);
      this.updateEffectiveGains();
    }
    return track;
  }

  /**
   * Decodes raw array buffer using the shared AudioContext.
   */
  async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.getContext();
    try {
      const copy = arrayBuffer.slice(0);
      return await ctx.decodeAudioData(copy);
    } catch (err) {
      throw new Error(
        `Web Audio decoding failed: ${err instanceof Error ? err.message : String(err)}. File format may not be supported by this browser.`
      );
    }
  }

  /**
   * Loads an audio track buffer into the engine as the primary or named track.
   */
  loadBuffer(buffer: AudioBuffer, trackId: string = 'master', name?: string): void {
    if (this.isPlaying) {
      this.stop();
    }

    const id = normalizeTrackId(trackId);
    const defaultStemNames: Record<string, string> = {
      vocals: 'Vocals',
      drums: 'Drums',
      bass: 'Bass',
      other: 'Other',
      master: 'Master Track',
    };
    const displayName = name || defaultStemNames[id] || id;

    const track = this.ensureTrackNodes(id, displayName);
    track.buffer = buffer;
    track.name = displayName;

    if (this.timelineModelRef && id !== 'master') {
      this.timelineModelRef.registerAsset(id, buffer);
    }

    // Calculate maximum duration across all loaded tracks
    this.updateMaxDuration();
    this.updateEffectiveGains();
    this.notifyTime(this.startOffset, this.duration);
    this.notifyTrackStates();
  }

  removeTrack(trackId: string): void {
    const id = normalizeTrackId(trackId);
    const source = this.activeSources.get(id);
    if (source) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
      this.activeSources.delete(id);
    }

    const track = this.tracks.get(id);
    if (track) {
      try {
        track.gainNode.disconnect();
        track.panNode?.disconnect();
        track.analyserNode?.disconnect();
      } catch {
        // disconnected
      }
      this.tracks.delete(id);
    }

    this.updateMaxDuration();
    this.updateEffectiveGains();
    this.notifyTrackStates();
  }

  clearAllTracks(): void {
    this.stop();
    Array.from(this.tracks.keys()).forEach((id) => this.removeTrack(id));
    this.duration = 0;
    this.startOffset = 0;
    this.notifyTime(0, 0);
    this.notifyTrackStates();
  }

  private updateMaxDuration(): void {
    let max = 0;
    this.tracks.forEach((t) => {
      if (t.buffer && t.buffer.duration > max) max = t.buffer.duration;
    });
    if (this.timelineModelRef) {
      const timelineDur = this.timelineModelRef.getTotalDuration();
      if (timelineDur > max) max = timelineDur;
    }
    this.duration = max;
  }

  /**
   * Starts playback synchronized to the shared audio clock across all tracks and clips.
   */
  play(fromTime?: number): void {
    // If timeline model is active and has clips, play from timeline
    if (this.timelineModelRef && this.timelineModelRef.getAllClips().length > 0) {
      this.playFromTimeline(fromTime);
      return;
    }

    if (this.tracks.size === 0 || this.duration <= 0) return;

    const ctx = this.getContext();

    // If already playing, stop existing sources cleanly first
    if (this.isPlaying) {
      this.stopAllActiveSources();
    }

    if (typeof fromTime === 'number') {
      this.startOffset = Math.max(0, Math.min(this.duration, fromTime));
    }

    // Rewind if already at end
    if (this.startOffset >= this.duration - 0.05) {
      this.startOffset = 0;
    }

    this.playbackStartTime = ctx.currentTime;
    this.activeSources.clear();

    // Update gains before starting
    this.updateEffectiveGains();

    let primarySource: AudioBufferSourceNode | null = null;

    // Create synchronized source nodes for every track scheduled at ctx.currentTime
    for (const track of this.tracks.values()) {
      if (!track.buffer) continue;

      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.gainNode);

      const offset = this.startOffset;
      const durationRemaining = Math.max(0, track.buffer.duration - offset);

      if (durationRemaining > 0) {
        source.start(0, offset, durationRemaining);
        this.activeSources.set(track.id, source);

        if (!primarySource) {
          primarySource = source;
        }
      }
    }

    this.isPlaying = true;
    this.notifyPlayState(true);
    this.notifyTrackStates();

    // Natural playback completion detection
    if (primarySource) {
      const sourceRef = primarySource;
      sourceRef.onended = () => {
        if (this.isPlaying && this.activeSources.get('master') === sourceRef) {
          const elapsed = ctx.currentTime - this.playbackStartTime;
          if (this.startOffset + elapsed >= this.duration - 0.08) {
            this.stop();
          }
        }
      };
    }

    this.startTicker();
  }

  /**
   * Plays the non-destructive timeline clip arrangement.
   */
  private playFromTimeline(fromTime?: number): void {
    if (!this.timelineModelRef) return;
    const ctx = this.getContext();

    if (this.isPlaying) {
      this.stopAllActiveSources();
    }

    this.duration = this.timelineModelRef.getTotalDuration();

    if (typeof fromTime === 'number') {
      this.startOffset = Math.max(0, Math.min(this.duration, fromTime));
    }

    if (this.startOffset >= this.duration - 0.05) {
      this.startOffset = 0;
    }

    this.playbackStartTime = ctx.currentTime;
    this.activeTimelineSources.clear();
    this.updateEffectiveGains();

    const schedule = this.timelineModelRef.getScheduleForTime(this.startOffset);

    for (const item of schedule) {
      const buffer = this.timelineModelRef.getAsset(item.clip.assetId);
      if (!buffer) continue;

      const trackId = normalizeTrackId(item.trackId);
      const track = this.ensureTrackNodes(trackId);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(track.gainNode);

      const startTime = ctx.currentTime + item.delaySeconds;
      source.start(startTime, item.sourceOffset, item.playDuration);
      this.activeTimelineSources.add(source);
    }

    this.isPlaying = true;
    this.notifyPlayState(true);
    this.notifyTrackStates();
    this.startTicker();
  }

  /**
   * Dynamically reschedules timeline sources when clips are edited while actively playing.
   */
  rescheduleTimeline(): void {
    if (!this.isPlaying || !this.ctx || !this.timelineModelRef) return;
    const current = this.getCurrentTime();
    this.stopAllActiveSources();
    this.playFromTimeline(current);
  }

  /**
   * Pauses audio playback without losing current position.
   */
  pause(): void {
    if (!this.isPlaying || !this.ctx) return;

    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    this.startOffset = Math.min(this.duration, this.startOffset + elapsed);

    this.stopAllActiveSources();
    this.isPlaying = false;
    this.stopTicker();

    this.notifyPlayState(false);
    this.notifyTime(this.startOffset, this.duration);
    this.notifyTrackStates();
  }

  /**
   * Toggles play/pause state safely.
   */
  togglePlay(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Stops audio playback and rewinds playhead to 0.
   */
  stop(): void {
    this.stopAllActiveSources();
    this.isPlaying = false;
    this.startOffset = 0;
    this.stopTicker();

    this.notifyPlayState(false);
    this.notifyTime(0, this.duration);
    this.notifyTrackStates();
  }

  /**
   * Seeks to any position along the timeline.
   */
  seek(time: number): void {
    if (this.duration <= 0) return;

    const clamped = Math.max(0, Math.min(this.duration, time));
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.play(clamped);
    } else {
      this.startOffset = clamped;
      this.notifyTime(clamped, this.duration);
      this.notifyTrackStates();
    }
  }

  // -------------------------------------------------------------
  // Multi-Stem & Track Mixer Controls
  // -------------------------------------------------------------

  setTrackVolume(trackId: string, volume: number): void {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.volume = Math.max(0, Math.min(1.5, volume));
    this.timelineModelRef?.setTrackVolume(id, track.volume);
    this.updateEffectiveGains();
  }

  setTrackMute(trackId: string, muted?: boolean): void {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.muted = muted !== undefined ? muted : !track.muted;
    this.timelineModelRef?.setTrackMute(id, track.muted);
    this.updateEffectiveGains();
  }

  setTrackSolo(trackId: string, solo?: boolean): void {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.solo = solo !== undefined ? solo : !track.solo;
    this.timelineModelRef?.setTrackSolo(id, track.solo);
    this.updateEffectiveGains();
  }

  setTrackPan(trackId: string, pan: number): void {
    const id = normalizeTrackId(trackId);
    const track = this.ensureTrackNodes(id);
    track.pan = Math.max(-1.0, Math.min(1.0, pan));
    if (track.panNode && this.ctx) {
      track.panNode.pan.setValueAtTime(track.pan, this.ctx.currentTime);
    }
    this.timelineModelRef?.setTrackPan(id, track.pan);
    this.notifyTrackStates();
  }

  /**
   * Directly auditions and plays a specific stem track in sync with the song clock.
   * Solos only this stem and triggers playback from the current position (or fromTime).
   */
  playStem(stemId: string, fromTime?: number): void {
    const id = normalizeTrackId(stemId);
    this.ensureTrackNodes(id);

    // Solo this stem and un-solo all other stems
    for (const [tid, track] of this.tracks.entries()) {
      const isTarget = tid === id;
      track.solo = isTarget;
      this.timelineModelRef?.setTrackSolo(tid, isTarget);
    }

    this.selectStem(id);
    this.updateEffectiveGains();

    const seekTime = typeof fromTime === 'number' ? fromTime : this.getCurrentTime();
    if (!this.isPlaying) {
      this.play(seekTime);
    }
  }

  /**
   * Synchronizes stem selection between Timeline and Mixer.
   */
  selectStem(stemId: string): void {
    const id = normalizeTrackId(stemId);
    this.timelineModelRef?.selectTrack(id);
    this.notifyTrackStates();
  }

  setMasterVolume(gain: number): void {
    this.masterVolume = Math.max(0, Math.min(1.5, gain));
    this.applyMasterGain();
    this.notifyTrackStates();
  }

  setMasterMute(muted?: boolean): void {
    this.masterMuted = muted !== undefined ? muted : !this.masterMuted;
    this.applyMasterGain();
    this.notifyTrackStates();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getMasterMute(): boolean {
    return this.masterMuted;
  }

  private updateEffectiveGains(): void {
    const hasSolo = Array.from(this.tracks.values()).some((t) => t.solo);
    const currentTime = this.ctx ? this.ctx.currentTime : 0;

    for (const track of this.tracks.values()) {
      let effectiveGain = 0;
      if (hasSolo) {
        effectiveGain = track.solo && !track.muted ? track.volume : 0;
      } else {
        effectiveGain = track.muted ? 0 : track.volume;
      }

      if (this.ctx) {
        track.gainNode.gain.setValueAtTime(effectiveGain, currentTime);
      } else {
        track.gainNode.gain.value = effectiveGain;
      }
    }

    this.notifyTrackStates();
  }

  private applyMasterGain(): void {
    if (this.masterGain && this.ctx) {
      const effective = this.masterMuted ? 0 : this.masterVolume;
      this.masterGain.gain.setValueAtTime(effective, this.ctx.currentTime);
    }
  }

  getTrackStates(): TrackInfo[] {
    const hasSolo = Array.from(this.tracks.values()).some((t) => t.solo);
    const selectedTrackId = this.timelineModelRef?.getSelectedTrackId();
    return Array.from(this.tracks.values()).map((t) => ({
      id: t.id,
      name: t.name,
      duration: t.buffer ? t.buffer.duration : this.duration,
      volume: t.volume,
      muted: t.muted,
      solo: t.solo,
      pan: t.pan,
      isActive: this.isPlaying && (!t.muted && (!hasSolo || t.solo)),
      isSelected: selectedTrackId === t.id,
    }));
  }

  getTrackAnalyser(trackId: string): AnalyserNode | null {
    const id = normalizeTrackId(trackId);
    return this.tracks.get(id)?.analyserNode || null;
  }

  getTrack(trackId: string): TrackNode | undefined {
    const id = normalizeTrackId(trackId);
    return this.tracks.get(id);
  }

  getAllTracks(): Map<string, TrackNode> {
    return this.tracks;
  }

  private stopAllActiveSources(): void {
    this.activeSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    });
    this.activeSources.clear();

    this.activeTimelineSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    });
    this.activeTimelineSources.clear();
  }

  private startTicker(): void {
    this.stopTicker();
    const tick = () => {
      if (this.isPlaying && this.ctx) {
        const elapsed = this.ctx.currentTime - this.playbackStartTime;
        const current = Math.min(this.duration, this.startOffset + elapsed);
        this.notifyTime(current, this.duration);

        if (current >= this.duration) {
          this.stop();
          return;
        }

        this.animFrameId = requestAnimationFrame(tick);
      }
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) return this.startOffset;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    return Math.min(this.duration, this.startOffset + elapsed);
  }

  getDuration(): number {
    return this.duration;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getAnalyser(): AnalyserNode | null {
    return this.masterAnalyser;
  }

  onTimeUpdate(cb: TimeUpdateCallback): () => void {
    this.onTimeUpdateListeners.add(cb);
    return () => this.onTimeUpdateListeners.delete(cb);
  }

  onPlayStateChange(cb: PlayStateCallback): () => void {
    this.onPlayStateListeners.add(cb);
    return () => this.onPlayStateListeners.delete(cb);
  }

  onTrackStatesChange(cb: TrackStatesCallback): () => void {
    this.onTrackStatesListeners.add(cb);
    return () => this.onTrackStatesListeners.delete(cb);
  }

  private notifyTime(current: number, duration: number): void {
    this.onTimeUpdateListeners.forEach((cb) => cb(current, duration));
  }

  private notifyPlayState(playing: boolean): void {
    this.onPlayStateListeners.forEach((cb) => cb(playing));
  }

  private notifyTrackStates(): void {
    const states = this.getTrackStates();
    this.onTrackStatesListeners.forEach((cb) => cb(states));
  }
}

export const audioEngine = new AudioEngine();
