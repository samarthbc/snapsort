// The "🗑 To Delete" album(s). Google Photos albums hold at most 20,000 items, so when one
// fills up SnapSort continues in "🗑 To Delete 2", "🗑 To Delete 3", …

import type { Album } from '../api/albums';
import { getMeta, setMeta, type Db } from '../db/db';

export const TO_DELETE_TITLE = '🗑 To Delete';
/** Stay a little under Google's 20,000-item album limit. */
export const TO_DELETE_LIMIT = 19_900;

export interface ToDeleteState {
  /** All To Delete albums, in order. The last one is where new discards go. */
  albums: { key: string; title: string; count: number }[];
}

export interface ToDeleteDeps {
  listAlbums(): Promise<Album[]>;
  createAlbum(title: string): Promise<string>;
}

const META_KEY = 'toDelete';

export function toDeleteTitle(n: number): string {
  return n <= 1 ? TO_DELETE_TITLE : `${TO_DELETE_TITLE} ${n}`;
}

export function isToDeleteTitle(title: string): boolean {
  return title === TO_DELETE_TITLE || /^🗑 To Delete \d+$/.test(title);
}

function titleNumber(title: string): number {
  return title === TO_DELETE_TITLE ? 1 : Number(title.slice(TO_DELETE_TITLE.length + 1));
}

/** Finds SnapSort's To Delete albums in the user's album list, in order. */
export async function discoverToDelete(deps: ToDeleteDeps): Promise<ToDeleteState> {
  const albums = (await deps.listAlbums())
    .filter((a) => isToDeleteTitle(a.title))
    .sort((a, b) => titleNumber(a.title) - titleNumber(b.title))
    .map((a) => ({ key: a.key, title: a.title, count: a.itemCount }));
  return { albums };
}

export async function getToDeleteState(db: Db): Promise<ToDeleteState | undefined> {
  return getMeta<ToDeleteState>(db, META_KEY);
}

export async function isToDeleteAlbum(db: Db, albumKey: string): Promise<boolean> {
  return !!(await getToDeleteState(db))?.albums.some((a) => a.key === albumKey);
}

/** The album key new discards should go into, creating or rolling over albums as needed. */
export async function resolveToDelete(db: Db, deps: ToDeleteDeps): Promise<string> {
  let state = await getToDeleteState(db);
  if (!state || state.albums.length === 0) {
    state = await discoverToDelete(deps);
  }
  let current = state.albums.at(-1);
  if (!current || current.count >= TO_DELETE_LIMIT) {
    const title = toDeleteTitle(state.albums.length + 1);
    current = { key: await deps.createAlbum(title), title, count: 0 };
    state.albums.push(current);
  }
  await setMeta(db, META_KEY, state);
  return current.key;
}

/** Adjust the local item count of a To Delete album after adds/removes. */
export async function bumpToDeleteCount(db: Db, albumKey: string, delta: number): Promise<void> {
  const state = await getToDeleteState(db);
  const album = state?.albums.find((a) => a.key === albumKey);
  if (!state || !album) return;
  album.count = Math.max(0, album.count + delta);
  await setMeta(db, META_KEY, state);
}
