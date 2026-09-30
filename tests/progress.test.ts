import { describe, expect, it } from 'vitest';
import type { Album } from '../src/api/albums';
import {
  decodeBookmark,
  encodeBookmark,
  mergeBookmarks,
  RemoteProgress,
  type Bookmark,
} from '../src/sync/progress';

const bm = (t: number, k = 'K', s = 0): Bookmark => ({ v: 1, t, k, s, u: 0 });

describe('bookmark encoding', () => {
  it('round-trips through an album title', () => {
    const b = bm(1552367400000, 'AF1QipNTevW2iKXuebrH5bEj4ex9_zktpqD4qtQaN_c2', 1790745172030);
    expect(decodeBookmark(encodeBookmark(b))).toEqual(b);
  });

  it('ignores other albums and garbage', () => {
    expect(decodeBookmark('Ooty trip')).toBeNull();
    expect(decodeBookmark('SnapSort · progress not json')).toBeNull();
    expect(decodeBookmark('SnapSort · progress {"v":2}')).toBeNull();
  });
});

describe('mergeBookmarks', () => {
  it('takes the one further ahead', () => {
    expect(mergeBookmarks(bm(100), bm(200))!.t).toBe(200);
    expect(mergeBookmarks(bm(300), bm(200))!.t).toBe(300);
    expect(mergeBookmarks(bm(100, 'B'), bm(100, 'A'))!.k).toBe('B');
  });

  it('handles missing sides', () => {
    expect(mergeBookmarks(null, null)).toBeNull();
    expect(mergeBookmarks(bm(1), null)!.t).toBe(1);
    expect(mergeBookmarks(null, bm(2))!.t).toBe(2);
  });

  it('on a tie, keeps the later upload horizon', () => {
    expect(mergeBookmarks(bm(100, 'K', 5), bm(100, 'K', 9))!.s).toBe(9);
  });
});

describe('RemoteProgress', () => {
  function fake(initial: Album[]) {
    const albums = [...initial];
    const calls: string[] = [];
    return {
      albums,
      calls,
      deps: {
        listAlbums: async () => albums,
        createAlbum: async (title: string) => {
          calls.push('create');
          albums.push({ key: 'P', title, itemCount: 0 });
          return 'P';
        },
        renameAlbum: async (key: string, title: string) => {
          calls.push(`rename ${key}`);
          albums.find((a) => a.key === key)!.title = title;
        },
      },
    };
  }

  it('creates the album on first write, renames afterwards, and debounces', async () => {
    const f = fake([]);
    const r = new RemoteProgress(f.deps, 10_000);
    expect(await r.read()).toBeNull();
    r.write(bm(1));
    r.write(bm(2));
    await r.flush();
    r.write(bm(3));
    await r.flush();
    expect(f.calls).toEqual(['create', 'rename P']);
    expect(await new RemoteProgress(f.deps).read()).toEqual(bm(3));
  });

  it('reads the furthest-ahead bookmark if several progress albums exist', async () => {
    const f = fake([
      { key: 'A', title: encodeBookmark(bm(100)), itemCount: 0 },
      { key: 'B', title: encodeBookmark(bm(500)), itemCount: 0 },
    ]);
    const r = new RemoteProgress(f.deps);
    expect((await r.read())!.t).toBe(500);
    r.write(bm(600));
    await r.flush();
    expect(f.calls).toEqual(['rename B']);
  });

  it('keeps a failed write for the next flush', async () => {
    const f = fake([{ key: 'A', title: encodeBookmark(bm(1)), itemCount: 0 }]);
    let fail = true;
    const r = new RemoteProgress({
      ...f.deps,
      renameAlbum: async (k, t) => {
        if (fail) throw new Error('offline');
        await f.deps.renameAlbum(k, t);
      },
    });
    await r.read();
    r.write(bm(7));
    await r.flush();
    expect(r.lastError).toContain('offline');
    fail = false;
    await r.flush();
    expect(decodeBookmark(f.albums[0]!.title)!.t).toBe(7);
  });
});
