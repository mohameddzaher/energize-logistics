'use client';
/**
 * منسدلةٌ فيها بحث — لأيّ قائمةِ خيارات.
 *
 * ── ولماذا في كلّ منسدلة ──────────────────────────────────────────────────
 * `<select>` الأصليّة تكفي لخمسة خيارات. وقوائمُنا عملاءُ وموظّفون وفروع —
 * مئاتٌ أحيانًا — فيصير اختيارُ اسمٍ تمريرًا طويلًا بالفأرة. والمستخدم يعرف
 * الاسمَ الذي يريد؛ ينقصه أن يكتبه.
 *
 * وهذه لخياراتٍ تُمرَّر كما هي، بخلاف `SearchableManagedSelect` التي تجلب
 * قائمتَها من `/api/lookups` وتُضيف إليها.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

// الطيُّ العربيّ: من كتب «احمد» يجد «أحمد»، ومن كتب «شركه» يجد «شركة».
const fold = (s: string) => String(s || '').toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ').trim();

export type SearchOption = { value: string; label: string; hint?: string };

export default function SearchSelect({
  value, onChange, options, placeholder, allLabel, ar, disabled, className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  /** نصُّ الخيار الفارغ — «الكل» في الفلاتر، أو غيابُه في حقلٍ مطلوب. */
  allLabel?: string;
  ar: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const shown = useMemo(() => {
    const s = fold(q);
    if (!s) return options;
    return options.filter((o) => fold(o.label).includes(s) || fold(o.hint || '').includes(s) || fold(o.value).includes(s));
  }, [options, q]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={box} className={`relative ${className || ''}`}>
      <button type="button" disabled={disabled} onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-start disabled:opacity-50">
        <span className={current ? 'text-slate-900 truncate' : 'text-slate-400 truncate'}>
          {current?.label || allLabel || placeholder || (ar ? 'اختر…' : 'Select…')}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={ar ? 'ابحث…' : 'Search…'}
              className="w-full text-[13px] outline-none bg-transparent" />
            {q && <button type="button" onClick={() => setQ('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {allLabel && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                className={`w-full text-start px-3 py-1.5 text-[13px] hover:bg-slate-50 ${!value ? 'text-[#f37121] font-medium' : 'text-slate-600'}`}>
                {allLabel}
              </button>
            )}
            {shown.map((o) => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-start px-3 py-1.5 text-[13px] hover:bg-slate-50 ${o.value === value ? 'text-[#f37121] font-medium' : 'text-slate-700'}`}>
                <span className="truncate block">{o.label}</span>
                {o.hint && <span className="block text-[11px] text-slate-400 truncate">{o.hint}</span>}
              </button>
            ))}
            {!shown.length && <p className="px-3 py-4 text-center text-[12px] text-slate-400">{ar ? 'لا نتائج' : 'No matches'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
