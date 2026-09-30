import type { MediaItem } from '../api/library';

/** Formats the taken time in the timezone where the photo was taken. */
export function formatTaken(item: Pick<MediaItem, 'takenAt' | 'tzOffsetMs'>): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(item.takenAt + item.tzOffsetMs));
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** URL for an image sized to fit a box, in device pixels. */
export function sizedUrl(baseUrl: string, width: number, height: number): string {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.min(Math.round(width * dpr), 2560);
  const h = Math.min(Math.round(height * dpr), 2560);
  return `${baseUrl}=w${w}-h${h}`;
}

/** Playable MP4 URLs, best first: 720p, then 360p. (`=dv` and `=m37` don't work.) */
export function videoUrls(baseUrl: string): string[] {
  return [`${baseUrl}=m22`, `${baseUrl}=m18`];
}

/** "1 item", "2,345 items". */
export function countLabel(n: number, noun = 'item'): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
}
