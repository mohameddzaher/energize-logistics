'use client';
// A row's action menu, opened from its button and drawn in document.body.
// Drawn inside the table it was cut by the scroll container, and `position: fixed` under an animated (transformed) ancestor is placed relative to that ancestor, so the menu opened off its button or off screen.
import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const GAP = 4;
const EDGE = 8;

export default function RowMenu({ anchor, onClose, rtl = false, width = 192, children }: {
  anchor: DOMRect; onClose: () => void; rtl?: boolean; width?: number; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Placed after measuring: below the button when it fits, otherwise above it; always inside the viewport.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = anchor.bottom + GAP;
    const top = below + h <= vh - EDGE ? below : Math.max(EDGE, anchor.top - GAP - h);
    const preferred = rtl ? anchor.left : anchor.right - width;
    setPos({ top, left: Math.min(Math.max(EDGE, preferred), vw - width - EDGE) });
  }, [anchor, width, rtl]);

  // The anchor moves with scrolling and resizing, so the menu closes rather than float away from its row.
  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div ref={ref} role="menu" dir={rtl ? 'rtl' : 'ltr'} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
        className="fixed z-[100] rounded-xl border border-slate-200 bg-white py-1 shadow-2xl ring-1 ring-black/5"
        onClick={onClose}>
        {children}
      </div>
    </>,
    document.body,
  );
}
