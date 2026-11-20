import { AudioClip } from './types';

export class ClipNode {
  clip: AudioClip;
  prev: ClipNode | null = null;
  next: ClipNode | null = null;

  constructor(clip: AudioClip) {
    this.clip = clip;
  }
}

/**
 * Doubly Linked List maintaining ordered clip arrangement per track.
 * Provides O(1) adjacent clip navigation, splice insertion, and neighbor snapping.
 */
export class ClipLinkedList {
  head: ClipNode | null = null;
  tail: ClipNode | null = null;
  private length: number = 0;

  get count(): number {
    return this.length;
  }

  /**
   * Inserts clip maintaining chronological order of startOffset.
   */
  insert(clip: AudioClip): ClipNode {
    const newNode = new ClipNode(clip);

    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
      this.length++;
      return newNode;
    }

    // If new clip starts before head
    if (clip.startOffset < this.head.clip.startOffset) {
      newNode.next = this.head;
      this.head.prev = newNode;
      this.head = newNode;
      this.length++;
      return newNode;
    }

    // Traverse to find insertion point
    let curr: ClipNode | null = this.head;
    while (curr.next && curr.next.clip.startOffset <= clip.startOffset) {
      curr = curr.next;
    }

    // Insert after curr
    newNode.next = curr.next;
    newNode.prev = curr;
    if (curr.next) {
      curr.next.prev = newNode;
    } else {
      this.tail = newNode;
    }
    curr.next = newNode;

    this.length++;
    return newNode;
  }

  remove(clipId: string): boolean {
    const node = this.find(clipId);
    if (!node) return false;

    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
    this.length--;
    return true;
  }

  find(clipId: string): ClipNode | null {
    let curr = this.head;
    while (curr) {
      if (curr.clip.id === clipId) return curr;
      curr = curr.next;
    }
    return null;
  }

  getAdjacent(clipId: string): { prev: AudioClip | null; next: AudioClip | null } {
    const node = this.find(clipId);
    if (!node) return { prev: null, next: null };
    return {
      prev: node.prev ? node.prev.clip : null,
      next: node.next ? node.next.clip : null,
    };
  }

  toArray(): AudioClip[] {
    const result: AudioClip[] = [];
    let curr = this.head;
    while (curr) {
      result.push(curr.clip);
      curr = curr.next;
    }
    return result;
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
}
