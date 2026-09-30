// Keyboard shortcuts, plus "Export / Import progress" as a manual backup of the bookmark
// (progress already syncs through Google Photos; this is a safety net).

import { useState } from 'preact/hooks';
import type { Review } from '../review/services';
import type { Bookmark } from '../sync/progress';

interface Props {
  review: Review | null;
  onClose: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['→  or swipe right', 'Keep'],
  ['←  or swipe left', 'Discard (to 🗑 To Delete)'],
  ['Z', 'Undo'],
  ['A  or tap the photo', 'Add to albums'],
  ['L', 'Move to Locked Folder'],
  ['?', 'This help'],
  ['Esc', 'Close'],
];

export function parseProgressFile(text: string): Bookmark | null {
  try {
    const b = (JSON.parse(text) as { snapsortProgress?: Partial<Bookmark> }).snapsortProgress;
    if (!b || b.v !== 1 || typeof b.t !== 'number' || typeof b.k !== 'string') return null;
    return { v: 1, t: b.t, k: b.k, s: typeof b.s === 'number' ? b.s : 0, u: Date.now() };
  } catch {
    return null;
  }
}

export function HelpPanel({ review, onClose }: Props) {
  const [message, setMessage] = useState<string | null>(null);

  function exportProgress() {
    if (!review) return;
    const json = JSON.stringify({ snapsortProgress: review.exportBookmark() }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `snapsort-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMessage('Progress exported.');
  }

  async function importProgress(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !review) return;
    const bookmark = parseProgressFile(await file.text());
    if (!bookmark) {
      setMessage("That file isn't a SnapSort progress export.");
      return;
    }
    await review.importBookmark(bookmark);
    setMessage('Progress imported.');
  }

  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet help" role="dialog" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-header">
          <span class="sheet-title">Shortcuts</span>
          <button class="text-btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
        <dl class="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt>{keys}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <div class="help-actions">
          <button class="text-btn" type="button" onClick={exportProgress} disabled={!review}>
            Export progress
          </button>
          <label class={`text-btn ${review ? '' : 'disabled'}`}>
            Import progress
            <input type="file" accept="application/json,.json" hidden onChange={importProgress} />
          </label>
        </div>
        {message && <p class="muted help-message">{message}</p>}
      </div>
    </div>
  );
}
