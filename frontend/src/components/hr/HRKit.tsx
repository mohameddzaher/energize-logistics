'use client';
// Small shared UI kit for the HR section so every page stays consistent and
// short. Pure presentation — all data/logic lives in the pages themselves.
import { soundsLike } from '@/lib/nameSound';
import { ReactNode, useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Download, Loader2, ChevronDown, Check as CheckIcon, AlertTriangle, RefreshCw } from 'lucide-react';

export function Spinner() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function PageHeader({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]">{icon}</div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative" data-search-box>
      <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
    </div>
  );
}

export function ExportButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
      <Download className="w-4 h-4" /> {label}
    </button>
  );
}

export function PrimaryButton({ onClick, children, disabled, type = 'button' }: { onClick?: () => void; children: ReactNode; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
      {children}
    </button>
  );
}

// font-semibold, not medium: the tinted /20 backgrounds are pale, so a light text weight reads washed out.
export function Badge({ style, lang }: { style?: { bg: string; text: string; en: string; ar: string } | null; lang: 'en' | 'ar' }) {
  if (!style) return <span className="text-slate-500">—</span>;
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>{lang === 'ar' ? style.ar : style.en}</span>;
}

export function SmallBadge({ bg, text, label }: { bg: string; text: string; label: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${bg} ${text}`}>{label}</span>;
}

// `wide: 'xl'` is the large detail window (a request with its decision panel beside it).
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean | 'xl' }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()} className={`w-full ${wide === 'xl' ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'} bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg mb-3">{title}</h2>
              <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">{children}</div>
            {footer && <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, children, span2 }: { label: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

// A passed `className` is appended, not replacing. It used to overwrite the base class and be lost: passing a class to color a server-rejected field red had no effect and no message said why. The base comes first and the passed class after, so the more specific wins and the shape stays uniform.
export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${className || ''}`} />;
}
export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${className || ''}`} />;
}
/**
 * Saudi mobile: the country code is always on the left.
 * The number is written in Latin digits and read left to right in every language; a phone is not Arabic text. With `+966` as the first element of an Arabic row it went to the right of the field with the digits on its left, reading reversed from how it is written and different from the English screen. So the whole box is `dir="ltr"`: code on the left, digits after it, in Arabic or English. Storage is always the full `+9665XXXXXXXX`, input is nine digits at most, and a leading zero or pasted country code is dropped.
 */
export function PhoneSA({
  value, onChange, className, placeholder = '5XXXXXXXX', compact, children,
}: {
  /** Stored value: "+9665XXXXXXXX" or empty. */
  value: string;
  onChange: (full: string) => void;
  className?: string;
  placeholder?: string;
  /** Table rows are narrow. */
  compact?: boolean;
  /** Call buttons and the like; drawn outside the box. */
  children?: React.ReactNode;
}) {
  const local = String(value || '').replace(/\D/g, '').replace(/^966/, '').slice(0, 9);
  const pad = compact ? 'py-1.5' : 'py-2';
  return (
    <div className="flex items-center gap-2">
      <div dir="ltr" className={`${inputCls} flex-1 flex items-center gap-2 p-0 overflow-hidden ${className || ''}`}>
        <span className={`px-2.5 ${pad} bg-slate-100 text-slate-600 text-sm font-semibold shrink-0`}>+966</span>
        <input
          value={local} inputMode="numeric" dir="ltr" maxLength={9} placeholder={placeholder}
          onChange={(e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.startsWith('966')) v = v.slice(3);
            if (v.startsWith('0')) v = v.slice(1);
            onChange(v ? `+966${v.slice(0, 9)}` : '');
          }}
          className={`flex-1 min-w-0 px-2 ${pad} ${compact ? 'text-xs' : 'text-sm'} outline-none bg-transparent`} />
      </div>
      {children}
    </div>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${className || ''}`} />;
}


// A failed fetch must never render as an empty table. "No data" and "we could
// not reach the server" look identical to a user, and they send them hunting
// for missing records instead of signing back in — which is exactly what
// `catch {}` on a page-level load causes.
//
// `error` is the message thrown by lib/api. It throws the literal string
// 'Authentication required' once a refresh has already failed, which is the
// common case: a tab left open past the token's life.
export function ErrorNotice({ error, onRetry, lang = 'en' }: { error: string; onRetry?: () => void; lang?: 'en' | 'ar' }) {
  const ar = lang === 'ar';
  const expired = /auth/i.test(error);
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-900">
          {expired
            ? (ar ? 'انتهت الجلسة' : 'Your session has expired')
            : (ar ? 'تعذّر تحميل البيانات' : 'Could not load the data')}
        </p>
        <p className="text-xs text-red-800 mt-0.5">
          {expired
            ? (ar ? 'سجّل الدخول مرة أخرى لعرض البيانات — البيانات نفسها لم تتأثر.' : 'Sign in again to see the data — the data itself is unaffected.')
            : error}
        </p>
      </div>
      {expired ? (
        <a href="/login" className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold">
          {ar ? 'تسجيل الدخول' : 'Sign in'}
        </a>
      ) : onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold">
          <RefreshCw className="w-3.5 h-3.5" /> {ar ? 'إعادة المحاولة' : 'Retry'}
        </button>
      ) : null}
    </div>
  );
}

// `badge` + `tone`: an optional colored status chip under the label (the fleet vehicle picker uses it for the available-in-city and has-a-load-to states). The badge text participates in search like the hint.
export interface SearchOption {
  value: string; label: string; hint?: string;
  /** Extra text the search reads but the list does not show, e.g. the Arabic name. */
  search?: string;
  badge?: string;
  tone?: 'ok' | 'busy' | 'info';
}
const OPTION_TONES: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  busy: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
};
const OPTION_DOTS: Record<string, string> = { ok: 'bg-emerald-500', busy: 'bg-amber-500', info: 'bg-blue-500' };

// A <select> replacement for lists too long to scroll: employees, customers, vendors. Filters on both the label and the hint (employee number, iqama), so typing a number finds the person as fast as typing a name. Below `searchAfter` options the search box is omitted, so it can be used anywhere without noise on short lists.
// A value the list does not know is shown as is: it used to compare the value with the options and draw the ghost placeholder when not found, as if the field were empty. Customer routes are stored with cities not all in the form lists, so opening an edit showed 72 routes with both ends blank and looked like data loss, then saving made it real. Now the saved value itself is displayed when no option matches.
// `allowCustom` makes it a combo box: typed text is a valid value and options are suggestions, not a limit.
export function SearchableSelect({
  value, onChange, options, placeholder = '—', searchPlaceholder, disabled, searchAfter = 8, emptyLabel,
  allowCustom, customHint, onSearch, loading, footer,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  searchAfter?: number;
  emptyLabel?: string;
  /** Accepts text not in the list; the list is suggestions. */
  allowCustom?: boolean;
  /** Text of the "use what I typed" line, in the screen's language. */
  customHint?: (typed: string) => string;
  /** A list that is not fully loaded: search goes to the server. Arabic folding here filters what arrived; that suffices for a hundred records and misleads for thirteen thousand (a thousand loaded with a blind cap, searched, reported no results while the rest sat in the other twelve thousand). With `onSearch`, the server filters and the arrived set is not filtered again; it is called debounced after typing pauses. */
  onSearch?: (q: string) => void;
  /** Shows a searching indicator while the list is on its way. */
  loading?: boolean;
  /** A fixed line below the list, e.g. "50 of 3370, narrow the search". */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) || null;
  const showSearch = allowCustom || !!onSearch || options.length > searchAfter;
  // A saved value is displayed when the list does not know it, unless it is a record id: many callers store `_id` and their lists arrive after first paint, and a hex id shown for a moment is worse than a ghost placeholder.
  const rawLabel = value && !/^[0-9a-f]{24}$/i.test(value) ? value : '';

  const filtered = useMemo(() => {
    // Arabic folding: hamza forms, ta marbuta and alif maqsura collapse so that typing a bare alif finds the hamza form; nobody hunts for the right hamza mid-search.
    const fold = (x: string) => x.toLowerCase()
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[ًٌٍَُِّْ]/g, '');
    const s = fold(q.trim());
    // Remote search already filtered on the server; filtering the arrived set again hides what it found (the server searches plate, driver and operations card, while the fold here sees the name only and would drop a row that matched by number).
    if (!s) return options;
    // While the server looks, the previous list must not pose as the answer.
    if (onSearch) return loading ? [] : options;
    // Every space-separated word must appear somewhere, so "ahmed 2570" works.
    const words = s.split(/\s+/);
    return options.filter((o) => {
      const hay = fold(`${o.label} ${o.search || ''} ${o.hint || ''} ${o.badge || ''}`);
      return words.every((w) => hay.includes(w)) || soundsLike(o.label, s);
    });
  }, [options, q, loading, onSearch]);

  // The "use what I typed" line leads the list when unknown values are allowed; otherwise typing a new city leads nowhere.
  const rows = useMemo(() => {
    const typed = q.trim();
    if (!allowCustom || !typed || options.some((o) => o.value === typed)) return filtered;
    return [{ value: typed, label: customHint ? customHint(typed) : typed } as SearchOption, ...filtered];
  }, [allowCustom, customHint, filtered, options, q]);

  // The call is kept in a ref: a caller writing it in the render body changes it every render, and as a dependency it would refetch endlessly.
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  useEffect(() => {
    if (!onSearch || !open) return;
    const t = setTimeout(() => onSearchRef.current?.(q.trim()), q.trim() ? 260 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const t = setTimeout(() => searchRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    // The panel renders in the page body, so a click inside it is not inside the box; without excluding it the list would close before the choice registers.
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (boxRef.current?.contains(t)) return;
      if (t?.closest?.('[data-searchable-select]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Keep the keyboard-highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) pick(rows[active].value);
      else if (allowCustom && q.trim()) pick(q.trim());
    }
  };

  // Panel position, computed from the button position because it renders in the page body.
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number }>(
    { left: 0, width: 0, top: 0, maxH: 320 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      // The panel does not shrink with a narrow field. A field in half a card with a button beside it opened a panel of its own width: the search box was clipped and names half cut. So the panel is at least 300px, anchored to the field edge by language direction (right in Arabic), and pulled back inside the screen if it overflows.
      const vw = window.innerWidth;
      const width = Math.min(Math.max(box.width, 300), vw - 16);
      const rtl = getComputedStyle(boxRef.current as Element).direction === 'rtl';
      const left = Math.min(Math.max(8, rtl ? box.right - width : box.left), vw - width - 8);
      const r = { left, width, top: box.top, bottom: box.bottom };
      // If there is not enough room below, it opens above: a list running off the bottom of the screen cannot be read.
      const below = window.innerHeight - r.bottom;
      const H = 280;
      if (below < H && r.top > below) {
        // Above and attached: the panel's bottom is pinned to the field top so it grows upward by its content. It used to pin the top at `r.top - 280`, reserving height it did not fill, so a three-line list left about 160px of gap between it and what was clicked, looking suspended unrelated to the field; most visible at the end of the page with extra-shipment trucks.
        setPos({ left: r.left, width: r.width, bottom: Math.round(window.innerHeight - r.top) + 4, maxH: Math.max(140, r.top - 12) });
      } else {
        setPos({ left: r.left, width: r.width, top: r.bottom + 4, maxH: Math.max(140, below - 12) });
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between gap-2 text-start ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate ${selected || rawLabel ? 'text-slate-900' : 'text-slate-400'}`}>{selected ? selected.label : (rawLabel || placeholder)}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* The panel renders over the page, not inside the table. It used to be `absolute` inside the row, but the table is wrapped in `overflow-x-auto`, a clipping context, so the list was clipped at the table edge and anything past it was invisible. It renders in the page body at a fixed position computed from the button position, so nothing clips it. */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          data-searchable-select
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
          className="fixed z-[80] rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col">
          {showSearch && (
            <div className="relative border-b border-slate-100 shrink-0">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={q}
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder || 'Search…'}
                className="w-full ps-10 pe-3 py-2.5 text-sm text-slate-900 focus:outline-none"
              />
            </div>
          )}
          <div ref={listRef} className="flex-1 min-h-0 max-h-60 overflow-y-auto" onKeyDown={onKeyDown}>
            {loading && rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">…</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">{emptyLabel || 'No matches'}</p>
            ) : rows.map((o, i) => (
              <button
                key={o.value}
                type="button"
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={`w-full text-start px-3 py-2 border-b border-slate-100 last:border-0 flex items-center gap-2 ${i === active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-900 truncate">{o.label}</span>
                  {o.badge && (
                    <span className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold max-w-full ${OPTION_TONES[o.tone || 'info']}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${OPTION_DOTS[o.tone || 'info']}`} />
                      <span className="truncate">{o.badge}</span>
                    </span>
                  )}
                  {o.hint && <span className="block text-xs text-slate-500 truncate mt-0.5">{o.hint}</span>}
                </span>
                {o.value === value && <CheckIcon className="w-4 h-4 shrink-0 text-[#f37121]" />}
              </button>
            ))}
          </div>
          {footer && <div className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500 bg-slate-50">{footer}</div>}
        </div>, document.body)}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors flex items-center gap-2 ${active === t.key ? 'border-[#f37121] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
          {t.badge ? <span className="bg-[#f37121] text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Number card. The card lives inside a grid whose cell minimum width is `auto`, i.e. its content width: a long figure pushes the cell past the card and overflows on narrow screens. `min-w-0` lets the cell shrink and `break-words` wraps the figure inside. The title truncates when narrow (`truncate` with `title`) but the number never does: half a number is worse than a wrapped one. The font is a bit smaller on mobile and larger on desktop, and `tabular-nums` makes digits equal width so cards align vertically. */
/**
 * Pick: makes a number card a button that opens what is under it and marks itself selected.
 * A wrapper, not a `StatCard` property: the card is used on dozens of screens, most with no slice under it (a category count is a count of values, not rows). If every card were a button the reader would think every number opens, click, see nothing happen and think the screen broken. So the wrapper goes only on cards with something beneath them.
 */
export function Pick({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-start rounded-xl transition min-w-0 ${on ? 'ring-2 ring-[#f37121] ring-offset-1' : 'hover:opacity-80'}`}>
      {children}
    </button>
  );
}

/** A number card that leads to its rows. A number that cannot be opened is half an answer: the reader sees a count of overdue items and then hunts for them in the table by hand or opens another screen and filters again, which is the work a dashboard should save. Passing `href` or `onClick` makes the card a button: hand cursor, border tint on hover, a small arrow, and a line saying click to show them; a card given neither stays as it was, so it does not imply a click that leads nowhere. `href` is preferred over `onClick` where there is a destination: it opens in another tab and can be copied and sent as a link carrying the filter. */
export function StatCard({ label, value, accent, href, onClick, hint, active }: {
  label: string; value: ReactNode; accent?: string;
  /** Card destination: the rows page with its filter in the URL. */
  href?: string;
  /** Or filtering in place. */
  onClick?: () => void;
  /** A small line under the number: what will be shown. */
  hint?: string;
  /** The currently selected card (with `onClick`). */
  active?: boolean;
}) {
  const clickable = !!href || !!onClick;
  const body = (
    <>
      <p className="text-slate-500 text-xs truncate" title={typeof label === 'string' ? label : undefined}>{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 leading-tight tabular-nums break-words ${accent || 'text-slate-900'}`}>{value}</p>
      {hint ? <p className="text-[10px] text-slate-400 mt-1 truncate">{hint}</p> : null}
    </>
  );
  const cls = `min-w-0 bg-white border rounded-xl p-4 shadow-sm block text-start w-full ${
    active ? 'border-[#f37121] ring-1 ring-[#f37121]/40' : 'border-slate-200'
  } ${clickable ? 'transition hover:border-[#f37121]/60 hover:shadow-md cursor-pointer' : ''}`;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export { Loader2 };
