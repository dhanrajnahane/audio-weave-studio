import { AudioClip } from './types';

export class IntervalNode {
  low: number;
  high: number;
  max: number;
  clip: AudioClip;
  left: IntervalNode | null = null;
  right: IntervalNode | null = null;

  constructor(clip: AudioClip) {
    this.clip = clip;
    this.low = clip.startOffset;
    this.high = clip.startOffset + clip.duration;
    this.max = this.high;
  }
}

/**
 * Augmented Interval Tree Data Structure for non-destructive timeline clips.
 * Detects overlapping clips, boundary collisions, and timeline point intersections in O(log N + K).
 */
export class TimelineIntervalTree {
  private root: IntervalNode | null = null;

  insert(clip: AudioClip): void {
    const newNode = new IntervalNode(clip);
    this.root = this.insertNode(this.root, newNode);
  }

  private insertNode(root: IntervalNode | null, node: IntervalNode): IntervalNode {
    if (!root) return node;

    if (node.low < root.low) {
      root.left = this.insertNode(root.left, node);
    } else {
      root.right = this.insertNode(root.right, node);
    }

    root.max = Math.max(root.high, Math.max(
      root.left ? root.left.max : 0,
      root.right ? root.right.max : 0
    ));

    return root;
  }

  remove(clipId: string): void {
    this.root = this.removeNode(this.root, clipId);
  }

  private removeNode(root: IntervalNode | null, clipId: string): IntervalNode | null {
    if (!root) return null;

    if (root.clip.id === clipId) {
      // Node found: standard BST deletion
      if (!root.left) return root.right;
      if (!root.right) return root.left;

      // Find minimum node in right subtree
      let minLarger = root.right;
      while (minLarger.left) {
        minLarger = minLarger.left;
      }
      root.clip = minLarger.clip;
      root.low = minLarger.low;
      root.high = minLarger.high;
      root.right = this.removeNode(root.right, minLarger.clip.id);
    } else {
      root.left = this.removeNode(root.left, clipId);
      root.right = this.removeNode(root.right, clipId);
    }

    // Update max
    root.max = Math.max(
      root.high,
      Math.max(root.left ? root.left.max : 0, root.right ? root.right.max : 0)
    );

    return root;
  }

  /**
   * Queries all clips that overlap with time interval [start, end].
   * Optionally filtered by trackId.
   */
  queryOverlaps(start: number, end: number, trackId?: string): AudioClip[] {
    const results: AudioClip[] = [];
    this.queryOverlapsSubtree(this.root, start, end, trackId, results);
    return results;
  }

  private queryOverlapsSubtree(
    node: IntervalNode | null,
    start: number,
    end: number,
    trackId: string | undefined,
    results: AudioClip[]
  ): void {
    if (!node) return;

    // Pruning: if max in subtree is <= start, no interval in this subtree can overlap
    if (node.max <= start) return;

    // Check left child if left.max > start
    if (node.left && node.left.max > start) {
      this.queryOverlapsSubtree(node.left, start, end, trackId, results);
    }

    // Check current node overlap: node.low < end && start < node.high
    if (node.low < end && start < node.high) {
      if (!trackId || node.clip.trackId === trackId) {
        results.push(node.clip);
      }
    }

    // Check right child if node.low < end
    if (node.right && node.low < end) {
      this.queryOverlapsSubtree(node.right, start, end, trackId, results);
    }
  }

  /**
   * Queries which clip(s) are active at exact timeline position time.
   */
  queryAtTime(time: number, trackId?: string): AudioClip[] {
    // A point query is an interval query [time, time + 0.0001]
    return this.queryOverlaps(time, time + 0.00001, trackId);
  }

  clear(): void {
    this.root = null;
  }
}
