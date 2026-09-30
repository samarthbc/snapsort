# SnapSort — Requirements

A browser extension for cleaning up a Google Photos library by reviewing photos one at a time: keep or discard, and optionally add each photo to albums.

## Background

- Google Photos is full, largely because WhatsApp media was backed up into it.
- Goal: go through every photo manually, discard the junk, and organise the keepers into albums (e.g. "Ooty trip").
- **No auto-categorisation.** No AI, duplicate detection, trip clustering or smart groups — every decision is made by the user.

## Platform

- **Browser extension** (Chromium, Manifest V3) that runs on `photos.google.com` in the user's logged-in session.
- Target browser: **Brave**, on both laptop and Android phone.

| Device | Support | Notes |
|---|---|---|
| Laptop (Brave desktop) | ✅ Works | Chromium-based; load unpacked in developer mode, or install from the Chrome Web Store. |
| Phone (Brave Android) | ⚠️ Experimental | Extensions are behind `brave://flags/#brave-android-extensions` (off by default). Chrome Web Store / unpacked / `.crx` installs, MV3 supported. On phones there is **no toolbar button** yet. Availability in the stable build still to be confirmed on the user's phone. |

- Because Brave Android phones have no extension toolbar, SnapSort must provide its **own launch button inside photos.google.com** (injected by the content script). It must not rely on the toolbar icon or popup.
- The UI must work on both screen sizes: keyboard + mouse drag on laptop, touch swipe and tap on phone.
- photos.google.com may serve a mobile layout on the phone; SnapSort's overlay and API calls must work on either layout.
- **Fallback** if Brave Android extensions don't work: use Firefox for Android on the phone (stable extension support), or laptop only. Progress still syncs because it's stored in Google Photos (see *Progress sync*).

### Why an extension

- The official Google Photos Library API (since 31 Mar 2025) can only read photos the app itself uploaded, and has never supported deleting photos.
- The Picker API is read-only and requires manual selection.
- An Android app can only see photos stored on the device, not cloud-only ones.
- An extension can call the same internal web API that photos.google.com uses (`/_/PhotosUi/data/batchexecute`), with the user's own session: list the library, list/create albums, add to albums, move to trash.

## Functional requirements

### 1. Photo-by-photo review

- Show one photo (or video) at a time, full screen.
- Order: **oldest first**.
- Show basic info: date, filename, file size, position (e.g. `1,204 / 48,213`).
- Preload the next few photos so moving on is instant.
- Videos play muted with a scrub bar.

### 2. Remember progress (synced across devices)

- Save progress **immediately** after each swipe.
- On reopening — on either device — resume at the **first unreviewed photo**.
- Already-reviewed photos never come back.
- Export / Import progress as a backup file.

#### Progress is a single bookmark

Photos are reviewed strictly oldest → newest with no skipping, so progress is one bookmark:

> "Everything up to **<timestamp>, photo ID <id>** is reviewed."

- **Discards** are already synced: they're in the "🗑 To Delete" album.
- **Album additions** are already synced: they're real Google Photos albums.
- **Keeps** need no record: everything before the bookmark counts as reviewed.
- **Undo** moves the bookmark back one photo.

#### Where the bookmark is stored

- In Google Photos itself: a dedicated album whose **title** holds the bookmark, e.g. `SnapSort · progress {"v":1,"t":…,"id":…}`. Verified in phase 1: a 133-character title round-trips exactly. (Album descriptions weren't needed, so they weren't pursued.)
- The bookmark contains: last reviewed photo's timestamp + ID, time of the last library scan, and a last-updated time.
- Read on open; written after swipes, batched every few seconds.
- Also cached locally (IndexedDB); if offline or a write fails, push the local copy when possible.
- Why not browser sync: Brave Sync doesn't sync extension data, and this approach works regardless of browser on each device. No extra sign-in is needed.

#### Edge cases

- **Photos uploaded later with older dates** (e.g. a restored WhatsApp backup) would fall behind the bookmark. Anything uploaded after the stored *last scan time* goes into a **"New since last session"** list, reviewed before the main queue continues. (Confirmed in phase 1: every library item includes its upload time.)
- **Both devices used at the same time**: the furthest-ahead bookmark wins; at worst a few photos are shown again.

### 3. Keep or discard (Tinder-style)

| Action | Input | Result |
|---|---|---|
| Keep | Swipe/drag right, or `→` | Marked reviewed. No change in Google Photos. |
| Discard | Swipe/drag left, or `←` | Photo added to the **"🗑 To Delete"** album in Google Photos. Nothing is deleted yet. |
| Undo | `Z` | Reverses the last swipe (removes from "🗑 To Delete" if it was a discard). |

- The card tilts and tints green or red while dragging.
- A drag beyond a small threshold counts as a swipe; less than that counts as a tap.

### 4. Albums (optional, per photo)

- **Single tap/click on the photo** (or `A`) opens the album picker:
  - Lists all Google Photos albums, with search.
  - Multi-select.
  - **+ New album**: type a name, and it's created in Google Photos and selected.
  - Albums the photo was added to during this session are shown as ticked. (Phase 1 found no API field listing which albums contain a photo, so existing memberships from before aren't shown.)
- The photo is added to the chosen albums **immediately**, independent of keep/discard.
- Selections **reset for each photo** (not sticky).
- Adding a photo to an album and then discarding it is fine: albums hold references, not copies, and trashing a photo removes it from every album. If it's rescued from the delete folder, it stays in its albums.

### 4a. Move to Locked Folder

- The same tap sheet has **🔒 Move to Locked Folder** at the top (shortcut `L`).
- The photo moves immediately (no password needed to move in), the card flies up, and the next photo shows. It counts as reviewed.
- **Undo (`Z`)** moves it back out of the Locked Folder. Google gives the restored photo a new media key and upload time; SnapSort swaps in the new key and won't list it as "New since last time".
- Moving to the Locked Folder removes the photo from its albums; undo doesn't restore album memberships.
- Opening the Locked Folder itself (in Google Photos) needs the Google account password; SnapSort never opens it.

### 5. Delete folder

- A grid of everything in **"🗑 To Delete"**.
- Tap a photo to **rescue** it (removes it from "🗑 To Delete").
- Show a count and the total size to be freed.
- **Move all to trash**: moves every photo in the album to Google Photos Trash, in throttled batches that resume if interrupted.
- Deleting the album itself would not delete the photos, so the extension must trash the photos, not the album.

## Safety

- Only ever **move to trash** (recoverable for 60 days in Google Photos). Never empty the trash or delete permanently.
- Nothing is trashed without going through the delete folder review.
- Requests to Google are throttled to avoid rate limits.

## Privacy

- No backend server. Photos stay in Google and the user's browser.
- Progress is stored in the user's own Google Photos ("SnapSort · progress" album); a local cache and the library index are kept in the browser (IndexedDB).
- Extension permissions limited to `photos.google.com` (images load through plain `<img>` tags, which need no extra permission).

## Technical notes

- A MAIN-world script reads the page's session values (`WIZ_global_data`: `FdrFJe`, `cfb2h`, `SNlM0e`) and hands them to the content script, which calls the internal `batchexecute` endpoint with the user's cookies.
- All internal API calls live in `src/api/`, so fixes are isolated when Google changes its site.
- Images are served from `photos.fife.usercontent.google.com`; append a size suffix to the base URL (e.g. `=w1600-h1600`, `=w256-h256-c` for square crops).
- Videos: `=m22` (720p MP4) with `=m18` (360p) as fallback; they need the user's cookies, which `<video>` sends. `=dv` and `=m37` don't work.

### Google Photos internal API (verified in phase 1)

Found in photos.google.com's JS bundle (`PhotosFeService.*` method names) and verified against the user's account on build `boq_photosuiserver_20260924.10_p0`. Write operations were tested only on uploaded test images.

| Operation | RPC ID | Service method | Payload | Notes |
|---|---|---|---|---|
| List library | `lcxiM` | PhotosGetUserItems | `[pageToken, null, null, null, 1, 1]` | Newest first, 300 per page. Item: `[mediaKey, [url, w, h, …], takenAt, dedupKey, tzOffset, uploadedAt, …, {ext}]`. Videos carry ext field `76647426` = `[durationMs, …]`. |
| Item info | `fDcn4b` | PhotosGetPhotoInfo | `[mediaKey]` | `[[key, description, filename, takenAt, tz, sizeBytes, w, h, …]]` |
| List albums | `Z5xsfc` | PhotosGetUserCollections | `[]` | Album: `[albumKey, …, {"72930366": [?, title, times, itemCount, …]}]`; metadata object position varies. |
| Album contents | `snAcKc` | PhotosGetCollection | `[albumKey, pageToken, null, null]` | `[_, items, nextPageToken, [albumKey, title, …]]`. Items have their own album-item key; match to library via dedup key. |
| Create album | `OXvT9d` | PhotosCreateAlbum | `[title, null, 2]` | Returns `[[albumKey]]` |
| Add to album | `E1Cajb` | PhotosAddToAlbum | `[[mediaKeys…], albumKey]` | Returns `[albumKey, [albumItemKeys], [[[mediaKey, albumItemKey, status]…]]]`; re-adding is harmless (status 2, same key). |
| Remove from album | `pn5t0c` | PhotosRemoveItems | `[[albumItemKeys…]]` | Photo stays in library |
| Rename album | `SVP9Xd` | PhotosSetCollectionTitle | `[albumKey, title]` | Used for the progress bookmark |
| Move to trash | `XwAOJf` | PhotosDeleteItems | `[null, 1, [dedupKeys…], 3]` | Recoverable from Trash |
| Restore from trash | `XwAOJf` | PhotosDeleteItems | `[null, 3, [dedupKeys…], 2]` | |
| Recently added | `EzkLib` | PhotosSearchItems | `[null, null, pageToken, null, pageSize, null, null, [null, [[[…13×null, [[[]]]]]]]]` | Newest upload first; used for incremental index refresh. |
| Move to Locked Folder | `StLnCe` | PhotosMarsDataService.PhotosMoveItemsToCloudLockedFolder | `[[dedupKeys…], []]` | No password needed. Item leaves the library. |
| Move out of Locked Folder | `Pp2Xxe` | PhotosMarsDataService.PhotosMoveItemsOutOfCloudLockedFolder | `[[dedupKeys…], []]` | No password needed. Item returns with a **new media key and upload time**, same dedup key. |
| Delete album | `hjPofe` | PhotosRemoveCollections | `[[albumKey]]` | Photos stay in the library. Not used by the app; used to clean up test albums. |

Not verified yet:
- The maximum number of items per album (Google's documented limit is 20,000), so "🗑 To Delete" keeps the rollover plan.
- Pagination of album contents and album lists beyond one page (no large album available to test).

Stack: TypeScript, esbuild, Preact, `idb` for IndexedDB.

## Risks

- **Unofficial API**: may break when Google changes photos.google.com; needs a patch when it does.
- **Rate limits**: large operations (e.g. trashing 20,000 photos) take minutes by design.
- **Account**: calls are the same ones the website makes from the user's own session — low risk, but not officially supported.
- **Brave Android extensions are experimental**: may be buggy, missing from the stable build, or changed/paused by Brave. Fallback: Firefox for Android.

## First milestone

A proof of concept that confirms the risky parts work:

1. List the library (oldest first).
2. Create a test album and add one photo to it.
3. Move one user-chosen photo to trash.
4. Create the "SnapSort · progress" album and write/read a bookmark in its title.
5. Check whether library items include upload time as well as taken time.
6. Run the same test in Brave on the laptop and in Brave Android with the extensions flag enabled.

Once that works, build the review UI, progress sync, album picker and delete folder on top.
