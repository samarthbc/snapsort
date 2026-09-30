import { call } from './rpc';
import { RPC } from './rpcids';

/** Moves items (by dedup key) to Google Photos Trash, where they stay restorable for 60 days. */
export async function moveToTrash(dedupKeys: string[]): Promise<void> {
  if (dedupKeys.length === 0) return;
  await call(RPC.trash, [null, 1, dedupKeys, 3]);
}

/** Restores items (by dedup key) from Trash. */
export async function restoreFromTrash(dedupKeys: string[]): Promise<void> {
  if (dedupKeys.length === 0) return;
  await call(RPC.trash, [null, 3, dedupKeys, 2]);
}
