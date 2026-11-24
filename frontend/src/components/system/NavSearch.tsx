'use client';
/**
 * Sidebar search: find a page or a section by name and jump to it.
 * Reads only the pages the user can open (the layout passes its filtered nav). Ctrl/Cmd+K focuses it from anywhere; arrows move, Enter opens.
 * Defined outside the layout's render body so typing never remounts the input.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, CornerDownLeft, X } from 'lucide-react';

export interface NavSearchItem { href: string; label: string; section: string; sectionLabel: string; icon?: ReactNode }

// Folds Arabic letter variants, diacritics and case so «إدارة» matches «اداره».
const fold = (s: string) => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/\s+/g, ' ').trim();

export default function NavSearch({ items, ar, onPick, autoFocusKey }: {
  items: NavSearchItem[]; ar: boolean; onPick: (href: string) => void; autoFocusKey?: number;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd+K focuses the search wherever the user is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (autoFocusKey) input.current?.focus(); }, [autoFocusKey]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const results = useMemo(() => {
    const f = fold(q);
    if (!f) return [];
    const words = f.split(' ');
    const scored = items.map((it) => {
      const page = fold(it.label); const sec = fold(it.sectionLabel); const key = fold(`${it.section} ${it.href}`);
      if (!words.every((w) => page.includes(w) || sec.includes(w) || key.includes(w))) return null;
      // A page whose own name matches ranks first, then a name that starts with the query, then section matches.
      const score = (page.startsWith(f) ? 0 : page.includes(f) ? 1 : sec.includes(f) ? 2 : 3) * 1000 + page.length;
      return { it, score };
    }).filter(Boolean) as { it: NavSearchItem; score: number }[];
    return scored.sort((a, b) => a.score - b.score).slice(0, 12).map((x) => x.it);
  }, [items, q]);
  useEffect(() => { setActive(0); }, [q]);

  const pick = (href: string) => { setQ(''); setOpen(false); onPick(href); };
  const mark = (text: string) => {
    const f = fold(q);
    const i = fold(text).indexOf(f);
    // Folding keeps length except for removed diacritics; highlight only when positions still line up.
    if (!f || i < 0 || fold(text).length !== text.toLowerCase().length) return text;
    return <>{text.slice(0, i)}<mark className="bg-[#f37121]/30 text-white rounded px-0.5">{text.slice(i, i + f.length)}</mark>{text.slice(i + f.length)}</>;
  };

  return (
    <div ref={box} className="relative px-2 pt-2">
      <div className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-2.5 ring-1 ring-slate-700 focus-within:ring-[#f37121]/70 transition">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={input} value={q} dir="auto"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1))); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active].href); }
            else if (e.key === 'Escape') { setQ(''); setOpen(false); input.current?.blur(); }
          }}
          placeholder={ar ? 'ابحث عن صفحة أو قسم…' : 'Search pages or sections…'}
          className="w-full bg-transparent py-2 text-[13px] text-white placeholder:text-slate-500 focus:outline-none"
        />
        {q ? (
          <button type="button" onClick={() => { setQ(''); input.current?.focus(); }} className="text-slate-400 hover:text-white" title={ar ? 'مسح' : 'Clear'}><X className="h-3.5 w-3.5" /></button>
        ) : (
          <kbd className="hidden xl:inline rounded border border-slate-600 px-1 text-[10px] font-semibold text-slate-400" dir="ltr">Ctrl K</kbd>
        )}
      </div>
      {open && q.trim() && (
        <div className="absolute inset-x-2 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40">
          {results.length ? (
            <ul className="max-h-80 overflow-y-auto py-1 sidebar-scroll">
              {results.map((it, i) => (
                <li key={it.href}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(it.href)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] ${i === active ? 'bg-[#f37121] text-white' : 'text-slate-200 hover:bg-slate-800'}`}>
                    <span className={`shrink-0 [&>svg]:h-4 [&>svg]:w-4 ${i === active ? 'text-white' : 'text-slate-400'}`}>{it.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{mark(it.label)}</span>
                      <span className={`block truncate text-[11px] ${i === active ? 'text-white/80' : 'text-slate-500'}`}>{mark(it.sectionLabel)}</span>
                    </span>
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-80" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-center text-[12.5px] text-slate-400">{ar ? 'لا صفحة بهذا الاسم' : 'No matching page'}</p>
          )}
        </div>
      )}
    </div>
  );
}
