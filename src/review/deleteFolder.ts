// The delete folder: everything in SnapSort's "🗑 To Delete" album(s), with rescue and a
// resumable "Move all to trash" job. Only items found in those albums are ever trashed.

import type { AlbumItem } from '../api/albums';
import type { Db } from '../db/db';
import { getMeta, setMeta } from '../db/db';
import { discoverToDelete, type ToDeleteDeps } from '../sync/toDelete';

export interface DeleteFolderItem extends AlbumItem {
  albumKey: string;
  /** Library media key, when the item is in the local index. */
  mediaKey: string | null;
}

export interface TrashJob {
  /** Dedup keys still to trash. */
  remaining: string[];
  total: number;
  startedAt: number;
}

export interface TrashLogEntry {
  dedupKey: string;
  mediaKey: string | null;
  takenAt: number;
  trashedAt: number;
}

export interface DeleteFolderDeps extends ToDeleteDeps {
  getAllAlbumItems(albumKey: string): Promise<AlbumItem[]>;
  removeFromAlbum(albumItemKeys: string[]): Promise<void>;
  moveToTrash(dedupKeys: string[]): Promise<void>;
}

const JOB_KEY = 'trashJob';
const LOG_KEY = 'trashLog';
export const TRASH_BATCH = 50;
const PAUSE_MS = 500;

export async function loadDeleteFolder(
  db: Db,
  deps: DeleteFolderDeps,
): Promise<DeleteFolderItem[]> {
  const { albums } = await discoverToDelete(deps);
  await setMeta(db, 'toDelete', { albums });
  const out: DeleteFolderItem[] = [];
  const seen = new Set<string>();
  for (const album of albums) {
    for (const item of await deps.getAllAlbumItems(album.key)) {
      if (seen.has(item.dedupKey)) continue;
      seen.add(item.dedupKey);
      const local = await db.getFromIndex('items', 'byDedup', item.dedupKey);
      out.push({ ...item, albumKey: album.key, mediaKey: local?.key ?? null });
    }
  }
  return out.sort((a, b) => a.takenAt - b.takenAt);
}

/** Takes a photo out of the delete folder (it stays in the library). */
export async function rescue(db: Db, deps: DeleteFolderDeps, item: DeleteFolderItem) {
  await deps.removeFromAlbum([item.albumItemKey]);
  if (item.mediaKey) await db.delete('memberships', [item.albumKey, item.mediaKey]);
}

export async function getTrashJob(db: Db): Promise<TrashJob | null> {
  return (await getMeta<TrashJob | null>(db, JOB_KEY)) ?? null;
}

export async function startTrashJob(db: Db, items: DeleteFolderItem[]): Promise<TrashJob> {
  const job: TrashJob = {
    remaining: items.map((i) => i.dedupKey),
    total: items.length,
    startedAt: Date.now(),
  };
  await setMeta(db, JOB_KEY, job);
  return job;
}

export async function getTrashLog(db: Db): Promise<TrashLogEntry[]> {
  return (await getMeta<TrashLogEntry[]>(db, LOG_KEY)) ?? [];
}

/**
 * Trashes the job's remaining items in batches, saving progress after each batch so a
 * closed tab resumes where it stopped. Trashed items are removed from the local index.
 */
export async function runTrashJob(
  db: Db,
  deps: Pick<DeleteFolderDeps, 'moveToTrash'>,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let job = await getTrashJob(db);
  while (job && job.remaining.length > 0) {
    signal?.throwIfAborted();
    const batch = job.remaining.slice(0, TRASH_BATCH);
    await deps.moveToTrash(batch);

    const log = await getTrashLog(db);
    for (const dedupKey of batch) {
      const local = await db.getFromIndex('items', 'byDedup', dedupKey);
      log.push({
        dedupKey,
        mediaKey: local?.key ?? null,
        takenAt: local?.takenAt ?? 0,
        trashedAt: Date.now(),
      });
      if (local) {
        await db.delete('items', local.key);
        for (const m of await db.getAllFromIndex('memberships', 'byMedia', local.key)) {
          await db.delete('memberships', [m.albumKey, m.mediaKey]);
        }
      }
    }
    await setMeta(db, LOG_KEY, log);

    job = { ...job, remaining: job.remaining.slice(batch.length) };
    await setMeta(db, JOB_KEY, job.remaining.length > 0 ? job : null);
    onProgress(job.total - job.remaining.length, job.total);
    if (job.remaining.length > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}

export function trashLogCsv(log: TrashLogEntry[]): string {
  const rows = log.map((e) =>
    [
      e.dedupKey,
      e.mediaKey ?? '',
      new Date(e.takenAt).toISOString(),
      new Date(e.trashedAt).toISOString(),
    ].join(','),
  );
  return ['dedup_key,media_key,taken_at,trashed_at', ...rows].join('\n');
}
