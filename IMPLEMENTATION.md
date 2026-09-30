# SnapSort — Implementation Plan

Phase-by-phase plan for building the extension described in [REQUIREMENTS.md](REQUIREMENTS.md).

Each phase ends with something that runs in Brave and a clear exit check. Phase 1 proves the risky parts (Google's internal API) before any UI is built on top of them.

## Overview

| Phase | What | Depends on | Size | Status |
|---|---|---|---|---|
| 0 | Project setup | — | S | ✅ Built; not yet loaded in Brave |
| 1 | API proof of concept | 0 | L | ✅ Verified in Chrome (test images only) |
| 2 | Library index | 1 | M | ✅ Verified: 6,592 items indexed in 15 s |
| 3 | Review screen (UI only) | 2 | M | ✅ Verified in Chrome |
| 4 | Keep / discard / undo | 3 | M | ✅ Verified in Chrome (test images) |
| 5 | Album picker | 4 | M | ✅ Verified in Chrome (test images) |
| 6 | Progress sync | 4 | M | ✅ Verified in Chrome (bookmark album, "new since last time") |
| 7 | Delete folder + trash | 4 | M | ✅ Verified in Chrome (rescue + trash on test images) |
| 7a | Move to Locked Folder (tap sheet + `L`, undo) | 5 | S | ✅ Verified in Chrome (test images) |
| 8 | Phone (Brave Android) | 3–7 | M | ⏳ Needs the user's phone; layout checked at 390 px |
| 9 | Hardening and polish | all | M | 🟡 Mostly done (see phase 9) |

Phases 5, 6 and 7 are independent of each other and can be built in any order after phase 4.

## Project structure

```
snapsort/
├─ manifest.json            # MV3 manifest
├─ src/
│  ├─ api/                  # ALL Google internal API code lives here
│  │  ├─ rpc.ts             # batchexecute request/response encoding
│  │  ├─ token.ts           # reads session token from the page
│  │  ├─ library.ts         # list library pages
│  │  ├─ albums.ts          # list / create / add / remove / describe
│  │  └─ trash.ts           # move to trash
│  ├─ main-world/           # tiny script in the page's JS context (token only)
│  ├─ content/              # content script: launch button, mounts the UI
│  ├─ db/                   # IndexedDB: library index + incremental refresh (indexer.ts)
│  ├─ review/               # review session, services wiring, albums, delete folder logic
│  ├─ sync/                 # write queue, "🗑 To Delete" albums, progress bookmark
│  ├─ ui/                   # Preact components (review, album picker, delete folder, help)
│  ├─ harness/              # dev-only test harness (not shipped)
│  └─ shared/               # types, throttling, logging
├─ tests/
│  └─ fixtures/             # saved (anonymised) API responses for parser tests
├─ REQUIREMENTS.md
└─ IMPLEMENTATION.md
```

---

## Phase 0 — Project setup

**Goal:** an empty extension that loads in Brave and injects a button on photos.google.com.

- Scaffold: TypeScript + Preact, bundled with **esbuild** (`scripts/build.mjs`). Chosen over Vite because the extension is only content scripts, which must be self-contained IIFE bundles; esbuild does that directly with no plugin.
- `manifest.json` (MV3):
  - `host_permissions`: `https://photos.google.com/*`
  - `content_scripts`: one in the default isolated world (UI + API), one in `"world": "MAIN"` (token reader only).
  - `permissions`: `storage`.
  - Only add `*.googleusercontent.com` if loading images/videos turns out to need it (plain `<img>`/`<video>` tags shouldn't).
- Vitest for unit tests, ESLint + Prettier.
- `npm run dev` (watch build) and `npm run build` (zip for loading/installing).

**Exit check:** load unpacked in Brave desktop → open photos.google.com → a "SnapSort" button appears.

---

## Phase 1 — API proof of concept (highest risk)

**Goal:** prove every Google call SnapSort needs works from the extension, and capture the formats.

### 1a. Reverse-engineer the calls
Use Brave DevTools → Network on photos.google.com, filter by `batchexecute`, and perform each action by hand. Record the RPC ID, request payload and response shape. Cross-check against open-source projects (e.g. Google Photos Toolkit).

| Action | Needed for |
|---|---|
| List library page (with pagination token) | Phase 2 |
| Get item details (filename, size, upload time) | Phases 2, 3, 6 |
| List albums | Phase 5 |
| Create album | Phases 4, 5, 6 |
| Add items to album | Phases 4, 5 |
| Remove items from album | Undo, rescue |
| List items in an album | Phase 7 |
| Rename album (progress bookmark) | Phase 6 |
| Move items to trash | Phase 7 |

### 1b. Build the API layer
- `token.ts`: MAIN-world script reads the session token (`WIZ_global_data`) and hands it to the content script via `window.postMessage`. The isolated content script can't read page variables directly.
- `rpc.ts`: POST to `/_/PhotosUi/data/batchexecute` from the content script (same origin, so the user's cookies are sent). Encode `f.req`, strip the `)]}'` prefix, parse the nested JSON response.
- One typed function per action in the table above.
- Save anonymised responses as test fixtures; unit-test every parser against them.

### 1c. Manual test page
A hidden debug panel (dev builds only) with buttons for each action, to run against the real account:

1. List the first 3 pages of the library.
2. Create album "SnapSort test", add one photo, remove it.
3. Write and read back a JSON string in that album's title.
4. Move one photo the user picks to trash, then restore it by hand from Google Photos Trash.
5. Check whether items include **upload time** as well as taken time.
6. Check the **maximum items per album** (believed to be 20,000) — affects "🗑 To Delete".

**Exit check:** all six work in Brave desktop. Findings (RPC IDs, limits, upload-time answer) written into `REQUIREMENTS.md` → *Technical notes*.

**If it fails:** if trash or add-to-album can't be made to work, stop and revisit the approach before building UI.

---

## Phase 2 — Library index

**Goal:** a complete local list of every photo/video, sorted oldest first.

- Page through the whole library and store items in IndexedDB (`db/`): ID, taken time, upload time (if available), width/height, is-video, base image URL.
- Show progress on first scan ("Indexing 12,400 / ~48,000"). Throttle requests.
- Resumable: store the pagination token so a closed tab continues the scan.
- Incremental rescans: only fetch items newer than the last scan.
- Index sorted by `(takenTime, id)` so "next unreviewed photo" is a fast lookup.
- Fetch filename/size lazily (only for photos about to be shown), since per-item details are a separate call.

**Exit check:** full index of the real library; counts roughly match Google Photos; rescan picks up a newly uploaded photo.

---

## Phase 3 — Review screen (UI only)

**Goal:** the full-screen swipe experience, without changing anything in Google Photos yet.

- Launch button (from phase 0) opens a full-screen overlay mounted in a **Shadow DOM**, so Google's CSS can't break it (and vice versa).
- Card showing the current photo at screen size (`=w{W}-h{H}` URL suffix); videos with `<video muted controls>`.
- Info bar: date, filename, size, position (`1,204 / 48,213`).
- Preload the next 3 photos.
- Input handling (Pointer Events, works for mouse and touch):
  - Drag → card follows, tilts, tints green (right) / red (left).
  - Release past threshold → swipe; otherwise snap back.
  - Movement under a few px → **tap** (opens album picker in phase 5).
  - Keys: `→` keep, `←` discard, `Z` undo, `A` albums, `Esc` close.
- Decisions stored in memory only for now.

**Exit check:** swiping through 100 photos feels instant on the laptop; tap vs swipe is never confused.

---

## Phase 4 — Keep / discard / undo

**Goal:** swipes have real effects in Google Photos.

- On first use, find or create the **"🗑 To Delete"** album.
- **Discard** → add photo to "🗑 To Delete". **Keep** → no Google call.
- Advance the local bookmark after every swipe (IndexedDB), so a reload resumes at the right photo.
- **Undo (`Z`)**: move the bookmark back one; if it was a discard, remove the photo from "🗑 To Delete". Keep an undo stack (e.g. last 50).
- **Optimistic UI + write queue**: the next photo appears immediately; Google calls go into a persistent queue that retries on failure and survives reloads.
- If the "🗑 To Delete" album hits the per-album limit (from phase 1), roll over to "🗑 To Delete 2", etc.

**Exit check:** discard 20 photos → they appear in "🗑 To Delete" on the phone's Google Photos app; undo removes one; closing and reopening resumes at the right photo.

---

## Phase 5 — Album picker

**Goal:** tap a photo to add it to any albums.

- Tap (or `A`) opens a bottom sheet / modal:
  - All albums (cached, refreshed on open), with search box.
  - Albums the photo is already in shown ticked (needs a "which albums contain this item" lookup from phase 1; if unavailable, tick only albums added to in this session).
  - Multi-select; ticking adds immediately, unticking removes immediately (via the write queue).
  - **+ New album**: name input → create → auto-tick.
- Selections reset for the next photo.
- Hide SnapSort's own albums ("🗑 To Delete", "SnapSort · progress") from the list.

**Exit check:** create "Ooty trip" from the picker, add 5 photos, see them in Google Photos on the phone.

---

## Phase 6 — Progress sync

**Goal:** laptop and phone share progress.

- Find or create **"SnapSort · progress"** album; store the bookmark as JSON in its **title** (verified in phase 1):
  ```json
  { "v": 1, "taken": 1552367400000, "id": "AF1Qip...", "lastScan": 1727700000000, "updated": 1727700123000 }
  ```
- On open: read remote bookmark, compare with local, **take whichever is further ahead**.
- Write after swipes, debounced (every ~5 s and when the overlay closes / tab hides).
- If offline or a write fails, keep the local copy and push later.
- **"New since last session"**: items uploaded after `lastScan` but taken before the bookmark are shown first, before the main queue continues. (Phase 1 confirmed every item has an upload time.)
- Export / Import progress (download/upload the JSON) as a backup.

**Exit check:** review 30 photos on the laptop → open on another Brave profile (or the phone) → resumes at the same photo.

---

## Phase 7 — Delete folder + trash

**Goal:** review discards and move them to trash.

- Screen listing every item in "🗑 To Delete" (all rollover albums) as a thumbnail grid (virtualised for thousands of items).
- Count and total size to be freed (size fetched lazily; show "≈" until complete).
- Tap a thumbnail → full view → **Rescue** removes it from "🗑 To Delete".
- **Move all to trash**:
  - Confirmation dialog with the count (custom in-page dialog, not `window.confirm`).
  - Trash in batches (e.g. 50) with pauses; progress bar; persistent job so a closed tab resumes.
  - Never empty the trash; never delete the album itself.
- Local log of trashed IDs + filenames, downloadable as CSV.

**Exit check:** discard 10 test photos → rescue 2 → trash 8 → the 8 are in Google Photos Trash and restorable; the 2 are untouched.

---

## Phase 8 — Phone (Brave Android)

**Goal:** the same extension works on the phone.

- Enable `brave://flags/#brave-android-extensions`; install the built extension (unpacked / `.crx` / Web Store).
- Verify: content scripts run, MAIN-world script runs, launch button appears (no toolbar on phones, so the in-page button is the only entry point).
- Check photos.google.com's mobile layout doesn't hide/break the launch button; position it as a fixed floating button.
- Touch tuning: swipe thresholds, tap detection, bottom-sheet album picker, safe areas, no accidental browser back-swipe or pull-to-refresh (`overscroll-behavior`, `touch-action`).
- Image sizes suited to the phone screen and mobile data.

**Exit check:** full flow (swipe, album, sync, delete folder) works on the phone.

**If Brave Android extensions don't work:** build for Firefox for Android (add `browser_specific_settings`, check MV3/`world: MAIN` support there) and test the same checklist.

---

## Phase 9 — Hardening and polish

Status: done — shape validation pauses the write queue with a "SnapSort needs an update" message; throttling with back-off; "session expired — reload" message on HTTP 400/401/403; `?` help panel with shortcuts; Export / Import progress; DB upgrades close stale connections. Not done: settings (swipe direction, data saver), full-library performance check on a larger library, Web Store packaging.

- **Breakage detection:** validate every API response shape; on mismatch show "Google Photos changed something — SnapSort needs an update" instead of failing silently. Pause the write queue so nothing is half-done.
- **Rate limiting:** global request throttle with back-off on errors / 429s.
- **Session expiry:** detect logged-out / expired token and ask the user to reload the page.
- **Settings:** swipe direction swap, image quality (data saver on phone).
- Keyboard shortcut help overlay (`?`).
- Performance check with the full library (tens of thousands of items): index lookups, grid scrolling, memory.
- Packaging: versioned zip; optional private Chrome Web Store listing for easy install on both devices.

---

## Testing strategy

- **Offline demo (`npm run demo`):** the real UI on made-up sample pictures with `src/api` swapped for `src/demo/mockApi.ts` at build time. Used for screenshots and UI work without a Google account; `node scripts/demo.mjs --bundle` outputs a standalone script (a private demo page was published from it).

- **Dev harness (automated testing without installing the extension):** `npm run harness` builds `.harness/harness-api.js` (API only) and `.harness/harness.js` (API + UI). They run the real `src/` code in a photos.google.com tab's page context, using the page's session directly instead of the MAIN-world bridge. Loaded through a temporary `<input type=file>` in the page (Chrome blocks fetching from localhost, and Claude in Chrome can't load unpacked extensions). The production `dist/main-world.js` + `dist/content.js` were also loaded this way to exercise the session bridge; only the isolated-world behaviour needs a real extension install.

- **Unit tests (Vitest):** RPC encoding/decoding against saved fixtures, bookmark merge logic, "next unreviewed" lookup, write-queue retry, album-rollover logic.
- **Manual checklist per phase** (the exit checks above), run on a small set of test photos before the real library.
- **Safe test data:** before the first run on the real library, test destructive actions on a few photos uploaded specifically for testing.

## Open questions

Answered in phase 1:

1. **RPC IDs and payloads:** see the API table in REQUIREMENTS.md → *Technical notes*.
2. **Upload time:** yes, every library item includes it.
3. **Album descriptions:** not needed; the bookmark fits in the album title (verified).
4. **"Which albums contain this photo":** no such field found. The picker ticks only albums added in the current session.

Still open:

5. **Max items per album** (believed 20,000) — can't practically test; keep the rollover plan.
6. **Pagination** of large albums / many albums — verify once a large "🗑 To Delete" exists.
7. **Brave Android extensions flag** on the user's phone — user to check.
8. **Real extension load** in Brave desktop (phase 0 exit check, content-script session bridge) — user to check.
