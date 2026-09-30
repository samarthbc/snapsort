import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AlbumItem } from '../src/api/albums';
import type { MediaItem } from '../src/api/library';
import { countItems, newItemsBehind, openDb, putItems, type Db } from '../src/db/db';
import {
  getTrashJob,
  getTrashLog,
  loadDeleteFolder,
  rescue,
  runTrashJob,
  startTrashJob,
  TRASH_BATCH,
  type DeleteFolderDeps,
} from '../src/review/deleteFolder';
import { ReviewSession } from '../src/review/session';

let dbCounter = 0;
let db: Db;

const media = (n: number, uploadedAt = n * 1000): MediaItem => ({
  key: `K${String(n).padStart(3, '0')}`,
  dedupKey: `D${n}`,
  takenAt: n * 1000,
  tzOffsetMs: 0,
  uploadedAt,
  width: 1,
  height: 1,
  baseUrl: `u${n}`,
  isVideo: false,
  durationMs: null,
});

const albumItem = (n: number): AlbumItem => ({
  albumItemKey: `AIK${n}`,
  dedupKey: `D${n}`,
  takenAt: n * 1000,
  baseUrl: `u${n}`,
  width: 1,
  height: 1,
});

beforeEach(async () => {
  db = await openDb(`df-${++dbCounter}`);
});

function fakeDeps(albums: Record<string, { title: string; items: AlbumItem[] }>) {
  const trashed: string[][] = [];
  const removed: string[] = [];
  const deps: DeleteFolderDeps & { failAfter?: number } = {
    listAlbums: async () =>
      Object.entries(albums).map(([key, a]) => ({
        key,
        title: a.title,
        itemCount: a.items.length,
      })),
    createAlbum: async () => 'NEW',
    getAllAlbumItems: async (key) => albums[key]!.items,
    removeFromAlbum: async (keys) => {
      removed.push(...keys);
    },
    moveToTrash: async (keys) => {
      if (deps.failAfter !== undefined && trashed.length >= deps.failAfter) throw new Error('net');
      trashed.push(keys);
    },
  };
  return { deps, trashed, removed };
}

describe('delete folder', () => {
  it('lists items from every To Delete album, oldest first, and ignores other albums', async () => {
    await putItems(db, [media(1), media(2), media(3)]);
    const { deps } = fakeDeps({
      T2: { title: '🗑 To Delete 2', items: [albumItem(1)] },
      T1: { title: '🗑 To Delete', items: [albumItem(3)] },
      X: { title: 'Ooty trip', items: [albumItem(2)] },
    });
    const list = await loadDeleteFolder(db, deps);
    expect(list.map((i) => [i.dedupKey, i.albumKey, i.mediaKey])).toEqual([
      ['D1', 'T2', 'K001'],
      ['D3', 'T1', 'K003'],
    ]);
  });

  it('rescue removes the item from its To Delete album', async () => {
    const { deps, removed } = fakeDeps({ T1: { title: '🗑 To Delete', items: [albumItem(4)] } });
    const [item] = await loadDeleteFolder(db, deps);
    await rescue(db, deps, item!);
    expect(removed).toEqual(['AIK4']);
  });

  it('trashes in batches, logs, removes from the index, and resumes after a failure', async () => {
    const n = TRASH_BATCH * 2 + 5;
    const all = Array.from({ length: n }, (_, i) => media(i + 1));
    await putItems(db, all);
    const { deps, trashed } = fakeDeps({
      T1: { title: '🗑 To Delete', items: all.map((m, i) => albumItem(i + 1)) },
    });
    await startTrashJob(db, await loadDeleteFolder(db, deps));

    deps.failAfter = 1;
    await expect(runTrashJob(db, deps, () => {})).rejects.toThrow('net');
    expect((await getTrashJob(db))!.remaining).toHaveLength(n - TRASH_BATCH);

    deps.failAfter = undefined;
    const progress: number[] = [];
    await runTrashJob(db, deps, (done) => progress.push(done));
    expect(trashed.map((b) => b.length)).toEqual([TRASH_BATCH, TRASH_BATCH, 5]);
    expect(progress).toEqual([TRASH_BATCH * 2, n]);
    expect(await getTrashJob(db)).toBeNull();
    expect(await getTrashLog(db)).toHaveLength(n);
    expect(await countItems(db)).toBe(0);
  });
});

describe('new since last time', () => {
  it('finds new uploads of photos taken before the bookmark', async () => {
    await putItems(db, [media(1, 100), media(2, 200), media(3, 900), media(8, 950)]);
    const behind = await newItemsBehind(db, { takenAt: 5000, key: 'K005' }, 500);
    expect(behind.map((i) => i.key)).toEqual(['K003']);
  });

  it('lock decisions call the lock effect, undo calls undoLock, and items can be swapped', async () => {
    await putItems(db, [media(1), media(2)]);
    const log: string[] = [];
    const s = new ReviewSession(db, {
      discard() {},
      undoDiscard() {},
      saveCursor() {},
      lock: (i) => log.push(`lock ${i.key}`),
      undoLock: (i) => log.push(`undo ${i.key}`),
    });
    await s.load(null);
    await s.decide('lock');
    expect(s.cursor?.key).toBe('K001');
    await s.undo();
    expect(log).toEqual(['lock K001', 'undo K001']);
    s.replaceItem('D1', { ...media(1), key: 'NEWKEY' });
    expect(s.current?.key).toBe('NEWKEY');
  });

  it('reviews them first without moving the bookmark', async () => {
    await putItems(db, [media(1), media(2), media(3), media(10)]);
    const saved: unknown[] = [];
    let caughtUp = false;
    const s = new ReviewSession(db, {
      discard() {},
      undoDiscard() {},
      saveCursor: (c) => saved.push(c),
      catchupDone: () => {
        caughtUp = true;
      },
    });
    await s.load({ takenAt: 3000, key: 'K003' }, [media(2)]);
    expect(s.current?.key).toBe('K002');
    await s.decide('keep');
    expect(caughtUp).toBe(true);
    expect(saved).toEqual([]);
    expect(s.current?.key).toBe('K010');
    await s.undo();
    expect(s.current?.key).toBe('K002');
  });
});
