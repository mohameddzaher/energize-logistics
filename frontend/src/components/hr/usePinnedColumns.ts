'use client';
/**
 * Pinned columns at the start of HR tables: actions, employee number, name and ID, while the rest scrolls under them.
 * Tables are wider than the screen, so row identity and actions stay visible. Widths are measured from the header with ResizeObserver and summed, since they vary by language and name length. `start` rather than `left` follows page direction. Pinned cells have an explicit background; the row carries `group` so hover tinting covers the pinned part.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function usePinnedColumns(count: number) {
  const [widths, setWidths] = useState<number[]>(() => Array(count).fill(0));
  const observers = useRef<(ResizeObserver | null)[]>([]);

  useEffect(() => () => { observers.current.forEach((o) => o?.disconnect()); }, []);

  const refs = useMemo(() => Array.from({ length: count }, (_, i) => (el: HTMLElement | null) => {
    observers.current[i]?.disconnect();
    observers.current[i] = null;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidths((prev) => (Math.abs((prev[i] || 0) - w) < 0.5 ? prev : prev.map((x, j) => (j === i ? w : x))));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const o = new ResizeObserver(measure);
      o.observe(el);
      observers.current[i] = o;
    }
  }), [count]);

  const offset = useCallback((i: number) => widths.slice(0, i).reduce((a, b) => a + b, 0), [widths]);

  /** Header props of pinned column i. */
  const th = useCallback((i: number, extra = '') => ({
    ref: refs[i],
    className: `sticky z-30 bg-slate-900 ${i === count - 1 ? 'border-e border-slate-600' : ''} ${extra}`,
    style: { insetInlineStart: offset(i) },
  }), [refs, offset, count]);

  /** Cell props of pinned column i in a row. */
  const td = useCallback((i: number, extra = '', bg = 'bg-white group-hover:bg-slate-50') => ({
    className: `sticky z-20 ${bg} ${i === count - 1 ? 'border-e border-slate-200' : ''} ${extra}`,
    style: { insetInlineStart: offset(i) },
  }), [offset, count]);

  return { th, td };
}
