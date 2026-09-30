// Serialises requests to Google with a minimum gap between them, and retries with back-off on
// rate limiting (429) and server errors (5xx).

const MIN_GAP_MS = 150;
const MAX_RETRIES = 4;

let chain: Promise<unknown> = Promise.resolve();
let lastStart = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isRetryable(err)) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => withRetry(fn));
  chain = run.catch(() => undefined);
  return run;
}
