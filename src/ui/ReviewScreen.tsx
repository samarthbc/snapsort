import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../api';
import type { ItemInfo, MediaItem } from '../api/library';
import { openDb } from '../db/db';
import type { ScanProgress } from '../db/indexer';
import { formatBytes, formatDuration, formatTaken, sizedUrl } from '../review/format';
import { startReview, type Review } from '../review/services';
import type { Decision } from '../review/session';
import type { QueueStatus } from '../sync/writeQueue';
import { AlbumPicker } from './AlbumPicker';
import { HelpPanel } from './HelpPanel';
import { SwipeCard } from './SwipeCard';

interface Props {
  onClose: () => void;
  onOpenDeleteFolder: () => void;
}

type Stage =
  | { kind: 'loading'; progress: ScanProgress | null }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

const PRELOAD = 3;

/** True when a key event was typed into a text field (inside our shadow DOM or the page). */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.composedPath()[0] as HTMLElement | undefined;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function ReviewScreen({ onClose, onOpenDeleteFolder }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading', progress: null });
  const [review, setReview] = useState<Review | null>(null);
  const [, setTick] = useState(0);
  const [flyOut, setFlyOut] = useState<Decision | null>(null);
  const [info, setInfo] = useState<Record<string, ItemInfo | null>>({});
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const session = review?.session ?? null;

  // Sync the index and bookmark, then start reviewing.
  useEffect(() => {
    const ctl = new AbortController();
    let r: Review | null = null;
    (async () => {
      try {
        const db = await openDb();
        r = await startReview(
          db,
          (progress) => setStage({ kind: 'loading', progress }),
          ctl.signal,
        );
        r.session.subscribe(() => setTick((t) => t + 1));
        r.queue.subscribe(() => setQueueStatus(r!.queue.status));
        setQueueStatus(r.queue.status);
        setReview(r);
        setStage({ kind: 'ready' });
      } catch (err) {
        if (!ctl.signal.aborted) setStage({ kind: 'error', message: String(err) });
      }
    })();
    const onHide = () => {
      if (document.visibilityState === 'hidden') void r?.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      ctl.abort();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void r?.flush();
    };
  }, []);

  const current = session?.current ?? null;

  // Fetch filename/size for the current and next photos; preload next images.
  useEffect(() => {
    if (!session) return;
    const upcoming = session.upcoming.slice(0, PRELOAD + 1);
    for (const item of upcoming) {
      if (!(item.key in info)) {
        setInfo((m) => ({ ...m, [item.key]: null }));
        api
          .getItemInfo(item.key)
          .then((i) => setInfo((m) => ({ ...m, [item.key]: i })))
          .catch(() => {});
      }
    }
    for (const item of upcoming.slice(1)) {
      if (!item.isVideo)
        new Image().src = sizedUrl(item.baseUrl, window.innerWidth, window.innerHeight);
    }
  }, [current?.key]);

  // Decisions and undos run strictly in order. A card that's flying off holds the chain until
  // its decision is recorded, so an undo pressed mid-animation undoes *that* photo instead of
  // being dropped or undoing the one before.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const leaveDone = useRef<(() => void) | null>(null);
  const flying = useRef(false);

  /** Holds the chain until the leaving card's decision is recorded. Idempotent per card. */
  function onLeaving() {
    if (flying.current) return;
    flying.current = true;
    chain.current = chain.current.then(
      () => new Promise<void>((resolve) => (leaveDone.current = resolve)),
    );
  }

  /** Keyboard / button: fly the current card off. Holds the chain right away, so an undo in
   * the same instant still waits for this decision. */
  function fly(decision: Decision) {
    if (!session?.current || flying.current) return;
    onLeaving();
    setFlyOut(decision);
  }

  async function decide(decision: Decision) {
    if (!session) return;
    setFlyOut(null);
    try {
      await session.decide(decision);
    } finally {
      flying.current = false;
      leaveDone.current?.();
      leaveDone.current = null;
    }
  }

  function undo() {
    if (!session) return;
    chain.current = chain.current.then(() => session.undo());
  }

  // One keyboard handler for the whole screen (including the album picker), registered once
  // and reading the latest state from a ref, so no keypress hits a stale handler.
  const keyState = useRef({ session, pickerOpen, helpOpen, current, onClose, undo, fly });
  keyState.current = { session, pickerOpen, helpOpen, current, onClose, undo, fly };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keyState.current;
      if (e.key === 'Escape') {
        if (s.pickerOpen) setPickerOpen(false);
        else if (s.helpOpen) setHelpOpen(false);
        else s.onClose();
      } else if (s.pickerOpen || isTyping(e)) {
        return; // let the picker's text field have the keys
      } else if (e.key === '?') {
        setHelpOpen((open) => !open);
      } else if (s.helpOpen) {
        return; // no swiping behind the help panel
      } else if (!s.session || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (e.key === 'ArrowRight') s.fly('keep');
      else if (e.key === 'ArrowLeft') s.fly('discard');
      else if (e.key === 'z' || e.key === 'Z') void s.undo();
      else if ((e.key === 'a' || e.key === 'A') && s.current) setPickerOpen(true);
      else if (e.key === 'l' || e.key === 'L') s.fly('lock');
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const catchupLeft = session?.catchup.length ?? 0;

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="SnapSort">
      <header class="topbar">
        <span class="brand">SnapSort</span>
        {session && (
          <span class="position">
            {catchupLeft > 0
              ? `New since last time · ${catchupLeft.toLocaleString()} left`
              : `${Math.min(session.reviewedCount + 1, session.total).toLocaleString()} / ${session.total.toLocaleString()}`}
          </span>
        )}
        {queueStatus && <SaveStatus status={queueStatus} />}
        <button
          class="icon-btn"
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="Help"
          title="Shortcuts and backup"
        >
          ?
        </button>
        <button
          class="icon-btn"
          type="button"
          onClick={onOpenDeleteFolder}
          aria-label="Delete folder"
          title="Delete folder"
        >
          🗑
        </button>
        <button class="icon-btn" type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <main class="stage">
        {stage.kind === 'loading' && <Loading progress={stage.progress} />}
        {stage.kind === 'error' && <p class="message">Something went wrong: {stage.message}</p>}
        {stage.kind === 'ready' && session?.done && (
          <p class="message">All caught up — every photo has been reviewed.</p>
        )}
        {stage.kind === 'ready' && current && (
          <SwipeCard
            key={current.key}
            item={current}
            onDecide={decide}
            onLeaving={onLeaving}
            onTap={() => setPickerOpen(true)}
            flyOut={flyOut}
          />
        )}
      </main>

      {current && <InfoBar item={current} info={info[current.key] ?? null} />}

      {session && (
        <footer class="actions">
          <button class="action discard" type="button" onClick={() => fly('discard')}>
            ← Discard
          </button>
          <button class="action undo" type="button" onClick={undo} disabled={!session.canUndo}>
            ↶ Undo
          </button>
          <button class="action keep" type="button" onClick={() => fly('keep')}>
            Keep →
          </button>
        </footer>
      )}

      {helpOpen && <HelpPanel review={review} onClose={() => setHelpOpen(false)} />}

      {pickerOpen && review && current && (
        <AlbumPicker
          albums={review.albums}
          item={current}
          onClose={() => setPickerOpen(false)}
          onLock={() => {
            setPickerOpen(false);
            fly('lock');
          }}
        />
      )}
    </div>
  );
}

function Loading({ progress }: { progress: ScanProgress | null }) {
  const reached =
    progress?.reachedTakenAt &&
    new Date(progress.reachedTakenAt).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  return (
    <div class="message">
      <div class="spinner" aria-hidden="true" />
      <p>
        {!progress
          ? 'Loading…'
          : progress.phase === 'refresh'
            ? `Checking for new photos · ${progress.itemsFetched.toLocaleString()}`
            : `Indexing your library · ${progress.itemsFetched.toLocaleString()} items`}
      </p>
      {reached && <p class="muted">Reached {reached}</p>}
    </div>
  );
}

function InfoBar({ item, info }: { item: MediaItem; info: ItemInfo | null }) {
  return (
    <div class="infobar">
      <span>{formatTaken(item)}</span>
      {info && <span class="filename">{info.filename}</span>}
      {info?.sizeBytes != null && <span>{formatBytes(info.sizeBytes)}</span>}
      {item.isVideo && <span>▶ {formatDuration(item.durationMs)}</span>}
    </div>
  );
}

function SaveStatus({ status }: { status: QueueStatus }) {
  if (status.broken) {
    return (
      <span class="status status-error" title={status.error ?? ''}>
        ⚠ Google Photos changed — SnapSort needs an update
      </span>
    );
  }
  if (status.error) {
    const signedOut = /HTTP 40[013]/.test(status.error);
    return (
      <span class="status status-error" title={status.error}>
        {signedOut ? '⚠ Google session expired — reload the page' : `⚠ Retrying… ${status.pending}`}
      </span>
    );
  }
  if (status.pending > 0) return <span class="status">Saving… {status.pending}</span>;
  return <span class="status">✓ Saved</span>;
}
