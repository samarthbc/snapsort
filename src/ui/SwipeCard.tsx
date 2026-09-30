// The photo card: follows the pointer while dragging, tilts and tints green (keep, right) or
// red (discard, left). A release past the threshold is a swipe; a short press with almost no
// movement is a tap.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { MediaItem } from '../api/library';
import type { Decision } from '../review/session';
import { sizedUrl, videoUrls } from '../review/format';

interface Props {
  item: MediaItem;
  onDecide: (decision: Decision) => void;
  /** Called as soon as the card starts flying off (before onDecide). */
  onLeaving?: () => void;
  onTap: () => void;
  /** Set by keyboard shortcuts to play the fly-out animation. */
  flyOut: Decision | null;
}

const TAP_MAX_MOVE = 8;
const FLY_MS = 180;

export function swipeThreshold(width: number): number {
  return Math.max(80, width * 0.22);
}

export function SwipeCard({ item, onDecide, onLeaving, onTap, flyOut }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const left = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const [videoSrc, setVideoSrc] = useState(0);

  useEffect(() => {
    setDx(0);
    setDy(0);
    setLeaving(null);
    setVideoSrc(0);
  }, [item.key]);

  useEffect(() => {
    if (flyOut) leave(flyOut);
  }, [flyOut]);

  function leave(decision: Decision) {
    if (left.current) return; // a card leaves once, even if two inputs arrive together
    left.current = true;
    onLeaving?.();
    setLeaving(decision);
    if (decision === 'lock') {
      setDy(-window.innerHeight * 1.2); // Locked Folder: fly up
    } else {
      setDx((decision === 'keep' ? 1 : -1) * window.innerWidth * 1.2);
    }
    setTimeout(() => onDecide(decision), FLY_MS);
  }

  function onPointerDown(e: PointerEvent) {
    if (leaving || drag.current) return;
    const target = e.target as HTMLElement;
    // Leave the bottom strip of a video to its native controls (scrub bar).
    if (target.tagName === 'VIDEO') {
      const rect = target.getBoundingClientRect();
      if (e.clientY > rect.bottom - 56) return;
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    ref.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x,
      my = e.clientY - d.y;
    if (Math.hypot(mx, my) > TAP_MAX_MOVE) d.moved = true;
    if (d.moved) {
      setDx(mx);
      setDy(my * 0.3);
    }
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const width = ref.current?.parentElement?.clientWidth ?? window.innerWidth;
    // Use the release position, not the dx state: a fast flick may deliver a single move
    // event whose state update hasn't rendered yet.
    const releaseDx = e.clientX - d.x;
    const moved = d.moved || Math.hypot(releaseDx, e.clientY - d.y) > TAP_MAX_MOVE;
    if (!moved) {
      onTap();
    } else if (Math.abs(releaseDx) > swipeThreshold(width)) {
      leave(releaseDx > 0 ? 'keep' : 'discard');
    } else {
      setDx(0);
      setDy(0);
    }
  }

  function onPointerCancel() {
    drag.current = null;
    setDx(0);
    setDy(0);
  }

  const width = ref.current?.parentElement?.clientWidth ?? window.innerWidth;
  const strength = Math.min(1, Math.abs(dx) / swipeThreshold(width));
  const tint = dx > 0 ? 'keep' : dx < 0 ? 'discard' : null;
  const dragging = drag.current?.moved;
  const style = {
    transform: `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`,
    transition: dragging ? 'none' : `transform ${FLY_MS}ms ease-out`,
  };
  const box = { w: window.innerWidth, h: window.innerHeight };
  const sources = videoUrls(item.baseUrl);

  return (
    <div
      ref={ref}
      class="card"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div class="frame">
        {item.isVideo ? (
          <video
            key={item.key}
            class="media"
            src={sources[videoSrc]}
            poster={sizedUrl(item.baseUrl, box.w, box.h)}
            controls
            muted
            autoplay
            loop
            playsInline
            onError={() => setVideoSrc((i) => Math.min(i + 1, sources.length - 1))}
          />
        ) : (
          <img
            key={item.key}
            class="media"
            src={sizedUrl(item.baseUrl, box.w, box.h)}
            alt=""
            draggable={false}
          />
        )}
        {tint && (
          <div class={`tint tint-${tint}`} style={{ '--strength': strength }}>
            <span class="tint-label">{tint === 'keep' ? 'KEEP' : 'DISCARD'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
