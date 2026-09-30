import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Album } from '../src/api/albums';
import { ApiShapeError } from '../src/api/rpc';
import { openDb, type Db } from '../src/db/db';
import {
  bumpToDeleteCount,
  getToDeleteState,
  resolveToDelete,
  TO_DELETE_LIMIT,
} from '../src/sync/toDelete';
import { WriteQueue, type WriteQueueDeps } from '../src/sync/writeQueue';

let dbCounter = 0;
let db: Db;

beforeEach(async () => {
  db = await openDb(`wq-${++dbCounter}`);
});

/** Fake Google Photos albums: albumKey → (mediaKey → albumItemKey). */
function fakeGoogle() {
  const albums = new Map<string, Map<string, string>>();
  const calls: string[] = [];
  let n = 0;
  const deps = (): WriteQueueDeps => ({
    db,
    async addToAlbum(albumKey, mediaKeys) {
      calls.push(`add ${albumKey} ${mediaKeys.join(',')}`);
      const album = albums.get(albumKey) ?? new Map();
      albums.set(albumKey, album);
      const out = new Map<string, string>();
      for (const k of mediaKeys) {
        if (!album.has(k)) album.set(k, `AIK${++n}`);
        out.set(k, album.get(k)!);
      }
      return out;
    },
    async removeFromAlbum(keys) {
      calls.push(`remove ${keys.join(',')}`);
      for (const album of albums.values())
        for (const [m, aik] of album) if (keys.includes(aik)) album.delete(m);
    },
    resolveToDelete: async () => 'TODELETE',
    async moveToLockedFolder(keys) {
      calls.push(`lock ${keys.join(',')}`);
    },
    async moveOutOfLockedFolder(keys) {
      calls.push(`unlock ${keys.join(',')}`);
    },
    async findAlbumItemKey(albumKey, dedupKey) {
      calls.push(`find ${albumKey} ${dedupKey}`);
      return albums.get(albumKey)?.get(dedupKey.replace('D', 'K')) ?? null;
    },
  });
  return { albums, calls, deps };
}

const photo = (n: number) => ({ key: `K${n}`, dedupKey: `D${n}` });

describe('WriteQueue', () => {
  it('adds discards to To Delete and removes them on undo', async () => {
    const g = fakeGoogle();
    const q = await WriteQueue.load(g.deps());
    await q.enqueue('add', { kind: 'toDelete' }, photo(1));
    await q.idle();
    expect([...g.albums.get('TODELETE')!.keys()]).toEqual(['K1']);

    await q.enqueue('remove', { kind: 'toDelete' }, photo(1));
    await q.idle();
    expect(g.albums.get('TODELETE')!.size).toBe(0);
    expect(g.calls).toEqual(['add TODELETE K1', 'remove AIK1']);
    expect(q.status).toEqual({ pending: 0, error: null, broken: false });
  });

  it('cancels an add and a remove that were never sent', async () => {
    const g = fakeGoogle();
    // Block sending so both ops are pending.
    const blocked = { ...g.deps(), resolveToDelete: () => new Promise<string>(() => {}) };
    const q2 = await WriteQueue.load(blocked);
    await q2.enqueue('add', { kind: 'toDelete' }, photo(1)); // in flight (blocked)
    await q2.enqueue('add', { kind: 'toDelete' }, photo(2)); // pending
    await q2.enqueue('remove', { kind: 'toDelete' }, photo(2)); // cancels the pending add
    expect(q2.status.pending).toBe(1);
  });

  it('survives a reload: pending ops are sent by the next page load', async () => {
    const g = fakeGoogle();
    const offline = { ...g.deps(), addToAlbum: () => new Promise<Map<string, string>>(() => {}) };
    const q1 = await WriteQueue.load(offline);
    await q1.enqueue('add', { kind: 'toDelete' }, photo(3));
    expect(q1.status.pending).toBe(1);

    const q2 = await WriteQueue.load(g.deps());
    q2.start();
    await q2.idle();
    expect([...g.albums.get('TODELETE')!.keys()]).toEqual(['K3']);
  });

  it('finds the album-item key when it was not recorded locally', async () => {
    const g = fakeGoogle();
    g.albums.set('TODELETE', new Map([['K4', 'AIK-OTHER-DEVICE']]));
    const q = await WriteQueue.load(g.deps());
    await q.enqueue('remove', { kind: 'toDelete' }, photo(4));
    await q.idle();
    expect(g.calls).toEqual(['find TODELETE D4', 'remove AIK-OTHER-DEVICE']);
  });

  it('stops and reports when Google changes its response format', async () => {
    const g = fakeGoogle();
    const q = await WriteQueue.load({
      ...g.deps(),
      addToAlbum: async () => {
        throw new ApiShapeError('changed');
      },
    });
    await q.enqueue('add', { kind: 'toDelete' }, photo(5));
    await q.idle();
    expect(q.status.broken).toBe(true);
    expect(q.status.pending).toBe(1);
  });
});

describe('Locked Folder', () => {
  it('moves photos in and back out, by dedup key', async () => {
    const g = fakeGoogle();
    const changes: string[] = [];
    const q = await WriteQueue.load({
      ...g.deps(),
      onLockedChange: async (op) => {
        changes.push(`${op.action} ${op.mediaKey}`);
      },
    });
    await q.enqueue('add', { kind: 'lockedFolder' }, photo(1));
    await q.idle();
    await q.enqueue('remove', { kind: 'lockedFolder' }, photo(1));
    await q.idle();
    expect(g.calls).toEqual(['lock D1', 'unlock D1']);
    expect(changes).toEqual(['add K1', 'remove K1']);
  });

  it('an undo before the move is sent cancels it without calling Google', async () => {
    const g = fakeGoogle();
    const blocked = { ...g.deps(), resolveToDelete: () => new Promise<string>(() => {}) };
    const q = await WriteQueue.load(blocked);
    await q.enqueue('add', { kind: 'toDelete' }, photo(9)); // blocks the queue
    await q.enqueue('add', { kind: 'lockedFolder' }, photo(2));
    expect(q.hasPendingLock('K2')).toBe(true);
    await q.enqueue('remove', { kind: 'lockedFolder' }, photo(2));
    expect(q.hasPendingLock('K2')).toBe(false);
    expect(q.status.pending).toBe(1);
    expect(g.calls.filter((c) => c.includes('lock'))).toEqual([]);
  });

  it('does not report Locked Folder moves as album changes', async () => {
    const g = fakeGoogle();
    const blocked = { ...g.deps(), resolveToDelete: () => new Promise<string>(() => {}) };
    const q = await WriteQueue.load(blocked);
    await q.enqueue('add', { kind: 'toDelete' }, photo(9));
    await q.enqueue('add', { kind: 'lockedFolder' }, photo(3));
    expect(q.pendingAlbumChanges('K3').added.size).toBe(0);
  });
});

describe('To Delete albums', () => {
  function albumsApi(existing: Album[]) {
    const created: string[] = [];
    return {
      created,
      deps: {
        listAlbums: async () => existing,
        createAlbum: async (title: string) => {
          created.push(title);
          return `NEW-${created.length}`;
        },
      },
    };
  }

  it('creates "🗑 To Delete" on first use', async () => {
    const a = albumsApi([{ key: 'A', title: 'Ooty trip', itemCount: 3 }]);
    expect(await resolveToDelete(db, a.deps)).toBe('NEW-1');
    expect(a.created).toEqual(['🗑 To Delete']);
  });

  it('reuses existing To Delete albums found in Google Photos, in order', async () => {
    const a = albumsApi([
      { key: 'T2', title: '🗑 To Delete 2', itemCount: 10 },
      { key: 'T1', title: '🗑 To Delete', itemCount: TO_DELETE_LIMIT },
    ]);
    expect(await resolveToDelete(db, a.deps)).toBe('T2');
    expect(a.created).toEqual([]);
    expect((await getToDeleteState(db))!.albums.map((x) => x.key)).toEqual(['T1', 'T2']);
  });

  it('rolls over to a new album when the current one is full', async () => {
    const a = albumsApi([{ key: 'T1', title: '🗑 To Delete', itemCount: TO_DELETE_LIMIT - 1 }]);
    expect(await resolveToDelete(db, a.deps)).toBe('T1');
    await bumpToDeleteCount(db, 'T1', 1);
    expect(await resolveToDelete(db, a.deps)).toBe('NEW-1');
    expect(a.created).toEqual(['🗑 To Delete 2']);
  });
});
