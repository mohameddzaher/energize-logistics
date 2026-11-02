'use client';
/**
 * ScrollX: wide-table container with a horizontal scrollbar above the table too, linked to it, shown only when the table overflows and from laptop width (1280px) up.
 * It floats (position: fixed under the header) rather than sticky because overflow-hidden cards and overflow-x-auto <main> become the scroll container.
 * In Arabic scrollLeft is negative; the bars share direction so values copy as is, arrows use absolute values.
 * The bar is drawn by us because the macOS overlay scrollbar hides until scrolled. Replace `<div className="overflow-x-auto">`; other props pass through.
 */
import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ScrollX({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const wrap = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const [float, setFloat] = useState<{ top: number; left: number; width: number } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ size: 100, pos: 0 });   // As a percentage of the track.
  // Laptop-size screen or larger. Measured with a media query, not only the resize event, so it is right on first render and on tablet rotation.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [over, setOver] = useState(false);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = main.current;
    if (!el) return;
    setOver(el.scrollWidth > el.clientWidth + 1);
    const max = el.scrollWidth - el.clientWidth;
    // Handle size = visible part of the table; position = amount scrolled from the start.
    const size = el.scrollWidth ? Math.max(8, (el.clientWidth / el.scrollWidth) * 100) : 100;
    const progress = max > 0 ? Math.min(1, Math.abs(el.scrollLeft) / max) : 0;
    setThumb({ size, pos: progress * (100 - size) });
    const rtl = getComputedStyle(el).direction === 'rtl';
    const pos = Math.abs(el.scrollLeft);                 // Distance from the table start.
    const atStart = pos <= 1;
    const atEnd = pos >= max - 1;
    // The start is the right side in Arabic and the left in English.
    setEdge(rtl ? { right: !atStart, left: !atEnd } : { left: !atStart, right: !atEnd });
  }, []);

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  // Show the bar only when the table is wider than its container and the screen is desktop-size.
  const show = over && wide;

  // Floating: the table header is above the screen edge and its body is still visible.
  useEffect(() => {
    const place = () => {
      const w = wrap.current;
      if (!w) return;
      const header = document.querySelector('header');
      const hb = header ? header.getBoundingClientRect().bottom : 0;
      const offset = Math.max(0, hb);
      const r = w.getBoundingClientRect();
      const next = r.top < offset && r.bottom > offset + 80 ? { top: offset, left: r.left, width: r.width } : null;
      setFloat((p) => (p?.top === next?.top && p?.left === next?.left && p?.width === next?.width ? p : next));
    };
    place();
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, { capture: true } as any);
      window.removeEventListener('resize', place);
    };
  }, []);
  // The bar width changes when it floats and returns, so remeasure and reposition.
  useEffect(() => {
    measure();
  }, [float, measure]);
  const sync = () => measure();

  // Progress 0..1 from the table start, converted to scrollLeft according to direction.
  const setProgress = (p: number) => {
    const el = main.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const v = Math.max(0, Math.min(1, p)) * max;
    el.scrollLeft = rtl ? -v : v;
  };
  const progressAt = (clientX: number) => {
    const tr = top.current;
    const el = main.current;
    if (!tr || !el) return 0;
    const r = tr.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const size = (thumb.size / 100) * r.width;
    const x = rtl ? r.right - clientX : clientX - r.left;   // Distance from the track start.
    return (x - size / 2) / Math.max(1, r.width - size);
  };
  const drag = useRef<{ startX: number; startScroll: number } | null>(null);
  const onThumbDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const el = main.current;
    if (!el) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startScroll: el.scrollLeft };
  };
  const onThumbMove = (e: React.PointerEvent) => {
    const d = drag.current; const el = main.current; const tr = top.current;
    if (!d || !el || !tr) return;
    // One track pixel equals (table width / track width) table pixels.
    const ratio = el.scrollWidth / Math.max(1, tr.clientWidth);
    el.scrollLeft = d.startScroll + (e.clientX - d.startX) * ratio;
  };
  const onThumbUp = () => { drag.current = null; };
  // The wheel over the bar scrolls the table horizontally instead of the page vertically. A native non-passive listener is needed because React's listener is passive and cannot prevent page scroll.
  useEffect(() => {
    const tr = top.current;
    if (!tr) return;
    const onWheel = (e: WheelEvent) => {
      const el = main.current;
      if (!el) return;
      e.preventDefault();
      const rtl = getComputedStyle(el).direction === 'rtl';
      const dy = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      el.scrollLeft += rtl ? -dy : dy;
    };
    tr.addEventListener('wheel', onWheel, { passive: false });
    return () => tr.removeEventListener('wheel', onWheel);
  }, [show]);

  const jump = (dir: 1 | -1) => {
    const el = main.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const btn = 'shrink-0 p-1 rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm hover:text-[#f37121] hover:border-[#f37121]/40 disabled:opacity-30 disabled:hover:text-slate-600 disabled:hover:border-slate-200';

  return (
    <div ref={wrap} className="relative">
      {show && float && <div className="h-[33px]" aria-hidden="true" />}
      {show && (
        <div style={float ? { position: 'fixed', top: float.top, left: float.left, width: float.width } : undefined}
          className={`z-40 flex items-center gap-1.5 px-2 py-1 bg-slate-50/95 backdrop-blur border-b border-slate-200 ${float ? 'shadow-md rounded-b-lg' : ''}`}>
          <button type="button" className={btn} disabled={!edge.right} onClick={() => jump(1)} aria-label="Scroll right">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div ref={top}
            onPointerDown={(e) => { if (e.target === e.currentTarget) setProgress(progressAt(e.clientX)); }}
            className="group/track relative flex-1 h-3 rounded-full bg-slate-200/80 cursor-pointer" role="scrollbar"
            aria-orientation="horizontal" aria-valuenow={Math.round(thumb.pos)}>
            <div onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
              className="absolute top-0 bottom-0 rounded-full bg-slate-400 hover:bg-[#f37121] active:bg-[#f37121] cursor-grab active:cursor-grabbing transition-colors touch-none"
              style={{ width: `${thumb.size}%`, insetInlineStart: `${thumb.pos}%` }} />
          </div>
          <button type="button" className={btn} disabled={!edge.left} onClick={() => jump(-1)} aria-label="Scroll left">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}
      <div ref={main} onScroll={sync} className={`overflow-x-auto ${className}`} {...rest}>
        {children}
      </div>
    </div>
  );
}
