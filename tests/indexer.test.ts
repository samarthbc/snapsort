import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LibraryPage, MediaItem } from '../src/api/library';
import { countItems, countUpTo, getScanState, itemsAfter, openDb, type Db } from '../src/db/db';
import { refreshRecent, runFullScan, syncIndex, type LibrarySource } from '../src/db/indexer';

let dbCounter = 0;
let db: Db;

beforeEach(async () => {
  db = await openDb(`test-${++dbCounter}`);
});

function item(n: number, takenAt: number, uploadedAt = takenAt): MediaItem {
  return {
    key: `K${n}`,
    dedupKey: `D${n}`,
    takenAt,
    tzOffsetMs: 0,
    uploadedAt,
    width: 100,
    height: 100,
    baseUrl: `https://example.test/${n}`,
    isVideo: false,
    durationMs: null,
  };
}

/** Fake Google: serves `items` in pages of `size`, by taken time and by upload time. */
function fakeSource(items: MediaItem[], size = 2) {
  const calls = { library: 0, recent: 0 };
  const paginate = (sorted: MediaItem[], token: string | null): LibraryPage => {
    const start = token ? Number(token) : 0;
    const end = start + size;
    return {
      items: sorted.slice(start, end),
      nextPageToken: end < sorted.length ? String(end) : null,
    };
  };
  const source: LibrarySource & { items: MediaItem[]; calls: typeof calls; failAfter?: number } = {
    items,
    calls,
    async getLibraryPage(token) {
      calls.library++;
      if (source.failAfter !== undefined && calls.library > source.failAfter)
        throw new Error('boom');
      return paginate(
        [...source.items].sort((a, b) => b.takenAt - a.takenAt),
        token,
      );
    },
    async getRecentlyAddedPage(token) {
      calls.recent++;
      return paginate(
        [...source.items].sort((a, b) => b.uploadedAt - a.uploadedAt),
        token,
      );
    },
  };
  return source;
}

describe('full scan', () => {
  it('indexes every item and marks the scan done', async () => {
    const src = fakeSource([item(1, 100), item(2, 200), item(3, 300), item(4, 400), item(5, 500)]);
    await runFullScan(db, src);
    expect(await countItems(db)).toBe(5);
    const state = await getScanState(db);
    expect(state.full.status).toBe('done');
    expect(state.full.reachedTakenAt).toBe(100);
    expect(state.syncedUploadsUntil).toBe(state.full.startedAt);
  });

  it('resumes from the saved page token after an interruption', async () => {
    const src = fakeSource([item(1, 100), item(2, 200), item(3, 300), item(4, 400), item(5, 500)]);
    src.failAfter = 1;
    await expect(runFullScan(db, src)).rejects.toThrow('boom');
    expect(await countItems(db)).toBe(2);
    expect((await getScanState(db)).full.status).toBe('running');

    src.failAfter = undefined;
    src.calls.library = 0;
    await runFullScan(db, src);
    expect(await countItems(db)).toBe(5);
    expect(src.calls.library).toBe(2); // pages 2 and 3 only
  });

  it('stops when aborted', async () => {
    const src = fakeSource([item(1, 100), item(2, 200), item(3, 300)]);
    const ctl = new AbortController();
    ctl.abort();
    await expect(runFullScan(db, src, undefined, ctl.signal)).rejects.toThrow();
    expect(await countItems(db)).toBe(0);
  });
});

describe('refresh', () => {
  it('picks up new uploads, including ones with old taken dates', async () => {
    const src = fakeSource([item(1, 100, 1000), item(2, 200, 2000), item(3, 300, 3000)]);
    await runFullScan(db, src);
    const syncedUntil = (await getScanState(db)).syncedUploadsUntil!;

    // New upload of an old photo (taken 50, uploaded after the scan).
    src.items.push(item(9, 50, syncedUntil + 60_000));
    const added = await refreshRecent(db, src);
    expect(added).toBeGreaterThanOrEqual(1);
    expect(await countItems(db)).toBe(4);
    expect((await itemsAfter(db, null, 1))[0]!.key).toBe('K9');
  });

  it('stops paging once it reaches already-synced uploads', async () => {
    const many = Array.from({ length: 10 }, (_, i) => item(i, i * 10, i * 10));
    const src = fakeSource(many);
    await runFullScan(db, src);
    src.items.push(item(99, 5, Date.now() + 1000));
    src.calls.recent = 0;
    await refreshRecent(db, src);
    expect(src.calls.recent).toBe(1);
  });

  it('syncIndex runs the full scan first, then refreshes on later runs', async () => {
    const src = fakeSource([item(1, 100), item(2, 200)]);
    await syncIndex(db, src);
    expect(src.calls.recent).toBe(0);
    await syncIndex(db, src);
    expect(src.calls.recent).toBe(1);
  });
});

describe('review order', () => {
  it('returns items oldest first, after a cursor', async () => {
    const src = fakeSource([item(3, 300), item(1, 100), item(2, 200), item(4, 200)]);
    await runFullScan(db, src);
    const all = await itemsAfter(db, null, 10);
    expect(all.map((i) => i.key)).toEqual(['K1', 'K2', 'K4', 'K3']);
    const next = await itemsAfter(db, { takenAt: 200, key: 'K2' }, 10);
    expect(next.map((i) => i.key)).toEqual(['K4', 'K3']);
    expect(await countUpTo(db, { takenAt: 200, key: 'K2' })).toBe(2);
    expect(await countUpTo(db, null)).toBe(0);
  });
});
