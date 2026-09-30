// Builds and refreshes the local library index.
//
// Full scan: pages through the timeline (newest taken → oldest), storing each page and the
// next page token, so a closed tab resumes where it stopped.
// Refresh: pages through "Recently added" (newest upload first) until reaching uploads that
// were already synced. This also catches new uploads with old taken dates.

import type { LibraryPage } from '../api/library';
import { getScanState, putItems, setScanState, type Db } from './db';

export interface LibrarySource {
  getLibraryPage(pageToken: string | null): Promise<LibraryPage>;
  getRecentlyAddedPage(pageToken: string | null): Promise<LibraryPage>;
}

export interface ScanProgress {
  phase: 'full' | 'refresh';
  itemsFetched: number;
  /** For full scans: taken time of the oldest item reached so far. */
  reachedTakenAt: number | null;
}

/** Uploads within this window before the last sync are re-fetched, to absorb clock skew. */
const SYNC_OVERLAP_MS = 10 * 60 * 1000;

export async function runFullScan(
  db: Db,
  source: LibrarySource,
  onProgress: (p: ScanProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const state = await getScanState(db);
  if (state.full.status === 'done') return;
  if (state.full.status === 'never') {
    state.full = {
      status: 'running',
      pageToken: null,
      startedAt: Date.now(),
      finishedAt: null,
      reachedTakenAt: null,
    };
    await setScanState(db, state);
  }

  let fetched = 0;
  for (;;) {
    signal?.throwIfAborted();
    const page = await source.getLibraryPage(state.full.pageToken);
    await putItems(db, page.items);
    fetched += page.items.length;
    const oldest = page.items.at(-1);
    if (oldest) state.full.reachedTakenAt = oldest.takenAt;
    state.full.pageToken = page.nextPageToken;
    if (!page.nextPageToken) {
      state.full.status = 'done';
      state.full.finishedAt = Date.now();
      // Everything uploaded before the scan started is now indexed.
      state.syncedUploadsUntil ??= state.full.startedAt;
    }
    await setScanState(db, state);
    onProgress({ phase: 'full', itemsFetched: fetched, reachedTakenAt: state.full.reachedTakenAt });
    if (!page.nextPageToken) return;
  }
}

/** Fetches items uploaded since the last sync. Returns how many were added or updated. */
export async function refreshRecent(
  db: Db,
  source: LibrarySource,
  onProgress: (p: ScanProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<number> {
  const state = await getScanState(db);
  if (state.syncedUploadsUntil == null) return 0;
  const since = state.syncedUploadsUntil - SYNC_OVERLAP_MS;
  const startedAt = Date.now();

  let token: string | null = null;
  let fetched = 0;
  do {
    signal?.throwIfAborted();
    const page = await source.getRecentlyAddedPage(token);
    const fresh = page.items.filter((item) => item.uploadedAt >= since);
    await putItems(db, fresh);
    fetched += fresh.length;
    onProgress({ phase: 'refresh', itemsFetched: fetched, reachedTakenAt: null });
    // Pages are newest upload first; once one contains older uploads we're caught up.
    if (fresh.length < page.items.length) break;
    token = page.nextPageToken;
  } while (token);

  const latest = await getScanState(db);
  latest.syncedUploadsUntil = startedAt;
  await setScanState(db, latest);
  return fetched;
}

/** Runs whatever is needed to bring the index up to date. */
export async function syncIndex(
  db: Db,
  source: LibrarySource,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const state = await getScanState(db);
  const fullScanWasDone = state.full.status === 'done';
  await runFullScan(db, source, onProgress, signal);
  if (fullScanWasDone) await refreshRecent(db, source, onProgress, signal);
}
