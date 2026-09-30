// A persistent queue of changes to make in Google Photos (add to / remove from albums, move
// into / out of the Locked Folder).
//
// Swipes update the screen immediately; the Google calls happen here in the background, one
// at a time, and survive reloads (the queue is stored in IndexedDB). An add followed by a
// remove of the same photo before either is sent cancels out.

import type { MediaItem } from '../api/library';
import { ApiShapeError } from '../api/rpc';
import { getMeta, setMeta, type Db, type Membership } from '../db/db';

/**
 * Where an op goes: SnapSort's "🗑 To Delete" album (resolved at send time), a given album,
 * or the Locked Folder ("add" moves in, "remove" moves out).
 */
export type Target =
  { kind: 'toDelete' } | { kind: 'album'; albumKey: string } | { kind: 'lockedFolder' };

export interface Op {
  id: number;
  action: 'add' | 'remove';
  target: Target;
  mediaKey: string;
  dedupKey: string;
}

export interface WriteQueueDeps {
  db: Db;
  addToAlbum(albumKey: string, mediaKeys: string[]): Promise<Map<string, string>>;
  removeFromAlbum(albumItemKeys: string[]): Promise<void>;
  /** Album key for new discards (creates / rolls over "🗑 To Delete" as needed). */
  resolveToDelete(): Promise<string>;
  /** Fallback when we don't know a photo's album-item key: look it up in the album. */
  findAlbumItemKey(albumKey: string, dedupKey: string): Promise<string | null>;
  onCountChange?(albumKey: string, delta: number): Promise<void>;
  moveToLockedFolder(dedupKeys: string[]): Promise<void>;
  moveOutOfLockedFolder(dedupKeys: string[]): Promise<void>;
  /** Called after a Locked Folder move has been sent. */
  onLockedChange?(op: Op): Promise<void>;
}

export interface QueueStatus {
  pending: number;
  error: string | null;
  /** Stopped because Google's responses changed shape; needs a SnapSort update. */
  broken: boolean;
}

const META_KEY = 'writeQueue';
const MAX_BACKOFF_MS = 60_000;

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind !== 'album' || a.albumKey === (b as { albumKey: string }).albumKey);

export class WriteQueue {
  private ops: Op[] = [];
  private nextId = 1;
  private inFlight: number | null = null;
  private running = false;
  private error: string | null = null;
  private broken = false;
  private failures = 0;
  private listeners = new Set<() => void>();
  private idleWaiters: (() => void)[] = [];

  private constructor(private deps: WriteQueueDeps) {}

  static async load(deps: WriteQueueDeps): Promise<WriteQueue> {
    const q = new WriteQueue(deps);
    q.ops = (await getMeta<Op[]>(deps.db, META_KEY)) ?? [];
    q.nextId = Math.max(0, ...q.ops.map((o) => o.id)) + 1;
    return q;
  }

  get status(): QueueStatus {
    return { pending: this.ops.length, error: this.error, broken: this.broken };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private async persist() {
    await setMeta(this.deps.db, META_KEY, this.ops);
  }

  async enqueue(action: Op['action'], target: Target, item: Pick<MediaItem, 'key' | 'dedupKey'>) {
    const opposite = action === 'add' ? 'remove' : 'add';
    const idx = this.ops.findIndex(
      (o) =>
        o.id !== this.inFlight &&
        o.mediaKey === item.key &&
        o.action === opposite &&
        sameTarget(o.target, target),
    );
    if (idx !== -1) {
      this.ops.splice(idx, 1);
    } else {
      this.ops.push({
        id: this.nextId++,
        action,
        target,
        mediaKey: item.key,
        dedupKey: item.dedupKey,
      });
    }
    await this.persist();
    this.emit();
    void this.pump();
  }

  /** Albums this photo will be in / out of once pending ops are sent (excludes To Delete). */
  pendingAlbumChanges(mediaKey: string): { added: Set<string>; removed: Set<string> } {
    const added = new Set<string>();
    const removed = new Set<string>();
    for (const o of this.ops) {
      if (o.mediaKey !== mediaKey || o.target.kind !== 'album') continue;
      const key = o.target.albumKey;
      if (o.action === 'add') {
        added.add(key);
        removed.delete(key);
      } else {
        removed.add(key);
        added.delete(key);
      }
    }
    return { added, removed };
  }

  /** Starts sending (also resumes ops left over from a previous page load). */
  start() {
    void this.pump();
  }

  /** Resolves when the queue is empty (or stopped by an error). */
  idle(): Promise<void> {
    if (this.ops.length === 0 || this.broken) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async pump() {
    if (this.running || this.broken) return;
    this.running = true;
    try {
      while (this.ops.length > 0 && !this.broken) {
        const op = this.ops[0]!;
        this.inFlight = op.id;
        try {
          await this.send(op);
          this.ops.shift();
          this.failures = 0;
          this.error = null;
          await this.persist();
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
          if (err instanceof ApiShapeError) {
            this.broken = true;
          } else {
            this.failures++;
            this.emit();
            await new Promise((r) =>
              setTimeout(r, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures)),
            );
          }
        } finally {
          this.inFlight = null;
        }
        this.emit();
      }
    } finally {
      this.running = false;
      if (this.ops.length === 0 || this.broken) {
        for (const w of this.idleWaiters.splice(0)) w();
      }
    }
  }

  /** True if a move of this photo into the Locked Folder is waiting to be sent. */
  hasPendingLock(mediaKey: string): boolean {
    return this.ops.some(
      (o) =>
        o.id !== this.inFlight &&
        o.mediaKey === mediaKey &&
        o.action === 'add' &&
        o.target.kind === 'lockedFolder',
    );
  }

  private async send(op: Op) {
    const { db } = this.deps;
    if (op.target.kind === 'lockedFolder') {
      if (op.action === 'add') await this.deps.moveToLockedFolder([op.dedupKey]);
      else await this.deps.moveOutOfLockedFolder([op.dedupKey]);
      await this.deps.onLockedChange?.(op);
      return;
    }
    if (op.action === 'add') {
      const albumKey =
        op.target.kind === 'toDelete' ? await this.deps.resolveToDelete() : op.target.albumKey;
      const added = await this.deps.addToAlbum(albumKey, [op.mediaKey]);
      const albumItemKey = added.get(op.mediaKey);
      if (albumItemKey) {
        const m: Membership = {
          albumKey,
          mediaKey: op.mediaKey,
          albumItemKey,
          toDelete: op.target.kind === 'toDelete',
        };
        await db.put('memberships', m);
      }
      await this.deps.onCountChange?.(albumKey, 1);
      return;
    }

    // Remove: find which album the photo went into and its album-item key.
    const target = op.target;
    const memberships = await db.getAllFromIndex('memberships', 'byMedia', op.mediaKey);
    const m = memberships.find((x) =>
      target.kind === 'toDelete' ? x.toDelete : x.albumKey === target.albumKey,
    );
    let albumKey = m?.albumKey ?? (target.kind === 'album' ? target.albumKey : null);
    let albumItemKey = m?.albumItemKey ?? null;
    if (!albumItemKey && target.kind === 'toDelete') albumKey = await this.deps.resolveToDelete();
    if (!albumItemKey && albumKey) {
      albumItemKey = await this.deps.findAlbumItemKey(albumKey, op.dedupKey);
    }
    if (albumItemKey) await this.deps.removeFromAlbum([albumItemKey]);
    if (m) await db.delete('memberships', [m.albumKey, m.mediaKey]);
    if (albumKey && albumItemKey) await this.deps.onCountChange?.(albumKey, -1);
  }
}
