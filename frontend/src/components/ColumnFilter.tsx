'use client';
import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Loader2 } from 'lucide-react';

export type ColumnFilterOption = { value: string; count?: number };

// فلتر عمودٍ على طريقة إكسل: تُضغط القمعُ في رأس العمود فتُفتح قائمةُ قيمه، تُؤشَّر
// منها المطلوبة فيقتصر الجدول عليها. المطابقة تجري على القيمة **الخام** كما هي في
// القاعدة، فيجب أن يحمل `selected` قيمًا خامًّا لا نصوصًا معروضة.
//
// للقائمة مصدران:
//   • `options` — قيمٌ محسوبةٌ في الخادم مع عدد صفوف كلٍّ منها. هذا هو المصدر
//     الصحيح للجداول المُصفَّحة في الخادم: بناء القائمة من الصفوف المحمَّلة يعرض
//     قيم الصفحة الحالية وحدها (ثلاث حالاتٍ من تسع)، وتحميلُ الجدول كلّه لعلاجه
//     يجمّد التبويب.
//   • `rows` — الاشتقاق من الصفوف المحمَّلة، ويبقى للجداول التي تُحمَّل كاملةً في
//     المتصفح أصلًا فلا ينقصها شيء.
export function ColumnFilter({ rows, field, selected, onChange, onOpen, lang, format, options, loading, truncated, onQuery }: {
  rows?: any[];
  field: string;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  onOpen?: () => void;
  lang: 'en' | 'ar';
  format?: (v: any) => string;
  options?: ColumnFilterOption[];
  loading?: boolean;
  truncated?: boolean;
  onQuery?: (q: string) => void;
}) {
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const serverMode = !!options;

  useEffect(() => {
    if (!open) return;
    // اللوحةُ صارت في `body` فليست ابنةً للزرّ: الضغطُ داخلها كان يُقرأ «خارجًا»
    // فتُغلق قبل أن يُؤشَّر شيء. فيُستثنى ما بداخلها صراحةً.
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && ref.current.contains(t)) return;
      if (panelRef.current && panelRef.current.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // البحث في القيم: يُنفَّذ في المتصفح ما دامت القيم كلّها حاضرة. فإذا بلغت القائمة
  // سقف الخادم (أعمدةٌ كرقم الكشف فيها قيمةٌ لكل صف) صار البحث سؤالًا للخادم، وإلا
  // أجاب المتصفح «لا توجد قيم» عن قيمةٍ موجودةٍ في القاعدة لكنها خارج ما وصله.
  const [serverSearch, setServerSearch] = useState(false);
  useEffect(() => { if (truncated) setServerSearch(true); }, [truncated]);
  useEffect(() => { if (!open) { setQ(''); setServerSearch(false); } }, [open]);

  // المرجع يمنع إعادةَ ضبط المهلة كلّما أعاد الأب الرسم: لو اعتمد الأثر على هوية
  // الدالة نفسها لظلّت المهلة تُلغى وتُستأنف فلا يصل البحث إلى الخادم أبدًا.
  const queryRef = useRef(onQuery);
  queryRef.current = onQuery;
  useEffect(() => {
    if (!open || !serverSearch) return;
    const t = setTimeout(() => queryRef.current?.(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, open, serverSearch]);

  const values = useMemo(() => {
    if (!open) return [] as { value: string; label: string; count?: number }[];
    const label = (value: string, raw: any) =>
      value === '' ? (ar ? '(فارغ)' : '(Blank)') : (format ? format(raw) : value);

    if (options) {
      const seen = new Set(options.map((o) => o.value));
      // القيمة المختارة تبقى ظاهرةً حتى لو خرجت من نتيجة الخادم (بعد بحثٍ أو بعد
      // تضييق بقيّة الفلاتر)، وإلا اختفى مربّعُها فتعذّر إلغاء اختيارها.
      const pinned = [...selected].filter((v) => !seen.has(v)).map((v) => ({ value: v, label: label(v, v), count: undefined }));
      // الترتيب ترتيبُ الخادم: الأكثر تكرارًا أولًا — وهو ما يبحث عنه المستخدم غالبًا.
      return [...pinned, ...options.map((o) => ({ value: o.value, label: label(o.value, o.value), count: o.count }))];
    }

    const map = new Map<string, string>();
    for (const r of rows || []) {
      const raw = r?.[field];
      const value = raw === null || raw === undefined || raw === '' ? '' : String(raw);
      if (!map.has(value)) map.set(value, label(value, raw));
    }
    return Array.from(map.entries())
      .map(([value, lbl]) => ({ value, label: lbl, count: undefined }))
      .sort((a, b) => a.label.localeCompare(b.label, ar ? 'ar' : 'en', { numeric: true }));
  }, [open, options, rows, field, ar, format, selected]);

  const shown = (!serverSearch && q.trim())
    ? values.filter((v) => v.label.toLowerCase().includes(q.trim().toLowerCase()))
    : values;
  const active = selected.size > 0;
  const allShownSelected = shown.length > 0 && shown.every((v) => selected.has(v.value));

  const toggle = (v: string) => { const n = new Set(selected); n.has(v) ? n.delete(v) : n.add(v); onChange(n); };
  const toggleAllShown = () => {
    const n = new Set(selected);
    if (allShownSelected) shown.forEach((v) => n.delete(v.value));
    else shown.forEach((v) => n.add(v.value));
    onChange(n);
  };

  // ── ولماذا تُرسَم اللوحةُ خارجَ الجدول ──────────────────────────────────────
  //
  // كانت `absolute` داخلَ رأس العمود، ورأسُ العمود داخلَ حاويةٍ تُمرَّر أفقيًّا
  // (`overflow-x-auto`) وأخرى `overflow-hidden`. والحاويةُ التي تقصّ محتواها
  // تقصّ أبناءها المطلقين أيضًا — ولا ينفع `z-index`: هو يرتّب الطبقات ولا
  // يُخرج شيئًا من مقصّ. فحين تُظهر النتيجةُ صفًّا واحدًا يكون ارتفاعُ الجدول
  // أقصرَ من اللوحة، فتُقصّ ويختفي أكثرُها.
  //
  // فتُرسَم في `body` بإحداثيّاتٍ من موضع الزرّ: لا أبَ لها يقصّها. وتُصحَّح
  // إحداثيّاتُها مع التمرير وتغيير المقاس كي تبقى ملتصقةً بزرّها.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const W = 240; const M = 8;
      // لا تخرج عن الشاشة يمينًا ولا يسارًا.
      let left = ar ? r.right - W : r.left;
      left = Math.max(M, Math.min(left, window.innerWidth - W - M));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, ar]);

  const panel = (
        <div ref={panelRef} className="fixed z-[100] w-60 bg-white border border-slate-200 rounded-lg shadow-2xl p-2 text-slate-900 font-normal normal-case"
          style={{ top: pos ? pos.top : -9999, left: pos ? pos.left : -9999 }}
          dir={ar ? 'rtl' : 'ltr'}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'بحث في القيم...' : 'Search values...'}
            className="w-full mb-2 px-2 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-[#f37121]"
          />
          <div className="flex items-center justify-between mb-1 px-1">
            <button type="button" onClick={toggleAllShown} className="text-[11px] text-[#f37121] hover:underline">
              {allShownSelected ? (ar ? 'إلغاء تحديد الكل' : 'Clear shown') : (ar ? 'تحديد الكل' : 'Select all')}
            </button>
            {active && <button type="button" onClick={() => onChange(new Set())} className="text-[11px] text-slate-500 hover:underline">{ar ? 'إعادة تعيين' : 'Reset'}</button>}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading && shown.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-slate-400 px-1 py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> {ar ? 'جارٍ تحميل القيم...' : 'Loading values...'}
              </p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-2">{ar ? 'لا توجد قيم' : 'No values'}</p>
            ) : shown.map((v) => (
              <label key={v.value} className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-slate-100 rounded cursor-pointer">
                <input type="checkbox" checked={selected.has(v.value)} onChange={() => toggle(v.value)} className="w-3.5 h-3.5 accent-[#f37121]" />
                <span className="truncate flex-1" title={v.label}>{v.label}</span>
                {v.count != null && <span className="text-[10px] text-slate-400 tabular-nums">{v.count.toLocaleString()}</span>}
              </label>
            ))}
          </div>
          {serverMode && truncated && (
            <p className="text-[10px] text-slate-400 px-1 pt-1 border-t border-slate-100 mt-1">
              {ar ? 'القيم كثيرة — اكتب في البحث للوصول إلى الباقي' : 'Too many values — type to search for the rest'}
            </p>
          )}
          {serverMode && loading && shown.length > 0 && (
            <p className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1 pt-1">
              <Loader2 className="w-3 h-3 animate-spin" /> {ar ? 'تحديث...' : 'Updating...'}
            </p>
          )}
        </div>
  );

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }}
        className={`ms-1 p-0.5 rounded transition-colors ${active ? 'text-[#f37121]' : 'text-slate-400 hover:text-white'}`}
        title={ar ? 'فلتر' : 'Filter'}
      >
        <Filter className="w-3 h-3" fill={active ? 'currentColor' : 'none'} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(panel, document.body)}
    </span>
  );
}
