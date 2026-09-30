// Dev-only: an in-memory stand-in for src/api, used by the offline demo page (npm run demo).
// Same exports and signatures as the real module; data is made up.

import type { Album, AlbumItem, AlbumPage } from '../api/albums';
import type { ItemInfo, LibraryPage, MediaItem } from '../api/library';
import { isPortrait, sampleImageUrl } from './images';

export { ApiShapeError, HttpError, RpcError, setSessionProvider, type Session } from '../api/rpc';
export type { Album, AlbumItem, AlbumPage, ItemInfo, LibraryPage, MediaItem };

const DAY = 86_400_000;

// [kind, filename pattern] — images.ts draws a matching picture for each kind.
const KINDS: [string, (d: Date, i: number) => string][] = [
  ['beach', (d) => `IMG_${stamp(d)}_101512.jpg`],
  ['meme', (d, i) => `IMG-${stamp(d)}-WA${String(i).padStart(4, '0')}.jpg`],
  ['screenshot', (d) => `Screenshot_${stamp(d)}-221045.png`],
  ['mountains', (d) => `IMG_${stamp(d)}_074210.jpg`],
  ['goodmorning', (d, i) => `IMG-${stamp(d)}-WA${String(i + 40).padStart(4, '0')}.jpg`],
  ['receipt', (d) => `IMG_${stamp(d)}_193302.jpg`],
  ['sunset', (d) => `IMG_${stamp(d)}_182755.jpg`],
  ['family', (d) => `IMG_${stamp(d)}_131104.jpg`],
];

function stamp(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

const start = Date.UTC(2022, 0, 14, 9, 30);
const items: MediaItem[] = [];
const infos = new Map<string, ItemInfo>();
for (let i = 0; i < 48; i++) {
  const [kind, name] = KINDS[i % KINDS.length]!;
  const takenAt = start + i * 3.3 * DAY + (i % 5) * 3_600_000;
  const key = `K${String(i).padStart(3, '0')}`;
  const portrait = isPortrait(kind);
  items.push({
    key,
    dedupKey: `D${key}`,
    takenAt,
    tzOffsetMs: 19_800_000,
    uploadedAt: takenAt + 60_000,
    width: portrait ? 1080 : 1600,
    height: portrait ? 1920 : 1200,
    baseUrl: sampleImageUrl(kind, i),
    isVideo: false,
    durationMs: null,
  });
  infos.set(key, {
    key,
    filename: name(new Date(takenAt), i),
    sizeBytes: 150_000 + ((i * 7919) % 3_800_000),
    description: null,
  });
}

let nextKey = 1;
const albums = new Map<string, { title: string; items: string[] }>([
  ['A-ooty', { title: 'Ooty trip', items: ['K000', 'K003'] }],
  ['A-family', { title: 'Family', items: ['K007'] }],
  ['A-goa', { title: 'Goa 2022', items: [] }],
  ['A-docs', { title: 'Documents', items: [] }],
]);
const lockedOrTrashed = new Set<string>();

const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 60));
const live = () => items.filter((i) => !lockedOrTrashed.has(i.dedupKey));

export async function getLibraryPage(pageToken: string | null = null): Promise<LibraryPage> {
  const sorted = live().sort((a, b) => b.takenAt - a.takenAt);
  const from = Number(pageToken ?? 0);
  const next = from + 30;
  return delay({
    items: sorted.slice(from, next),
    nextPageToken: next < sorted.length ? String(next) : null,
  });
}

export async function getRecentlyAddedPage(): Promise<LibraryPage> {
  return delay({ items: live().sort((a, b) => b.uploadedAt - a.uploadedAt), nextPageToken: null });
}

export async function getItemInfo(key: string): Promise<ItemInfo> {
  return delay(infos.get(key)!);
}

export async function listAlbums(): Promise<Album[]> {
  return delay([...albums].map(([key, a]) => ({ key, title: a.title, itemCount: a.items.length })));
}

export async function createAlbum(title: string): Promise<string> {
  const key = `A-new-${nextKey++}`;
  albums.set(key, { title, items: [] });
  return delay(key);
}

export async function addToAlbum(albumKey: string, mediaKeys: string[]) {
  const album = albums.get(albumKey)!;
  for (const k of mediaKeys) if (!album.items.includes(k)) album.items.push(k);
  return delay(new Map(mediaKeys.map((k) => [k, `${albumKey}/${k}`])));
}

export async function removeFromAlbum(albumItemKeys: string[]) {
  for (const aik of albumItemKeys) {
    const [albumKey, mediaKey] = aik.split('/');
    const album = albums.get(albumKey!);
    if (album) album.items = album.items.filter((k) => k !== mediaKey);
  }
  return delay(undefined);
}

export async function renameAlbum(albumKey: string, title: string) {
  const album = albums.get(albumKey);
  if (album) album.title = title;
  return delay(undefined);
}

export async function getAlbumPage(albumKey: string): Promise<AlbumPage> {
  const album = albums.get(albumKey)!;
  return delay({
    title: album.title,
    nextPageToken: null,
    items: album.items
      .map((k) => items.find((i) => i.key === k)!)
      .filter((i) => !lockedOrTrashed.has(i.dedupKey))
      .map((i) => ({
        albumItemKey: `${albumKey}/${i.key}`,
        dedupKey: i.dedupKey,
        takenAt: i.takenAt,
        baseUrl: i.baseUrl,
        width: i.width,
        height: i.height,
      })),
  });
}

export async function getAllAlbumItems(albumKey: string): Promise<AlbumItem[]> {
  return (await getAlbumPage(albumKey)).items;
}

export async function moveToTrash(dedupKeys: string[]) {
  for (const d of dedupKeys) lockedOrTrashed.add(d);
  return delay(undefined);
}

export async function restoreFromTrash(dedupKeys: string[]) {
  for (const d of dedupKeys) lockedOrTrashed.delete(d);
  return delay(undefined);
}

export const moveToLockedFolder = moveToTrash;
export const moveOutOfLockedFolder = restoreFromTrash;
