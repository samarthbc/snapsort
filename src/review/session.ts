// Review state, independent of the UI: the queue of upcoming photos (oldest first), the
// bookmark (cursor), and an undo history. Photos uploaded recently but taken before the
// bookmark ("New since last time") are reviewed first, without moving the bookmark. Side
// effects (adding to "To Delete", moving to the Locked Folder, saving the bookmark) are
// injected so they can be swapped in tests.

import type { MediaItem } from '../api/library';
import { countItems, countUpTo, itemsAfter, type Cursor, type Db } from '../db/db';

/** Keep, discard (to "🗑 To Delete"), or move to the Locked Folder. */
export type Decision = 'keep' | 'discard' | 'lock';

export interface ReviewEffects {
  /** The user discarded `item` (e.g. add it to "To Delete"). */
  discard(item: MediaItem): void;
  /** Undo of a discard (e.g. remove it from "To Delete"). */
  undoDiscard(item: MediaItem): void;
  /** The user moved `item` to the Locked Folder. */
  lock?(item: MediaItem): void;
  /** Undo of a Locked Folder move. */
  undoLock?(item: MediaItem): void;
  /** The bookmark moved; persist it. */
  saveCursor(cursor: Cursor | null): void;
  /** Every "New since last time" photo has been reviewed. */
  catchupDone?(): void;
}

export const noEffects: ReviewEffects = {
  discard() {},
  undoDiscard() {},
  saveCursor() {},
};

interface HistoryEntry {
  item: MediaItem;
  decision: Decision;
  cursorBefore: Cursor | null;
  fromCatchup: boolean;
}

const REFILL_BELOW = 8;
const REFILL_SIZE = 30;
const MAX_UNDO = 50;

export const cursorOf = (item: MediaItem): Cursor => ({ takenAt: item.takenAt, key: item.key });

export class ReviewSession {
  /** "New since last time" items, shown before the main queue. */
  catchup: MediaItem[] = [];
  /** Upcoming items after the bookmark. */
  queue: MediaItem[] = [];
  history: HistoryEntry[] = [];
  cursor: Cursor | null = null;
  reviewedCount = 0;
  total = 0;
  private exhausted = false;
  private listeners = new Set<() => void>();

  constructor(
    private db: Db,
    private effects: ReviewEffects = noEffects,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  get current(): MediaItem | null {
    return this.catchup[0] ?? this.queue[0] ?? null;
  }

  /** Upcoming items in display order (for preloading). */
  get upcoming(): MediaItem[] {
    return [...this.catchup, ...this.queue];
  }

  get done(): boolean {
    return this.catchup.length === 0 && this.queue.length === 0 && this.exhausted;
  }

  async load(cursor: Cursor | null, catchup: MediaItem[] = []): Promise<void> {
    this.cursor = cursor;
    this.catchup = [...catchup];
    this.queue = [];
    this.history = [];
    this.exhausted = false;
    [this.total, this.reviewedCount] = await Promise.all([
      countItems(this.db),
      countUpTo(this.db, cursor),
    ]);
    await this.refill();
    this.emit();
  }

  private async refill(): Promise<void> {
    if (this.exhausted || this.queue.length >= REFILL_BELOW) return;
    const last = this.queue.at(-1);
    const from = last ? cursorOf(last) : this.cursor;
    const more = await itemsAfter(this.db, from, REFILL_SIZE);
    if (more.length < REFILL_SIZE) this.exhausted = true;
    this.queue.push(...more);
  }

  async decide(decision: Decision): Promise<void> {
    const fromCatchup = this.catchup.length > 0;
    const item = fromCatchup ? this.catchup.shift() : this.queue.shift();
    if (!item) return;
    this.history.push({ item, decision, cursorBefore: this.cursor, fromCatchup });
    if (this.history.length > MAX_UNDO) this.history.shift();
    if (decision === 'discard') this.effects.discard(item);
    if (decision === 'lock') this.effects.lock?.(item);
    if (fromCatchup) {
      if (this.catchup.length === 0) this.effects.catchupDone?.();
    } else {
      this.cursor = cursorOf(item);
      this.reviewedCount++;
      this.effects.saveCursor(this.cursor);
    }
    this.emit();
    await this.refill();
    this.emit();
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  async undo(): Promise<Decision | null> {
    const entry = this.history.pop();
    if (!entry) return null;
    if (entry.decision === 'discard') this.effects.undoDiscard(entry.item);
    if (entry.decision === 'lock') this.effects.undoLock?.(entry.item);
    if (entry.fromCatchup) {
      this.catchup.unshift(entry.item);
    } else {
      this.queue.unshift(entry.item);
      this.cursor = entry.cursorBefore;
      this.reviewedCount = Math.max(0, this.reviewedCount - 1);
      this.effects.saveCursor(this.cursor);
    }
    this.emit();
    return entry.decision;
  }

  /**
   * Swaps in a new version of a photo (same dedup key), e.g. after moving it back out of the
   * Locked Folder gave it a new media key.
   */
  replaceItem(dedupKey: string, item: MediaItem) {
    const swap = (list: MediaItem[]) => {
      const i = list.findIndex((x) => x.dedupKey === dedupKey);
      if (i !== -1) list[i] = item;
    };
    swap(this.catchup);
    swap(this.queue);
    for (const h of this.history) if (h.item.dedupKey === dedupKey) h.item = item;
    this.emit();
  }
}
