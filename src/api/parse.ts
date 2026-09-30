// Small helpers for picking values out of Google's positional JSON arrays, failing loudly
// (ApiShapeError) when the shape isn't what we expect.

import { ApiShapeError } from './rpc';

export function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new ApiShapeError(`${what} is not an array`);
  return value;
}

export function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new ApiShapeError(`${what} is not a string`);
  return value;
}

export function num(value: unknown, what: string): number {
  if (typeof value !== 'number') throw new ApiShapeError(`${what} is not a number`);
  return value;
}

export function optStr(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function optNum(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Items carry a trailing `{ "<field id>": value }` object; find the one holding `field`. */
export function findExtension(row: unknown[], field: string): unknown {
  for (const value of row) {
    if (value && typeof value === 'object' && !Array.isArray(value) && field in value) {
      return (value as Record<string, unknown>)[field];
    }
  }
  return undefined;
}
