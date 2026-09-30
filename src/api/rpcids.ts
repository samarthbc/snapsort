// RPC IDs, found in photos.google.com's JS bundle next to their service method names
// (PhotosFeService.*). Verified against build boq_photosuiserver_20260924.10_p0.
// If Google renames them, update here.

export const RPC = {
  /** PhotosGetUserItems — library timeline, newest first, 300 per page. */
  listLibrary: 'lcxiM',
  /** PhotosSearchItems — used with a fixed query for "Recently added" (newest upload first). */
  searchItems: 'EzkLib',
  /** PhotosGetPhotoInfo — filename, size, description for one item. */
  itemInfo: 'fDcn4b',
  /** PhotosGetUserCollections — the user's albums. */
  listAlbums: 'Z5xsfc',
  /** PhotosGetCollection — one album's metadata and items. */
  getAlbum: 'snAcKc',
  /** PhotosCreateAlbum */
  createAlbum: 'OXvT9d',
  /** PhotosAddToAlbum */
  addToAlbum: 'E1Cajb',
  /** PhotosRemoveItems — removes items from an album (by their album-item key). */
  removeFromAlbum: 'pn5t0c',
  /** PhotosSetCollectionTitle — rename album. */
  renameAlbum: 'SVP9Xd',
  /** PhotosDeleteItems — move to trash / restore from trash. */
  trash: 'XwAOJf',
  /** PhotosMarsDataService.PhotosMoveItemsToCloudLockedFolder — no password needed. */
  moveToLockedFolder: 'StLnCe',
  /** PhotosMarsDataService.PhotosMoveItemsOutOfCloudLockedFolder — the item comes back with a
   * new media key and upload time (same dedup key). */
  moveOutOfLockedFolder: 'Pp2Xxe',
} as const;
