// Messages passed between the MAIN-world script (page context) and the content script
// (isolated world) via window.postMessage. The content script can't read page variables, so
// it asks the MAIN-world script for the current session values.

import type { Session } from '../api/rpc';

export const MAIN_SOURCE = 'snapsort-main';
export const CONTENT_SOURCE = 'snapsort-content';

export type MainWorldMessage =
  | { source: typeof MAIN_SOURCE; type: 'ready' }
  | { source: typeof MAIN_SOURCE; type: 'session'; id: number; session: Session | null };

export type ContentMessage = { source: typeof CONTENT_SOURCE; type: 'getSession'; id: number };

function hasSource(data: unknown, source: string): boolean {
  return (
    typeof data === 'object' && data !== null && (data as { source?: unknown }).source === source
  );
}

export function isMainWorldMessage(data: unknown): data is MainWorldMessage {
  return hasSource(data, MAIN_SOURCE);
}

export function isContentMessage(data: unknown): data is ContentMessage {
  return hasSource(data, CONTENT_SOURCE);
}
