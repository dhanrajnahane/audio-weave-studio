import {
  EqualizerSettings,
  ReverbSettings,
  DelaySettings,
  CompressorSettings,
  TrackEffectsSettings,
  createDefaultTrackEffects,
} from './types';

/**
 * EffectsRack encapsulates an active Web Audio API processing chain:
 * Input -> Equalizer (3-Band) -> Compressor -> Delay -> Reverb -> Output
 * Supports both real-time AudioContext and OfflineAudioContext.
 */
export class EffectsRack {
  private ctx: BaseAudioContext;
  private inputNode: GainNode;
  private outputNode: GainNode;

  // 1. Equalizer Nodes
  private eqLowShelf!: BiquadFilterNode;
  private eqMidPeak!: BiquadFilterNode;
  private eqHighShelf!: BiquadFilterNode;

  // 2. Compressor Nodes & Bypass
  private compInputGain!: GainNode;
  private compNode!: DynamicsCompressorNode;
  private compWetGain!: GainNode;
  private compDryGain!: GainNode;
  private compOutputGain!: GainNode;

  // 3. Delay Nodes & Bypass
  private delayInputGain!: GainNode;
  private delayNode!: DelayNode;
  private delayFeedbackGain!: GainNode;
  private delayWetGain!: GainNode;
  private delayDryGain!: GainNode;
  private delayOutputGain!: GainNode;

  // 4. Reverb Nodes & Bypass
  private reverbInputGain!: GainNode;
  private convolverNode!: ConvolverNode;
  private reverbWetGain!: GainNode;
  private reverbDryGain!: GainNode;

  // Current Settings
  private settings: TrackEffectsSettings;

  constructor(ctx: BaseAudioContext, initialSettings?: Partial<TrackEffectsSettings>) {
    this.ctx = ctx;
    this.settings = { ...createDefaultTrackEffects(), ...initialSettings };

    // Master Input and Output
    this.inputNode = ctx.createGain();
    this.inputNode.gain.value = 1.0;
    this.outputNode = ctx.createGain();
    this.outputNode.gain.value = 1.0;

    // Graceful fallback for mock or minimal audio contexts in unit tests
    if (typeof (ctx as any).createBiquadFilter !== 'function' || typeof (ctx as any).createDynamicsCompressor !== 'function') {
      this.inputNode.connect(this.outputNode);
      return;
    }

    // -------------------------------------------------------------
    // 1. Equalizer Chain (LowShelf -> Peaking -> HighShelf)
    // -------------------------------------------------------------
    this.eqLowShelf = ctx.createBiquadFilter();
    this.eqLowShelf.type = 'lowshelf';
    this.eqLowShelf.frequency.value = this.settings.eq.lowFreq;
    this.eqLowShelf.gain.value = this.settings.eq.enabled ? this.settings.eq.lowGain : 0.0;

    this.eqMidPeak = ctx.createBiquadFilter();
    this.eqMidPeak.type = 'peaking';
    this.eqMidPeak.frequency.value = this.settings.eq.midFreq;
    this.eqMidPeak.Q.value = 1.0;
    this.eqMidPeak.gain.value = this.settings.eq.enabled ? this.settings.eq.midGain : 0.0;

    this.eqHighShelf = ctx.createBiquadFilter();
    this.eqHighShelf.type = 'highshelf';
    this.eqHighShelf.frequency.value = this.settings.eq.highFreq;
    this.eqHighShelf.gain.value = this.settings.eq.enabled ? this.settings.eq.highGain : 0.0;

    this.inputNode.connect(this.eqLowShelf);
    this.eqLowShelf.connect(this.eqMidPeak);
    this.eqMidPeak.connect(this.eqHighShelf);

    // -------------------------------------------------------------
    // 2. Dynamics Compressor with True Dry/Wet Bypass
    // -------------------------------------------------------------
    this.compInputGain = ctx.createGain();
    this.compNode = ctx.createDynamicsCompressor();
    this.compWetGain = ctx.createGain();
    this.compDryGain = ctx.createGain();
    this.compOutputGain = ctx.createGain();

    this.applyCompressorParams(this.settings.compressor);

    this.eqHighShelf.connect(this.compInputGain);
    // Wet Path
    this.compInputGain.connect(this.compNode);
    this.compNode.connect(this.compWetGain);
    this.compWetGain.connect(this.compOutputGain);
    // Dry Bypass Path
    this.compInputGain.connect(this.compDryGain);
    this.compDryGain.connect(this.compOutputGain);

    // -------------------------------------------------------------
    // 3. Stereo Feedback Delay with Dry/Wet Routing
    // -------------------------------------------------------------
    this.delayInputGain = ctx.createGain();
    this.delayNode = ctx.createDelay(2.0);
    this.delayFeedbackGain = ctx.createGain();
    this.delayWetGain = ctx.createGain();
    this.delayDryGain = ctx.createGain();
    this.delayOutputGain = ctx.createGain();

    this.applyDelayParams(this.settings.delay);

    this.compOutputGain.connect(this.delayInputGain);
    // Dry Path
    this.delayInputGain.connect(this.delayDryGain);
    this.delayDryGain.connect(this.delayOutputGain);
    // Wet Delay Path + Feedback loop
    this.delayInputGain.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayWetGain);
    this.delayWetGain.connect(this.delayOutputGain);

    // -------------------------------------------------------------
    // 4. Convolver Reverb with Algorithmic Impulse Response
    // -------------------------------------------------------------
    this.reverbInputGain = ctx.createGain();
    this.convolverNode = ctx.createConvolver();
    this.reverbWetGain = ctx.createGain();
    this.reverbDryGain = ctx.createGain();

    this.applyReverbParams(this.settings.reverb);

    this.delayOutputGain.connect(this.reverbInputGain);
    // Dry Path
    this.reverbInputGain.connect(this.reverbDryGain);
    this.reverbDryGain.connect(this.outputNode);
    // Wet Reverb Path
    this.reverbInputGain.connect(this.convolverNode);
    this.convolverNode.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.outputNode);
  }

  getInputNode(): GainNode {
    return this.inputNode;
  }

  getOutputNode(): GainNode {
    return this.outputNode;
  }

  getSettings(): TrackEffectsSettings {
    return JSON.parse(JSON.stringify(this.settings));
  }

  // -------------------------------------------------------------
  // Parameter Updaters
  // -------------------------------------------------------------

  setEqualizer(eq: Partial<EqualizerSettings>): void {
    this.settings.eq = { ...this.settings.eq, ...eq };
    if (!this.eqLowShelf) return;
    const enabled = this.settings.eq.enabled;

    this.eqLowShelf.frequency.setValueAtTime(this.settings.eq.lowFreq, this.ctx.currentTime);
    this.eqLowShelf.gain.setValueAtTime(enabled ? this.settings.eq.lowGain : 0.0, this.ctx.currentTime);

    this.eqMidPeak.frequency.setValueAtTime(this.settings.eq.midFreq, this.ctx.currentTime);
    this.eqMidPeak.gain.setValueAtTime(enabled ? this.settings.eq.midGain : 0.0, this.ctx.currentTime);

    this.eqHighShelf.frequency.setValueAtTime(this.settings.eq.highFreq, this.ctx.currentTime);
    this.eqHighShelf.gain.setValueAtTime(enabled ? this.settings.eq.highGain : 0.0, this.ctx.currentTime);
  }

  private applyCompressorParams(comp: CompressorSettings): void {
    if (!this.compNode) return;
    this.compNode.threshold.setValueAtTime(comp.threshold, this.ctx.currentTime);
    this.compNode.knee.setValueAtTime(comp.knee, this.ctx.currentTime);
    this.compNode.ratio.setValueAtTime(comp.ratio, this.ctx.currentTime);
    this.compNode.attack.setValueAtTime(comp.attack, this.ctx.currentTime);
    this.compNode.release.setValueAtTime(comp.release, this.ctx.currentTime);

    if (comp.enabled) {
      this.compWetGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.compDryGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
    } else {
      this.compWetGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.compDryGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }
  }

  setCompressor(comp: Partial<CompressorSettings>): void {
    this.settings.compressor = { ...this.settings.compressor, ...comp };
    this.applyCompressorParams(this.settings.compressor);
  }

  private applyDelayParams(delay: DelaySettings): void {
    if (!this.delayNode) return;
    this.delayNode.delayTime.setValueAtTime(delay.time, this.ctx.currentTime);

    if (delay.enabled) {
      this.delayFeedbackGain.gain.setValueAtTime(Math.min(0.85, Math.max(0.0, delay.feedback)), this.ctx.currentTime);
      this.delayWetGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.0, delay.wet)), this.ctx.currentTime);
      this.delayDryGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.0, delay.dry)), this.ctx.currentTime);
    } else {
      this.delayFeedbackGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.delayWetGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.delayDryGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }
  }

  setDelay(delay: Partial<DelaySettings>): void {
    this.settings.delay = { ...this.settings.delay, ...delay };
    this.applyDelayParams(this.settings.delay);
  }

  private applyReverbParams(reverb: ReverbSettings): void {
    if (!this.convolverNode) return;
    if (reverb.enabled) {
      this.reverbWetGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.0, reverb.wet)), this.ctx.currentTime);
      this.reverbDryGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.0, reverb.dry)), this.ctx.currentTime);

      // Generate impulse response for desired decay time
      const ir = this.generateImpulseResponse(reverb.decay, this.ctx.sampleRate);
      try {
        this.convolverNode.buffer = ir;
      } catch (err) {
        // Convolver buffer re-assignment guard
      }
    } else {
      this.reverbWetGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.reverbDryGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }
  }

  setReverb(reverb: Partial<ReverbSettings>): void {
    const prevDecay = this.settings.reverb.decay;
    this.settings.reverb = { ...this.settings.reverb, ...reverb };

    if (reverb.decay !== undefined && reverb.decay !== prevDecay && this.settings.reverb.enabled && this.convolverNode) {
      // Re-generate impulse response on decay change
      this.convolverNode.buffer = this.generateImpulseResponse(this.settings.reverb.decay, this.ctx.sampleRate);
    }

    this.applyReverbParams(this.settings.reverb);
  }

  /**
   * Generates a stereo algorithmic impulse response with natural exponential decay.
   */
  generateImpulseResponse(decaySeconds: number, sampleRate: number): AudioBuffer {
    const safeDecay = Math.max(0.1, Math.min(10.0, decaySeconds));
    const length = Math.floor(sampleRate * safeDecay);
    const irBuffer = this.ctx.createBuffer(2, length, sampleRate);

    const left = irBuffer.getChannelData(0);
    const right = irBuffer.getChannelData(1);

    // Decay rate constant: -60dB (0.001) over decaySeconds
    const decayConstant = 6.91 / safeDecay;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-decayConstant * t);

      // Stereo decorrelated velvet noise
      left[i] = (Math.random() * 2 - 1) * envelope;
      right[i] = (Math.random() * 2 - 1) * envelope;
    }

    return irBuffer;
  }

  updateAll(settings: TrackEffectsSettings): void {
    this.setEqualizer(settings.eq);
    this.setCompressor(settings.compressor);
    this.setDelay(settings.delay);
    this.setReverb(settings.reverb);
  }

  dispose(): void {
    try {
      this.inputNode.disconnect();
      this.outputNode.disconnect();
      this.eqLowShelf.disconnect();
      this.eqMidPeak.disconnect();
      this.eqHighShelf.disconnect();
      this.compInputGain.disconnect();
      this.compNode.disconnect();
      this.compWetGain.disconnect();
      this.compDryGain.disconnect();
      this.compOutputGain.disconnect();
      this.delayInputGain.disconnect();
      this.delayNode.disconnect();
      this.delayFeedbackGain.disconnect();
      this.delayWetGain.disconnect();
      this.delayDryGain.disconnect();
      this.delayOutputGain.disconnect();
      this.reverbInputGain.disconnect();
      this.convolverNode.disconnect();
      this.reverbWetGain.disconnect();
      this.reverbDryGain.disconnect();
    } catch {}
  }
}
