// Wires the review session to the real Google Photos API: discards, album changes and
// Locked Folder moves go through the write queue, and the bookmark is saved locally and to
// the progress album.

import * as api from '../api';
import type { MediaItem } from '../api/library';
import {
  getMeta,
  getScanState,
  newItemsBehind,
  putItems,
  setMeta,
  type Cursor,
  type Db,
} from '../db/db';
import { syncIndex, type ScanProgress } from '../db/indexer';
import { cursorOfBookmark, mergeBookmarks, RemoteProgress, type Bookmark } from '../sync/progress';
import { bumpToDeleteCount, resolveToDelete } from '../sync/toDelete';
import { WriteQueue, type Op } from '../sync/writeQueue';
import { AlbumStore } from './albums';
import { ReviewSession } from './session';

const BOOKMARK_KEY = 'bookmark';
/** Photos moved back out of the Locked Folder by undo (they get a fresh upload time). */
const UNLOCKED_KEY = 'unlockedDedups';

/** Notified when a photo comes back from the Locked Folder with a new media key. */
const restoredListeners = new Set<(item: MediaItem) => void>();

async function onLockedChange(db: Db, op: Op) {
  if (op.action === 'add') {
    // It left the library: drop it from the index and forget its album memberships.
    await db.delete('items', op.mediaKey);
    for (const m of await db.getAllFromIndex('memberships', 'byMedia', op.mediaKey)) {
      await db.delete('memberships', [m.albumKey, m.mediaKey]);
    }
    return;
  }
  // Back in the library under a new media key: find it among the newest uploads.
  const unlocked = (await getMeta<string[]>(db, UNLOCKED_KEY)) ?? [];
  await setMeta(db, UNLOCKED_KEY, [...unlocked, op.dedupKey].slice(-500));
  const page = await api.getRecentlyAddedPage(null, 50);
  const restored = page.items.find((i) => i.dedupKey === op.dedupKey);
  if (!restored) return;
  await putItems(db, [restored]);
  for (const l of restoredListeners) l(restored);
}

export interface Review {
  session: ReviewSession;
  queue: WriteQueue;
  albums: AlbumStore;
  /** Saves any pending bookmark to Google Photos now (on close / tab hide). */
  flush(): Promise<void>;
  /** The current bookmark, for "Export progress". */
  exportBookmark(): Bookmark;
  /** Replaces progress with an exported bookmark and restarts the review from it. */
  importBookmark(b: Bookmark): Promise<void>;
}

/** Bookmark meaning "nothing reviewed yet" (sorts before every photo). */
const START: Cursor = { takenAt: -8.64e15, key: '' };

let queuePromise: Promise<WriteQueue> | null = null;

/** The single write queue for this page (shared by the review screen and delete folder). */
export function getQueue(db: Db): Promise<WriteQueue> {
  queuePromise ??= createQueue(db);
  return queuePromise;
}

async function createQueue(db: Db): Promise<WriteQueue> {
  const toDeleteDeps = { listAlbums: api.listAlbums, createAlbum: api.createAlbum };
  const queue = await WriteQueue.load({
    db,
    addToAlbum: api.addToAlbum,
    removeFromAlbum: api.removeFromAlbum,
    resolveToDelete: () => resolveToDelete(db, toDeleteDeps),
    async findAlbumItemKey(albumKey, dedupKey) {
      const items = await api.getAllAlbumItems(albumKey);
      return items.find((i) => i.dedupKey === dedupKey)?.albumItemKey ?? null;
    },
    onCountChange: (albumKey, delta) => bumpToDeleteCount(db, albumKey, delta),
    moveToLockedFolder: api.moveToLockedFolder,
    moveOutOfLockedFolder: api.moveOutOfLockedFolder,
    onLockedChange: (op) => onLockedChange(db, op),
  });
  queue.start();
  return queue;
}

export async function startReview(
  db: Db,
  onProgress: (p: ScanProgress) => void,
  signal: AbortSignal,
): Promise<Review> {
  const remote = new RemoteProgress({
    listAlbums: api.listAlbums,
    createAlbum: api.createAlbum,
    renameAlbum: api.renameAlbum,
  });
  const [queue, localBookmark, remoteBookmark] = await Promise.all([
    getQueue(db),
    getMeta<Bookmark | null>(db, BOOKMARK_KEY),
    remote.read(),
  ]);
  const start = mergeBookmarks(localBookmark ?? null, remoteBookmark);

  await syncIndex(db, api, onProgress, signal);
  const syncedUntil = (await getScanState(db)).syncedUploadsUntil ?? Date.now();

  const cursor = start ? cursorOfBookmark(start) : null;
  const unlocked = new Set((await getMeta<string[]>(db, UNLOCKED_KEY)) ?? []);
  const catchup = start
    ? (await newItemsBehind(db, cursor, start.s)).filter((i) => !unlocked.has(i.dedupKey))
    : [];
  // Upload horizon to record in the bookmark: once the catch-up list is done, everything
  // in this device's index is accounted for.
  let horizon = catchup.length > 0 && start ? start.s : syncedUntil;
  let lastCursor: Cursor | null = cursor;

  const bookmarkOf = (c: Cursor | null): Bookmark => {
    const at = c ?? START;
    return { v: 1, t: at.takenAt, k: at.key, s: horizon, u: Date.now() };
  };
  const save = (c: Cursor | null) => {
    lastCursor = c;
    // Undoing back past the first photo saves START, so other devices go back too.
    const bookmark = bookmarkOf(c);
    void setMeta(db, BOOKMARK_KEY, bookmark);
    remote.write(bookmark);
  };

  const session = new ReviewSession(db, {
    discard: (item) => void queue.enqueue('add', { kind: 'toDelete' }, item),
    undoDiscard: (item) => void queue.enqueue('remove', { kind: 'toDelete' }, item),
    lock: (item) => void queue.enqueue('add', { kind: 'lockedFolder' }, item),
    undoLock: (item) => void queue.enqueue('remove', { kind: 'lockedFolder' }, item),
    saveCursor: save,
    catchupDone: () => {
      horizon = syncedUntil;
      save(lastCursor);
    },
  });
  await session.load(cursor, catchup);
  restoredListeners.clear();
  restoredListeners.add((item) => session.replaceItem(item.dedupKey, item));

  // Local copy may be ahead of Google's (e.g. saved offline); push it.
  if (start && start !== remoteBookmark) remote.write(start);

  return {
    session,
    queue,
    albums: new AlbumStore(db, queue),
    flush: () => remote.flush(),
    exportBookmark: () => bookmarkOf(lastCursor),
    async importBookmark(b) {
      horizon = b.s;
      const c = cursorOfBookmark(b);
      save(c);
      await session.load(c, await newItemsBehind(db, c, b.s));
    },
  };
}
