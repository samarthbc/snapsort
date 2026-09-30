import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../api';
import { openDb, type Db } from '../db/db';
import {
  getTrashJob,
  getTrashLog,
  loadDeleteFolder,
  rescue,
  runTrashJob,
  startTrashJob,
  trashLogCsv,
  type DeleteFolderItem,
} from '../review/deleteFolder';
import { countLabel, formatBytes, sizedUrl } from '../review/format';
import { getQueue } from '../review/services';

interface Props {
  onBack: () => void;
  onClose: () => void;
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' }
  | { kind: 'confirm' }
  | { kind: 'trashing'; done: number; total: number }
  | { kind: 'finished'; count: number };

const PAGE = 300;
const deps = {
  listAlbums: api.listAlbums,
  createAlbum: api.createAlbum,
  getAllAlbumItems: api.getAllAlbumItems,
  removeFromAlbum: api.removeFromAlbum,
  moveToTrash: api.moveToTrash,
};

export function DeleteFolder({ onBack, onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [items, setItems] = useState<DeleteFolderItem[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [preview, setPreview] = useState<DeleteFolderItem | null>(null);
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const [interrupted, setInterrupted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const dbRef = useRef<Db | null>(null);
  const abort = useRef(new AbortController());

  async function load() {
    setStage({ kind: 'loading' });
    const db = (dbRef.current ??= await openDb());
    // Let pending discards reach Google first, so the folder is complete.
    await (await getQueue(db)).idle();
    const [list, job] = await Promise.all([loadDeleteFolder(db, deps), getTrashJob(db)]);
    setItems(list);
    setInterrupted(job?.remaining.length ?? 0);
    setStage({ kind: 'ready' });
  }

  useEffect(() => {
    load().catch((err) => setStage({ kind: 'error', message: String(err) }));
    const ctl = abort.current;
    return () => ctl.abort();
  }, []);

  // Look up file sizes in the background for the "space freed" total.
  useEffect(() => {
    const signal = abort.current.signal;
    (async () => {
      for (const item of items) {
        if (signal.aborted) return;
        if (!item.mediaKey || sizes.has(item.dedupKey)) continue;
        try {
          const info = await api.getItemInfo(item.mediaKey);
          if (info.sizeBytes != null) {
            setSizes((m) => new Map(m).set(item.dedupKey, info.sizeBytes!));
          }
        } catch {
          // Size is informational only.
        }
      }
    })();
  }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (preview) setPreview(null);
      else if (stage.kind === 'confirm') setStage({ kind: 'ready' });
      else if (stage.kind !== 'trashing') onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [preview, stage.kind]);

  async function doRescue(item: DeleteFolderItem) {
    setBusy(true);
    try {
      await rescue(dbRef.current!, deps, item);
      setItems((list) => list.filter((i) => i.dedupKey !== item.dedupKey));
      setPreview(null);
    } catch (err) {
      setInlineError(`Couldn't rescue: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function trashAll(resume: boolean) {
    const db = dbRef.current!;
    try {
      if (!resume) {
        // Re-read the albums right before trashing so only what's there now is trashed.
        await (await getQueue(db)).idle();
        const fresh = await loadDeleteFolder(db, deps);
        if (fresh.length === 0) {
          setItems([]);
          setStage({ kind: 'ready' });
          return;
        }
        await startTrashJob(db, fresh);
      }
      const job = await getTrashJob(db);
      const total = job?.total ?? 0;
      setStage({ kind: 'trashing', done: total - (job?.remaining.length ?? 0), total });
      await runTrashJob(
        db,
        deps,
        (done, t) => setStage({ kind: 'trashing', done, total: t }),
        abort.current.signal,
      );
      setInterrupted(0);
      setItems([]);
      setStage({ kind: 'finished', count: total });
    } catch (err) {
      if (abort.current.signal.aborted) return;
      setInterrupted((await getTrashJob(db))?.remaining.length ?? 0);
      setStage({ kind: 'ready' });
      setInlineError(`Moving to trash stopped: ${String(err)}. You can continue it.`);
    }
  }

  async function downloadLog() {
    const csv = trashLogCsv(await getTrashLog(dbRef.current!));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `snapsort-trash-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const knownSize = [...sizes.values()].reduce((a, b) => a + b, 0);
  const sizedCount = sizes.size;
  const withKeys = items.filter((i) => i.mediaKey).length;

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Delete folder">
      <header class="topbar">
        <button class="icon-btn" type="button" onClick={onBack} aria-label="Back to review">
          ←
        </button>
        <span class="brand">Delete folder</span>
        <span class="position">
          {stage.kind === 'ready' || stage.kind === 'confirm'
            ? `${countLabel(items.length)}${
                knownSize > 0
                  ? ` · ${sizedCount < withKeys ? '≈ ' : ''}${formatBytes(knownSize)}`
                  : ''
              }`
            : ''}
        </span>
        <button class="icon-btn" type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <main class="folder">
        {stage.kind === 'loading' && (
          <div class="message">
            <div class="spinner" aria-hidden="true" />
            <p>Loading the delete folder…</p>
          </div>
        )}
        {stage.kind === 'error' && <p class="message">Something went wrong: {stage.message}</p>}
        {inlineError && <p class="banner banner-error">{inlineError}</p>}
        {interrupted > 0 && stage.kind === 'ready' && (
          <p class="banner">
            A previous "Move to trash" stopped with {countLabel(interrupted)} left.{' '}
            <button class="text-btn" type="button" onClick={() => trashAll(true)}>
              Continue
            </button>
          </p>
        )}
        {stage.kind === 'trashing' && (
          <div class="message">
            <p>
              Moving to trash… {stage.done.toLocaleString()} / {stage.total.toLocaleString()}
            </p>
            <div class="progress">
              <div style={{ width: `${(100 * stage.done) / Math.max(1, stage.total)}%` }} />
            </div>
            <p class="muted">You can close this; it continues next time you open the folder.</p>
          </div>
        )}
        {stage.kind === 'finished' && (
          <div class="message">
            <p>
              Moved {countLabel(stage.count)} to Google Photos Trash. You can restore them from
              Trash for 60 days.
            </p>
            <button class="text-btn" type="button" onClick={downloadLog}>
              Download log (CSV)
            </button>
          </div>
        )}
        {(stage.kind === 'ready' || stage.kind === 'confirm') && items.length === 0 && (
          <p class="message">Nothing here. Photos you discard while reviewing appear here.</p>
        )}
        {(stage.kind === 'ready' || stage.kind === 'confirm') && items.length > 0 && (
          <>
            <ul class="grid">
              {items.slice(0, shown).map((item) => (
                <li key={item.dedupKey}>
                  <button
                    class="thumb"
                    type="button"
                    onClick={() => setPreview(item)}
                    aria-label="Preview"
                  >
                    <img src={`${item.baseUrl}=w256-h256-c`} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
            {shown < items.length && (
              <button class="text-btn more" type="button" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({(items.length - shown).toLocaleString()} left)
              </button>
            )}
          </>
        )}
      </main>

      {(stage.kind === 'ready' || stage.kind === 'confirm') && items.length > 0 && (
        <footer class="actions">
          <button
            class="action discard wide"
            type="button"
            onClick={() => setStage({ kind: 'confirm' })}
          >
            Move {items.length.toLocaleString()} to trash
          </button>
        </footer>
      )}

      {preview && (
        <div class="sheet-backdrop" onClick={() => setPreview(null)}>
          <div class="preview" onClick={(e) => e.stopPropagation()}>
            <img
              class="media"
              src={sizedUrl(preview.baseUrl, window.innerWidth, window.innerHeight * 0.75)}
              alt=""
            />
            <div class="preview-actions">
              <button class="action undo" type="button" onClick={() => setPreview(null)}>
                Close
              </button>
              <button
                class="action keep"
                type="button"
                disabled={busy}
                onClick={() => doRescue(preview)}
              >
                Rescue (keep it)
              </button>
            </div>
          </div>
        </div>
      )}

      {stage.kind === 'confirm' && (
        <div class="sheet-backdrop" onClick={() => setStage({ kind: 'ready' })}>
          <div class="confirm" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            <p class="confirm-title">Move {countLabel(items.length)} to Google Photos Trash?</p>
            <p class="muted">
              They disappear from your library and every album. You can restore them from Google
              Photos Trash for 60 days.
            </p>
            <div class="preview-actions">
              <button class="action undo" type="button" onClick={() => setStage({ kind: 'ready' })}>
                Cancel
              </button>
              <button class="action discard" type="button" onClick={() => trashAll(false)}>
                Move to trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
