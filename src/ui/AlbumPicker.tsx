// Bottom sheet opened by tapping the photo: add it to albums (ticking adds immediately,
// unticking removes; "+ New album" creates an album and ticks it), or move it to the Locked
// Folder. Nothing stays selected for the next photo.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MediaItem } from '../api/library';
import type { AlbumStore } from '../review/albums';

interface Props {
  albums: AlbumStore;
  item: MediaItem;
  onClose: () => void;
  /** Move the photo to the Locked Folder (the sheet closes and the next photo shows). */
  onLock: () => void;
}

export function AlbumPicker({ albums, item, onClose, onLock }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [, setTick] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await albums.load();
        const current = await albums.albumsOf(item);
        if (!cancelled) setSelected(current);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    search.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [item.key]);

  const trimmed = query.trim();
  const visible = useMemo(() => {
    const q = trimmed.toLowerCase();
    return q ? albums.albums.filter((a) => a.title.toLowerCase().includes(q)) : albums.albums;
  }, [albums.albums, trimmed, loading]);
  const exactMatch = albums.albums.some((a) => a.title.toLowerCase() === trimmed.toLowerCase());

  function toggle(albumKey: string) {
    const on = !selected.has(albumKey);
    const next = new Set(selected);
    if (on) next.add(albumKey);
    else next.delete(albumKey);
    setSelected(next);
    void albums.setMembership(item, albumKey, on);
  }

  async function createAlbum() {
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const album = await albums.create(trimmed);
      setQuery('');
      setSelected((s) => new Set(s).add(album.key));
      void albums.setMembership(item, album.key, true);
      setTick((t) => t + 1);
    } catch (err) {
      setError(`Couldn't create album: ${String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div
        class="sheet"
        role="dialog"
        aria-label="Add to albums"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div class="sheet-header">
          <span class="sheet-title">Add to albums</span>
          <button class="text-btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
        <form
          class="sheet-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && !exactMatch) void createAlbum();
            else if (visible.length === 1) toggle(visible[0]!.key);
          }}
        >
          <input
            ref={search}
            type="text"
            placeholder="Search or name a new album"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            aria-label="Search albums"
          />
        </form>
        {error && <p class="sheet-error">{error}</p>}
        <button class="album-row lock-row" type="button" onClick={onLock}>
          <span class="album-check lock-icon" aria-hidden="true">
            🔒
          </span>
          <span class="album-title">Move to Locked Folder</span>
          <span class="album-count">L</span>
        </button>
        <ul class="album-list">
          {trimmed && !exactMatch && (
            <li>
              <button
                class="album-row new-album"
                type="button"
                onClick={createAlbum}
                disabled={creating}
              >
                <span class="album-check">＋</span>
                <span class="album-title">{creating ? 'Creating…' : `New album "${trimmed}"`}</span>
              </button>
            </li>
          )}
          {loading && <li class="muted album-empty">Loading albums…</li>}
          {!loading && visible.length === 0 && !trimmed && (
            <li class="muted album-empty">No albums yet — type a name to create one.</li>
          )}
          {visible.map((a) => (
            <li key={a.key}>
              <button
                class={`album-row ${selected.has(a.key) ? 'selected' : ''}`}
                type="button"
                role="checkbox"
                aria-checked={selected.has(a.key)}
                onClick={() => toggle(a.key)}
              >
                <span class="album-check">{selected.has(a.key) ? '✓' : ''}</span>
                <span class="album-title">{a.title || 'Untitled'}</span>
                <span class="album-count">{a.itemCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
