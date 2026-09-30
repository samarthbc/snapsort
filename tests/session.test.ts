import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../src/api/library';
import { openDb, putItems, type Cursor, type Db } from '../src/db/db';
import { ReviewSession, type ReviewEffects } from '../src/review/session';

let dbCounter = 0;
let db: Db;

const item = (n: number): MediaItem => ({
  key: `K${String(n).padStart(3, '0')}`,
  dedupKey: `D${n}`,
  takenAt: n * 1000,
  tzOffsetMs: 0,
  uploadedAt: n * 1000,
  width: 10,
  height: 10,
  baseUrl: `u${n}`,
  isVideo: false,
  durationMs: null,
});

function recorder() {
  const log: string[] = [];
  let cursor: Cursor | null = null;
  const effects: ReviewEffects = {
    discard: (i) => log.push(`discard ${i.key}`),
    undoDiscard: (i) => log.push(`undo ${i.key}`),
    saveCursor: (c) => {
      cursor = c;
    },
  };
  return { log, effects, cursor: () => cursor };
}

beforeEach(async () => {
  db = await openDb(`session-${++dbCounter}`);
  await putItems(
    db,
    Array.from({ length: 50 }, (_, i) => item(i + 1)),
  );
});

describe('ReviewSession', () => {
  it('starts at the oldest photo and counts the library', async () => {
    const s = new ReviewSession(db);
    await s.load(null);
    expect(s.current?.key).toBe('K001');
    expect(s.total).toBe(50);
    expect(s.reviewedCount).toBe(0);
  });

  it('resumes after a saved bookmark', async () => {
    const s = new ReviewSession(db);
    await s.load({ takenAt: 10_000, key: 'K010' });
    expect(s.current?.key).toBe('K011');
    expect(s.reviewedCount).toBe(10);
  });

  it('keep and discard advance, save the bookmark, and trigger discard effects', async () => {
    const r = recorder();
    const s = new ReviewSession(db, r.effects);
    await s.load(null);
    await s.decide('keep');
    await s.decide('discard');
    expect(s.current?.key).toBe('K003');
    expect(r.log).toEqual(['discard K002']);
    expect(r.cursor()).toEqual({ takenAt: 2000, key: 'K002' });
    expect(s.reviewedCount).toBe(2);
  });

  it('undo restores the photo, the bookmark and reverses a discard', async () => {
    const r = recorder();
    const s = new ReviewSession(db, r.effects);
    await s.load({ takenAt: 5000, key: 'K005' });
    await s.decide('discard');
    await s.decide('keep');
    expect(await s.undo()).toBe('keep');
    expect(await s.undo()).toBe('discard');
    expect(s.current?.key).toBe('K006');
    expect(r.cursor()).toEqual({ takenAt: 5000, key: 'K005' });
    expect(r.log).toEqual(['discard K006', 'undo K006']);
    expect(await s.undo()).toBeNull();
  });

  it('keeps refilling the queue and finishes at the end of the library', async () => {
    const s = new ReviewSession(db);
    await s.load(null);
    for (let i = 0; i < 50; i++) await s.decide('keep');
    expect(s.current).toBeNull();
    expect(s.done).toBe(true);
    expect(s.reviewedCount).toBe(50);
  });
});
