import { CONTENT_SOURCE, isMainWorldMessage, type ContentMessage } from '../shared/messages';
import type { Session, SessionProvider } from './rpc';

type WizData = Record<string, unknown> | undefined;

/** Reads session values from Google's page globals. Only works in the page's own JS context. */
export function readSessionFromPage(): Session | null {
  const wiz = (window as unknown as { WIZ_global_data?: WizData }).WIZ_global_data;
  const fsid = wiz?.FdrFJe,
    bl = wiz?.cfb2h,
    at = wiz?.SNlM0e;
  if (typeof fsid !== 'string' || typeof bl !== 'string' || typeof at !== 'string') return null;
  return { fsid, bl, at };
}

const NOT_SIGNED_IN = 'SnapSort: no Google Photos session on this page (signed out?)';

/** For code running in the page context (MAIN world, or injected for testing). */
export const pageSessionProvider: SessionProvider = async () => {
  const session = readSessionFromPage();
  if (!session) throw new Error(NOT_SIGNED_IN);
  return session;
};

/** For the isolated-world content script: asks the MAIN-world script over postMessage. */
export function bridgeSessionProvider(timeoutMs = 3000): SessionProvider {
  let nextId = 1;
  return () =>
    new Promise<Session>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('SnapSort: page script did not answer (reload the page)'));
      }, timeoutMs);
      function onMessage(event: MessageEvent) {
        const data = event.data;
        if (event.source !== window || !isMainWorldMessage(data)) return;
        if (data.type !== 'session' || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.session) resolve(data.session);
        else reject(new Error(NOT_SIGNED_IN));
      }
      window.addEventListener('message', onMessage);
      const request: ContentMessage = { source: CONTENT_SOURCE, type: 'getSession', id };
      window.postMessage(request, window.location.origin);
    });
}
