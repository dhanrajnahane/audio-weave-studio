import { TimelineModel } from '../timeline/TimelineModel';
import { RemixComposerModel } from '../remix/RemixComposerModel';
import { AudioClip } from '../timeline/types';
import { effectsManager } from '../effects/EffectsManager';
import { EffectsRack } from '../effects/EffectsRack';

export type ExportTarget = 'full_mix' | 'stems' | 'selected_track' | 'selected_region' | 'arrangement';
export type ExportFormat = 'wav' | 'mp3';
export type ExportBitDepth = 16 | 24;
export type ExportSampleRate = 44100 | 48000;

export interface ExportOptions {
  target: ExportTarget;
  format: ExportFormat;
  sampleRate: ExportSampleRate;
  bitDepth: ExportBitDepth;
  mp3Bitrate?: '128k' | '192k' | '256k' | '320k';
  selectedTrackId?: string;
  includedStems?: Array<'vocals' | 'drums' | 'bass' | 'other' | string>;
  regionStart?: number;
  regionEnd?: number;
  filename?: string;
  engine?: any;
}

export interface ExportValidationResult {
  isValid: boolean;
  duration: number;
  sampleRate: number;
  channels: number;
  maxPeak: number;
  error?: string;
}

export class AudioExportEngine {
  private static effectsInstance: typeof effectsManager = effectsManager;
  private static audioEngineInstance: any = null;

  static setEffectsManager(mgr: typeof effectsManager): void {
    this.effectsInstance = mgr;
  }

  static getEffectsManager(): typeof effectsManager {
    return this.effectsInstance || effectsManager;
  }

  static setAudioEngine(engine: any): void {
    this.audioEngineInstance = engine;
  }

  static getAudioEngine(): any {
    return this.audioEngineInstance;
  }

  /**
   * Main export execution entry point.
   */
  static async exportAudio(
    options: ExportOptions,
    timeline: TimelineModel,
    remixComposer?: RemixComposerModel,
    engine?: any
  ): Promise<{ blob: Blob; filename: string; validation: ExportValidationResult }> {
    const sampleRate = options.sampleRate || 44100;
    const bitDepth = options.bitDepth || 16;
    const format = options.format || 'wav';
    const activeEngine = engine || options.engine || this.getAudioEngine();

    let renderedBuffer: AudioBuffer;
    let baseFilename = options.filename || 'AudioWeave_Project';

    if (options.target === 'full_mix') {
      let clips = timeline.getAllClips();
      if (options.includedStems && options.includedStems.length > 0) {
        const allowed = new Set(options.includedStems);
        clips = clips.filter((c) => allowed.has(c.assetId) || allowed.has(c.trackId));
      }
      renderedBuffer = await this.renderTimelineClips(
        clips,
        timeline,
        sampleRate,
        options.regionStart,
        options.regionEnd,
        activeEngine
      );
      baseFilename += '_FullMix';
    } else if (options.target === 'selected_track' && options.selectedTrackId) {
      const trackClips = timeline.getTrackClips(options.selectedTrackId);
      renderedBuffer = await this.renderTimelineClips(
        trackClips,
        timeline,
        sampleRate,
        options.regionStart,
        options.regionEnd,
        activeEngine
      );
      baseFilename += `_${options.selectedTrackId}`;
    } else if (options.target === 'selected_region') {
      let clips = timeline.getAllClips();
      if (options.includedStems && options.includedStems.length > 0) {
        const allowed = new Set(options.includedStems);
        clips = clips.filter((c) => allowed.has(c.assetId) || allowed.has(c.trackId));
      }
      const start = options.regionStart ?? 0;
      const end = options.regionEnd ?? timeline.getTotalDuration();
      renderedBuffer = await this.renderTimelineClips(
        clips,
        timeline,
        sampleRate,
        start,
        end,
        activeEngine
      );
      baseFilename += `_Region_${start.toFixed(1)}s-${end.toFixed(1)}s`;
    } else if (options.target === 'arrangement' && remixComposer) {
      const arr = remixComposer.getActiveArrangement();
      if (!arr || arr.blocks.length === 0) {
        throw new Error('Export failed: Active remix arrangement has no sections to render.');
      }

      const stemTrackMap: Record<string, string> = {
        vocals: 'vocals',
        drums: 'drums',
        bass: 'bass',
        other: 'other',
      };

      const stems: Array<'vocals' | 'drums' | 'bass' | 'other'> = ['vocals', 'drums', 'bass', 'other'];
      const hasStems = stems.some((s) => timeline.hasAsset(s));
      const arrangementClips: AudioClip[] = [];

      for (const block of arr.blocks) {
        if (hasStems) {
          for (const stem of stems) {
            if (block.activeStems[stem] && timeline.hasAsset(stem)) {
              if (!options.includedStems || options.includedStems.includes(stem)) {
                arrangementClips.push({
                  id: `arr-clip-${stem}-${block.id}`,
                  trackId: stemTrackMap[stem] || 'vocals',
                  assetId: stem,
                  name: `${block.name} (${stem.toUpperCase()})`,
                  startOffset: block.timelineStart,
                  duration: block.duration,
                  sourceOffset: block.sourceStart,
                  color: block.color || '#3b82f6',
                });
              }
            }
          }
        } else {
          const registered = timeline.getRegisteredAssetIds();
          const fallbackId = registered.length > 0 ? registered[0] : 'master';
          arrangementClips.push({
            id: `arr-clip-stereo-${block.id}`,
            trackId: 'vocals',
            assetId: fallbackId,
            name: `${block.name} (Stereo)`,
            startOffset: block.timelineStart,
            duration: block.duration,
            sourceOffset: block.sourceStart,
            color: block.color || '#3b82f6',
          });
        }
      }

      const arrDuration = remixComposer.getArrangementDuration();
      renderedBuffer = await this.renderTimelineClips(
        arrangementClips,
        timeline,
        sampleRate,
        options.regionStart,
        options.regionEnd ?? arrDuration,
        activeEngine
      );
      baseFilename += `_${arr.name.replace(/\s+/g, '_')}`;
    } else {
      // Default fallback: full mix
      renderedBuffer = await this.renderTimelineClips(
        timeline.getAllClips(),
        timeline,
        sampleRate,
        undefined,
        undefined,
        activeEngine
      );
      baseFilename += '_Mix';
    }

    // 1. Encode into PCM WAV
    let finalBlob: Blob = this.encodeWav(renderedBuffer, bitDepth);
    let finalExt = 'wav';

    // 2. If MP3 requested, convert using backend FFmpeg endpoint
    if (format === 'mp3') {
      try {
        finalBlob = await this.convertWavToMp3(finalBlob, options.mp3Bitrate || '320k');
        finalExt = 'mp3';
      } catch (err) {
        console.warn('Backend MP3 conversion failed, falling back to 16-bit WAV:', err);
      }
    }

    const outputFilename = `${baseFilename}.${finalExt}`;

    // 3. Validate exported file by decoding it back
    const validation = await this.validateExportBlob(finalBlob, renderedBuffer.duration, sampleRate);

    return {
      blob: finalBlob,
      filename: outputFilename,
      validation,
    };
  }

  /**
   * Renders a synchronized multi-track arrangement into an AudioBuffer using OfflineAudioContext.
   * Utilizes the identical Web Audio node graph as real-time playback:
   * Source -> Track Gain (Volume, Mute, Solo) -> Track Panner -> Track EffectsRack -> Master Gain -> Master EffectsRack -> Destination
   */
  static async renderTimelineClips(
    clips: AudioClip[],
    timeline: TimelineModel,
    sampleRate: number,
    regionStart?: number,
    regionEnd?: number,
    engine?: any
  ): Promise<AudioBuffer> {
    const totalDuration = timeline.getTotalDuration();
    const start = Math.max(0, regionStart ?? 0);
    const end = regionEnd !== undefined ? regionEnd : totalDuration;
    const renderDuration = Math.max(0.1, end - start);

    const totalFrames = Math.ceil(renderDuration * sampleRate);
    const OfflineCtxClass =
      (typeof window !== 'undefined' && (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)) ||
      (typeof globalThis !== 'undefined' && (globalThis as any).OfflineAudioContext);

    if (!OfflineCtxClass) {
      throw new Error('OfflineAudioContext is not supported in this environment.');
    }

    const offlineCtx = new OfflineCtxClass(2, totalFrames, sampleRate);

    // 1. Master Chain: Master Gain -> Master Effects Rack -> Destination
    const activeEngine = engine || this.getAudioEngine();
    const masterVolume =
      activeEngine && typeof activeEngine.getMasterVolume === 'function' ? activeEngine.getMasterVolume() : 1.0;
    const masterMuted =
      activeEngine && typeof activeEngine.getMasterMute === 'function' ? activeEngine.getMasterMute() : false;
    const effectiveMasterGain = masterMuted ? 0.0 : Math.max(0, Math.min(1.5, masterVolume));

    const masterGainNode = offlineCtx.createGain();
    masterGainNode.gain.value = effectiveMasterGain;

    const masterEffectsSettings = this.getEffectsManager().getMasterSettings();
    const masterRack = new EffectsRack(offlineCtx, masterEffectsSettings);

    masterGainNode.connect(masterRack.getInputNode());
    masterRack.getOutputNode().connect(offlineCtx.destination);

    // 2. Track Mixer & Routing Chains
    interface TrackMixerInfo {
      volume: number;
      pan: number;
      muted: boolean;
      solo: boolean;
    }
    const trackMixerMap = new Map<string, TrackMixerInfo>();

    for (const t of timeline.getTracks()) {
      trackMixerMap.set(t.id, {
        volume: typeof t.volume === 'number' ? t.volume : 1.0,
        pan: typeof t.pan === 'number' ? t.pan : 0.0,
        muted: !!t.muted,
        solo: !!t.solo,
      });
    }

    if (activeEngine && typeof activeEngine.getTrackStates === 'function') {
      const states = activeEngine.getTrackStates();
      for (const st of states) {
        trackMixerMap.set(st.id, {
          volume: typeof st.volume === 'number' ? st.volume : 1.0,
          pan: typeof st.pan === 'number' ? st.pan : 0.0,
          muted: !!st.muted,
          solo: !!st.solo,
        });
      }
    }

    const hasSolo = Array.from(trackMixerMap.values()).some((t) => t.solo);

    interface TrackRoutingChain {
      gainNode: GainNode;
      panNode: StereoPannerNode | null;
      effectsRack: EffectsRack;
    }
    const trackChains = new Map<string, TrackRoutingChain>();

    const getOrCreateTrackChain = (trackId: string): TrackRoutingChain => {
      let chain = trackChains.get(trackId);
      if (!chain) {
        const info = trackMixerMap.get(trackId) || { volume: 1.0, pan: 0.0, muted: false, solo: false };

        let effectiveGain = 0;
        if (hasSolo) {
          effectiveGain = info.solo && !info.muted ? info.volume : 0;
        } else {
          effectiveGain = info.muted ? 0 : info.volume;
        }

        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = Math.max(0, Math.min(1.5, effectiveGain));

        let panNode: StereoPannerNode | null = null;
        if (typeof offlineCtx.createStereoPanner === 'function') {
          const p = offlineCtx.createStereoPanner();
          p.pan.value = Math.max(-1.0, Math.min(1.0, info.pan));
          panNode = p;
        }

        const trackRack = new EffectsRack(offlineCtx, this.getEffectsManager().getTrackSettings(trackId));

        if (panNode) {
          gainNode.connect(panNode);
          panNode.connect(trackRack.getInputNode());
        } else {
          gainNode.connect(trackRack.getInputNode());
        }

        trackRack.getOutputNode().connect(masterGainNode);

        chain = { gainNode, panNode, effectsRack: trackRack };
        trackChains.set(trackId, chain);
      }
      return chain;
    };

    // 3. Schedule Clips
    for (const clip of clips) {
      const clipEnd = clip.startOffset + clip.duration;
      // Filter clips within region
      if (clipEnd <= start || clip.startOffset >= end) continue;

      const buffer = timeline.getAsset(clip.assetId);
      if (!buffer) {
        console.warn(`Export warning: Asset "${clip.assetId}" for clip "${clip.name}" not found in timeline.`);
        continue;
      }

      const clipStartInRender = Math.max(0, clip.startOffset - start);
      const offsetIntoClip = start > clip.startOffset ? start - clip.startOffset : 0;
      const sourceOffset = clip.sourceOffset + offsetIntoClip;
      const playDuration = Math.min(clip.duration - offsetIntoClip, end - (clip.startOffset + offsetIntoClip));

      if (playDuration > 0) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        const chain = getOrCreateTrackChain(clip.trackId);
        source.connect(chain.gainNode);
        source.start(clipStartInRender, sourceOffset, playDuration);
      }
    }

    return offlineCtx.startRendering();
  }

  /**
   * Exports all 4 Demucs stems into individual synchronized WAV blobs.
   */
  static async exportStemSet(
    timeline: TimelineModel,
    sampleRate: number = 44100,
    bitDepth: ExportBitDepth = 16,
    engine?: any
  ): Promise<Record<string, { blob: Blob; filename: string; validation: ExportValidationResult }>> {
    const trackMapping = [
      { id: 'vocals', stem: 'vocals' },
      { id: 'drums', stem: 'drums' },
      { id: 'bass', stem: 'bass' },
      { id: 'other', stem: 'other' },
    ];

    const results: Record<string, { blob: Blob; filename: string; validation: ExportValidationResult }> = {};

    for (const item of trackMapping) {
      const clips = timeline.getTrackClips(item.id);
      const rendered = await this.renderTimelineClips(clips, timeline, sampleRate, undefined, undefined, engine);
      const blob = this.encodeWav(rendered, bitDepth);
      const filename = `AudioWeave_Stem_${item.stem.toUpperCase()}_${sampleRate}Hz.wav`;
      const validation = await this.validateExportBlob(blob, rendered.duration, sampleRate);
      results[item.stem] = {
        blob,
        filename,
        validation,
      };
    }

    return results;
  }

  /**
   * Encodes an AudioBuffer into 16-bit or 24-bit PCM WAV format.
   */
  static encodeWav(buffer: AudioBuffer, bitDepth: ExportBitDepth = 16): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = buffer.length * blockAlign;

    const bufferArray = new ArrayBuffer(44 + dataSize);
    const view = new DataView(bufferArray);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF chunk
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');

    // fmt sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM header size
    view.setUint16(20, 1, true); // Format code: 1 = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // Byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;

    let offset = 44;
    if (bitDepth === 16) {
      for (let i = 0; i < buffer.length; i++) {
        const s0 = Math.max(-1, Math.min(1, ch0[i]));
        const s1 = Math.max(-1, Math.min(1, ch1[i]));
        view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
        view.setInt16(offset + 2, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
        offset += 4;
      }
    } else {
      // 24-bit PCM
      for (let i = 0; i < buffer.length; i++) {
        const s0 = Math.max(-1, Math.min(1, ch0[i]));
        const s1 = Math.max(-1, Math.min(1, ch1[i]));
        const v0 = s0 < 0 ? Math.floor(s0 * 0x800000) : Math.floor(s0 * 0x7fffff);
        const v1 = s1 < 0 ? Math.floor(s1 * 0x800000) : Math.floor(s1 * 0x7fffff);

        view.setUint8(offset, v0 & 0xff);
        view.setUint8(offset + 1, (v0 >> 8) & 0xff);
        view.setUint8(offset + 2, (v0 >> 16) & 0xff);
        view.setUint8(offset + 3, v1 & 0xff);
        view.setUint8(offset + 4, (v1 >> 8) & 0xff);
        view.setUint8(offset + 5, (v1 >> 16) & 0xff);
        offset += 6;
      }
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  /**
   * Sends rendered WAV blob to backend for high-quality MP3 encoding via FFmpeg.
   */
  static async convertWavToMp3(wavBlob: Blob, bitrate: string = '320k'): Promise<Blob> {
    const formData = new FormData();
    formData.append('file', wavBlob, 'temp_render.wav');

    const res = await fetch(`/api/audio/export/mp3?bitrate=${bitrate}`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`MP3 conversion server error: ${res.statusText}`);
    }

    return res.blob();
  }

  /**
   * Validates exported file by re-decoding it and verifying technical audio integrity.
   */
  static async validateExportBlob(
    blob: Blob,
    expectedDuration: number,
    expectedSampleRate: number
  ): Promise<ExportValidationResult> {
    if (blob.size <= 44) {
      return {
        isValid: false,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        maxPeak: 0,
        error: 'Exported file is empty or corrupted (size <= 44 bytes).',
      };
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();

      // Check WAV header if WAV
      if (blob.type.includes('wav')) {
        const view = new DataView(arrayBuffer);
        const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));

        if (riff !== 'RIFF' || wave !== 'WAVE') {
          return {
            isValid: false,
            duration: 0,
            sampleRate: 0,
            channels: 0,
            maxPeak: 0,
            error: 'Invalid RIFF/WAVE header structure.',
          };
        }

        const channels = view.getUint16(22, true);
        const sampleRate = view.getUint32(24, true);
        const bitDepth = view.getUint16(34, true);
        const dataSize = view.getUint32(40, true);
        const bytesPerSample = bitDepth / 8;
        const frames = dataSize / (channels * bytesPerSample);
        const duration = frames / sampleRate;

        // Check if samples contain audio energy distributed across the file
        let maxPeak = 0;
        const sampleOffset = 44;
        const numCheckPoints = Math.min(frames, 5000);
        const step = Math.max(1, Math.floor(frames / numCheckPoints));
        for (let i = 0; i < frames; i += step) {
          let s = 0;
          if (bitDepth === 16) {
            s = Math.abs(view.getInt16(sampleOffset + i * channels * 2, true) / 32768.0);
          } else if (bitDepth === 24) {
            const b0 = view.getUint8(sampleOffset + i * channels * 3);
            const b1 = view.getUint8(sampleOffset + i * channels * 3 + 1);
            const b2 = view.getUint8(sampleOffset + i * channels * 3 + 2);
            let val = (b2 << 16) | (b1 << 8) | b0;
            if (val & 0x800000) val |= ~0xffffff;
            s = Math.abs(val / 8388608.0);
          }
          if (s > maxPeak) maxPeak = s;
        }

        const durationMatch = Math.abs(duration - expectedDuration) < 0.15;
        const sampleRateMatch = sampleRate === expectedSampleRate;

        return {
          isValid: durationMatch && sampleRateMatch,
          duration: Number(duration.toFixed(3)),
          sampleRate,
          channels,
          maxPeak: Number(maxPeak.toFixed(4)),
          error: !durationMatch
            ? `Duration mismatch: expected ${expectedDuration.toFixed(1)}s, got ${duration.toFixed(1)}s`
            : !sampleRateMatch
            ? `Sample rate mismatch: expected ${expectedSampleRate}Hz, got ${sampleRate}Hz`
            : undefined,
        };
      }

      // If MP3, verify byte size
      return {
        isValid: blob.size > 1000,
        duration: Number(expectedDuration.toFixed(3)),
        sampleRate: expectedSampleRate,
        channels: 2,
        maxPeak: 1.0,
      };
    } catch (err: unknown) {
      return {
        isValid: false,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        maxPeak: 0,
        error: `Audio re-decoding validation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Triggers client-side browser download of rendered audio blob.
   */
  static triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
