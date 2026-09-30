// Cross-device progress: the review bookmark is stored in the title of a dedicated album,
// "SnapSort · progress {json}", so any browser signed in to the same Google account sees it.

import type { Album } from '../api/albums';
import type { Cursor } from '../db/db';

export const PROGRESS_PREFIX = 'SnapSort · progress';

export interface Bookmark {
  v: 1;
  /** Review cursor: everything up to (takenAt, key) has been reviewed. */
  t: number;
  k: string;
  /**
   * Uploads before this time were in the reviewing device's index, so anything uploaded
   * earlier and taken before the cursor has been reviewed. Newer uploads taken before the
   * cursor are shown as "New since last time".
   */
  s: number;
  /** When the bookmark was written. */
  u: number;
}

export function isProgressTitle(title: string): boolean {
  return title.startsWith(PROGRESS_PREFIX);
}

export function encodeBookmark(b: Bookmark): string {
  return `${PROGRESS_PREFIX} ${JSON.stringify(b)}`;
}

export function decodeBookmark(title: string): Bookmark | null {
  if (!isProgressTitle(title)) return null;
  try {
    const b = JSON.parse(title.slice(PROGRESS_PREFIX.length).trim()) as Partial<Bookmark>;
    if (b.v !== 1 || typeof b.t !== 'number' || typeof b.k !== 'string') return null;
    return { v: 1, t: b.t, k: b.k, s: typeof b.s === 'number' ? b.s : 0, u: b.u ?? 0 };
  } catch {
    return null;
  }
}

export function compareCursors(a: Cursor | null, b: Cursor | null): number {
  if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
  return a.takenAt - b.takenAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export const cursorOfBookmark = (b: Bookmark): Cursor => ({ takenAt: b.t, key: b.k });

/**
 * Combine the local and remote bookmarks: the cursor that's further ahead wins, and the
 * upload horizon comes with it (it describes what that device had reviewed).
 */
export function mergeBookmarks(local: Bookmark | null, remote: Bookmark | null): Bookmark | null {
  if (!local) return remote;
  if (!remote) return local;
  const c = compareCursors(cursorOfBookmark(local), cursorOfBookmark(remote));
  if (c !== 0) return c > 0 ? local : remote;
  return local.s >= remote.s ? local : remote;
}

export interface ProgressDeps {
  listAlbums(): Promise<Album[]>;
  createAlbum(title: string): Promise<string>;
  renameAlbum(albumKey: string, title: string): Promise<void>;
}

/** Reads and writes the bookmark album. Writes are debounced; call flush() before leaving. */
export class RemoteProgress {
  private albumKey: string | null = null;
  private pending: Bookmark | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  lastError: string | null = null;

  constructor(
    private deps: ProgressDeps,
    private debounceMs = 5000,
  ) {}

  async read(): Promise<Bookmark | null> {
    const albums = (await this.deps.listAlbums()).filter((a) => isProgressTitle(a.title));
    // If several exist (e.g. created concurrently on two devices), use the furthest ahead.
    let best: Bookmark | null = null;
    for (const a of albums) {
      const b = decodeBookmark(a.title);
      if (b && mergeBookmarks(best, b) === b) {
        best = b;
        this.albumKey = a.key;
      }
    }
    this.albumKey ??= albums[0]?.key ?? null;
    return best;
  }

  write(bookmark: Bookmark) {
    this.pending = bookmark;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const b = this.pending;
    if (!b) return this.writing;
    this.pending = null;
    this.writing = this.writing.then(async () => {
      try {
        const title = encodeBookmark(b);
        if (this.albumKey) await this.deps.renameAlbum(this.albumKey, title);
        else this.albumKey = await this.deps.createAlbum(title);
        this.lastError = null;
      } catch (err) {
        this.lastError = String(err);
        // Keep it for the next attempt unless a newer bookmark arrived meanwhile.
        this.pending ??= b;
      }
    });
    return this.writing;
  }
}
