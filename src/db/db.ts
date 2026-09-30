// Local IndexedDB storage. Content scripts share the page's origin, so this database lives
// under photos.google.com in the browser profile.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MediaItem } from '../api/library';

export interface ScanState {
  /** Full scan of the timeline (newest taken → oldest). */
  full: {
    status: 'never' | 'running' | 'done';
    /** Page token to resume an interrupted scan from. */
    pageToken: string | null;
    startedAt: number | null;
    finishedAt: number | null;
    /** Taken time of the oldest item reached so far (progress indicator). */
    reachedTakenAt: number | null;
  };
  /** Uploads newer than this are fetched by the next refresh. */
  syncedUploadsUntil: number | null;
}

interface SnapSortDB extends DBSchema {
  items: {
    key: string;
    value: MediaItem;
    indexes: { byTaken: [number, string]; byDedup: string; byUploaded: number };
  };
  meta: {
    key: string;
    value: unknown;
  };
  /** Album-item keys of photos SnapSort added to albums, so they can be removed again. */
  memberships: {
    key: [string, string];
    value: Membership;
    indexes: { byMedia: string };
  };
}

export interface Membership {
  albumKey: string;
  mediaKey: string;
  albumItemKey: string;
  /** True when albumKey is one of SnapSort's "🗑 To Delete" albums. */
  toDelete: boolean;
}

export type Db = IDBPDatabase<SnapSortDB>;

const DB_NAME = 'snapsort';

let dbPromise: Promise<Db> | null = null;

export function openDb(name = DB_NAME): Promise<Db> {
  if (name !== DB_NAME) return open(name);
  dbPromise ??= open(name);
  return dbPromise;
}

function open(name: string): Promise<Db> {
  const promise = openDB<SnapSortDB>(name, 3, {
    // A newer SnapSort (e.g. after an extension update) needs to upgrade the database:
    // close this connection so it isn't blocked. This copy stops working until reload.
    blocking() {
      void promise.then((db) => db.close());
      if (dbPromise === promise) dbPromise = null;
    },
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const items = db.createObjectStore('items', { keyPath: 'key' });
        items.createIndex('byTaken', ['takenAt', 'key']);
        items.createIndex('byDedup', 'dedupKey');
        db.createObjectStore('meta');
      }
      if (oldVersion < 2) {
        const m = db.createObjectStore('memberships', { keyPath: ['albumKey', 'mediaKey'] });
        m.createIndex('byMedia', 'mediaKey');
      }
      if (oldVersion < 3) {
        tx.objectStore('items').createIndex('byUploaded', 'uploadedAt');
      }
    },
  });
  return promise;
}

export const initialScanState: ScanState = {
  full: {
    status: 'never',
    pageToken: null,
    startedAt: null,
    finishedAt: null,
    reachedTakenAt: null,
  },
  syncedUploadsUntil: null,
};

export async function getScanState(db: Db): Promise<ScanState> {
  return (
    ((await db.get('meta', 'scan')) as ScanState | undefined) ?? structuredClone(initialScanState)
  );
}

export async function setScanState(db: Db, state: ScanState): Promise<void> {
  await db.put('meta', state, 'scan');
}

export async function putItems(db: Db, items: MediaItem[]): Promise<void> {
  const tx = db.transaction('items', 'readwrite');
  await Promise.all([...items.map((item) => tx.store.put(item)), tx.done]);
}

export async function countItems(db: Db): Promise<number> {
  return db.count('items');
}

export interface Cursor {
  takenAt: number;
  key: string;
}

/** Items in review order (oldest taken first), strictly after `cursor`. */
export async function itemsAfter(
  db: Db,
  cursor: Cursor | null,
  limit: number,
): Promise<MediaItem[]> {
  const range = cursor ? IDBKeyRange.lowerBound([cursor.takenAt, cursor.key], true) : undefined;
  const out: MediaItem[] = [];
  let c = await db.transaction('items').store.index('byTaken').openCursor(range);
  while (c && out.length < limit) {
    out.push(c.value);
    c = await c.continue();
  }
  return out;
}

/** Number of items at or before `cursor` in review order (i.e. already reviewed). */
export async function countUpTo(db: Db, cursor: Cursor | null): Promise<number> {
  if (!cursor) return 0;
  return db.countFromIndex(
    'items',
    'byTaken',
    IDBKeyRange.upperBound([cursor.takenAt, cursor.key]),
  );
}

export async function deleteItem(db: Db, key: string): Promise<void> {
  await db.delete('items', key);
}

export async function getMeta<T>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}

export async function setMeta(db: Db, key: string, value: unknown): Promise<void> {
  await db.put('meta', value, key);
}

export async function getItem(db: Db, key: string): Promise<MediaItem | undefined> {
  return db.get('items', key);
}

/**
 * Items uploaded after `uploadedAfter` that sit at or before `cursor` in review order — i.e.
 * new uploads of older photos, which the main queue has already passed.
 */
export async function newItemsBehind(
  db: Db,
  cursor: Cursor | null,
  uploadedAfter: number,
): Promise<MediaItem[]> {
  if (!cursor) return [];
  const fresh = await db.getAllFromIndex(
    'items',
    'byUploaded',
    IDBKeyRange.lowerBound(uploadedAfter, true),
  );
  return fresh
    .filter(
      (i) => i.takenAt < cursor.takenAt || (i.takenAt === cursor.takenAt && i.key <= cursor.key),
    )
    .sort((a, b) => a.takenAt - b.takenAt || (a.key < b.key ? -1 : 1));
}
