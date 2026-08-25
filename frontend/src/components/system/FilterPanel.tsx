'use client';
// لوحة فلترة واحدة تصلح لأي قسم.
//
// المشكلة التي تحلّها: الشاشات كانت تُفلتَر بقيمة واحدة لحقل واحد، فالسؤال
// الحقيقي — «أرِني الباكستانيين والهنود، الذكور، في النقل الثقيل، بجدة ومكة» —
// كان يحتاج أربع زيارات ولا يُجاب عنه مجتمعًا أبدًا.
//
// ثلاث قواعد تحكم هذه اللوحة:
//
// ١) قائمة الحقول وقيمها **تأتي من الخادم**، لا تُكتب هنا. فالجنسيات التي تظهر
//    هي الجنسيات الموجودة فعلًا في البيانات، وأي عمود جديد يظهر وحده.
//
// ٢) العدد بجانب كل قيمة محسوب **بعد بقيّة الفلاتر**، فما تراه هو ما ستحصل
//    عليه؛ ولا يظهر خيار عدده صفر فتضغطه وتجد الشاشة فارغة.
//
// ٣) الفلتر النشط يبقى مرئيًّا كشرائح فوق الصفحة. الفلتر المخفيّ الذي تنساه
//    مفعَّلًا هو أسوأ ما في أي لوحة تحليلات: الأرقام تبدو خاطئة ولا تعرف لماذا.
import { useEffect, useMemo, useRef, useState } from 'react';
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

/** ضمّ/إزالة قيمة من حقل متعدّد القيم (القيم مفصولة بفواصل في نص الاستعلام). */
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
   * الشريحة باسم المفتاح البرمجي — «employment: active» — وهو ليس عربيًّا ولا
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
  const box = useRef<HTMLDivElement>(null);

  // القيم تُعاد قراءتها مع كل تغيير في الفلتر — وهذا بيت القصيد: بعد اختيار
  // «جدة» يصير عدد كل جنسية هو عددها في جدة، لا في الشركة كلها.
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

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
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
        <div className="relative" ref={box}>
          <button onClick={() => setOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition
              ${active ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}>
            <SlidersHorizontal className="w-4 h-4" />
            {t('تصفية', 'Filter')}
            {active > 0 && <span className="px-1.5 rounded-full bg-white/25 text-[11px] font-bold">{active}</span>}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute z-40 mt-1.5 w-[min(92vw,760px)] max-h-[70vh] overflow-auto bg-white border border-slate-200 rounded-xl shadow-xl p-3
                            start-0 rtl:start-auto rtl:end-0">
              <div className="flex items-center justify-between mb-2 sticky top-0 bg-white pb-2 border-b border-slate-100">
                <p className="text-[12.5px] font-bold text-slate-800">
                  {t('اختر أي عدد من القيم في أي عدد من الحقول', 'Pick any number of values across any fields')}
                </p>
                <div className="flex items-center gap-2">
                  {active > 0 && (
                    <button onClick={clearAll} className="inline-flex items-center gap-1 text-[11.5px] text-slate-500 hover:text-red-600">
                      <RotateCcw className="w-3.5 h-3.5" /> {t('مسح الكل', 'Clear all')}
                    </button>
                  )}
                  <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
              </div>

              {extra && <div className="mb-2 pb-2 border-b border-slate-100">{extra}</div>}
              {loading && !fields.length && <p className="text-[12px] text-slate-400 py-4 text-center">{t('جارٍ التحميل…', 'Loading…')}</p>}

              {byGroup.map(([g, fs]) => (
                <div key={g} className="mb-3">
                  <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1">{g}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {fs.map((f) => {
                      const sel = String(value[f.key] || '').split(',').filter(Boolean);
                      const isOpen = expanded === f.key;
                      const q = (search[f.key] || '').trim();
                      const vals = q ? f.values.filter((v) => v.value.toLowerCase().includes(q.toLowerCase())) : f.values;
                      return (
                        <div key={f.key} className={`rounded-lg border ${sel.length ? 'border-[#f37121] bg-orange-50/40' : 'border-slate-200'}`}>
                          <button onClick={() => setExpanded(isOpen ? null : f.key)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-start">
                            <span className="text-[12px] font-semibold text-slate-700 truncate">{label(f)}</span>
                            <span className="flex items-center gap-1 shrink-0">
                              {sel.length > 0 && <span className="px-1.5 rounded-full bg-[#f37121] text-white text-[10px] font-bold">{sel.length}</span>}
                              <span className="text-[10px] text-slate-400">{f.values.length}</span>
                              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </span>
                          </button>
                          {isOpen && (
                            <div className="px-2 pb-2">
                              {f.values.length > 8 && (
                                <div className="relative mb-1">
                                  <Search className="w-3 h-3 absolute top-2 start-2 text-slate-300" />
                                  <input value={search[f.key] || ''} onChange={(e) => setSearch((s) => ({ ...s, [f.key]: e.target.value }))}
                                    placeholder={t('بحث…', 'Search…')}
                                    className="w-full ps-6 pe-2 py-1 text-[11.5px] border border-slate-200 rounded-md focus:outline-none focus:border-slate-400" />
                                </div>
                              )}
                              <div className="max-h-44 overflow-auto space-y-0.5">
                                {vals.map((v) => {
                                  const on = sel.includes(v.value);
                                  return (
                                    <button key={v.value} onClick={() => set(f.key, toggleValue(value[f.key], v.value))}
                                      className={`w-full flex items-center justify-between gap-2 px-1.5 py-1 rounded text-[11.5px] transition
                                        ${on ? 'bg-[#12325c] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
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
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {!!dateFields.length && (
                <div>
                  <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1">{t('المدد الزمنية', 'Date ranges')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {dateFields.map((d) => (
                      <div key={d.key} className={`rounded-lg border px-2.5 py-1.5
                        ${value[`${d.key}From`] || value[`${d.key}To`] ? 'border-[#f37121] bg-orange-50/40' : 'border-slate-200'}`}>
                        <p className="text-[11.5px] font-semibold text-slate-700 mb-1">{ar ? d.ar : d.en}</p>
                        <div className="flex items-center gap-1">
                          <input type="date" value={value[`${d.key}From`] || ''} onChange={(e) => set(`${d.key}From`, e.target.value)}
                            className="flex-1 min-w-0 px-1.5 py-1 text-[11px] border border-slate-200 rounded-md" />
                          <span className="text-[10px] text-slate-400">→</span>
                          <input type="date" value={value[`${d.key}To`] || ''} onChange={(e) => set(`${d.key}To`, e.target.value)}
                            className="flex-1 min-w-0 px-1.5 py-1 text-[11px] border border-slate-200 rounded-md" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

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
            {t('مسح كل الفلاتر', 'Clear all')}
          </button>
        )}
      </div>
    </div>
  );
}
