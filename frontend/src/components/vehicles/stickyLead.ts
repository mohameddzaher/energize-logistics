'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Two sticky leading columns in the table: actions, then plate number.
// Vehicle tables are wider than the screen (47 columns in the registry). Actions used to be the last column, forcing a horizontal scroll per row and risking acting on the wrong row. Actions stay fixed, and the plate stays with them as the row identity.

/** First column: actions. Sticks to the table edge. */
export const LEAD = 'sticky start-0 z-20';

/** Background of a first-column cell in a normal row. */
export const LEAD_CELL = `${LEAD} bg-white group-hover:bg-slate-50`;

/** Second column: plate. Its offset is computed, not hard-coded: insetInlineStart is passed in style with the measured actions width. The divider border sits here as the end of the whole sticky area. */
export const LEAD_2 = 'sticky z-20 border-e border-slate-200';
export const LEAD_2_CELL = `${LEAD_2} bg-white group-hover:bg-slate-50`;

/**
 * The actions column width is measured, not assumed.
 * The second sticky column needs to know where the first ends, and the width varies by page and language, so it is measured from the header and re-measured on change. A callback ref is used instead of useRef because the table renders only after loading, so an effect reading ref.current once at mount would find it empty.
 */
export function useLeadOffset() {
  const [offset, setOffset] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    const measure = () => setOffset(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      obs.current = new ResizeObserver(measure);
      obs.current.observe(el);
    }
  }, []);

  useEffect(() => () => obs.current?.disconnect(), []);
  return { ref, offset };
}
