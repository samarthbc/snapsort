import { arr, findExtension, num, optNum, optStr, str } from './parse';
import { ApiShapeError, call } from './rpc';
import { RPC } from './rpcids';

export interface Album {
  key: string;
  title: string;
  itemCount: number;
}

/** Field id of album metadata on an album-list row: [?, title, times, itemCount, …]. */
const ALBUM_META_FIELD = '72930366';

export function parseAlbumList(value: unknown): { albums: Album[]; nextPageToken: string | null } {
  const res = arr(value, 'album list');
  const rows = res[0] == null ? [] : arr(res[0], 'album rows');
  const albums = rows.map((r) => {
    const row = arr(r, 'album row');
    const meta = arr(findExtension(row, ALBUM_META_FIELD), 'album meta');
    return {
      key: str(row[0], 'album key'),
      title: optStr(meta[1]) ?? '',
      itemCount: optNum(meta[3]) ?? 0,
    };
  });
  return { albums, nextPageToken: optStr(res[1]) };
}

export async function listAlbums(): Promise<Album[]> {
  const all: Album[] = [];
  let token: string | null = null;
  do {
    const page = parseAlbumList(await call(RPC.listAlbums, token ? [token] : []));
    all.push(...page.albums);
    token = page.nextPageToken;
  } while (token);
  return all;
}

export interface AlbumItem {
  /** Key of this item *within the album*; needed to remove it from the album. */
  albumItemKey: string;
  /** Matches MediaItem.dedupKey of the library item. */
  dedupKey: string;
  takenAt: number;
  baseUrl: string;
  width: number;
  height: number;
}

export interface AlbumPage {
  title: string;
  items: AlbumItem[];
  nextPageToken: string | null;
}

export function parseAlbumPage(value: unknown): AlbumPage {
  const res = arr(value, 'album page');
  const rows = res[1] == null ? [] : arr(res[1], 'album items');
  const meta = arr(res[3], 'album page meta');
  return {
    title: optStr(meta[1]) ?? '',
    items: rows.map((r) => {
      const row = arr(r, 'album item');
      const image = arr(row[1], 'album item image');
      return {
        albumItemKey: str(row[0], 'album item key'),
        dedupKey: str(row[3], 'album item dedup key'),
        takenAt: num(row[2], 'album item taken time'),
        baseUrl: str(image[0], 'album item url'),
        width: num(image[1], 'album item width'),
        height: num(image[2], 'album item height'),
      };
    }),
    nextPageToken: optStr(res[2]),
  };
}

export async function getAlbumPage(albumKey: string, pageToken: string | null = null) {
  return parseAlbumPage(await call(RPC.getAlbum, [albumKey, pageToken, null, null]));
}

export async function getAllAlbumItems(albumKey: string): Promise<AlbumItem[]> {
  const all: AlbumItem[] = [];
  let token: string | null = null;
  do {
    const page = await getAlbumPage(albumKey, token);
    all.push(...page.items);
    token = page.nextPageToken;
  } while (token);
  return all;
}

export async function createAlbum(title: string): Promise<string> {
  const res = arr(await call(RPC.createAlbum, [title, null, 2]), 'create album');
  return str(arr(res[0], 'create album result')[0], 'new album key');
}

/**
 * Adds library items (by media key) to an album. Returns each item's album-item key (needed to
 * remove it again). Adding an item that's already in the album is harmless and returns its
 * existing album-item key.
 */
export async function addToAlbum(
  albumKey: string,
  mediaKeys: string[],
): Promise<Map<string, string>> {
  if (mediaKeys.length === 0) return new Map();
  return parseAddToAlbum(await call(RPC.addToAlbum, [mediaKeys, albumKey]), albumKey);
}

/** Response: [albumKey, [albumItemKeys], [[[mediaKey, albumItemKey, status], …]]]. */
export function parseAddToAlbum(value: unknown, albumKey: string): Map<string, string> {
  const res = arr(value, 'add to album');
  if (res[0] !== albumKey) throw new ApiShapeError('add to album returned a different album');
  const added = new Map<string, string>();
  for (const pair of arr(arr(res[2], 'add to album pairs')[0], 'add to album pair list')) {
    const p = arr(pair, 'add to album pair');
    added.set(str(p[0], 'added media key'), str(p[1], 'added album item key'));
  }
  return added;
}

/** Removes items from an album (by album-item key). The photos stay in the library. */
export async function removeFromAlbum(albumItemKeys: string[]): Promise<void> {
  if (albumItemKeys.length === 0) return;
  await call(RPC.removeFromAlbum, [albumItemKeys]);
}

export async function renameAlbum(albumKey: string, title: string): Promise<void> {
  await call(RPC.renameAlbum, [albumKey, title]);
}
