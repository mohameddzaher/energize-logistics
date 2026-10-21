'use client';
/**
 * منسدلةٌ متعدّدةُ الاختيار فيها بحث — وبجانب كلّ خيارٍ عددُه.
 *
 * أختُ `SearchSelect`: القائمةُ نفسُها والبحثُ نفسُه بالطيّ العربيّ، والفرقُ أنّ
 * الضغطَ يضمّ الخيارَ أو يرفعه ولا يُغلق القائمة — «ياسر وحسام» سؤالٌ واحد.
 *
 * والعددُ بجانب الخيار يأتي من الخادم محسوبًا **تحت الفلاتر الأخرى**، فما
 * تراه هو ما ستحصل عليه. والمختارُ يبقى ظاهرًا ولو صار عددُه صفرًا، كي لا
 * يختفي فلترٌ مفعَّلٌ من أمام صاحبه.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

const fold = (s: string) => String(s || '').toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ').trim();

export type MultiOption = { value: string; label: string; hint?: string; count?: number };

export default function MultiSearchSelect({
  label, value, onChange, options, ar, searchable = true, className,
}: {
  /** اسمُ الفلتر — يُكتب على الزرّ حين لا اختيار. */
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: MultiOption[];
  ar: boolean;
  /** قائمةٌ من ثلاثة خيارات لا تحتاج بحثًا. */
  searchable?: boolean;
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
    // ما لا عددَ له تحت الفلاتر الأخرى يُخفى — إلّا المختار.
    const live = options.filter((o) => o.count == null || o.count > 0 || value.includes(o.value));
    if (!s) return live;
    return live.filter((o) => fold(o.label).includes(s) || fold(o.hint || '').includes(s) || fold(o.value).includes(s));
  }, [options, q, value]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const picked = options.filter((o) => value.includes(o.value));
  const text = !value.length
    ? label
    : value.length === 1
      ? (picked[0]?.label || value[0])
      : `${label} (${value.length})`;

  return (
    <div ref={box} className={`relative ${className || ''}`}>
      <button type="button" onClick={() => setOpen((p) => !p)} title={label}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-start transition-colors ${
          value.length ? 'border-[#f37121]/60 bg-[#f37121]/5 text-slate-900' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'}`}>
        <span className="truncate">{text}</span>
        <span className="flex items-center gap-1 shrink-0">
          {value.length > 0 && (
            <span role="button" tabIndex={-1} aria-label={ar ? 'مسح' : 'Clear'}
              onClick={(e) => { e.stopPropagation(); onChange([]); }}
              className="text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></span>
          )}
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[240px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={ar ? 'ابحث…' : 'Search…'}
                className="w-full text-[13px] outline-none bg-transparent" />
              {q && <button type="button" onClick={() => setQ('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto py-1">
            {shown.map((o) => {
              const on = value.includes(o.value);
              return (
                <button key={o.value} type="button" onClick={() => toggle(o.value)}
                  className={`w-full flex items-center gap-2 text-start px-3 py-1.5 text-[13px] hover:bg-slate-50 ${on ? 'text-slate-900' : 'text-slate-700'}`}>
                  <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-[#f37121] border-[#f37121] text-white' : 'border-slate-300'}`}>
                    {on && <Check className="w-3 h-3" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="truncate block">{o.label}</span>
                    {o.hint && <span className="block text-[11px] text-slate-400 truncate">{o.hint}</span>}
                  </span>
                  {o.count != null && <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{o.count.toLocaleString('en-US')}</span>}
                </button>
              );
            })}
            {!shown.length && <p className="px-3 py-4 text-center text-[12px] text-slate-400">{ar ? 'لا نتائج' : 'No matches'}</p>}
          </div>
          {value.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-1.5 flex justify-between items-center text-[12px]">
              <span className="text-slate-400">{ar ? `${value.length} مختار` : `${value.length} selected`}</span>
              <button type="button" onClick={() => onChange([])} className="text-slate-500 hover:text-red-600">{ar ? 'مسح' : 'Clear'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
