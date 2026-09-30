import { describe, expect, it } from 'vitest';
import { parseProgressFile } from '../src/ui/HelpPanel';

describe('progress import', () => {
  it('accepts a SnapSort export', () => {
    const b = parseProgressFile(
      JSON.stringify({ snapsortProgress: { v: 1, t: 123, k: 'AF1Qip', s: 99, u: 1 } }),
    );
    expect(b).toMatchObject({ v: 1, t: 123, k: 'AF1Qip', s: 99 });
  });

  it('rejects anything else', () => {
    expect(parseProgressFile('not json')).toBeNull();
    expect(parseProgressFile(JSON.stringify({ v: 1, t: 1, k: 'x' }))).toBeNull();
    expect(parseProgressFile(JSON.stringify({ snapsortProgress: { v: 2 } }))).toBeNull();
  });
});
