// Album data for the picker: the user's albums (minus SnapSort's own), and which albums a
// photo is in as far as SnapSort knows (albums it added the photo to, plus pending changes).

import * as api from '../api';
import type { Album } from '../api/albums';
import type { MediaItem } from '../api/library';
import type { Db } from '../db/db';
import { isToDeleteTitle } from '../sync/toDelete';
import type { WriteQueue } from '../sync/writeQueue';
import { isProgressTitle } from '../sync/progress';

export function isSnapSortAlbum(title: string): boolean {
  return isToDeleteTitle(title) || isProgressTitle(title);
}

export class AlbumStore {
  albums: Album[] = [];
  private loaded: Promise<void> | null = null;

  constructor(
    private db: Db,
    private queue: WriteQueue,
  ) {}

  /** Loads the album list once; call refresh() to reload. */
  load(): Promise<void> {
    this.loaded ??= this.refresh();
    return this.loaded;
  }

  async refresh(): Promise<void> {
    const all = await api.listAlbums();
    this.albums = all.filter((a) => !isSnapSortAlbum(a.title));
  }

  async create(title: string): Promise<Album> {
    const key = await api.createAlbum(title);
    const album = { key, title, itemCount: 0 };
    this.albums = [album, ...this.albums];
    return album;
  }

  async albumsOf(item: MediaItem): Promise<Set<string>> {
    const memberships = await this.db.getAllFromIndex('memberships', 'byMedia', item.key);
    const keys = new Set(memberships.filter((m) => !m.toDelete).map((m) => m.albumKey));
    const { added, removed } = this.queue.pendingAlbumChanges(item.key);
    for (const k of added) keys.add(k);
    for (const k of removed) keys.delete(k);
    return keys;
  }

  async setMembership(item: MediaItem, albumKey: string, inAlbum: boolean): Promise<void> {
    await this.queue.enqueue(inAlbum ? 'add' : 'remove', { kind: 'album', albumKey }, item);
  }
}
