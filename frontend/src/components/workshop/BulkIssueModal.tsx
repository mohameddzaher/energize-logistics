'use client';
// صرف كذا صنف مرة واحدة — بدل ما أمين المخزن يخش على صنف صنف.
//
// الطلب كان: «فكرة إنه يخش على صنف صنف دي هتبقى بطيئة، خصوصًا إنه بيصرف أصناف
// كبيرة في اليوم». فالشاشة دي جدول أسطر: تكتب اسم الصنف، تختار من النتايج،
// تكتب الكمية، Enter وتروح للسطر اللي بعده.
//
// ── تلات قرارات ورا التصميم ────────────────────────────────────────────────
//
// ١) البيانات المشتركة فوق مرة واحدة (العربية، التاريخ، المكان، مصير القطعة
//    المستبدلة). ٩٩٪ من الصرف بيبقى لعربية واحدة في يوم واحد، فتكرارها على كل
//    سطر شغل زيادة. وأي سطر يقدر يكسر المشترك لنفسه.
//
// ٢) الرصيد بيبان جنب كل سطر وهو بيكتب، والزيادة بتتلوّن أحمر **قبل** ما يبعت
//    — عشان يعرف من غير ما يستنى رد السيرفر.
//
// ٣) الكل أو لا شيء. السيرفر بيرفض العملية كلها لو سطر واحد غلط، وبيرجّع
//    الأخطاء بأرقام أسطرها وإحنا بنعرضها جنب السطر نفسه. صرف نصّه اتنفّذ
//    أسوأ من اللي اترفض كله: المخزن بيبقى غلط وأمين المخزن مش عارف أنهي سطر
//    نزل، فيعيد الصرف كله ويطلع بدل مرتين.
import { useState, useMemo, useRef, useEffect } from 'react';
import { X, Plus, Trash2, Search, Check, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';

type Item = { _id: string; name: string; code?: string; quantity: number; unit?: string; category?: string };
type Line = {
  key: number;
  item: Item | null;
  query: string;
  quantity: string;
  vehicleNumber: string;   // فاضي = المشترك
  fitLocation: '' | 'head' | 'flatbed' | 'trailer';
  replacedFate: '' | 'damaged' | 'under_renewal' | 'none';
  notes: string;
  error?: string;
};

const FIT = [
  { key: '', ar: '— غير محدد —', en: '— none —' },
  { key: 'head', ar: 'الرأس', en: 'Head' },
  { key: 'flatbed', ar: 'السطحة', en: 'Flatbed' },
  { key: 'trailer', ar: 'التيدر', en: 'Trailer' },
] as const;
const FATE = [
  { key: 'none', ar: 'لا توجد قطعة مستبدلة', en: 'Nothing replaced' },
  { key: 'damaged', ar: 'القطعة القديمة تالفة', en: 'Old part damaged' },
  { key: 'under_renewal', ar: 'القطعة القديمة تحت التجديد', en: 'Old part under renewal' },
] as const;

let nextKey = 1;
const blankLine = (): Line => ({
  key: nextKey++, item: null, query: '', quantity: '1',
  vehicleNumber: '', fitLocation: '', replacedFate: '', notes: '',
});

export default function BulkIssueModal({ ar, onClose, onDone, notify }: {
  ar: boolean; onClose: () => void; onDone: () => void;
  notify: (m: string, t?: 'success' | 'error') => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [shared, setShared] = useState({
    vehicleNumber: '', date: new Date().toISOString().slice(0, 10),
    fitLocation: '' as Line['fitLocation'], replacedFate: '' as Line['replacedFate'], notes: '',
  });
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine(), blankLine()]);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState('');

  // ── البحث عن الصنف ────────────────────────────────────────────────────────
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [results, setResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<any>(null);

  const search = (q: string, lineKey: number) => {
    setOpenFor(lineKey);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const d = await api.get<any>(`/api/workshop/inventory/search?q=${encodeURIComponent(q.trim())}&limit=12`);
        setResults(d.items || d.results || (Array.isArray(d) ? d : []));
      } catch { setResults([]); }
      setSearching(false);
    }, 220);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p, error: undefined } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  // الأسطر اللي فيها صنف فعلاً — الفاضية بتتجاهل
  const filled = useMemo(() => lines.filter((l) => l.item), [lines]);

  // مجموع المطلوب لكل صنف عبر كل الأسطر — نفس حساب السيرفر، عشان التحذير
  // يطابق الرفض. صنف متكرّر في تلات أسطر × ٢ لازم يتقاس على ٦ مش على ٢.
  const perItem = useMemo(() => {
    const m = new Map<string, number>();
    filled.forEach((l) => m.set(l.item!._id, (m.get(l.item!._id) || 0) + (Number(l.quantity) || 0)));
    return m;
  }, [filled]);
  const overdrawn = useMemo(
    () => filled.filter((l) => (perItem.get(l.item!._id) || 0) > (l.item!.quantity || 0)),
    [filled, perItem],
  );

  const fateOf = (l: Line) => l.replacedFate || shared.replacedFate;
  const missingFate = filled.filter((l) => !fateOf(l));
  const totalQty = filled.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  const canSubmit = filled.length > 0 && !overdrawn.length && !missingFate.length && !saving;

  const submit = async () => {
    setTopError('');
    setSaving(true);
    try {
      const body = {
        vehicleNumber: shared.vehicleNumber.trim(),
        date: shared.date,
        notes: shared.notes.trim(),
        lines: filled.map((l) => ({
          item: l.item!._id,
          quantity: Math.max(1, Number(l.quantity) || 1),
          vehicleNumber: (l.vehicleNumber || shared.vehicleNumber).trim(),
          fitLocation: l.fitLocation || shared.fitLocation,
          replacedFate: fateOf(l),
          notes: (l.notes || shared.notes).trim(),
          date: shared.date,
        })),
      };
      const r = await api.post<any>('/api/workshop/inventory/issue-bulk', body);
      notify(t(`تم صرف ${r?.summary?.lines ?? filled.length} سطر · ${r?.summary?.totalQty ?? totalQty} قطعة`,
        `Issued ${r?.summary?.lines ?? filled.length} lines · ${r?.summary?.totalQty ?? totalQty} units`), 'success');
      onDone();
      onClose();
    } catch (e: any) {
      // السيرفر بيرجّع الأخطاء بأرقام أسطرها — نحطّها جنب السطر نفسه.
      const errs = e?.data?.errors || e?.errors;
      if (Array.isArray(errs) && errs.length) {
        setLines((ls) => {
          const copy = [...ls];
          errs.forEach((x: any) => {
            String(x.line).split('، ').forEach((n: string) => {
              const idx = filled[Number(n) - 1];
              const at = copy.findIndex((c) => c.key === idx?.key);
              if (at >= 0) copy[at] = { ...copy[at], error: x.message };
            });
          });
          return copy;
        });
        setTopError(t('العملية اترفضت بالكامل — مفيش أي سطر اتنفّذ. صلّح الأسطر المعلّمة.',
          'Rejected in full — nothing was issued. Fix the flagged lines.'));
      } else setTopError(e?.message || 'Failed');
    }
    setSaving(false);
  };

  const inputCls = 'px-2 py-1.5 rounded-lg border border-slate-300 text-[13px] w-full focus:outline-none focus:border-[#f37121]';

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">{t('صرف عدة أصناف', 'Issue multiple items')}</h3>
            <p className="text-[11.5px] text-slate-600">
              {t('اكتب اسم الصنف واختر من النتايج، وبعدين الكمية. الأسطر الفاضية بتتجاهل.',
                 'Type an item name, pick it, then the quantity. Blank lines are ignored.')}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        {/* المشترك — بيتكتب مرة واحدة لكل الأسطر */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-700 mb-1">{t('رقم المركبة', 'Vehicle')}</label>
            <input value={shared.vehicleNumber} onChange={(e) => setShared((s) => ({ ...s, vehicleNumber: e.target.value }))}
              placeholder={t('مثال: 5010', 'e.g. 5010')} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-700 mb-1">{t('التاريخ', 'Date')}</label>
            <input type="date" value={shared.date} onChange={(e) => setShared((s) => ({ ...s, date: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-700 mb-1">{t('مكان التركيب', 'Fitted on')}</label>
            <select value={shared.fitLocation} onChange={(e) => setShared((s) => ({ ...s, fitLocation: e.target.value as any }))} className={inputCls}>
              {FIT.map((f) => <option key={f.key} value={f.key}>{ar ? f.ar : f.en}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold text-slate-700 mb-1">
              {t('مصير القطعة المستبدلة', 'Replaced part')} <span className="text-rose-600">*</span>
            </label>
            <select value={shared.replacedFate} onChange={(e) => setShared((s) => ({ ...s, replacedFate: e.target.value as any }))} className={inputCls}>
              <option value="">{t('— اختر —', '— choose —')}</option>
              {FATE.map((f) => <option key={f.key} value={f.key}>{ar ? f.ar : f.en}</option>)}
            </select>
          </div>
        </div>

        {topError && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[12.5px] font-semibold flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{topError}
          </div>
        )}

        {/* الأسطر */}
        <div className="px-5 py-3 space-y-2 max-h-[52vh] overflow-y-auto">
          {lines.map((l, i) => {
            const over = l.item && (perItem.get(l.item._id) || 0) > l.item.quantity;
            return (
              <div key={l.key} className={`rounded-xl border p-2.5 ${l.error || over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-end gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] grid place-items-center shrink-0 mb-1">{i + 1}</span>

                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2" />
                    <input
                      value={l.item ? `${l.item.name}${l.item.code ? ` · ${l.item.code}` : ''}` : l.query}
                      onChange={(e) => { patch(l.key, { query: e.target.value, item: null }); search(e.target.value, l.key); }}
                      onFocus={() => { if (!l.item) { setOpenFor(l.key); search(l.query, l.key); } }}
                      placeholder={t('اسم الصنف أو الكود…', 'Item name or code…')}
                      className={`${inputCls} ps-7 ${l.item ? 'font-semibold text-slate-900' : ''}`} />
                    {l.item && (
                      <button onClick={() => patch(l.key, { item: null, query: '' })}
                        className="absolute top-1/2 -translate-y-1/2 end-2 text-slate-500 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
                    )}
                    {openFor === l.key && !l.item && (l.query.trim() || searching) && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        {searching && <p className="px-3 py-2 text-[12px] text-slate-500">{t('بحث…', 'Searching…')}</p>}
                        {!searching && !results.length && <p className="px-3 py-2 text-[12px] text-slate-600">{t('مفيش نتايج', 'No results')}</p>}
                        {results.map((it) => (
                          <button key={it._id} onClick={() => { patch(l.key, { item: it, query: '' }); setOpenFor(null); setResults([]); }}
                            className="w-full text-start px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between gap-2">
                            <span className="text-[12.5px] text-slate-900 truncate">{it.name}{it.code ? ` · ${it.code}` : ''}</span>
                            <span className={`text-[11px] font-bold tabular-nums shrink-0 ${it.quantity > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                              {it.quantity}{it.unit ? ` ${it.unit}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="w-24">
                    <label className="block text-[10.5px] text-slate-600 mb-0.5">{t('الكمية', 'Qty')}</label>
                    <input type="number" min={1} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' && i === lines.length - 1) addLine(); }}
                      className={`${inputCls} text-center tabular-nums`} />
                  </div>

                  <div className="w-28 text-[11.5px]">
                    <label className="block text-[10.5px] text-slate-600 mb-0.5">{t('الرصيد', 'In stock')}</label>
                    <div className={`px-2 py-1.5 rounded-lg font-bold tabular-nums text-center ${
                      !l.item ? 'bg-slate-100 text-slate-500' : over ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>
                      {l.item ? `${l.item.quantity}${l.item.unit ? ` ${l.item.unit}` : ''}` : '—'}
                    </div>
                  </div>

                  <div className="w-36">
                    <label className="block text-[10.5px] text-slate-600 mb-0.5">{t('عربية (لو مختلفة)', 'Vehicle (if different)')}</label>
                    <input value={l.vehicleNumber} onChange={(e) => patch(l.key, { vehicleNumber: e.target.value })}
                      placeholder={shared.vehicleNumber || '—'} className={inputCls} />
                  </div>

                  <button onClick={() => removeLine(l.key)} disabled={lines.length === 1}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 mb-0.5">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {(l.error || over) && (
                  <p className="text-[11.5px] text-rose-700 font-semibold mt-1.5 ps-8">
                    {l.error || t(`الرصيد ${l.item!.quantity} والمطلوب في كل الأسطر ${perItem.get(l.item!._id)}`,
                      `Stock ${l.item!.quantity}, requested across lines ${perItem.get(l.item!._id)}`)}
                  </p>
                )}
              </div>
            );
          })}

          <button onClick={addLine}
            className="w-full py-2 rounded-xl border border-dashed border-slate-300 text-slate-700 hover:border-[#f37121] hover:text-[#f37121] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5">
            <Plus className="w-4 h-4" />{t('سطر جديد', 'Add line')}
          </button>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 flex flex-wrap items-center gap-2">
          <div className="text-[12.5px] text-slate-700">
            <b className="text-slate-900">{filled.length}</b> {t('سطر', 'lines')} · <b className="text-slate-900">{totalQty}</b> {t('قطعة', 'units')}
            {missingFate.length > 0 && (
              <span className="text-rose-700 font-semibold ms-2">{t('حدد مصير القطعة المستبدلة', 'Choose the replaced part’s fate')}</span>
            )}
          </div>
          <button onClick={submit} disabled={!canSubmit}
            className="ms-auto px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
            <Check className="w-4 h-4" />
            {saving ? t('جارٍ الصرف…', 'Issuing…')
              : filled.length ? t(`صرف ${filled.length} سطر`, `Issue ${filled.length} lines`)
              : t('اختر صنف على الأقل', 'Pick at least one item')}
          </button>
        </div>
      </div>
    </div>
  );
}
