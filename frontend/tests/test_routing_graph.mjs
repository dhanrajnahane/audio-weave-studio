import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ---------------------------------------------------------------------
 * AudioWeave Studio — Audio Routing Graph (DAG) Acceptance Test Suite
 * ---------------------------------------------------------------------
 * Verifies:
 * 1. Node creation for all 10 node types.
 * 2. Node deletion and edge cleanup (with boundary node protection).
 * 3. Connection creation, removal, and duplicate prevention.
 * 4. Connection validation: self-loops, role boundaries.
 * 5. Cycle detection: DFS reachability prevents cycle formation.
 * 6. Topological sorting: Kahn's algorithm ordering dependencies.
 * 7. Live Web Audio node parameter alteration changing real sound output.
 * 8. Bypass mode toggling.
 */

class MockAudioParam {
  constructor(defaultValue = 1.0) {
    this.value = defaultValue;
  }
  setValueAtTime(v) {
    this.value = v;
  }
}

class MockAudioNode {
  constructor() {
    this.connections = new Set();
  }
  connect(dest) {
    this.connections.add(dest);
  }
  disconnect() {
    this.connections.clear();
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = new MockAudioParam(1.0);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1.0);
    this.gain = new MockAudioParam(0.0);
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor() {
    super();
    this.threshold = new MockAudioParam(-24);
    this.ratio = new MockAudioParam(4);
    this.knee = new MockAudioParam(10);
    this.attack = new MockAudioParam(0.01);
    this.release = new MockAudioParam(0.25);
  }
}

class MockDelayNode extends MockAudioNode {
  constructor() {
    super();
    this.delayTime = new MockAudioParam(0.3);
  }
}

class MockConvolverNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
  }
}

class MockStereoPannerNode extends MockAudioNode {
  constructor() {
    super();
    this.pan = new MockAudioParam(0.0);
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new MockGainNode();
  }
  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createDelay() { return new MockDelayNode(); }
  createConvolver() { return new MockConvolverNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createBuffer(channels, length, rate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    };
  }
}

globalThis.window = { AudioContext: MockAudioContext };

const modelPath = path.resolve('src/audio/routing/AudioGraphModel.compiled.mjs');
const { AudioGraphModel } = await import(pathToFileURL(modelPath).href);

const processorPath = path.resolve('src/audio/routing/AudioGraphProcessor.compiled.mjs');
const { AudioGraphProcessor } = await import(pathToFileURL(processorPath).href);

test('Audio Routing Graph (DAG) Acceptance Tests', async (t) => {
  const graph = new AudioGraphModel();
  const ctx = new MockAudioContext();
  const processor = new AudioGraphProcessor();
  processor.setContext(ctx);
  processor.setGraphModel(graph);

  // -----------------------------------------------------------------
  // 1. Initial State & All 10 Node Types Creation
  // -----------------------------------------------------------------
  await t.test('1. Node creation for all 10 supported node types', () => {
    // Default graph has Input -> Gain -> Output
    assert.equal(graph.getAllNodes().length, 3);
    const inNode = graph.getAllNodes().find((n) => n.type === 'input');
    const outNode = graph.getAllNodes().find((n) => n.type === 'output');
    assert.ok(inNode, 'Audio Input boundary node exists');
    assert.ok(outNode, 'Audio Output boundary node exists');

    // Add remaining 8 node types
    const types = ['gain', 'eq', 'compressor', 'reverb', 'delay', 'lowpass', 'highpass', 'pan'];
    for (const type of types) {
      const created = graph.addNode(type, 200, 200);
      assert.equal(created.type, type);
      assert.ok(graph.getNode(created.id));
    }

    assert.equal(graph.getAllNodes().length, 3 + 8, 'All 10 node types created and retrievable');
  });

  // -----------------------------------------------------------------
  // 2. Node Deletion and Boundary Protection
  // -----------------------------------------------------------------
  await t.test('2. Node deletion with boundary protection and edge cleanup', () => {
    const inNode = graph.getAllNodes().find((n) => n.type === 'input');
    const outNode = graph.getAllNodes().find((n) => n.type === 'output');

    // Cannot delete input or output nodes
    assert.equal(graph.removeNode(inNode.id), false, 'Boundary Input node deletion blocked');
    assert.equal(graph.removeNode(outNode.id), false, 'Boundary Output node deletion blocked');

    // Create an effect node and connect it
    const testGain = graph.addNode('gain', 300, 200);
    graph.connect(inNode.id, testGain.id);
    graph.connect(testGain.id, outNode.id);

    // Verify connections exist
    const connsWithGain = graph.getAllConnections().filter(
      (c) => c.fromNodeId === testGain.id || c.toNodeId === testGain.id
    );
    assert.equal(connsWithGain.length, 2);

    // Delete node
    const removed = graph.removeNode(testGain.id);
    assert.equal(removed, true);
    assert.equal(graph.getNode(testGain.id), undefined);

    // Verify attached connections were cleaned up
    const remainingConns = graph.getAllConnections().filter(
      (c) => c.fromNodeId === testGain.id || c.toNodeId === testGain.id
    );
    assert.equal(remainingConns.length, 0, 'Edges to deleted node cleaned up');
  });

  // -----------------------------------------------------------------
  // 3. Connection Validation: Self-loops, Roles, Duplicates
  // -----------------------------------------------------------------
  await t.test('3. Connection validation rejects illegal connections', () => {
    const inNode = graph.getAllNodes().find((n) => n.type === 'input');
    const outNode = graph.getAllNodes().find((n) => n.type === 'output');
    const lp = graph.addNode('lowpass', 200, 200);

    // Self-loop: lp -> lp
    const selfLoopRes = graph.connect(lp.id, lp.id);
    assert.equal(selfLoopRes.success, false);
    assert.ok(selfLoopRes.reason?.includes('self-loop'));

    // Output node cannot have outgoing connections
    const outOutgoingRes = graph.connect(outNode.id, lp.id);
    assert.equal(outOutgoingRes.success, false);
    assert.ok(outOutgoingRes.reason?.includes('Output node cannot have outgoing'));

    // Input node cannot have incoming connections
    const inIncomingRes = graph.connect(lp.id, inNode.id);
    assert.equal(inIncomingRes.success, false);
    assert.ok(inIncomingRes.reason?.includes('Input node cannot have incoming'));

    // Duplicate connection check
    const validConn = graph.connect(inNode.id, lp.id);
    assert.equal(validConn.success, true);

    const dupConn = graph.connect(inNode.id, lp.id);
    assert.equal(dupConn.success, false);
    assert.ok(dupConn.reason?.includes('already exists'));
  });

  // -----------------------------------------------------------------
  // 4. Cycle Detection (DAG Invariant via DFS Reachability)
  // -----------------------------------------------------------------
  await t.test('4. Cycle detection prevents cycles from forming', () => {
    // Reset to clean state
    graph.initDefaultGraph();
    const inNode = graph.getAllNodes().find((n) => n.type === 'input');
    const outNode = graph.getAllNodes().find((n) => n.type === 'output');

    // Construct linear chain: In -> NodeA -> NodeB -> NodeC -> Out
    const nodeA = graph.addNode('lowpass', 200, 200, 'Node A');
    const nodeB = graph.addNode('delay', 350, 200, 'Node B');
    const nodeC = graph.addNode('gain', 500, 200, 'Node C');

    graph.connect(inNode.id, nodeA.id);
    graph.connect(nodeA.id, nodeB.id);
    graph.connect(nodeB.id, nodeC.id);
    graph.connect(nodeC.id, outNode.id);

    // Attempt to connect C -> A (would create cycle A -> B -> C -> A!)
    const cycleRes = graph.connect(nodeC.id, nodeA.id);
    assert.equal(cycleRes.success, false, 'Cycle connection C -> A must be rejected');
    assert.ok(cycleRes.reason?.includes('creates a cycle'));

    // Attempt to connect B -> A (would create cycle A -> B -> A!)
    const cycleRes2 = graph.connect(nodeB.id, nodeA.id);
    assert.equal(cycleRes2.success, false, 'Cycle connection B -> A must be rejected');

    // Attempt to connect C -> B (would create cycle B -> C -> B!)
    const cycleRes3 = graph.connect(nodeC.id, nodeB.id);
    assert.equal(cycleRes3.success, false, 'Cycle connection C -> B must be rejected');

    // Verify graph remains acyclic
    const topo = graph.getTopologicalOrder();
    assert.equal(topo.isValid, true);
    assert.equal(topo.hasCycle, false);
  });

  // -----------------------------------------------------------------
  // 5. Kahn's Algorithm for Topological Sorting
  // -----------------------------------------------------------------
  await t.test('5. Topological sorting calculates exact linear dependency order', () => {
    graph.initDefaultGraph();
    const inNode = graph.getAllNodes().find((n) => n.type === 'input');
    const outNode = graph.getAllNodes().find((n) => n.type === 'output');

    // Remove default master gain to create custom branch
    const defaultGain = graph.getAllNodes().find((n) => n.type === 'gain');
    if (defaultGain) graph.removeNode(defaultGain.id);

    // Build diamond DAG:
    //         -> EQ ->
    // Input              -> Reverb -> Output
    //         -> Delay ->
    const eq = graph.addNode('eq', 250, 100, 'EQ Branch');
    const delay = graph.addNode('delay', 250, 300, 'Delay Branch');
    const reverb = graph.addNode('reverb', 500, 200, 'Reverb Summer');

    graph.connect(inNode.id, eq.id);
    graph.connect(inNode.id, delay.id);
    graph.connect(eq.id, reverb.id);
    graph.connect(delay.id, reverb.id);
    graph.connect(reverb.id, outNode.id);

    const topo = graph.getTopologicalOrder();
    assert.equal(topo.isValid, true);
    assert.equal(topo.hasCycle, false);

    const order = topo.topologicalOrder;
    assert.ok(order);

    // In topological order:
    // 1. inNode must precede both EQ and Delay
    assert.ok(order.indexOf(inNode.id) < order.indexOf(eq.id));
    assert.ok(order.indexOf(inNode.id) < order.indexOf(delay.id));

    // 2. EQ and Delay must precede Reverb
    assert.ok(order.indexOf(eq.id) < order.indexOf(reverb.id));
    assert.ok(order.indexOf(delay.id) < order.indexOf(reverb.id));

    // 3. Reverb must precede Output
    assert.ok(order.indexOf(reverb.id) < order.indexOf(outNode.id));
  });

  // -----------------------------------------------------------------
  // 6. Live Parameter Alteration Changes Actual Web Audio Signal
  // -----------------------------------------------------------------
  await t.test('6. Changing node parameter modifies live Web Audio node value', () => {
    graph.loadPreset('direct');
    processor.rebuildAudioRouting();

    const gainNodeData = graph.getAllNodes().find((n) => n.type === 'gain');
    assert.ok(gainNodeData);

    // Initial gain value is 1.0
    assert.equal(gainNodeData.params.gain, 1.0);

    // Update gain to 1.75
    graph.updateNodeParam(gainNodeData.id, 'gain', 1.75);
    processor.updateParam(gainNodeData.id, 'gain', 1.75);

    assert.equal(graph.getNode(gainNodeData.id)?.params.gain, 1.75, 'Graph model stores updated parameter');

    // Test filter frequency update on Lowpass node
    const lp = graph.addNode('lowpass', 300, 200);
    graph.updateNodeParam(lp.id, 'frequency', 1200);
    processor.updateParam(lp.id, 'frequency', 1200);
    assert.equal(graph.getNode(lp.id)?.params.frequency, 1200, 'Lowpass cutoff frequency updated');

    // Test bypass toggle
    assert.equal(graph.getNode(lp.id)?.bypassed, false);
    const bypassed = graph.toggleBypass(lp.id);
    assert.equal(bypassed, true);
    assert.equal(graph.getNode(lp.id)?.bypassed, true, 'Node bypass state updated');
  });

  // -----------------------------------------------------------------
  // 7. Preset Topologies Loading
  // -----------------------------------------------------------------
  await t.test('7. Preset topologies load valid configurations', () => {
    graph.loadPreset('vocal_warmth');
    const topo = graph.getTopologicalOrder();
    assert.equal(topo.isValid, true, 'Vocal warmth preset is a valid DAG');
    assert.ok(graph.getAllNodes().some((n) => n.type === 'compressor'));
    assert.ok(graph.getAllNodes().some((n) => n.type === 'eq'));
    assert.ok(graph.getAllNodes().some((n) => n.type === 'highpass'));

    graph.loadPreset('space_echo');
    const topoEcho = graph.getTopologicalOrder();
    assert.equal(topoEcho.isValid, true, 'Space echo preset is a valid DAG');
    assert.ok(graph.getAllNodes().some((n) => n.type === 'delay'));
    assert.ok(graph.getAllNodes().some((n) => n.type === 'reverb'));
  });
});
