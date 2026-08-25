'use client';
// شريط فلاتر واحد يصلح لأي قسم.
//
// المشكلة التي يحلّها: الشاشات كانت تُفلتَر بقيمة واحدة لحقل واحد، فالسؤال
// الحقيقي — «أرِني الباكستانيين والهنود، الذكور، في النقل الثقيل، بجدّة ومكّة» —
// كان يحتاج أربع زيارات ولا يُجاب عنه مجتمعًا أبدًا.
//
// ولماذا شريطٌ لا لوحةٌ منبثقة: كانت الحقول كلها مخبّأة خلف زرٍّ واحد يفتح لوحةً
// عريضة، فتقصّها أوّلُ حاوية فوقها ذات `overflow` ولا يظهر منها إلا طرف. والأهمّ
// من العطل: الفلتر المخبّأ لا يُستعمل — لا يعرف الناظر ما الذي يملك أن يفلتر به
// حتى يفتح، فيظنّ أن لا شيء هناك. الآن كل حقلٍ زرٌّ ظاهر باسمه، والضغط عليه
// يفتح قائمته وحدها.
//
// وثلاث قواعد تحكم هذا الشريط:
//
// ١) قائمة الحقول وقيمها **تأتي من الخادم**، لا تُكتب هنا. فالجنسيات التي تظهر
//    هي الجنسيات الموجودة فعلًا في البيانات، وأيّ عمود جديد يظهر وحده.
//
// ٢) العدد بجانب كل قيمة محسوب **بعد بقيّة الفلاتر**، فما تراه هو ما ستحصل
//    عليه؛ ولا يظهر خيار عدده صفر فتضغطه فتجد الشاشة فارغة.
//
// ٣) الفلتر النشط يبقى مرئيًّا كشرائح تحت الشريط. الفلتر المخفيّ الذي تنساه
//    مفعَّلًا هو أسوأ ما في أيّ لوحة تحليلات: الأرقام تبدو خاطئة ولا تعرف لماذا.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { X, Search, ChevronDown, RotateCcw, Check, SlidersHorizontal } from 'lucide-react';

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

/**
 * قائمة منسدلة تُرسَم في جذر الصفحة لا داخل الشريط.
 *
 * الرسم في الجذر ليس زخرفة: أيّ حاوية فوق الشريط فيها `overflow` — وجدولٌ قابل
 * للتمرير الأفقيّ فوقه بطاقةٌ مستديرة الحواف كافيان — كانت تقصّ القائمة فلا
 * يظهر منها إلا سطر. وهي تتبع زرَّها عند التمرير حتى لا تنفصل عنه.
 */
function Dropdown({ anchor, onClose, children, isRTL }: {
  anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode; isRTL: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const WIDTH = 280;

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      // تُحاذى القائمة مع بداية زرّها في اتجاه القراءة، ثم تُزَحّ داخل الشاشة
      // إن تجاوزت حافتها — فحقلٌ في آخر السطر لا تخرج قائمته عن الشاشة.
      let left = isRTL ? r.right - WIDTH : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8));
      setPos({ top: r.bottom + 6, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, isRTL]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [anchor, onClose]);

  if (!pos || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={panel} dir={isRTL ? 'rtl' : 'ltr'}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH, zIndex: 60 }}
      className="bg-white border border-slate-200 rounded-xl shadow-2xl p-2">
      {children}
    </div>,
    document.body,
  );
}

export default function FilterPanel({
  optionsUrl, value, onChange, dateFields = [], extra, extraLabels = {}, resultCount, resultLabel,
}: {
  /** اندبوينت يرجّع { filters: FilterFieldDef[], dateFields?: string[] } */
  optionsUrl: string;
  value: FilterValues;
  onChange: (v: FilterValues) => void;
  /** حقول التاريخ التي تقبل مدى — بأسمائها المعروضة */
  dateFields?: FilterDateDef[];
  /** فلاتر خاصة بالقسم (أزرار جاهزة) تظهر أوّل الشريط */
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

  const [fields, setFields] = useState<FilterFieldDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState<Record<string, string>>({});

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

  const openFor = (key: string, el: HTMLElement) => {
    if (openKey === key) { setOpenKey(null); setAnchor(null); return; }
    setOpenKey(key); setAnchor(el);
  };
  const close = () => { setOpenKey(null); setAnchor(null); };

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

  /** زرّ حقلٍ واحد: اسمه، وعدد ما اختير منه، وعدد قيمه المتاحة. */
  const FieldButton = ({ f }: { f: FilterFieldDef }) => {
    const sel = String(value[f.key] || '').split(',').filter(Boolean);
    const isOpen = openKey === f.key;
    return (
      <button
        onClick={(e) => openFor(f.key, e.currentTarget)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold transition
          ${sel.length
            ? 'bg-[#12325c] text-white border-[#12325c]'
            : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'}`}>
        <span className="truncate max-w-[10rem]">{label(f)}</span>
        {sel.length > 0
          ? <span className="px-1.5 rounded-full bg-white/25 text-[10px] font-bold tabular-nums">{sel.length}</span>
          : <span className="text-[10px] text-slate-400 tabular-nums">{f.values.length}</span>}
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
    );
  };

  /** محتوى قائمة حقلٍ واحد: بحث عند كثرة القيم، ثم القيم بأعدادها. */
  const FieldMenu = ({ f }: { f: FilterFieldDef }) => {
    const sel = String(value[f.key] || '').split(',').filter(Boolean);
    const q = (search[f.key] || '').trim();
    const vals = q ? f.values.filter((v) => v.value.toLowerCase().includes(q.toLowerCase())) : f.values;
    return (
      <>
        <div className="flex items-center justify-between gap-2 px-1 pb-1.5 mb-1 border-b border-slate-100">
          <p className="text-[12px] font-bold text-slate-800 truncate">{label(f)}</p>
          {sel.length > 0 && (
            <button onClick={() => set(f.key, '')} className="text-[11px] text-slate-500 hover:text-red-600 shrink-0">
              {t('مسح', 'Clear')}
            </button>
          )}
        </div>
        {f.values.length > 8 && (
          <div className="relative mb-1.5">
            <Search className="w-3 h-3 absolute top-2 start-2 text-slate-300" />
            <input autoFocus value={search[f.key] || ''}
              onChange={(e) => setSearch((s) => ({ ...s, [f.key]: e.target.value }))}
              placeholder={t('ابحث…', 'Search…')}
              className="w-full ps-6 pe-2 py-1 text-[11.5px] border border-slate-200 rounded-md focus:outline-none focus:border-slate-400" />
          </div>
        )}
        <div className="max-h-64 overflow-auto space-y-0.5">
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
      </>
    );
  };

  const openField = fields.find((f) => f.key === openKey);
  const openDate = dateFields.find((d) => `date:${d.key}` === openKey);

  return (
    <div className="space-y-2.5" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* العنوان وأدوات الشريط */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-slate-800">
          <SlidersHorizontal className="w-4 h-4 text-[#12325c]" />
          {t('الفلاتر', 'Filters')}
        </span>
        {resultCount != null && (
          <span className="text-[12px] text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1">
            {resultLabel || t('النتائج', 'Results')}: <b className="tabular-nums text-slate-900">{resultCount}</b>
          </span>
        )}
        {active > 0 && (
          <button onClick={clearAll}
            className="inline-flex items-center gap-1 text-[11.5px] text-slate-500 hover:text-red-600 ms-auto">
            <RotateCcw className="w-3.5 h-3.5" /> {t('مسح كل الفلاتر', 'Clear all filters')}
          </button>
        )}
      </div>

      {extra && <div>{extra}</div>}

      {loading && !fields.length && (
        <p className="text-[12px] text-slate-400 py-2">{t('جارٍ تحميل الفلاتر…', 'Loading filters…')}</p>
      )}

      {/* كل حقلٍ زرٌّ ظاهر باسمه — لا شيء مخبّأ خلف زرٍّ واحد */}
      {byGroup.map(([g, fs]) => (
        <div key={g} className="flex items-start gap-2">
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide pt-2 w-24 shrink-0 truncate">{g}</p>
          <div className="flex flex-wrap gap-1.5">
            {fs.map((f) => <FieldButton key={f.key} f={f} />)}
          </div>
        </div>
      ))}

      {!!dateFields.length && (
        <div className="flex items-start gap-2">
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide pt-2 w-24 shrink-0">
            {t('المدد الزمنية', 'Date ranges')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {dateFields.map((d) => {
              const on = !!(value[`${d.key}From`] || value[`${d.key}To`]);
              const isOpen = openKey === `date:${d.key}`;
              return (
                <button key={d.key} onClick={(e) => openFor(`date:${d.key}`, e.currentTarget)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold transition
                    ${on ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'}`}>
                  <span className="truncate max-w-[10rem]">{ar ? d.ar : d.en}</span>
                  <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* شرائح الفلتر النشط — ما يُنسى مفعَّلًا يجعل الأرقام تبدو خاطئة بلا سبب */}
      {!!chips.length && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {chips.map((c) => (
            <button key={`${c.k}:${c.v}`}
              onClick={() => set(c.k, c.v ? toggleValue(value[c.k], c.v) : '')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#12325c] text-white text-[11px] font-semibold hover:bg-[#1b4278]">
              {c.text}<X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      {openField && (
        <Dropdown anchor={anchor} onClose={close} isRTL={isRTL}>
          <FieldMenu f={openField} />
        </Dropdown>
      )}

      {openDate && (
        <Dropdown anchor={anchor} onClose={close} isRTL={isRTL}>
          <div className="flex items-center justify-between gap-2 px-1 pb-1.5 mb-1.5 border-b border-slate-100">
            <p className="text-[12px] font-bold text-slate-800 truncate">{ar ? openDate.ar : openDate.en}</p>
            {(value[`${openDate.key}From`] || value[`${openDate.key}To`]) && (
              <button onClick={() => { set(`${openDate.key}From`, ''); set(`${openDate.key}To`, ''); }}
                className="text-[11px] text-slate-500 hover:text-red-600 shrink-0">{t('مسح', 'Clear')}</button>
            )}
          </div>
          <div className="space-y-1.5 px-1 pb-1">
            <label className="block">
              <span className="text-[11px] text-slate-500">{t('من', 'From')}</span>
              <input type="date" value={value[`${openDate.key}From`] || ''}
                onChange={(e) => set(`${openDate.key}From`, e.target.value)}
                className="w-full px-2 py-1 text-[11.5px] border border-slate-200 rounded-md" />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">{t('إلى', 'To')}</span>
              <input type="date" value={value[`${openDate.key}To`] || ''}
                onChange={(e) => set(`${openDate.key}To`, e.target.value)}
                className="w-full px-2 py-1 text-[11.5px] border border-slate-200 rounded-md" />
            </label>
          </div>
        </Dropdown>
      )}
    </div>
  );
}
