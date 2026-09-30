import { arr, findExtension, num, optNum, optStr, str } from './parse';
import { call } from './rpc';
import { RPC } from './rpcids';

export interface MediaItem {
  /** Library media key ("AF1Qip…"). Used for item info and adding to albums. */
  key: string;
  /** Dedup key. Used for trash / restore, and to match an item inside an album. */
  dedupKey: string;
  /** When the photo was taken (ms since epoch, UTC). */
  takenAt: number;
  /** Timezone offset of takenAt, in ms. */
  tzOffsetMs: number;
  /** When the item was uploaded to Google Photos (ms since epoch). */
  uploadedAt: number;
  width: number;
  height: number;
  /** Image URL without size suffix; append e.g. `=w1600-h1600`. */
  baseUrl: string;
  isVideo: boolean;
  /** Video length in ms, when known. */
  durationMs: number | null;
}

export interface LibraryPage {
  items: MediaItem[];
  nextPageToken: string | null;
}

/** Field id of the video extension on an item row: [durationMs, null, width, height, …]. */
const VIDEO_FIELD = '76647426';

export function parseMediaRow(value: unknown): MediaItem {
  const row = arr(value, 'media row');
  const image = arr(row[1], 'media row image');
  const video = findExtension(row, VIDEO_FIELD);
  return {
    key: str(row[0], 'media key'),
    dedupKey: str(row[3], 'dedup key'),
    takenAt: num(row[2], 'taken time'),
    tzOffsetMs: optNum(row[4]) ?? 0,
    uploadedAt: num(row[5], 'upload time'),
    width: num(image[1], 'width'),
    height: num(image[2], 'height'),
    baseUrl: str(image[0], 'image url'),
    isVideo: video !== undefined,
    durationMs: Array.isArray(video) ? optNum(video[0]) : null,
  };
}

export function parseLibraryPage(value: unknown): LibraryPage {
  const res = arr(value, 'library page');
  const rows = res[0] == null ? [] : arr(res[0], 'library items');
  return { items: rows.map(parseMediaRow), nextPageToken: optStr(res[1]) };
}

/** One page of the library, newest first. Pass the previous page's token to continue. */
export async function getLibraryPage(pageToken: string | null = null): Promise<LibraryPage> {
  return parseLibraryPage(await call(RPC.listLibrary, [pageToken, null, null, null, 1, 1]));
}

/**
 * The "Recently added" search, as sent by photos.google.com. Positions: [2] page token,
 * [4] page size. Rows have the same leading fields as library rows.
 */
function recentlyAddedRequest(pageToken: string | null, pageSize: number): unknown[] {
  const emptyFilter: null[] = Array(13).fill(null);
  return [null, null, pageToken, null, pageSize, null, null, [null, [[[...emptyFilter, [[[]]]]]]]];
}

/** One page of the library ordered by upload time, newest upload first. */
export async function getRecentlyAddedPage(
  pageToken: string | null = null,
  pageSize = 300,
): Promise<LibraryPage> {
  return parseLibraryPage(await call(RPC.searchItems, recentlyAddedRequest(pageToken, pageSize)));
}

export interface ItemInfo {
  key: string;
  filename: string;
  sizeBytes: number | null;
  description: string | null;
}

export function parseItemInfo(value: unknown): ItemInfo {
  const row = arr(arr(value, 'item info')[0], 'item info row');
  return {
    key: str(row[0], 'item info key'),
    description: optStr(row[1]),
    filename: str(row[2], 'filename'),
    sizeBytes: optNum(row[5]),
  };
}

export async function getItemInfo(key: string): Promise<ItemInfo> {
  return parseItemInfo(await call(RPC.itemInfo, [key]));
}
