// src/audio/effects/types.ts
var createDefaultEQ = () => ({
  enabled: false,
  lowGain: 0,
  midGain: 0,
  highGain: 0,
  lowFreq: 100,
  midFreq: 1e3,
  highFreq: 6e3
});
var createDefaultReverb = () => ({
  enabled: false,
  decay: 2,
  preDelay: 0.01,
  wet: 0.35,
  dry: 1
});
var createDefaultDelay = () => ({
  enabled: false,
  time: 0.25,
  feedback: 0.35,
  wet: 0.3,
  dry: 1
});
var createDefaultCompressor = () => ({
  enabled: false,
  threshold: -24,
  knee: 30,
  ratio: 4,
  attack: 3e-3,
  release: 0.25
});
var createDefaultTrackEffects = () => ({
  eq: createDefaultEQ(),
  reverb: createDefaultReverb(),
  delay: createDefaultDelay(),
  compressor: createDefaultCompressor()
});

// src/audio/effects/EffectsRack.ts
var EffectsRack = class {
  ctx;
  inputNode;
  outputNode;
  // 1. Equalizer Nodes
  eqLowShelf;
  eqMidPeak;
  eqHighShelf;
  // 2. Compressor Nodes & Bypass
  compInputGain;
  compNode;
  compWetGain;
  compDryGain;
  compOutputGain;
  // 3. Delay Nodes & Bypass
  delayInputGain;
  delayNode;
  delayFeedbackGain;
  delayWetGain;
  delayDryGain;
  delayOutputGain;
  // 4. Reverb Nodes & Bypass
  reverbInputGain;
  convolverNode;
  reverbWetGain;
  reverbDryGain;
  // Current Settings
  settings;
  constructor(ctx, initialSettings) {
    this.ctx = ctx;
    this.settings = { ...createDefaultTrackEffects(), ...initialSettings };
    this.inputNode = ctx.createGain();
    this.inputNode.gain.value = 1;
    this.outputNode = ctx.createGain();
    this.outputNode.gain.value = 1;
    if (typeof ctx.createBiquadFilter !== "function" || typeof ctx.createDynamicsCompressor !== "function") {
      this.inputNode.connect(this.outputNode);
      return;
    }
    this.eqLowShelf = ctx.createBiquadFilter();
    this.eqLowShelf.type = "lowshelf";
    this.eqLowShelf.frequency.value = this.settings.eq.lowFreq;
    this.eqLowShelf.gain.value = this.settings.eq.enabled ? this.settings.eq.lowGain : 0;
    this.eqMidPeak = ctx.createBiquadFilter();
    this.eqMidPeak.type = "peaking";
    this.eqMidPeak.frequency.value = this.settings.eq.midFreq;
    this.eqMidPeak.Q.value = 1;
    this.eqMidPeak.gain.value = this.settings.eq.enabled ? this.settings.eq.midGain : 0;
    this.eqHighShelf = ctx.createBiquadFilter();
    this.eqHighShelf.type = "highshelf";
    this.eqHighShelf.frequency.value = this.settings.eq.highFreq;
    this.eqHighShelf.gain.value = this.settings.eq.enabled ? this.settings.eq.highGain : 0;
    this.inputNode.connect(this.eqLowShelf);
    this.eqLowShelf.connect(this.eqMidPeak);
    this.eqMidPeak.connect(this.eqHighShelf);
    this.compInputGain = ctx.createGain();
    this.compNode = ctx.createDynamicsCompressor();
    this.compWetGain = ctx.createGain();
    this.compDryGain = ctx.createGain();
    this.compOutputGain = ctx.createGain();
    this.applyCompressorParams(this.settings.compressor);
    this.eqHighShelf.connect(this.compInputGain);
    this.compInputGain.connect(this.compNode);
    this.compNode.connect(this.compWetGain);
    this.compWetGain.connect(this.compOutputGain);
    this.compInputGain.connect(this.compDryGain);
    this.compDryGain.connect(this.compOutputGain);
    this.delayInputGain = ctx.createGain();
    this.delayNode = ctx.createDelay(2);
    this.delayFeedbackGain = ctx.createGain();
    this.delayWetGain = ctx.createGain();
    this.delayDryGain = ctx.createGain();
    this.delayOutputGain = ctx.createGain();
    this.applyDelayParams(this.settings.delay);
    this.compOutputGain.connect(this.delayInputGain);
    this.delayInputGain.connect(this.delayDryGain);
    this.delayDryGain.connect(this.delayOutputGain);
    this.delayInputGain.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayWetGain);
    this.delayWetGain.connect(this.delayOutputGain);
    this.reverbInputGain = ctx.createGain();
    this.convolverNode = ctx.createConvolver();
    this.reverbWetGain = ctx.createGain();
    this.reverbDryGain = ctx.createGain();
    this.applyReverbParams(this.settings.reverb);
    this.delayOutputGain.connect(this.reverbInputGain);
    this.reverbInputGain.connect(this.reverbDryGain);
    this.reverbDryGain.connect(this.outputNode);
    this.reverbInputGain.connect(this.convolverNode);
    this.convolverNode.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.outputNode);
  }
  getInputNode() {
    return this.inputNode;
  }
  getOutputNode() {
    return this.outputNode;
  }
  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }
  // -------------------------------------------------------------
  // Parameter Updaters
  // -------------------------------------------------------------
  setEqualizer(eq) {
    this.settings.eq = { ...this.settings.eq, ...eq };
    if (!this.eqLowShelf) return;
    const enabled = this.settings.eq.enabled;
    this.eqLowShelf.frequency.setValueAtTime(this.settings.eq.lowFreq, this.ctx.currentTime);
    this.eqLowShelf.gain.setValueAtTime(enabled ? this.settings.eq.lowGain : 0, this.ctx.currentTime);
    this.eqMidPeak.frequency.setValueAtTime(this.settings.eq.midFreq, this.ctx.currentTime);
    this.eqMidPeak.gain.setValueAtTime(enabled ? this.settings.eq.midGain : 0, this.ctx.currentTime);
    this.eqHighShelf.frequency.setValueAtTime(this.settings.eq.highFreq, this.ctx.currentTime);
    this.eqHighShelf.gain.setValueAtTime(enabled ? this.settings.eq.highGain : 0, this.ctx.currentTime);
  }
  applyCompressorParams(comp) {
    if (!this.compNode) return;
    this.compNode.threshold.setValueAtTime(comp.threshold, this.ctx.currentTime);
    this.compNode.knee.setValueAtTime(comp.knee, this.ctx.currentTime);
    this.compNode.ratio.setValueAtTime(comp.ratio, this.ctx.currentTime);
    this.compNode.attack.setValueAtTime(comp.attack, this.ctx.currentTime);
    this.compNode.release.setValueAtTime(comp.release, this.ctx.currentTime);
    if (comp.enabled) {
      this.compWetGain.gain.setValueAtTime(1, this.ctx.currentTime);
      this.compDryGain.gain.setValueAtTime(0, this.ctx.currentTime);
    } else {
      this.compWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.compDryGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
  setCompressor(comp) {
    this.settings.compressor = { ...this.settings.compressor, ...comp };
    this.applyCompressorParams(this.settings.compressor);
  }
  applyDelayParams(delay) {
    if (!this.delayNode) return;
    this.delayNode.delayTime.setValueAtTime(delay.time, this.ctx.currentTime);
    if (delay.enabled) {
      this.delayFeedbackGain.gain.setValueAtTime(Math.min(0.85, Math.max(0, delay.feedback)), this.ctx.currentTime);
      this.delayWetGain.gain.setValueAtTime(Math.min(1, Math.max(0, delay.wet)), this.ctx.currentTime);
      this.delayDryGain.gain.setValueAtTime(Math.min(1, Math.max(0, delay.dry)), this.ctx.currentTime);
    } else {
      this.delayFeedbackGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.delayWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.delayDryGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
  setDelay(delay) {
    this.settings.delay = { ...this.settings.delay, ...delay };
    this.applyDelayParams(this.settings.delay);
  }
  applyReverbParams(reverb) {
    if (!this.convolverNode) return;
    if (reverb.enabled) {
      this.reverbWetGain.gain.setValueAtTime(Math.min(1, Math.max(0, reverb.wet)), this.ctx.currentTime);
      this.reverbDryGain.gain.setValueAtTime(Math.min(1, Math.max(0, reverb.dry)), this.ctx.currentTime);
      const ir = this.generateImpulseResponse(reverb.decay, this.ctx.sampleRate);
      try {
        this.convolverNode.buffer = ir;
      } catch (err) {
      }
    } else {
      this.reverbWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.reverbDryGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
  setReverb(reverb) {
    const prevDecay = this.settings.reverb.decay;
    this.settings.reverb = { ...this.settings.reverb, ...reverb };
    if (reverb.decay !== void 0 && reverb.decay !== prevDecay && this.settings.reverb.enabled) {
      this.convolverNode.buffer = this.generateImpulseResponse(this.settings.reverb.decay, this.ctx.sampleRate);
    }
    this.applyReverbParams(this.settings.reverb);
  }
  /**
   * Generates a stereo algorithmic impulse response with natural exponential decay.
   */
  generateImpulseResponse(decaySeconds, sampleRate) {
    const safeDecay = Math.max(0.1, Math.min(10, decaySeconds));
    const length = Math.floor(sampleRate * safeDecay);
    const irBuffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = irBuffer.getChannelData(0);
    const right = irBuffer.getChannelData(1);
    const decayConstant = 6.91 / safeDecay;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-decayConstant * t);
      left[i] = (Math.random() * 2 - 1) * envelope;
      right[i] = (Math.random() * 2 - 1) * envelope;
    }
    return irBuffer;
  }
  updateAll(settings) {
    this.setEqualizer(settings.eq);
    this.setCompressor(settings.compressor);
    this.setDelay(settings.delay);
    this.setReverb(settings.reverb);
  }
  dispose() {
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
    } catch {
    }
  }
};
export {
  EffectsRack
};
