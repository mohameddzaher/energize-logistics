'use client';
// لوحة فلاتر واحدة تصلح لأي قسم.
//
// المشكلة التي تحلّها: الشاشات كانت تُفلتَر بقيمة واحدة لحقل واحد، فالسؤال
// الحقيقي — «أرِني الباكستانيين والهنود، الذكور، في النقل الثقيل، بجدّة ومكّة» —
// كان يحتاج أربع زيارات ولا يُجاب عنه مجتمعًا أبدًا.
//
// وثلاث قواعد تحكم هذه اللوحة:
//
// ١) قائمة الحقول وقيمها **تأتي من الخادم**، لا تُكتب هنا. فالجنسيات التي تظهر
//    هي الجنسيات الموجودة فعلًا في البيانات، وأيّ عمود جديد يظهر وحده.
//
// ٢) العدد بجانب كل قيمة محسوب **بعد بقيّة الفلاتر**، فما تراه هو ما ستحصل
//    عليه؛ ولا يظهر خيار عدده صفر فتضغطه فتجد الشاشة فارغة.
//
// ٣) الفلتر النشط يبقى مرئيًّا كشرائح تحت الزرّ. الفلتر المخفيّ الذي تنساه
//    مفعَّلًا هو أسوأ ما في أيّ لوحة تحليلات: الأرقام تبدو خاطئة ولا تعرف لماذا.
//
// ── لماذا اللوحة تُرسَم في جذر الصفحة ────────────────────────────────────────
// كانت تُرسَم `absolute` داخل الشريط، فتقصّها أوّلُ حاوية فوقها ذات `overflow`
// ولا يظهر منها إلا طرف. البوّابة تخرجها من كل حاوية، فلا شيء يقصّها.
//
// وكل ما تحتاجه اللوحة من عناصر مكتوبٌ هنا في موضعه، لا في مكوّنات تُعرَّف داخل
// جسم الرسم: المكوّن المعرَّف في الجسم يُبنى من جديد مع كل ضغطة، فيُستبدل عنصره
// في الصفحة ويصير المرجع المحفوظ منفصلًا عنها — فيرجع قياسه أصفارًا وتُرسَم
// القائمة في زاوية الشاشة العليا. هكذا حدث بالضبط، ولهذا لا مكوّنات هنا.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { SlidersHorizontal, X, Search, ChevronDown, RotateCcw, Check } from 'lucide-react';

export type FilterValues = Record<string, string>;

export interface FilterFieldDef {
  key: string; ar: string; en: string;
  groupAr?: string; groupEn?: string; groupKey?: string;
  values: { value: string; count: number }[];
}
export interface FilterDateDef { key: string; ar: string; en: string }

/** ضمّ/إزالة قيمة من حقل متعدّد القيم (القيم مفصولة بفواصل في نصّ الاستعلام). */
export const toggleValue = (cur: string | undefined, v: string) => {
  const list = String(cur || '').split(',').map((x) => x.trim()).filter(Boolean);
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1); else list.push(v);
  return list.join(',');
};
export const countActive = (v: FilterValues) =>
  Object.entries(v).filter(([, val]) => val !== '' && val != null).length;

export default function FilterPanel({
  optionsUrl, value, onChange, dateFields = [], extra, extraLabels = {}, resultCount, resultLabel,
}: {
  /** اندبوينت يرجّع { filters: FilterFieldDef[], dateFields?: string[] } */
  optionsUrl: string;
  value: FilterValues;
  onChange: (v: FilterValues) => void;
  /** حقول التاريخ التي تقبل مدى — بأسمائها المعروضة */
  dateFields?: FilterDateDef[];
  /** فلاتر خاصة بالقسم (أزرار جاهزة) تظهر أعلى اللوحة */
  extra?: React.ReactNode;
  /**
   * أسماء مقروءة للفلاتر التي لا تأتي من الخادم (أزرار `extra`). بدونها تظهر
   * الشريحة باسم المفتاح البرمجيّ — «employment: active» — وهو ليس عربيًّا ولا
   * إنجليزيًّا ولا يقرؤه أحد.
   */
  extraLabels?: Record<string, { ar: string; en: string; values?: Record<string, { ar: string; en: string }> }>;
  resultCount?: number;
  resultLabel?: string;
}) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);

  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<FilterFieldDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState<Record<string, string>>({});
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // مرجعان ثابتان لا يتبدّلان مع الرسم: زرّ الفتح، وجسم اللوحة.
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // القيم تُعاد قراءتها مع كل تغيير في الفلتر — وهذا بيت القصيد: بعد اختيار
  // «جدّة» يصير عدد كل جنسية هو عددها في جدّة، لا في الشركة كلها.
  useEffect(() => {
    let dead = false;
    setLoading(true);
    const qs = new URLSearchParams(
      Object.entries(value).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    api.get<{ filters: FilterFieldDef[] }>(`${optionsUrl}${qs ? `?${qs}` : ''}`)
      .then((r) => { if (!dead) setFields(r.filters || []); })
      .catch(() => { if (!dead) setFields([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [optionsUrl, JSON.stringify(value)]);

  // موضع اللوحة: تحت الزرّ، محاذيةً له في اتجاه القراءة، ومزحوحةٌ داخل الشاشة
  // إن تجاوزت حافّتها. وتتبعه عند التمرير وتغيّر المقاس حتى لا تنفصل عنه.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = trigger.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(window.innerWidth - 16, 880);
      let left = isRTL ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 6, left, width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, isRTL]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const n = e.target as Node;
      if (panel.current?.contains(n) || trigger.current?.contains(n)) return;
      setOpen(false);
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  const set = (k: string, v: string) => {
    const next = { ...value };
    if (v) next[k] = v; else delete next[k];
    onChange(next);
  };
  const clearAll = () => onChange({});

  const active = countActive(value);
  const byGroup = useMemo(() => {
    const m = new Map<string, FilterFieldDef[]>();
    for (const f of fields) {
      const g = (ar ? f.groupAr : f.groupEn) || t('عام', 'General');
      m.set(g, [...(m.get(g) || []), f]);
    }
    return [...m.entries()];
  }, [fields, ar]);

  const label = (f: FilterFieldDef) => (ar ? f.ar : f.en);
  const dLabel = (k: string) => {
    const d = dateFields.find((x) => x.key === k);
    return d ? (ar ? d.ar : d.en) : k;
  };

  // شرائح الفلتر النشط — كل قيمة شريحة مستقلّة تُرفع وحدها.
  const chips: { k: string; v: string; text: string }[] = [];
  for (const [k, raw] of Object.entries(value)) {
    if (!raw) continue;
    if (/(From|To)$/.test(k)) {
      const base = k.replace(/(From|To)$/, '');
      chips.push({ k, v: '', text: `${dLabel(base)} ${k.endsWith('From') ? t('من', 'from') : t('إلى', 'to')} ${raw}` });
      continue;
    }
    const ex = extraLabels[k];
    if (ex) {
      const vl = ex.values?.[raw];
      chips.push({ k, v: '', text: vl ? (ar ? vl.ar : vl.en) : `${ar ? ex.ar : ex.en}: ${raw}` });
      continue;
    }
    const f = fields.find((x) => x.key === k);
    for (const v of String(raw).split(',').filter(Boolean)) {
      chips.push({ k, v, text: `${f ? label(f) : k}: ${v}` });
    }
  }

  return (
    <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2 flex-wrap">
        <button ref={trigger} onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition
            ${active ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}>
          <SlidersHorizontal className="w-4 h-4" />
          {t('فلتر', 'Filter')}
          {active > 0 && <span className="px-1.5 rounded-full bg-white/25 text-[11px] font-bold">{active}</span>}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {resultCount != null && (
          <span className="text-[12px] text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5">
            {resultLabel || t('النتائج', 'Results')}: <b className="tabular-nums text-slate-900">{resultCount}</b>
          </span>
        )}

        {chips.map((c) => (
          <button key={`${c.k}:${c.v}`}
            onClick={() => set(c.k, c.v ? toggleValue(value[c.k], c.v) : '')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#12325c] text-white text-[11px] font-semibold hover:bg-[#1b4278]">
            {c.text}<X className="w-3 h-3" />
          </button>
        ))}
        {active > 1 && (
          <button onClick={clearAll} className="text-[11.5px] text-slate-500 hover:text-red-600 underline">
            {t('مسح كل الفلاتر', 'Clear all filters')}
          </button>
        )}
      </div>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={panel} dir={isRTL ? 'rtl' : 'ltr'}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
          className="max-h-[72vh] overflow-auto bg-white border border-slate-200 rounded-2xl shadow-[0_20px_60px_-12px_rgba(15,23,42,0.35)] p-3.5">

          <div className="flex items-center gap-2 mb-2.5 sticky top-0 bg-white pb-2.5 border-b border-slate-200 z-10">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
              <SlidersHorizontal className="w-4 h-4 text-[#12325c]" />
              {t('الفلاتر', 'Filters')}
            </span>
            {active > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#12325c] text-white text-[10px] font-bold tabular-nums">{active}</span>
            )}
            {resultCount != null && (
              <span className="text-[11.5px] text-slate-500">
                {resultLabel || t('النتائج', 'Results')} <b className="tabular-nums text-slate-900">{resultCount}</b>
              </span>
            )}
            <div className="flex items-center gap-2 shrink-0 ms-auto">
              {active > 0 && (
                <button onClick={clearAll} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-slate-500 hover:text-red-600 hover:bg-red-50">
                  <RotateCcw className="w-3.5 h-3.5" /> {t('مسح الكل', 'Clear all')}
                </button>
              )}
              <button onClick={() => setOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
          </div>

          {extra && <div className="mb-2 pb-2 border-b border-slate-100">{extra}</div>}
          {loading && !fields.length && (
            <p className="text-[12px] text-slate-400 py-4 text-center">{t('جارٍ التحميل…', 'Loading…')}</p>
          )}

          {/* ── عمودان: الحقول ثابتة، وقيمها تُبدَّل بجانبها ────────────────────
              كان الحقل المفتوح يتمدّد داخل الشبكة فيدفع ما تحته ويقفز مكانُ كل
              شيء مع كل ضغطة. هنا لا يتحرّك شيء: تنتقل بين الحقول فيتبدّل
              المحتوى في مكانه وحده. */}
          <div className="flex gap-3 min-h-[17rem]">
            <div className="w-52 shrink-0 max-h-[52vh] overflow-auto p-1.5 rounded-xl bg-slate-50/70 border border-slate-100">
              {byGroup.map(([g, fs]) => (
                <div key={g} className="mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-1 mb-0.5">{g}</p>
                  {fs.map((f) => {
                    const sel = String(value[f.key] || '').split(',').filter(Boolean);
                    const on = expanded === f.key;
                    return (
                      <button key={f.key} onClick={() => setExpanded(f.key)}
                        className={`w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-start transition
                          ${on ? 'bg-[#12325c] text-white' : sel.length ? 'bg-orange-50 text-slate-800' : 'text-slate-600 hover:bg-slate-100'}`}>
                        <span className="text-[12px] font-semibold truncate">{ar ? f.ar : f.en}</span>
                        {sel.length > 0
                          ? <span className={`px-1.5 rounded-full text-[10px] font-bold shrink-0 ${on ? 'bg-white/25 text-white' : 'bg-[#f37121] text-white'}`}>{sel.length}</span>
                          : <span className={`text-[10px] tabular-nums shrink-0 ${on ? 'text-white/60' : 'text-slate-400'}`}>{f.values.length}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!!dateFields.length && (
                <div className="mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-1 mb-0.5">{t('المدد الزمنية', 'Date ranges')}</p>
                  {dateFields.map((dd) => {
                    const on = expanded === `date:${dd.key}`;
                    const has = !!(value[`${dd.key}From`] || value[`${dd.key}To`]);
                    return (
                      <button key={dd.key} onClick={() => setExpanded(`date:${dd.key}`)}
                        className={`w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-start transition
                          ${on ? 'bg-[#12325c] text-white' : has ? 'bg-orange-50 text-slate-800' : 'text-slate-600 hover:bg-slate-100'}`}>
                        <span className="text-[12px] font-semibold truncate">{ar ? dd.ar : dd.en}</span>
                        {has && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-white' : 'bg-[#f37121]'}`} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 max-h-[52vh] overflow-auto ps-0.5">
              {(() => {
                const f = fields.find((x) => x.key === expanded);
                if (f) {
                  const sel = String(value[f.key] || '').split(',').filter(Boolean);
                  const q = (search[f.key] || '').trim();
                  const vals = q ? f.values.filter((v) => v.value.toLowerCase().includes(q.toLowerCase())) : f.values;
                  return (
                    <>
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-[12.5px] font-bold text-slate-800 truncate">{ar ? f.ar : f.en}</p>
                        {sel.length > 0 && (
                          <button onClick={() => set(f.key, '')} className="text-[11px] text-slate-500 hover:text-red-600 shrink-0">
                            {t('مسح', 'Clear')}
                          </button>
                        )}
                        {f.values.length > 8 && (
                          <div className="relative ms-auto w-40">
                            <Search className="w-3 h-3 absolute top-2 start-2 text-slate-300" />
                            <input value={search[f.key] || ''}
                              onChange={(e) => setSearch((sv) => ({ ...sv, [f.key]: e.target.value }))}
                              placeholder={t('ابحث…', 'Search…')}
                              className="w-full ps-6 pe-2 py-1 text-[11.5px] border border-slate-200 rounded-md focus:outline-none focus:border-slate-400" />
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-2 gap-y-0.5">
                        {vals.map((v) => {
                          const on = sel.includes(v.value);
                          return (
                            <button key={v.value} onClick={() => set(f.key, toggleValue(value[f.key], v.value))}
                              className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[11.5px] transition
                                ${on ? 'bg-[#12325c] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
                              <span className="flex items-center gap-1.5 truncate">
                                <span className={`w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0
                                  ${on ? 'bg-white border-white' : 'border-slate-300'}`}>
                                  {on && <Check className="w-2.5 h-2.5 text-[#12325c]" strokeWidth={4} />}
                                </span>
                                <span className="truncate">{v.value === '—' ? t('(بلا قيمة)', '(blank)') : v.value}</span>
                              </span>
                              <b className={`tabular-nums ${on ? 'text-white/80' : 'text-slate-400'}`}>{v.count}</b>
                            </button>
                          );
                        })}
                        {!vals.length && <p className="text-[11px] text-slate-400 px-1.5 py-1">{t('لا نتائج', 'No matches')}</p>}
                      </div>
                    </>
                  );
                }
                const dk = String(expanded || '').startsWith('date:') ? String(expanded).slice(5) : '';
                const dd = dateFields.find((x) => x.key === dk);
                if (dd) {
                  return (
                    <>
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-[12.5px] font-bold text-slate-800 truncate">{ar ? dd.ar : dd.en}</p>
                        {(value[`${dd.key}From`] || value[`${dd.key}To`]) && (
                          <button onClick={() => { set(`${dd.key}From`, ''); set(`${dd.key}To`, ''); }}
                            className="text-[11px] text-slate-500 hover:text-red-600 shrink-0">{t('مسح', 'Clear')}</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-w-sm">
                        <label className="block">
                          <span className="text-[11px] text-slate-500">{t('من', 'From')}</span>
                          <input type="date" value={value[`${dd.key}From`] || ''}
                            onChange={(e) => set(`${dd.key}From`, e.target.value)}
                            className="w-full px-2 py-1 text-[11.5px] border border-slate-200 rounded-md" />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-slate-500">{t('إلى', 'To')}</span>
                          <input type="date" value={value[`${dd.key}To`] || ''}
                            onChange={(e) => set(`${dd.key}To`, e.target.value)}
                            className="w-full px-2 py-1 text-[11.5px] border border-slate-200 rounded-md" />
                        </label>
                      </div>
                    </>
                  );
                }
                return (
                  <p className="text-[12px] text-slate-400 pt-8 text-center">
                    {t('اختر حقلًا من القائمة لعرض قيمه', 'Pick a field from the list to see its values')}
                  </p>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
