import {
  AudioNodeData,
  AudioConnection,
  AudioNodeType,
  GraphValidationResult,
  NODE_PARAM_DEFINITIONS,
} from './types';

type GraphChangeListener = () => void;

/**
 * Directed Acyclic Graph (DAG) for Modular Audio Signal Routing.
 * Implements:
 * - Adjacency List graph representation
 * - Cycle detection via DFS reachability
 * - Kahn's algorithm for topological sorting
 * - Node creation, deletion, parameter persistence
 */
export class AudioGraphModel {
  private nodes: Map<string, AudioNodeData> = new Map();
  private connections: Map<string, AudioConnection> = new Map();

  // Adjacency lists for fast edge lookups
  private outgoingEdges: Map<string, Set<string>> = new Map(); // from -> Set<to>
  private incomingEdges: Map<string, Set<string>> = new Map(); // to -> Set<from>

  private listeners: Set<GraphChangeListener> = new Set();

  constructor() {
    this.initDefaultGraph();
  }

  /**
   * Initializes standard baseline graph: Input -> Gain -> Output.
   */
  initDefaultGraph(): void {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();

    const inputNode: AudioNodeData = {
      id: 'node-input',
      type: 'input',
      name: 'Audio In',
      x: 60,
      y: 180,
      bypassed: false,
      params: {},
    };

    const gainNode: AudioNodeData = {
      id: 'node-gain-master',
      type: 'gain',
      name: 'Master Level',
      x: 320,
      y: 180,
      bypassed: false,
      params: { gain: 1.0 },
    };

    const outputNode: AudioNodeData = {
      id: 'node-output',
      type: 'output',
      name: 'Audio Out',
      x: 580,
      y: 180,
      bypassed: false,
      params: { masterGain: 1.0 },
    };

    this.addNodeInternal(inputNode);
    this.addNodeInternal(gainNode);
    this.addNodeInternal(outputNode);

    this.connectInternal('node-input', 'node-gain-master');
    this.connectInternal('node-gain-master', 'node-output');

    this.notify();
  }

  // -----------------------------------------------------------------
  // Node Management
  // -----------------------------------------------------------------

  addNode(type: AudioNodeType, x: number = 300, y: number = 200, name?: string): AudioNodeData {
    const id = `node-${type}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    const defaultParams: Record<string, number> = {};
    const configs = NODE_PARAM_DEFINITIONS[type] || [];
    for (const c of configs) {
      defaultParams[c.name] = c.defaultValue;
    }

    const defaultNames: Record<AudioNodeType, string> = {
      input: 'Audio In',
      gain: 'Gain Stage',
      eq: 'Parametric EQ',
      compressor: 'Compressor',
      reverb: 'Convolver Reverb',
      delay: 'Stereo Delay',
      lowpass: 'Low-Pass Filter',
      highpass: 'High-Pass Filter',
      pan: 'Stereo Panner',
      output: 'Audio Out',
    };

    const node: AudioNodeData = {
      id,
      type,
      name: name || defaultNames[type] || type.toUpperCase(),
      x,
      y,
      bypassed: false,
      params: defaultParams,
    };

    this.addNodeInternal(node);
    this.notify();
    return node;
  }

  private addNodeInternal(node: AudioNodeData): void {
    this.nodes.set(node.id, { ...node });
    if (!this.outgoingEdges.has(node.id)) {
      this.outgoingEdges.set(node.id, new Set());
    }
    if (!this.incomingEdges.has(node.id)) {
      this.incomingEdges.set(node.id, new Set());
    }
  }

  removeNode(nodeId: string): boolean {
    // Input and Output boundary nodes cannot be deleted
    const node = this.nodes.get(nodeId);
    if (!node || node.type === 'input' || node.type === 'output') {
      return false;
    }

    // Remove all associated connections
    const toRemove: string[] = [];
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

  getNode(nodeId: string): AudioNodeData | undefined {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): AudioNodeData[] {
    return Array.from(this.nodes.values());
  }

  updateNodePosition(nodeId: string, x: number, y: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.x = Math.max(0, x);
      node.y = Math.max(0, y);
      this.notify();
    }
  }

  updateNodeParam(nodeId: string, paramName: string, value: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.params = { ...node.params, [paramName]: value };
      this.notify();
    }
  }

  toggleBypass(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (node && node.type !== 'input' && node.type !== 'output') {
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
  validateConnection(fromNodeId: string, toNodeId: string): { valid: boolean; reason?: string } {
    if (fromNodeId === toNodeId) {
      return { valid: false, reason: 'Cannot connect a node to itself (self-loop).' };
    }

    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);

    if (!fromNode || !toNode) {
      return { valid: false, reason: 'One or both nodes do not exist.' };
    }

    if (fromNode.type === 'output') {
      return { valid: false, reason: 'Audio Output node cannot have outgoing connections.' };
    }

    if (toNode.type === 'input') {
      return { valid: false, reason: 'Audio Input node cannot have incoming connections.' };
    }

    // Check duplicate edge
    const outgoing = this.outgoingEdges.get(fromNodeId);
    if (outgoing && outgoing.has(toNodeId)) {
      return { valid: false, reason: 'Connection already exists between these two nodes.' };
    }

    // Cycle detection: check if a directed path already exists from toNodeId to fromNodeId
    if (this.pathExists(toNodeId, fromNodeId)) {
      return {
        valid: false,
        reason: 'Connection creates a cycle. Audio routing graph must remain a Directed Acyclic Graph (DAG).',
      };
    }

    return { valid: true };
  }

  /**
   * Depth-First Search (DFS) to detect reachability from startId to targetId.
   */
  private pathExists(startId: string, targetId: string): boolean {
    const visited = new Set<string>();
    const stack = [startId];

    while (stack.length > 0) {
      const current = stack.pop()!;
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

  connect(fromNodeId: string, toNodeId: string): { success: boolean; connection?: AudioConnection; reason?: string } {
    const validation = this.validateConnection(fromNodeId, toNodeId);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const conn = this.connectInternal(fromNodeId, toNodeId);
    this.notify();
    return { success: true, connection: conn };
  }

  private connectInternal(fromNodeId: string, toNodeId: string): AudioConnection {
    const id = `conn-${fromNodeId}->${toNodeId}`;
    const conn: AudioConnection = {
      id,
      fromNodeId,
      fromPort: 'out',
      toNodeId,
      toPort: 'in',
    };

    this.connections.set(id, conn);

    let fromOut = this.outgoingEdges.get(fromNodeId);
    if (!fromOut) {
      fromOut = new Set();
      this.outgoingEdges.set(fromNodeId, fromOut);
    }
    fromOut.add(toNodeId);

    let toIn = this.incomingEdges.get(toNodeId);
    if (!toIn) {
      toIn = new Set();
      this.incomingEdges.set(toNodeId, toIn);
    }
    toIn.add(fromNodeId);

    return conn;
  }

  disconnect(connectionId: string, shouldNotify: boolean = true): boolean {
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

  getAllConnections(): AudioConnection[] {
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
  getTopologicalOrder(): GraphValidationResult {
    const inDegree: Map<string, number> = new Map();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }

    for (const conn of this.connections.values()) {
      inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) || 0) + 1);
    }

    // Queue nodes with in-degree 0
    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }

    const order: string[] = [];

    while (queue.length > 0) {
      const u = queue.shift()!;
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
        error: 'Cycle detected during topological sorting! Audio graph cannot be processed.',
      };
    }

    return {
      isValid: true,
      hasCycle: false,
      topologicalOrder: order,
    };
  }

  // -----------------------------------------------------------------
  // Preset Topologies
  // -----------------------------------------------------------------

  loadPreset(presetName: 'direct' | 'vocal_warmth' | 'space_echo' | 'lofi_filter'): void {
    this.nodes.clear();
    this.connections.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();

    const inNode = this.addNode('input', 50, 200, 'Audio In');
    const outNode = this.addNode('output', 750, 200, 'Audio Out');

    if (presetName === 'direct') {
      const gain = this.addNode('gain', 400, 200, 'Master Level');
      this.connect(inNode.id, gain.id);
      this.connect(gain.id, outNode.id);
    } else if (presetName === 'vocal_warmth') {
      // In -> High-Pass (100Hz) -> EQ -> Compressor -> Gain -> Out
      const hp = this.addNode('highpass', 200, 160, 'Low Cut (80Hz)');
      hp.params.frequency = 80;
      const eq = this.addNode('eq', 360, 240, 'Vocal Air & Body');
      eq.params.lowGain = 1.5;
      eq.params.midGain = -1.0;
      eq.params.highGain = 3.0;
      const comp = this.addNode('compressor', 520, 160, 'Vocal Leveler');
      comp.params.threshold = -18;
      comp.params.ratio = 3.5;

      this.connect(inNode.id, hp.id);
      this.connect(hp.id, eq.id);
      this.connect(eq.id, comp.id);
      this.connect(comp.id, outNode.id);
    } else if (presetName === 'space_echo') {
      // In -> Delay (300ms) -> Reverb -> Out
      const delay = this.addNode('delay', 240, 220, 'Tape Echo');
      delay.params.delayTime = 0.35;
      delay.params.feedback = 0.45;
      delay.params.wet = 0.5;

      const reverb = this.addNode('reverb', 480, 220, 'Hall Verb');
      reverb.params.decay = 2.8;
      reverb.params.wet = 0.4;

      this.connect(inNode.id, delay.id);
      this.connect(delay.id, reverb.id);
      this.connect(reverb.id, outNode.id);
    } else if (presetName === 'lofi_filter') {
      // In -> Low-Pass (1800Hz) -> High-Pass (350Hz) -> Gain -> Out
      const lp = this.addNode('lowpass', 240, 180, 'Warm Low-Pass');
      lp.params.frequency = 1800;
      lp.params.q = 1.4;

      const hp = this.addNode('highpass', 450, 180, 'Phone Cut');
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

  toJSON(): { nodes: AudioNodeData[]; connections: AudioConnection[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      connections: Array.from(this.connections.values()),
    };
  }

  fromJSON(data: { nodes: AudioNodeData[]; connections: AudioConnection[] }): void {
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

  subscribe(listener: GraphChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

export const audioGraphModel = new AudioGraphModel();
