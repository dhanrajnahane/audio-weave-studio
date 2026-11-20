// src/audio/routing/types.ts
var NODE_PARAM_DEFINITIONS = {
  input: [],
  output: [
    { name: "masterGain", label: "Output Level", min: 0, max: 2, step: 0.01, defaultValue: 1, unit: "x" }
  ],
  gain: [
    { name: "gain", label: "Gain", min: 0, max: 2, step: 0.01, defaultValue: 1, unit: "x" }
  ],
  eq: [
    { name: "lowGain", label: "Low (320Hz)", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" },
    { name: "midGain", label: "Mid (1kHz)", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" },
    { name: "highGain", label: "High (3.2kHz)", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" }
  ],
  compressor: [
    { name: "threshold", label: "Threshold", min: -60, max: 0, step: 1, defaultValue: -24, unit: "dB" },
    { name: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, defaultValue: 4, unit: ":1" },
    { name: "knee", label: "Knee", min: 0, max: 40, step: 1, defaultValue: 10, unit: "dB" },
    { name: "attack", label: "Attack", min: 1e-3, max: 0.5, step: 5e-3, defaultValue: 0.01, unit: "s" },
    { name: "release", label: "Release", min: 0.05, max: 1, step: 0.05, defaultValue: 0.25, unit: "s" }
  ],
  reverb: [
    { name: "decay", label: "Decay Time", min: 0.2, max: 6, step: 0.1, defaultValue: 2, unit: "s" },
    { name: "wet", label: "Wet Mix", min: 0, max: 1, step: 0.02, defaultValue: 0.35, unit: "%" },
    { name: "dry", label: "Dry Mix", min: 0, max: 1, step: 0.02, defaultValue: 1, unit: "%" }
  ],
  delay: [
    { name: "delayTime", label: "Delay Time", min: 0.02, max: 1.5, step: 0.02, defaultValue: 0.3, unit: "s" },
    { name: "feedback", label: "Feedback", min: 0, max: 0.85, step: 0.02, defaultValue: 0.35, unit: "%" },
    { name: "wet", label: "Wet Level", min: 0, max: 1, step: 0.02, defaultValue: 0.4, unit: "%" }
  ],
  lowpass: [
    { name: "frequency", label: "Cutoff Freq", min: 100, max: 18e3, step: 50, defaultValue: 2500, unit: "Hz" },
    { name: "q", label: "Resonance (Q)", min: 0.5, max: 12, step: 0.1, defaultValue: 1, unit: "" }
  ],
  highpass: [
    { name: "frequency", label: "Cutoff Freq", min: 20, max: 4e3, step: 20, defaultValue: 150, unit: "Hz" },
    { name: "q", label: "Resonance (Q)", min: 0.5, max: 12, step: 0.1, defaultValue: 1, unit: "" }
  ],
  pan: [
    { name: "pan", label: "Pan", min: -1, max: 1, step: 0.05, defaultValue: 0, unit: "" }
  ]
};

// src/audio/routing/AudioGraphModel.ts
var AudioGraphModel = class {
  nodes = /* @__PURE__ */ new Map();
  connections = /* @__PURE__ */ new Map();
  // Adjacency lists for fast edge lookups
  outgoingEdges = /* @__PURE__ */ new Map();
  // from -> Set<to>
  incomingEdges = /* @__PURE__ */ new Map();
  // to -> Set<from>
  listeners = /* @__PURE__ */ new Set();
  constructor() {
    this.initDefaultGraph();
  }
  /**
   * Initializes standard baseline graph: Input -> Gain -> Output.
   */
  initDefaultGraph() {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    const inputNode = {
      id: "node-input",
      type: "input",
      name: "Audio In",
      x: 60,
      y: 180,
      bypassed: false,
      params: {}
    };
    const gainNode = {
      id: "node-gain-master",
      type: "gain",
      name: "Master Level",
      x: 320,
      y: 180,
      bypassed: false,
      params: { gain: 1 }
    };
    const outputNode = {
      id: "node-output",
      type: "output",
      name: "Audio Out",
      x: 580,
      y: 180,
      bypassed: false,
      params: { masterGain: 1 }
    };
    this.addNodeInternal(inputNode);
    this.addNodeInternal(gainNode);
    this.addNodeInternal(outputNode);
    this.connectInternal("node-input", "node-gain-master");
    this.connectInternal("node-gain-master", "node-output");
    this.notify();
  }
  // -----------------------------------------------------------------
  // Node Management
  // -----------------------------------------------------------------
  addNode(type, x = 300, y = 200, name) {
    const id = `node-${type}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    const defaultParams = {};
    const configs = NODE_PARAM_DEFINITIONS[type] || [];
    for (const c of configs) {
      defaultParams[c.name] = c.defaultValue;
    }
    const defaultNames = {
      input: "Audio In",
      gain: "Gain Stage",
      eq: "Parametric EQ",
      compressor: "Compressor",
      reverb: "Convolver Reverb",
      delay: "Stereo Delay",
      lowpass: "Low-Pass Filter",
      highpass: "High-Pass Filter",
      pan: "Stereo Panner",
      output: "Audio Out"
    };
    const node = {
      id,
      type,
      name: name || defaultNames[type] || type.toUpperCase(),
      x,
      y,
      bypassed: false,
      params: defaultParams
    };
    this.addNodeInternal(node);
    this.notify();
    return node;
  }
  addNodeInternal(node) {
    this.nodes.set(node.id, { ...node });
    if (!this.outgoingEdges.has(node.id)) {
      this.outgoingEdges.set(node.id, /* @__PURE__ */ new Set());
    }
    if (!this.incomingEdges.has(node.id)) {
      this.incomingEdges.set(node.id, /* @__PURE__ */ new Set());
    }
  }
  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || node.type === "input" || node.type === "output") {
      return false;
    }
    const toRemove = [];
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.fromNodeId === nodeId || conn.toNodeId === nodeId) {
        toRemove.push(connId);
      }
    }
    toRemove.forEach((connId) => this.disconnect(connId, false));
    this.outgoingEdges.delete(nodeId);
    this.incomingEdges.delete(nodeId);
    this.nodes.delete(nodeId);
    this.notify();
    return true;
  }
  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }
  getAllNodes() {
    return Array.from(this.nodes.values());
  }
  updateNodePosition(nodeId, x, y) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.x = Math.max(0, x);
      node.y = Math.max(0, y);
      this.notify();
    }
  }
  updateNodeParam(nodeId, paramName, value) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.params = { ...node.params, [paramName]: value };
      this.notify();
    }
  }
  toggleBypass(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node && node.type !== "input" && node.type !== "output") {
      node.bypassed = !node.bypassed;
      this.notify();
      return node.bypassed;
    }
    return false;
  }
  // -----------------------------------------------------------------
  // Connection Validation & Cycle Detection
  // -----------------------------------------------------------------
  /**
   * Validates if a directed connection from fromNodeId to toNodeId is legally allowable.
   * Checks for:
   * 1. Self loops (u == v)
   * 2. Missing nodes
   * 3. Role restrictions (cannot connect out of 'output', cannot connect into 'input')
   * 4. Duplicate connections
   * 5. Cycle creation (Directed Acyclic Graph invariant)
   */
  validateConnection(fromNodeId, toNodeId) {
    if (fromNodeId === toNodeId) {
      return { valid: false, reason: "Cannot connect a node to itself (self-loop)." };
    }
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) {
      return { valid: false, reason: "One or both nodes do not exist." };
    }
    if (fromNode.type === "output") {
      return { valid: false, reason: "Audio Output node cannot have outgoing connections." };
    }
    if (toNode.type === "input") {
      return { valid: false, reason: "Audio Input node cannot have incoming connections." };
    }
    const outgoing = this.outgoingEdges.get(fromNodeId);
    if (outgoing && outgoing.has(toNodeId)) {
      return { valid: false, reason: "Connection already exists between these two nodes." };
    }
    if (this.pathExists(toNodeId, fromNodeId)) {
      return {
        valid: false,
        reason: "Connection creates a cycle. Audio routing graph must remain a Directed Acyclic Graph (DAG)."
      };
    }
    return { valid: true };
  }
  /**
   * Depth-First Search (DFS) to detect reachability from startId to targetId.
   */
  pathExists(startId, targetId) {
    const visited = /* @__PURE__ */ new Set();
    const stack = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === targetId) return true;
      if (!visited.has(current)) {
        visited.add(current);
        const neighbors = this.outgoingEdges.get(current);
        if (neighbors) {
          for (const next of neighbors) {
            if (!visited.has(next)) {
              stack.push(next);
            }
          }
        }
      }
    }
    return false;
  }
  connect(fromNodeId, toNodeId) {
    const validation = this.validateConnection(fromNodeId, toNodeId);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }
    const conn = this.connectInternal(fromNodeId, toNodeId);
    this.notify();
    return { success: true, connection: conn };
  }
  connectInternal(fromNodeId, toNodeId) {
    const id = `conn-${fromNodeId}->${toNodeId}`;
    const conn = {
      id,
      fromNodeId,
      fromPort: "out",
      toNodeId,
      toPort: "in"
    };
    this.connections.set(id, conn);
    let fromOut = this.outgoingEdges.get(fromNodeId);
    if (!fromOut) {
      fromOut = /* @__PURE__ */ new Set();
      this.outgoingEdges.set(fromNodeId, fromOut);
    }
    fromOut.add(toNodeId);
    let toIn = this.incomingEdges.get(toNodeId);
    if (!toIn) {
      toIn = /* @__PURE__ */ new Set();
      this.incomingEdges.set(toNodeId, toIn);
    }
    toIn.add(fromNodeId);
    return conn;
  }
  disconnect(connectionId, shouldNotify = true) {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    this.connections.delete(connectionId);
    this.outgoingEdges.get(conn.fromNodeId)?.delete(conn.toNodeId);
    this.incomingEdges.get(conn.toNodeId)?.delete(conn.fromNodeId);
    if (shouldNotify) {
      this.notify();
    }
    return true;
  }
  getAllConnections() {
    return Array.from(this.connections.values());
  }
  // -----------------------------------------------------------------
  // Topological Sorting (Kahn's Algorithm)
  // -----------------------------------------------------------------
  /**
   * Computes exact topological ordering for the DAG using Kahn's algorithm.
   * Returns list of node IDs in evaluation order.
   * Fails if graph contains a cycle.
   */
  getTopologicalOrder() {
    const inDegree = /* @__PURE__ */ new Map();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }
    for (const conn of this.connections.values()) {
      inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) || 0) + 1);
    }
    const queue = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }
    const order = [];
    while (queue.length > 0) {
      const u = queue.shift();
      order.push(u);
      const neighbors = this.outgoingEdges.get(u);
      if (neighbors) {
        for (const v of neighbors) {
          const currentDeg = (inDegree.get(v) || 1) - 1;
          inDegree.set(v, currentDeg);
          if (currentDeg === 0) {
            queue.push(v);
          }
        }
      }
    }
    if (order.length !== this.nodes.size) {
      return {
        isValid: false,
        hasCycle: true,
        error: "Cycle detected during topological sorting! Audio graph cannot be processed."
      };
    }
    return {
      isValid: true,
      hasCycle: false,
      topologicalOrder: order
    };
  }
  // -----------------------------------------------------------------
  // Preset Topologies
  // -----------------------------------------------------------------
  loadPreset(presetName) {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    const inNode = this.addNode("input", 50, 200, "Audio In");
    const outNode = this.addNode("output", 750, 200, "Audio Out");
    if (presetName === "direct") {
      const gain = this.addNode("gain", 400, 200, "Master Level");
      this.connect(inNode.id, gain.id);
      this.connect(gain.id, outNode.id);
    } else if (presetName === "vocal_warmth") {
      const hp = this.addNode("highpass", 200, 160, "Low Cut (80Hz)");
      hp.params.frequency = 80;
      const eq = this.addNode("eq", 360, 240, "Vocal Air & Body");
      eq.params.lowGain = 1.5;
      eq.params.midGain = -1;
      eq.params.highGain = 3;
      const comp = this.addNode("compressor", 520, 160, "Vocal Leveler");
      comp.params.threshold = -18;
      comp.params.ratio = 3.5;
      this.connect(inNode.id, hp.id);
      this.connect(hp.id, eq.id);
      this.connect(eq.id, comp.id);
      this.connect(comp.id, outNode.id);
    } else if (presetName === "space_echo") {
      const delay = this.addNode("delay", 240, 220, "Tape Echo");
      delay.params.delayTime = 0.35;
      delay.params.feedback = 0.45;
      delay.params.wet = 0.5;
      const reverb = this.addNode("reverb", 480, 220, "Hall Verb");
      reverb.params.decay = 2.8;
      reverb.params.wet = 0.4;
      this.connect(inNode.id, delay.id);
      this.connect(delay.id, reverb.id);
      this.connect(reverb.id, outNode.id);
    } else if (presetName === "lofi_filter") {
      const lp = this.addNode("lowpass", 240, 180, "Warm Low-Pass");
      lp.params.frequency = 1800;
      lp.params.q = 1.4;
      const hp = this.addNode("highpass", 450, 180, "Phone Cut");
      hp.params.frequency = 320;
      this.connect(inNode.id, lp.id);
      this.connect(lp.id, hp.id);
      this.connect(hp.id, outNode.id);
    }
    this.notify();
  }
  // -----------------------------------------------------------------
  // Serialization & Change Subscriptions
  // -----------------------------------------------------------------
  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()),
      connections: Array.from(this.connections.values())
    };
  }
  fromJSON(data) {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
    for (const node of data.nodes) {
      this.addNodeInternal(node);
    }
    for (const conn of data.connections) {
      this.connectInternal(conn.fromNodeId, conn.toNodeId);
    }
    this.notify();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    this.listeners.forEach((cb) => cb());
  }
};
var audioGraphModel = new AudioGraphModel();
export {
  AudioGraphModel,
  audioGraphModel
};
