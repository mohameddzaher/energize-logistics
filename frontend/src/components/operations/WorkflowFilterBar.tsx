'use client';
/**
 * شريطُ الفلترة في سير عمل التشغيل — على طريقة شريط الموارد البشرية (HrQuickFilters).
 *
 * صاحبُ الشركة (٢٠٢٦/١٠/٢١): بطاقاتُ الحالات الإحدى عشرة فوق الجدول تُزال،
 * ومكانَها شريطٌ ظاهرٌ يفلتر بأيّ عمود: العميل، الفرع، من/إلى، نوع الدفع، الحالة،
 * السائق، السيارة، الفاتورة… وكلُّ قيمةٍ بجانبها عددُها.
 *
 * ── ولا فلترَ خاصًّا به ──────────────────────────────────────────────────────
 * يكتب في فلاتر الأعمدة نفسِها (`cf_<العمود>`) التي يقرؤها الجدولُ والبطاقاتُ
 * والتصديرُ والخادم — فاختيارُ «جدة» هنا يُرى على رأس عمود «من» في الجدول، ومسحُه
 * من هناك يمسحه هنا. وقيمُ القائمة وأعدادُها من `/api/workflows/filters` التي تعدّ
 * بكلّ الفلاتر **عدا** فلتر العمود نفسِه — فيرى مَن اختار عميلًا كم له في كلّ فرع.
 *
 * والقائمةُ تُجلب حين تُفتح لا مع كلّ رسمة: ثلاثةَ عشرَ تجميعًا على تسعةٍ وثلاثين
 * ألفَ كشفٍ في كلّ تغييرِ فلترٍ ثمنٌ لا يُدفع لقوائمَ لم يفتحها أحد.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X, Check, Loader2, SlidersHorizontal } from 'lucide-react';
import api from '@/lib/api';
import { useLatestRequest } from '@/hooks/useLatestRequest';

type Opt = { value: string; count: number };
export type FilterBarField = { key: string; ar: string; en: string };

export default function WorkflowFilterBar({ fields, value, onChange, params, format, ar }: {
  fields: FilterBarField[];
  /** فلاتر الأعمدة الحاليّة — العمود ← القيم المختارة (الخام). */
  value: Record<string, Set<string>>;
  onChange: (field: string, next: Set<string>) => void;
  /** شروطُ الجدول كلُّها كما يرسلها (البحث والمدى والفلاتر) — تُحسب بها الأعداد. */
  params: () => URLSearchParams;
  /** عرضُ القيمة (الحالاتُ مترجمة، والتواريخُ بصيغتها) — والفلترةُ على الخام. */
  format: (field: string) => ((v: any) => string) | undefined;
  ar: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [open, setOpen] = useState('');
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<Opt[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const guard = useLatestRequest();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // القيمُ تُحسب في الخادم بكلّ الفلاتر عدا فلتر العمود نفسِه، والبحثُ داخل
  // القائمة يجري هناك أيضًا (الخادمُ لا يُرجع إلّا أكثرَ خمسمئة قيمة).
  const load = useCallback(async (field: string, query: string) => {
    const mine = guard.begin();
    setBusy(true);
    try {
      const p = params();
      p.set('field', field);
      if (query) p.set('q', query);
      const d = await api.get<{ filters: { key: string; values: Opt[]; truncated?: boolean }[] }>(`/api/workflows/filters?${p.toString()}`);
      if (!guard.isCurrent(mine)) return;
      const f = d?.filters?.[0];
      setOpts(f?.values || []);
      setTruncated(!!f?.truncated);
    } catch {
      if (guard.isCurrent(mine)) { setOpts([]); setTruncated(false); }
    } finally {
      if (guard.isCurrent(mine)) setBusy(false);
    }
  }, [params, guard]);

  // تتغيّر الفلاترُ والقائمةُ مفتوحة → تُعاد أعدادُها، فلا تبقى أرقامُ ما قبل الاختيار.
  useEffect(() => {
    if (!open) return;
    load(open, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, params]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(''); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const typeQuery = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { if (open) load(open, v.trim()); }, 300);
  };

  const any = fields.some((f) => (value[f.key]?.size || 0) > 0);

  return (
    <div ref={box} className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500">
        <SlidersHorizontal className="h-4 w-4" /> {t('فلترة', 'Filter')}
      </span>
      {fields.map((f) => {
        const sel = value[f.key] || new Set<string>();
        const on = sel.size > 0;
        const fmt = format(f.key);
        const label = (v: string) => (v === '' ? t('(فارغ)', '(blank)') : (fmt ? fmt(v) : v));
        const first = on ? [...sel][0] : '';
        return (
          <div key={f.key} className="relative">
            <button type="button"
              onClick={() => { if (open === f.key) { setOpen(''); return; } setOpts([]); setQ(''); setOpen(f.key); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold shadow-sm transition
                ${on ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/60'}`}>
              <span className={on ? 'text-white/80' : 'text-slate-500'}>{t(f.ar, f.en)}</span>
              {on && <span className="max-w-[160px] truncate">{sel.size === 1 ? label(first) : t(`${sel.size} مختار`, `${sel.size} selected`)}</span>}
              {on
                ? <X className="h-3.5 w-3.5" aria-label={t('مسح', 'Clear')} onClick={(e) => { e.stopPropagation(); onChange(f.key, new Set()); }} />
                : <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
            </button>
            {open === f.key && (
              <div className="absolute start-0 z-40 mt-1.5 w-72 max-w-[calc(100vw-32px)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="relative mb-1.5">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input autoFocus value={q} onChange={(e) => typeQuery(e.target.value)} placeholder={t('ابحث…', 'Search…')}
                    className="w-full rounded-lg border border-slate-200 py-1.5 pe-2 ps-8 text-sm focus:border-[#f37121] focus:outline-none" />
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {busy && !opts.length && (
                    <p className="flex items-center justify-center gap-1.5 px-2 py-3 text-[12px] text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />{t('جارٍ التحميل…', 'Loading…')}
                    </p>
                  )}
                  {opts.map((o) => {
                    const picked = sel.has(o.value);
                    return (
                      <button key={o.value || '∅'} type="button"
                        onClick={() => {
                          const next = new Set(sel);
                          if (picked) next.delete(o.value); else next.add(o.value);
                          onChange(f.key, next);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] ${picked ? 'bg-orange-50 text-[#c2410c]' : 'text-slate-700 hover:bg-slate-50'}`}>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${picked ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300'}`}>
                          {picked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1 truncate font-medium">{label(o.value)}</span>
                        <span className="text-[11.5px] tabular-nums text-slate-400">{o.count.toLocaleString('en-US')}</span>
                      </button>
                    );
                  })}
                  {!busy && !opts.length && <p className="px-2 py-3 text-center text-[12px] text-slate-400">{t('لا نتائج', 'No matches')}</p>}
                  {truncated && <p className="px-2 py-1 text-[11px] text-slate-400">{t('القائمة مقصورة على الأكثر تكرارًا — ابحث لتجد غيرها', 'Showing the most frequent values — search to find others')}</p>}
                </div>
                {on && (
                  <button type="button" onClick={() => onChange(f.key, new Set())}
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
        <button type="button" onClick={() => fields.forEach((f) => { if (value[f.key]?.size) onChange(f.key, new Set()); })}
          className="text-[12.5px] font-semibold text-slate-500 underline hover:text-slate-800">
          {t('مسح الكل', 'Clear all')}
        </button>
      )}
    </div>
  );
}
