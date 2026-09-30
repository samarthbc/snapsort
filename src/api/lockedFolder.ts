import { call } from './rpc';
import { RPC } from './rpcids';

/** Moves items (by dedup key) into the Locked Folder. They leave the library and albums. */
export async function moveToLockedFolder(dedupKeys: string[]): Promise<void> {
  if (dedupKeys.length === 0) return;
  await call(RPC.moveToLockedFolder, [dedupKeys, []]);
}

/** Moves items (by dedup key) back out of the Locked Folder into the library. */
export async function moveOutOfLockedFolder(dedupKeys: string[]): Promise<void> {
  if (dedupKeys.length === 0) return;
  await call(RPC.moveOutOfLockedFolder, [dedupKeys, []]);
}
