import { AudioGraphModel } from './AudioGraphModel';
import { AudioNodeData } from './types';

interface WebAudioNodeUnit {
  inputNode: AudioNode;
  outputNode: AudioNode;
  internalNodes: AudioNode[];
  updateParam: (paramName: string, value: number, ctx: AudioContext) => void;
  setBypass: (bypassed: boolean) => void;
}

/**
 * AudioGraphProcessor
 * Translates the AudioGraphModel DAG into real Web Audio API nodes in topological order.
 * Manages dynamic graph rebuilding, live parameter modifications, and audio routing.
 */
export class AudioGraphProcessor {
  private ctx: AudioContext | null = null;
  private graphModel: AudioGraphModel | null = null;
  private nodeUnits: Map<string, WebAudioNodeUnit> = new Map();

  private inputBridge: GainNode | null = null;
  private outputBridge: GainNode | null = null;

  setContext(ctx: AudioContext): void {
    this.ctx = ctx;
    this.inputBridge = ctx.createGain();
    this.outputBridge = ctx.createGain();
  }

  setGraphModel(model: AudioGraphModel): void {
    this.graphModel = model;
    model.subscribe(() => {
      this.rebuildAudioRouting();
    });
    this.rebuildAudioRouting();
  }

  getInputNode(): GainNode | null {
    return this.inputBridge;
  }

  getOutputNode(): GainNode | null {
    return this.outputBridge;
  }

  /**
   * Rebuilds the Web Audio API audio graph following topological order.
   */
  rebuildAudioRouting(): void {
    if (!this.ctx || !this.graphModel) return;

    // Disconnect old nodes cleanly
    this.cleanupNodes();

    const topoResult = this.graphModel.getTopologicalOrder();
    if (!topoResult.isValid || !topoResult.topologicalOrder) {
      console.warn('Cannot rebuild audio graph: DAG contains cycle or is invalid.');
      return;
    }

    const topoOrder = topoResult.topologicalOrder;

    // 1. Create Web Audio Node Units for all nodes
    for (const nodeId of topoOrder) {
      const nodeData = this.graphModel.getNode(nodeId);
      if (!nodeData) continue;
      const unit = this.createWebAudioNodeUnit(nodeData);
      if (unit) {
        this.nodeUnits.set(nodeId, unit);
      }
    }

    // 2. Wire connections between units based on graph edges
    const connections = this.graphModel.getAllConnections();
    for (const conn of connections) {
      const fromUnit = this.nodeUnits.get(conn.fromNodeId);
      const toUnit = this.nodeUnits.get(conn.toNodeId);

      if (fromUnit && toUnit) {
        try {
          fromUnit.outputNode.connect(toUnit.inputNode);
        } catch (err) {
          console.warn(`Failed to connect audio nodes ${conn.fromNodeId} -> ${conn.toNodeId}:`, err);
        }
      }
    }

    // 3. Connect Input Bridge to 'input' node, and 'output' node to Output Bridge
    const inputNodeData = this.graphModel.getAllNodes().find((n) => n.type === 'input');
    if (inputNodeData && this.inputBridge) {
      const inUnit = this.nodeUnits.get(inputNodeData.id);
      if (inUnit) {
        try {
          this.inputBridge.disconnect();
        } catch {}
        this.inputBridge.connect(inUnit.inputNode);
      }
    }

    const outputNodeData = this.graphModel.getAllNodes().find((n) => n.type === 'output');
    if (outputNodeData && this.outputBridge) {
      const outUnit = this.nodeUnits.get(outputNodeData.id);
      if (outUnit) {
        try {
          outUnit.outputNode.connect(this.outputBridge);
        } catch (err) {
          console.warn('Failed to connect output unit to output bridge:', err);
        }
      }
    }
  }

  /**
   * Updates a parameter in real time on the live Web Audio node.
   */
  updateParam(nodeId: string, paramName: string, value: number): void {
    if (!this.ctx) return;
    const unit = this.nodeUnits.get(nodeId);
    if (unit) {
      unit.updateParam(paramName, value, this.ctx);
    }
  }

  setBypass(nodeId: string, bypassed: boolean): void {
    const unit = this.nodeUnits.get(nodeId);
    if (unit) {
      unit.setBypass(bypassed);
    }
  }

  private cleanupNodes(): void {
    for (const unit of this.nodeUnits.values()) {
      try {
        unit.outputNode.disconnect();
      } catch {}
      for (const internal of unit.internalNodes) {
        try {
          internal.disconnect();
        } catch {}
      }
    }
    this.nodeUnits.clear();
  }

  // -----------------------------------------------------------------
  // Web Audio Node Factory for all 10 Node Types
  // -----------------------------------------------------------------

  private createWebAudioNodeUnit(data: AudioNodeData): WebAudioNodeUnit | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;

    switch (data.type) {
      case 'input': {
        const gain = ctx.createGain();
        gain.gain.value = 1.0;
        return {
          inputNode: gain,
          outputNode: gain,
          internalNodes: [gain],
          updateParam: () => {},
          setBypass: () => {},
        };
      }

      case 'output': {
        const gain = ctx.createGain();
        gain.gain.value = typeof data.params.masterGain === 'number' ? data.params.masterGain : 1.0;
        return {
          inputNode: gain,
          outputNode: gain,
          internalNodes: [gain],
          updateParam: (name, val, c) => {
            if (name === 'masterGain') gain.gain.setValueAtTime(val, c.currentTime);
          },
          setBypass: () => {},
        };
      }

      case 'gain': {
        const gainNode = ctx.createGain();
        gainNode.gain.value = typeof data.params.gain === 'number' ? data.params.gain : 1.0;
        return {
          inputNode: gainNode,
          outputNode: gainNode,
          internalNodes: [gainNode],
          updateParam: (name, val, c) => {
            if (name === 'gain') gainNode.gain.setValueAtTime(val, c.currentTime);
          },
          setBypass: (bypassed) => {
            gainNode.gain.setValueAtTime(bypassed ? 1.0 : (data.params.gain ?? 1.0), ctx.currentTime);
          },
        };
      }

      case 'lowpass': {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = data.params.frequency ?? 2500;
        filter.Q.value = data.params.q ?? 1.0;

        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const inSplit = ctx.createGain();
        const outSum = ctx.createGain();

        inSplit.connect(filter);
        filter.connect(wetGain);
        wetGain.connect(outSum);

        inSplit.connect(dryGain);
        dryGain.connect(outSum);

        const applyBypass = (bypassed: boolean) => {
          dryGain.gain.setValueAtTime(bypassed ? 1.0 : 0.0, ctx.currentTime);
          wetGain.gain.setValueAtTime(bypassed ? 0.0 : 1.0, ctx.currentTime);
        };
        applyBypass(data.bypassed);

        return {
          inputNode: inSplit,
          outputNode: outSum,
          internalNodes: [filter, dryGain, wetGain, inSplit, outSum],
          updateParam: (name, val, c) => {
            if (name === 'frequency') filter.frequency.setValueAtTime(val, c.currentTime);
            if (name === 'q') filter.Q.setValueAtTime(val, c.currentTime);
          },
          setBypass: applyBypass,
        };
      }

      case 'highpass': {
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = data.params.frequency ?? 150;
        filter.Q.value = data.params.q ?? 1.0;

        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const inSplit = ctx.createGain();
        const outSum = ctx.createGain();

        inSplit.connect(filter);
        filter.connect(wetGain);
        wetGain.connect(outSum);

        inSplit.connect(dryGain);
        dryGain.connect(outSum);

        const applyBypass = (bypassed: boolean) => {
          dryGain.gain.setValueAtTime(bypassed ? 1.0 : 0.0, ctx.currentTime);
          wetGain.gain.setValueAtTime(bypassed ? 0.0 : 1.0, ctx.currentTime);
        };
        applyBypass(data.bypassed);

        return {
          inputNode: inSplit,
          outputNode: outSum,
          internalNodes: [filter, dryGain, wetGain, inSplit, outSum],
          updateParam: (name, val, c) => {
            if (name === 'frequency') filter.frequency.setValueAtTime(val, c.currentTime);
            if (name === 'q') filter.Q.setValueAtTime(val, c.currentTime);
          },
          setBypass: applyBypass,
        };
      }

      case 'eq': {
        // 3-Band Parametric EQ: Low Shelf (320Hz), Mid Peaking (1000Hz), High Shelf (3200Hz)
        const low = ctx.createBiquadFilter();
        low.type = 'lowshelf';
        low.frequency.value = 320;
        low.gain.value = data.params.lowGain ?? 0;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 1.0;
        mid.gain.value = data.params.midGain ?? 0;

        const high = ctx.createBiquadFilter();
        high.type = 'highshelf';
        high.frequency.value = 3200;
        high.gain.value = data.params.highGain ?? 0;

        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const inSplit = ctx.createGain();
        const outSum = ctx.createGain();

        inSplit.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(wetGain);
        wetGain.connect(outSum);

        inSplit.connect(dryGain);
        dryGain.connect(outSum);

        const applyBypass = (bypassed: boolean) => {
          dryGain.gain.setValueAtTime(bypassed ? 1.0 : 0.0, ctx.currentTime);
          wetGain.gain.setValueAtTime(bypassed ? 0.0 : 1.0, ctx.currentTime);
        };
        applyBypass(data.bypassed);

        return {
          inputNode: inSplit,
          outputNode: outSum,
          internalNodes: [low, mid, high, dryGain, wetGain, inSplit, outSum],
          updateParam: (name, val, c) => {
            if (name === 'lowGain') low.gain.setValueAtTime(val, c.currentTime);
            if (name === 'midGain') mid.gain.setValueAtTime(val, c.currentTime);
            if (name === 'highGain') high.gain.setValueAtTime(val, c.currentTime);
          },
          setBypass: applyBypass,
        };
      }

      case 'compressor': {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = data.params.threshold ?? -24;
        comp.ratio.value = data.params.ratio ?? 4;
        comp.knee.value = data.params.knee ?? 10;
        comp.attack.value = data.params.attack ?? 0.01;
        comp.release.value = data.params.release ?? 0.25;

        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const inSplit = ctx.createGain();
        const outSum = ctx.createGain();

        inSplit.connect(comp);
        comp.connect(wetGain);
        wetGain.connect(outSum);

        inSplit.connect(dryGain);
        dryGain.connect(outSum);

        const applyBypass = (bypassed: boolean) => {
          dryGain.gain.setValueAtTime(bypassed ? 1.0 : 0.0, ctx.currentTime);
          wetGain.gain.setValueAtTime(bypassed ? 0.0 : 1.0, ctx.currentTime);
        };
        applyBypass(data.bypassed);

        return {
          inputNode: inSplit,
          outputNode: outSum,
          internalNodes: [comp, dryGain, wetGain, inSplit, outSum],
          updateParam: (name, val, c) => {
            if (name === 'threshold') comp.threshold.setValueAtTime(val, c.currentTime);
            if (name === 'ratio') comp.ratio.setValueAtTime(val, c.currentTime);
            if (name === 'knee') comp.knee.setValueAtTime(val, c.currentTime);
            if (name === 'attack') comp.attack.setValueAtTime(val, c.currentTime);
            if (name === 'release') comp.release.setValueAtTime(val, c.currentTime);
          },
          setBypass: applyBypass,
        };
      }

      case 'delay': {
        const delayNode = ctx.createDelay(2.0);
        delayNode.delayTime.value = data.params.delayTime ?? 0.3;

        const feedback = ctx.createGain();
        feedback.gain.value = data.params.feedback ?? 0.35;

        const dryGain = ctx.createGain();
        dryGain.gain.value = 1.0;

        const wetGain = ctx.createGain();
        wetGain.gain.value = data.params.wet ?? 0.4;

        const inSplit = ctx.createGain();
        const outSum = ctx.createGain();

        // Dry path
        inSplit.connect(dryGain);
        dryGain.connect(outSum);

        // Wet path + feedback
        inSplit.connect(delayNode);
        delayNode.connect(feedback);
        feedback.connect(delayNode); // Feedback loop
        delayNode.connect(wetGain);
        wetGain.connect(outSum);

        const applyBypass = (bypassed: boolean) => {
          wetGain.gain.setValueAtTime(bypassed ? 0.0 : (data.params.wet ?? 0.4), ctx.currentTime);
        };
        applyBypass(data.bypassed);

        return {
          inputNode: inSplit,
          outputNode: outSum,
          internalNodes: [delayNode, feedback, dryGain, wetGain, inSplit, outSum],
          updateParam: (name, val, c) => {
            if (name === 'delayTime') delayNode.delayTime.setValueAtTime(val, c.currentTime);
            if (name === 'feedback') feedback.gain.setValueAtTime(Math.min(0.88, val), c.currentTime);
            if (name === 'wet' && !data.bypassed) wetGain.gain.setValueAtTime(val, c.currentTime);
          },
          setBypass: applyBypass,
        };
      }

      case 'reverb': {
        const convolver = ctx.createConvolver();
        const decay = data.params.decay ?? 2.0;
        convolver.buffer = this.buildImpulseResponse(ctx, decay);

        const dryGain = ctx.createGain();
        dryGain.gain.value = data.params.dry ?? 1.0;

        const wetGain = ctx.createGain();
        wetGain.gain.value = data.params.wet ?? 0.35;

        const inSplit = ctx.createGain();
        const outSum = ctx.createGain();

        inSplit.connect(dryGain);
        dryGain.connect(outSum);

        inSplit.connect(convolver);
        convolver.connect(wetGain);
        wetGain.connect(outSum);

        const applyBypass = (bypassed: boolean) => {
          wetGain.gain.setValueAtTime(bypassed ? 0.0 : (data.params.wet ?? 0.35), ctx.currentTime);
        };
        applyBypass(data.bypassed);

        return {
          inputNode: inSplit,
          outputNode: outSum,
          internalNodes: [convolver, dryGain, wetGain, inSplit, outSum],
          updateParam: (name, val, c) => {
            if (name === 'decay') {
              convolver.buffer = this.buildImpulseResponse(c, val);
            }
            if (name === 'wet' && !data.bypassed) wetGain.gain.setValueAtTime(val, c.currentTime);
            if (name === 'dry') dryGain.gain.setValueAtTime(val, c.currentTime);
          },
          setBypass: applyBypass,
        };
      }

      case 'pan': {
        let pannerNode: StereoPannerNode | null = null;
        if (ctx.createStereoPanner) {
          pannerNode = ctx.createStereoPanner();
          pannerNode.pan.value = data.params.pan ?? 0.0;
        }
        const fallback = ctx.createGain();

        const activeNode = pannerNode || fallback;

        return {
          inputNode: activeNode,
          outputNode: activeNode,
          internalNodes: [activeNode],
          updateParam: (name, val, c) => {
            if (name === 'pan' && pannerNode) {
              pannerNode.pan.setValueAtTime(val, c.currentTime);
            }
          },
          setBypass: (bypassed) => {
            if (pannerNode) {
              pannerNode.pan.setValueAtTime(bypassed ? 0.0 : (data.params.pan ?? 0.0), ctx.currentTime);
            }
          },
        };
      }

      default:
        return null;
    }
  }

  /**
   * Generates a stereo algorithmic exponential decay impulse response for ConvolverNode.
   */
  private buildImpulseResponse(ctx: AudioContext, decaySeconds: number): AudioBuffer {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.floor(sampleRate * Math.max(0.2, decaySeconds));
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = i / length;
      // Exponential decay envelope
      const env = Math.pow(1 - n, 3);
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    }

    return impulse;
  }
}

export const audioGraphProcessor = new AudioGraphProcessor();
