'use client';
/**
 * شريطُ الفلترة السريعة — القسم · الفئة الوظيفية · السجل التجاري · المدينة · حالة العمل · المشروع · الجنسية · المهنة في الإقامة.
 *
 * صاحبُ الشركة (٢٠٢٦/١٠/١٩): «فلتر القسم واضح… ولو اخترت قسم اللوحة تتعدل
 * أرقامها كلها» — وكذلك المدينة وحالة العمل والمشروع والجنسية، في اللوحة والماستر
 * وصفحة الموظفين. فالشريطُ لا يملك فلترًا خاصًّا: يكتب في الفلتر نفسِه الذي تقرؤه
 * لوحةُ الفلترة الكاملة والخادم (`buildFilter`) — القيمةُ مفاتيحُ الحقول نفسُها
 * مفصولةً بفاصلة — فكلُّ رقمٍ في الشاشة يُحسَب عليه.
 *
 * والعددُ بجانب كلّ قيمةٍ يُحسَب بكلّ الفلاتر **عدا** فلترها (`filterOptions`)،
 * فيرى مَن اختار «جدة» كم في كلّ قسمٍ في جدة. وفي كلّ قائمةٍ بحث.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import api from '@/lib/api';
import type { FilterValues } from '@/components/system/FilterPanel';

type Opt = { value: string; count: number; label?: string };
type Def = { key: string; values: Opt[] };

export const QUICK_KEYS: { key: string; ar: string; en: string }[] = [
  { key: 'department', ar: 'القسم', en: 'Department' },
  // إداري · سائق · فني — لموظّفي B2C والنقل الثقيل.
  { key: 'staffCategory', ar: 'الفئة الوظيفية', en: 'Staff category' },
  // السجلُّ التجاريّ: رقمُ السجلّ أو «فري لانسر» أو «تدريب» (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠).
  { key: 'registerNumber', ar: 'السجل التجاري', en: 'Commercial register' },
  { key: 'branchName', ar: 'المدينة', en: 'City' },
  { key: 'workStatusText', ar: 'حالة العمل', en: 'Work status' },
  { key: 'project', ar: 'المشروع', en: 'Project' },
  { key: 'nationality', ar: 'الجنسية', en: 'Nationality' },
  // صاحبُ الشركة (٢٠٢٦/١٠/٢١).
  { key: 'iqamaProfession', ar: 'المهنة في الإقامة', en: 'Iqama occupation' },
];

const split = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export default function HrQuickFilters({ optionsUrl, optionsParams, value, onChange, ar, keys = QUICK_KEYS, options }: {
  /** نقطةُ الخيارات — تُمرَّر من الصفحة (راجع genPageApis). وبلا نقطةٍ تُقرأ `options`. */
  optionsUrl?: string;
  optionsParams?: Record<string, string>;
  value: FilterValues;
  onChange: (v: FilterValues) => void;
  ar: boolean;
  /** فلاترُ شاشةٍ أخرى بالشكل نفسِه (لوحةُ B2C) — والافتراضُ فلاترُ الموارد البشريّة. */
  keys?: { key: string; ar: string; en: string }[];
  /** خياراتٌ جاءت مع ردّ الشاشة نفسِه (`{key: [{value, label, count}]}`) — فلا نداءَ ثانٍ. */
  options?: Record<string, Opt[]>;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [defs, setDefs] = useState<Record<string, Opt[]>>({});
  const [open, setOpen] = useState('');
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!optionsUrl) return undefined;
    let dead = false;
    const qs = new URLSearchParams({
      ...optionsParams,
      ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '' && v != null) as [string, string][]),
    }).toString();
    api.get<{ filters: Def[] }>(`${optionsUrl}${qs ? `?${qs}` : ''}`)
      .then((r) => { if (!dead) setDefs(Object.fromEntries((r.filters || []).map((d) => [d.key, d.values || []]))); })
      .catch(() => {});
    return () => { dead = true; };
  }, [optionsUrl, JSON.stringify(value), JSON.stringify(optionsParams)]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(''); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const set = (key: string, vals: string[]) => {
    const n = { ...value };
    if (vals.length) n[key] = vals.join(','); else delete n[key];
    onChange(n);
  };
  const any = keys.some((k) => split(value[k.key]).length);
  const defsOf = (k: string) => (options ? options[k] : defs[k]) || [];

  return (
    <div ref={box} className="flex flex-wrap items-center gap-2">
      {keys.map((k) => {
        const sel = split(value[k.key]);
        const on = sel.length > 0;
        const all = defsOf(k.key);
        const opts = all.filter((o) => !q || o.value.toLowerCase().includes(q.toLowerCase())
          || String(o.label || '').toLowerCase().includes(q.toLowerCase()));
        const label = (v: string) => {
          const l = all.find((o) => o.value === v)?.label;
          return l || (v === '—' ? t('غير محدد', 'Not set') : v);
        };
        return (
          <div key={k.key} className="relative">
            <button type="button" onClick={() => { setOpen(open === k.key ? '' : k.key); setQ(''); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition shadow-sm
                ${on ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/60'}`}>
              <span className={on ? 'text-white/80' : 'text-slate-500'}>{t(k.ar, k.en)}</span>
              {on && <span className="max-w-[160px] truncate">{sel.length === 1 ? label(sel[0]) : t(`${sel.length} مختار`, `${sel.length} selected`)}</span>}
              {on
                ? <X className="h-3.5 w-3.5" onClick={(e) => { e.stopPropagation(); set(k.key, []); }} />
                : <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
            </button>
            {open === k.key && (
              <div className="absolute z-40 mt-1.5 w-72 max-w-[calc(100vw-32px)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl start-0">
                <div className="relative mb-1.5">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث…', 'Search…')}
                    className="w-full rounded-lg border border-slate-200 py-1.5 ps-8 pe-2 text-sm focus:border-[#f37121] focus:outline-none" />
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {opts.map((o) => {
                    const picked = sel.includes(o.value);
                    return (
                      <button key={o.value} type="button"
                        onClick={() => set(k.key, picked ? sel.filter((x) => x !== o.value) : [...sel, o.value])}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] ${picked ? 'bg-orange-50 text-[#c2410c]' : 'text-slate-700 hover:bg-slate-50'}`}>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${picked ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300'}`}>
                          {picked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1 truncate font-medium">{o.label || label(o.value)}</span>
                        <span className="tabular-nums text-[11.5px] text-slate-400">{o.count}</span>
                      </button>
                    );
                  })}
                  {!opts.length && <p className="px-2 py-3 text-center text-[12px] text-slate-400">{t('لا نتائج', 'No matches')}</p>}
                </div>
                {on && (
                  <button type="button" onClick={() => set(k.key, [])}
                    className="mt-1 w-full rounded-lg py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-50">
                    {t('مسح هذا الفلتر', 'Clear this filter')}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {any && (
        <button type="button" onClick={() => { const n = { ...value }; keys.forEach((k) => delete n[k.key]); onChange(n); }}
          className="text-[12.5px] font-semibold text-slate-500 underline hover:text-slate-800">
          {t('مسح الكل', 'Clear all')}
        </button>
      )}
    </div>
  );
}
