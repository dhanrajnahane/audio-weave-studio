import test from 'node:test';
import assert from 'node:assert/strict';

// Import compiled models
import {
  ClipLinkedList,
  TimelineIntervalTree,
  UndoRedoStack,
  TimelineModel
} from './timeline/TimelineModel.compiled.mjs';
import { AudioGraphModel } from './routing/AudioGraphModel.compiled.mjs';
import { RemixComposerModel } from './remix/RemixComposerModel.compiled.mjs';
import { AudioExportEngine } from './export/AudioExportEngine.compiled.mjs';
import { ProjectManager } from './project/ProjectManager.compiled.mjs';

test('FDS Verification: ClipLinkedList (Doubly Linked List)', async (t) => {
  await t.test('Chronological sorted insertion & neighbor navigation', () => {
    const list = new ClipLinkedList();
    const clip1 = { id: 'c1', trackId: 't1', assetId: 'a1', name: 'Intro', startOffset: 0.0, duration: 4.0, sourceOffset: 0, color: '#fff' };
    const clip2 = { id: 'c2', trackId: 't1', assetId: 'a1', name: 'Verse', startOffset: 8.0, duration: 6.0, sourceOffset: 0, color: '#fff' };
    const clip3 = { id: 'c3', trackId: 't1', assetId: 'a1', name: 'PreChorus', startOffset: 4.0, duration: 4.0, sourceOffset: 0, color: '#fff' };

    list.insert(clip1);
    list.insert(clip2);
    list.insert(clip3); // Out of order insert: should be placed between clip1 and clip2

    assert.equal(list.count, 3);
    const arr = list.toArray();
    assert.deepEqual(arr.map(c => c.id), ['c1', 'c3', 'c2']);

    const adj = list.getAdjacent('c3');
    assert.equal(adj.prev.id, 'c1');
    assert.equal(adj.next.id, 'c2');

    // Remove middle node
    const removed = list.remove('c3');
    assert.equal(removed, true);
    assert.equal(list.count, 2);
    assert.deepEqual(list.toArray().map(c => c.id), ['c1', 'c2']);
    assert.equal(list.getAdjacent('c1').next.id, 'c2');
    assert.equal(list.getAdjacent('c2').prev.id, 'c1');
  });
});

test('FDS Verification: TimelineIntervalTree (Augmented BST)', async (t) => {
  await t.test('Overlap detection & point queries in O(log N + K)', () => {
    const tree = new TimelineIntervalTree();
    const clipA = { id: 'A', trackId: 't1', assetId: 'a1', name: 'A', startOffset: 0.0, duration: 5.0, sourceOffset: 0, color: '#fff' };
    const clipB = { id: 'B', trackId: 't1', assetId: 'a1', name: 'B', startOffset: 10.0, duration: 5.0, sourceOffset: 0, color: '#fff' };
    const clipC = { id: 'C', trackId: 't1', assetId: 'a1', name: 'C', startOffset: 12.0, duration: 8.0, sourceOffset: 0, color: '#fff' };

    tree.insert(clipA); // [0, 5]
    tree.insert(clipB); // [10, 15]
    tree.insert(clipC); // [12, 20]

    // Point query at t=2.5 should find A only
    const at2 = tree.queryAtTime(2.5);
    assert.equal(at2.length, 1);
    assert.equal(at2[0].id, 'A');

    // Interval query [11, 14] should overlap both B [10, 15] and C [12, 20]
    const overlaps = tree.queryOverlaps(11, 14);
    assert.equal(overlaps.length, 2);
    assert.deepEqual(overlaps.map(c => c.id).sort(), ['B', 'C']);

    // Removal
    tree.remove('B');
    const overlapsAfter = tree.queryOverlaps(11, 14);
    assert.equal(overlapsAfter.length, 1);
    assert.equal(overlapsAfter[0].id, 'C');
  });
});

test('FDS Verification: UndoRedoStack (Double Stack)', async (t) => {
  await t.test('LIFO Push, Pop, Invalidation on new command', () => {
    const stack = new UndoRedoStack(10);
    let state = 0;

    const cmd1 = {
      description: 'Add 1',
      execute: () => { state += 1; },
      undo: () => { state -= 1; }
    };
    const cmd2 = {
      description: 'Add 10',
      execute: () => { state += 10; },
      undo: () => { state -= 10; }
    };

    stack.execute(cmd1);
    assert.equal(state, 1);
    stack.execute(cmd2);
    assert.equal(state, 11);

    assert.equal(stack.canUndo(), true);
    assert.equal(stack.canRedo(), false);

    // Undo cmd2
    stack.undo();
    assert.equal(state, 1);
    assert.equal(stack.canRedo(), true);

    // Undo cmd1
    stack.undo();
    assert.equal(state, 0);

    // Redo cmd1
    stack.redo();
    assert.equal(state, 1);

    // New command invalidates redo stack
    const cmd3 = {
      description: 'Add 100',
      execute: () => { state += 100; },
      undo: () => { state -= 100; }
    };
    stack.execute(cmd3);
    assert.equal(state, 101);
    assert.equal(stack.canRedo(), false);
  });
});

test('FDS Verification: AudioGraphModel FIFO Queue (Kahn Topological Sort)', async (t) => {
  await t.test('Queue-based DAG evaluation order & cycle detection', () => {
    const graph = new AudioGraphModel();
    const result = graph.getTopologicalOrder();
    assert.equal(result.isValid, true);
    assert.equal(result.hasCycle, false);
    assert.ok(result.topologicalOrder.length >= 3);

    // First node in Kahn evaluation must be Input
    assert.equal(result.topologicalOrder[0], 'node-input');
    // Last node must be Output
    assert.equal(result.topologicalOrder[result.topologicalOrder.length - 1], 'node-output');

    // Verify Cycle Invariant
    const cycleAttempt = graph.validateConnection('node-output', 'node-input');
    assert.equal(cycleAttempt.valid, false);
  });
});

test('TEST 4: Timeline Operations (Cut, Duplicate, Delete, Move, Undo, Redo)', async (t) => {
  const model = new TimelineModel();
  model.clearAll();

  // Create initial clip on vocals track
  const clip1 = {
    id: 'clip-vocal-1',
    trackId: 'vocals',
    assetId: 'stem-vocals',
    name: 'Vocals',
    startOffset: 0.0,
    duration: 10.0,
    sourceOffset: 0.0,
    color: '#06b6d4'
  };
  model.addClip(clip1);
  assert.equal(model.getAllClips().length, 1);

  await t.test('1. Split / Cut Segment at t=4.0s', () => {
    const splitClips = model.splitClip('clip-vocal-1', 4.0);
    assert.ok(splitClips);
    const [left, right] = splitClips;
    assert.equal(left.duration, 4.0);
    assert.equal(right.duration, 6.0);
    assert.equal(right.startOffset, 4.0);
    assert.equal(model.getAllClips().length, 2);
  });

  await t.test('2. Undo Split Operation', () => {
    assert.equal(model.canUndo(), true);
    model.undo();
    assert.equal(model.getAllClips().length, 1);
    assert.equal(model.getClip('clip-vocal-1').duration, 10.0);
  });

  await t.test('3. Redo Split Operation', () => {
    assert.equal(model.canRedo(), true);
    model.redo();
    assert.equal(model.getAllClips().length, 2);
  });

  await t.test('4. Duplicate Segment', () => {
    const all = model.getAllClips();
    const dup = model.duplicateClip(all[0].id);
    assert.ok(dup);
    assert.equal(model.getAllClips().length, 3);
  });

  await t.test('5. Delete Segment and Undo', () => {
    const all = model.getAllClips();
    const toDeleteId = all[all.length - 1].id;
    model.deleteClip(toDeleteId);
    assert.equal(model.getAllClips().length, 2);

    model.undo();
    assert.equal(model.getAllClips().length, 3);
  });
});
