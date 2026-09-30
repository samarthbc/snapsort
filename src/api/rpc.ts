// Google Photos internal web API ("batchexecute").
//
// Every call is a POST to /_/PhotosUi/data/batchexecute with an RPC ID and a JSON payload,
// authenticated by the user's cookies plus the page's session token. This module only knows
// the wire format; what each RPC means lives in library.ts / albums.ts / trash.ts.

import { throttled } from '../shared/throttle';

export interface Session {
  /** WIZ_global_data.FdrFJe */
  fsid: string;
  /** WIZ_global_data.cfb2h (server build label) */
  bl: string;
  /** WIZ_global_data.SNlM0e (anti-CSRF token) */
  at: string;
}

export type SessionProvider = () => Promise<Session>;

/** Google returned an error for the RPC (e.g. bad payload, or the item doesn't exist). */
export class RpcError extends Error {
  constructor(
    readonly rpcid: string,
    readonly detail: unknown,
  ) {
    super(`Google Photos RPC ${rpcid} failed: ${JSON.stringify(detail)}`);
  }
}

/** The response didn't have the shape we expected — Google probably changed something. */
export class ApiShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected Google Photos response: ${what}`);
  }
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Google Photos request failed with HTTP ${status}`);
  }
}

const ENDPOINT = '/_/PhotosUi/data/batchexecute';

export function encodeRequest(
  rpcid: string,
  payload: unknown,
  session: Session,
  reqId: number,
  sourcePath = '/',
): { url: string; body: string } {
  const params = new URLSearchParams({
    rpcids: rpcid,
    'source-path': sourcePath,
    'f.sid': session.fsid,
    bl: session.bl,
    hl: 'en',
    'soc-app': '165',
    'soc-platform': '1',
    'soc-device': '1',
    _reqid: String(reqId),
    rt: 'c',
  });
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[rpcid, JSON.stringify(payload), null, 'generic']]]),
    at: session.at,
  });
  return { url: `${ENDPOINT}?${params}`, body: body.toString() };
}

/**
 * Response format: `)]}'` then length-prefixed chunks, each a JSON array. The chunk for our
 * call is `["wrb.fr", rpcid, "<json string>" | null, ..., errorDetail]`.
 */
export function decodeResponse(text: string, rpcid: string): unknown {
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;
    for (const entry of chunk) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== rpcid) continue;
      if (typeof entry[2] !== 'string') throw new RpcError(rpcid, entry.slice(3));
      return JSON.parse(entry[2]);
    }
  }
  throw new ApiShapeError(`no result for ${rpcid}`);
}

let sessionProvider: SessionProvider | null = null;
let reqCounter = 100000 + Math.floor(Math.random() * 800000);

export function setSessionProvider(provider: SessionProvider) {
  sessionProvider = provider;
}

export async function call(rpcid: string, payload: unknown): Promise<unknown> {
  if (!sessionProvider) throw new Error('SnapSort: session provider not set');
  const session = await sessionProvider();
  reqCounter += 100000;
  const { url, body } = encodeRequest(rpcid, payload, session, reqCounter, location.pathname);
  const text = await throttled(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      credentials: 'include',
    });
    if (!res.ok) throw new HttpError(res.status);
    return res.text();
  });
  return decodeResponse(text, rpcid);
}
