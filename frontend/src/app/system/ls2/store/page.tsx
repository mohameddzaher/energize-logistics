'use client';
// مخزن النقل الثقيل — قطع الغيار: أصناف برصيد وسعر، حركات وارد/صادر (صادر على
// عربية / وارد من عربية)، إضافة أصناف، وسجل حركات — كله من هذه الصفحة بسهولة.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import SelectionBar from '@/components/ls2/SelectionBar';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { Boxes, Plus, ArrowDownToLine, ArrowUpFromLine, Edit, Trash2, X, Save, History, Search, Undo2 } from 'lucide-react';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { isLs2Staff, isLs2Admin, type Lang } from '@/lib/ls2';

type Item = { _id: string; code?: string; name: string; category?: string; categoryAr?: string; groupAr?: string; quantity: number; unit: string; unitPrice: number; minQuantity?: number; compatibleModels?: string[]; notes?: string; status: 'ok' | 'low' | 'out'; value: number };
type Cat = { key: string; ar: string; count: number };
type Movement = {
  _id: string; item: string; itemName: string; type: 'in' | 'out'; quantity: number;
  vehiclePlate?: string; reason?: string; balanceAfter: number; performedByName?: string; createdAt: string;
  // التراجع — السيرفر هو اللي بيقرر الحركة دي ينفع يترجع فيها ولا لأ، فالواجهة
  // ما تعيدش بناء القاعدة دي عندها.
  reversed?: boolean; reversedByName?: string; reversalReason?: string;
  canReverse?: boolean; isReversal?: boolean;
};

const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

const STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  ok: { ar: 'متوفر', en: 'In stock', cls: 'bg-emerald-100 text-emerald-700' },
  low: { ar: 'منخفض', en: 'Low', cls: 'bg-amber-100 text-amber-700' },
  out: { ar: 'نافد', en: 'Out', cls: 'bg-red-100 text-red-700' },
};

export default function Ls2StorePage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  // Gate on the SECTION, not on a hand-written role list. A role the super admin
  // grants «تعديل» on Location Solutions gets وارد/صادر/تعديل/حذف here without a
  // code change — which is what the permissions page promises and what the API
  // already honours (rbac lets a section grant through). The old list silently
  // broke that promise: the section opened, the actions stayed hidden.
  const canEdit = isLs2Admin(user);

  const [items, setItems] = useState<Item[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [plates, setPlates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [catF, setCatF] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [move, setMove] = useState<{ item: Item; type: 'in' | 'out' } | null>(null);
  // تحديد أكتر من صنف وصادر واحد عليهم — الصنف بينزل منه قطعة واحدة.
  // الاختيار بالـ _id مش بالصف، عشان يفضل شغّال لو الفلتر اتغيّر بعد الاختيار.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // الحركة الجماعية: 'out' صادر · 'in' وارد · null مغلقة
  const [bulkKind, setBulkKind] = useState<null | 'in' | 'out'>(null);
  const togglePick = (id: string) => setPicked((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [addNew, setAddNew] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);

  const load = useCallback(async () => {
    try {
      const [d, dash] = await Promise.all([
        api.get<{ items: Item[] }>(`/api/ls2/store${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
        api.get<{ totals: any }>('/api/ls2/store/dashboard'),
      ]);
      setItems(d.items || []); setTotals(dash.totals); setCats((dash as any).byCategory || []);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  }, [q, notify]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useSocket('ls2:store', useCallback(() => load(), [load]));
  useEffect(() => { api.get<{ vehicles: { plate: string }[] }>('/api/ls2/vehicles').then((d) => setPlates((d.vehicles || []).map((v) => v.plate).filter(Boolean))).catch(() => {}); }, []);

  const loadLog = useCallback(async () => {
    try { const d = await api.get<{ movements: Movement[] }>('/api/ls2/store/movements?limit=300'); setMovements(d.movements || []); } catch { /* keep */ }
  }, []);
  useEffect(() => { if (showLog) loadLog(); }, [showLog, loadLog]);
  useSocket('ls2:store', useCallback(() => { if (showLog) loadLog(); }, [showLog, loadLog]));

  const shown = useMemo(() => items.filter((i) =>
    (!statusF || i.status === statusF)
    && (!catF || i.category === catF)
    && (!priceMin || (i.unitPrice || 0) >= Number(priceMin))
    && (!priceMax || (i.unitPrice || 0) <= Number(priceMax))
  ), [items, statusF, catF, priceMin, priceMax]);
  const anyFilter = statusF || catF || priceMin || priceMax || q;
  const resetFilters = () => { setStatusF(''); setCatF(''); setPriceMin(''); setPriceMax(''); setQ(''); };

  const del = async (it: Item) => {
    if (!(await confirm(ar ? `حذف الصنف «${it.name}»؟` : `Delete "${it.name}"?`))) return;
    try { await api.delete(`/api/ls2/store/${it._id}`); notify(ar ? 'تم الحذف' : 'Deleted', 'success'); load(); } catch (e: any) { notify(e?.message, 'error'); }
  };

  // Same Excel export every other Location Solutions page offers — the store was
  // the only one without one.
  const itemCols: ExportColumn[] = [
    { header: ar ? 'الكود' : 'Code', key: 'code', width: 14 },
    { header: ar ? 'الصنف' : 'Item', key: 'name', width: 34 },
    { header: ar ? 'التصنيف' : 'Category', key: 'categoryAr', transform: (v, r) => v || r.category || '', width: 18 },
    { header: ar ? 'الرصيد' : 'Qty', key: 'quantity', width: 10 },
    { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 10 },
    { header: ar ? 'الحد الأدنى' : 'Min qty', key: 'minQuantity', width: 11 },
    { header: ar ? 'سعر الوحدة' : 'Unit price', key: 'unitPrice', width: 13 },
    { header: ar ? 'القيمة' : 'Value', key: 'value', width: 13 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => (ar ? STATUS[v]?.ar : STATUS[v]?.en) || v, width: 12 },
    { header: ar ? 'الموديلات المتوافقة' : 'Compatible models', key: 'compatibleModels', transform: (v) => (v || []).join('، '), width: 30 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];
  const movementCols: ExportColumn[] = [
    { header: ar ? 'التاريخ' : 'Date', key: 'createdAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''), width: 18 },
    { header: ar ? 'الصنف' : 'Item', key: 'itemName', width: 34 },
    { header: ar ? 'الحركة' : 'Type', key: 'type', transform: (v) => (ar ? (v === 'in' ? 'وارد' : 'صادر') : (v === 'in' ? 'In' : 'Out')), width: 10 },
    { header: ar ? 'الكمية' : 'Qty', key: 'quantity', width: 10 },
    { header: ar ? 'المركبة' : 'Vehicle', key: 'vehiclePlate', width: 14 },
    { header: ar ? 'السبب' : 'Reason', key: 'reason', width: 30 },
    { header: ar ? 'الرصيد بعدها' : 'Balance after', key: 'balanceAfter', width: 14 },
    { header: ar ? 'بواسطة' : 'By', key: 'performedByName', width: 20 },
  ];

  if (!isLs2Staff(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح' : 'Not authorized'}</div>;
  if (loading && !items.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Boxes className="w-5 h-5" />} title={ar ? 'مخزن النقل الثقيل' : 'Heavy Transport Store'} subtitle={ar ? 'قطع الغيار — الرصيد والحركات' : 'Spare parts — stock & movements'}>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLog((s) => !s)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${showLog ? 'bg-[#12325c] text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}><History className="w-4 h-4" /> {ar ? 'سجل الحركات' : 'Movements'}</button>
          <ExportMenu
            fileName="ls2-store" lang={lang as Lang}
            options={[
              { key: 'shown', label: ar ? 'المعروض حاليًا (بعد الفلتر)' : 'Current view (filtered)', sheets: [{ name: ar ? 'المخزن' : 'Store', rows: shown, columns: itemCols }] },
              { key: 'all', label: ar ? 'كل الأصناف' : 'All items', sheets: [{ name: ar ? 'المخزن' : 'Store', rows: items, columns: itemCols }] },
              { key: 'movements', label: ar ? 'سجل الحركات' : 'Movements log', sheets: [{ name: ar ? 'الحركات' : 'Movements', rows: movements, columns: movementCols }], disabled: !movements.length },
            ]}
          />
          {canEdit && <button onClick={() => setAddNew(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm"><Plus className="w-4 h-4" /> {ar ? 'صنف جديد' : 'Add item'}</button>}
        </div>
      </PageHeader>

      {/* بطاقات — قابلة للفلترة */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <button onClick={() => setStatusF('')} className="text-start"><StatCard label={ar ? 'عدد الأصناف' : 'Items'} value={totals?.items ?? items.length} accent="text-[#f37121]" /></button>
        <StatCard label={ar ? 'إجمالي القطع' : 'Total units'} value={money(totals?.totalUnits)} />
        <StatCard label={ar ? 'قيمة المخزون (ر.س)' : 'Stock value'} value={money(totals?.totalValue)} accent="text-emerald-600" />
        <button onClick={() => setStatusF(statusF === 'low' ? '' : 'low')} className="text-start"><StatCard label={ar ? 'منخفض' : 'Low stock'} value={totals?.lowStock ?? 0} accent="text-amber-600" /></button>
        <button onClick={() => setStatusF(statusF === 'out' ? '' : 'out')} className="text-start"><StatCard label={ar ? 'نافد' : 'Out of stock'} value={totals?.outOfStock ?? 0} accent="text-red-600" /></button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بالاسم / الكود / الموديل…' : 'name / code / model…'} className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-64 max-w-full" />
          </div>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            <option value="ok">{ar ? 'متوفر' : 'In stock'}</option>
            <option value="low">{ar ? 'منخفض' : 'Low'}</option>
            <option value="out">{ar ? 'نافد' : 'Out'}</option>
          </select>
          <select value={catF} onChange={(e) => setCatF(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white max-w-[190px]">
            <option value="">{ar ? 'كل التصنيفات' : 'All categories'}</option>
            {cats.map((c) => <option key={c.key} value={c.key}>{(ar ? c.ar : c.key)} ({c.count})</option>)}
          </select>
          <div className="flex items-center gap-1">
            <input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder={ar ? 'سعر من' : '≥'} className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm" />
            <span className="text-slate-300">—</span>
            <input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder={ar ? 'إلى' : '≤'} className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          {anyFilter && <button onClick={resetFilters} className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs">{ar ? 'مسح' : 'Reset'} <X className="w-3 h-3" /></button>}
          <span className="text-xs text-slate-400 ms-auto">{shown.length} {ar ? 'صنف' : 'items'}</span>
        </div>
      </div>

      {showLog && <MovementsLog movements={movements} ar={ar} canEdit={!!canEdit} plates={plates} onChanged={() => { loadLog(); load(); }} />}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>
                {canEdit && (
                  <th className="px-3 py-2.5 w-9">
                    <input type="checkbox" className="accent-[#f37121]"
                      title={ar ? 'اختيار كل المعروض' : 'Select all shown'}
                      checked={shown.length > 0 && shown.every((x) => picked.has(x._id))}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p);
                        shown.forEach((x) => (e.target.checked ? n.add(x._id) : n.delete(x._id)));
                        return n;
                      })} />
                  </th>
                )}
                {[ar ? 'الصنف' : 'Item', ar ? 'التصنيف' : 'Category', ar ? 'الرصيد' : 'Qty', ar ? 'السعر' : 'Price', ar ? 'القيمة' : 'Value', ar ? 'الحالة' : 'Status', ar ? 'حركة' : 'Move', ''].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((it) => (
                <tr key={it._id} className={picked.has(it._id) ? 'bg-orange-50/70' : 'hover:bg-slate-50'}>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <input type="checkbox" className="accent-[#f37121]"
                        title={it.quantity < 1 ? (ar ? 'الرصيد صفر — يصلح للوارد' : 'No stock — can still receive') : ''}
                        checked={picked.has(it._id)} onChange={() => togglePick(it._id)} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <p className="font-semibold text-slate-800">{it.name}</p>
                    {(it.compatibleModels?.length || it.code) ? <p className="text-[11px] text-slate-400">{it.code}{it.compatibleModels?.length ? ` · ${it.compatibleModels.join('، ')}` : ''}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{it.categoryAr || it.category || '—'}</td>
                  <td className="px-3 py-2 font-bold text-slate-800">{it.quantity} <span className="text-[10px] font-normal text-slate-400">{it.unit}</span></td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{money(it.unitPrice)}</td>
                  <td className="px-3 py-2 text-emerald-700 font-semibold whitespace-nowrap">{money(it.value)}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[it.status].cls}`}>{ar ? STATUS[it.status].ar : STATUS[it.status].en}</span></td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setMove({ item: it, type: 'in' })} title={ar ? 'وارد' : 'Stock in'} className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold inline-flex items-center gap-1"><ArrowDownToLine className="w-3.5 h-3.5" />{ar ? 'وارد' : 'In'}</button>
                        <button onClick={() => setMove({ item: it, type: 'out' })} title={ar ? 'صادر' : 'Stock out'} className="px-2 py-1 rounded-md bg-orange-50 hover:bg-orange-100 text-[#f37121] text-[11px] font-semibold inline-flex items-center gap-1"><ArrowUpFromLine className="w-3.5 h-3.5" />{ar ? 'صادر' : 'Out'}</button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditItem(it)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => del(it)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا توجد أصناف مطابقة' : 'No items'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* شريط الإجراء الجماعي — ثابت أسفل الشاشة، يظهر فور اختيار أول صنف.
          الصادر والوارد جنبًا إلى جنب: كلاهما يقبل كمية مختلفة لكل صنف. */}
      {canEdit && (
        <SelectionBar
          count={picked.size} ar={ar}
          label={ar ? `${picked.size} صنف محدَّد` : `${picked.size} selected`}
          hint={ar ? 'الكمية الافتراضية ١ لكل صنف، وتُعدَّل لكل صنف على حدة'
                   : 'Default is 1 each — set any item’s quantity separately'}
          actionLabel={ar ? `صادر (${picked.size})` : `Issue (${picked.size})`}
          onAction={() => setBulkKind('out')}
          onClear={() => setPicked(new Set())}>
          <button type="button" onClick={() => setBulkKind('in')}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap">
            {ar ? `وارد (${picked.size})` : `Receive (${picked.size})`}
          </button>
        </SelectionBar>
      )}

      {move && <MovementModal move={move} plates={plates} ar={ar} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
      {bulkKind && (
        <BulkOutModal
          items={items.filter((x) => picked.has(x._id))} plates={plates} ar={ar} kind={bulkKind}
          onClose={() => setBulkKind(null)}
          onDone={() => { setBulkKind(null); setPicked(new Set()); load(); }}
        />
      )}
      {(addNew || editItem) && <ItemFormModal item={editItem} ar={ar} onClose={() => { setAddNew(false); setEditItem(null); }} onSaved={() => { setAddNew(false); setEditItem(null); load(); }} />}
    </div>
  );
}

// سجل الحركات — ومن هنا بالظبط بيتم التراجع أو التصحيح.
//
// الحركة الملغية بتفضل ظاهرة ومشطوبة، مش بتختفي: الرصيد اتغيّر فعلاً وقتها،
// وإخفاء السطر معناه إن اللي بيراجع المخزن مش هيفهم الرقم جه منين.
function MovementsLog({ movements, ar, canEdit, plates, onChanged }: {
  movements: Movement[]; ar: boolean; canEdit: boolean; plates: string[]; onChanged: () => void;
}) {
  const [undoing, setUndoing] = useState<Movement | null>(null);

  const head = [ar ? 'التاريخ' : 'Date', ar ? 'الصنف' : 'Item', ar ? 'الحركة' : 'Type', ar ? 'الكمية' : 'Qty',
    ar ? 'العربية' : 'Vehicle', ar ? 'الرصيد بعدها' : 'Balance', ar ? 'بواسطة' : 'By', ''];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 font-bold text-sm text-slate-800 flex items-center justify-between gap-2">
        <span>{ar ? 'سجل الحركات' : 'Movement log'} ({movements.length})</span>
        {canEdit && <span className="text-[11px] font-normal text-slate-400">{ar ? 'الحركة المسجّلة لا تُعدَّل — الغلط يتصحّح بتراجع مسجَّل باسمك' : 'A recorded movement is never edited — mistakes are reversed, on the record'}</span>}
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-xs sticky top-0"><tr>{head.map((h, i) => <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => (
              <tr key={m._id} className={`hover:bg-slate-50 ${m.reversed ? 'bg-slate-50/60 text-slate-400' : ''}`}>
                <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap text-xs">{new Date(m.createdAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-3 py-1.5 font-medium text-slate-700">
                  <span className={m.reversed ? 'line-through' : ''}>{m.itemName}</span>
                  <span className="block text-[10px] leading-tight">
                    {m.reversed && <span className="text-red-500">{ar ? 'مُلغاة' : 'reversed'}{m.reversedByName ? ` · ${m.reversedByName}` : ''}</span>}
                    {m.isReversal && <span className="text-amber-600">{ar ? 'حركة تراجع' : 'reversal entry'}</span>}
                    {m.reversed && m.reversalReason && <span className="block text-slate-400">{m.reversalReason}</span>}
                  </span>
                </td>
                <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.reversed ? 'bg-slate-200 text-slate-500' : m.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-[#f37121]'}`}>{m.type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')}</span></td>
                <td className={`px-3 py-1.5 font-bold ${m.reversed ? 'line-through' : ''}`} style={{ color: m.reversed ? '#94a3b8' : m.type === 'in' ? '#059669' : '#f37121' }}>{m.type === 'in' ? '+' : '−'}{m.quantity}</td>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{m.vehiclePlate || '—'}</td>
                <td className="px-3 py-1.5 text-slate-600">{m.balanceAfter}</td>
                <td className="px-3 py-1.5 text-slate-400 text-xs">{m.performedByName || '—'}</td>
                <td className="px-3 py-1.5">
                  {canEdit && m.canReverse && (
                    <button type="button" onClick={() => setUndoing(m)}
                      title={ar ? 'التراجع عن الحركة' : 'Reverse'}
                      className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold inline-flex items-center gap-1">
                      <Undo2 className="w-3.5 h-3.5" />{ar ? 'تراجع' : 'Undo'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {movements.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">{ar ? 'لا حركات بعد' : 'No movements'}</td></tr>}
          </tbody>
        </table>
      </div>
      {undoing && <ReverseModal m={undoing} ar={ar} onClose={() => setUndoing(null)} onDone={() => { setUndoing(null); onChanged(); }} />}
    </div>
  );
}

// التراجع عن حركة. مفيش حقول تتعدّل هنا عن قصد — السبب بس، وهو إجباري.
// لو الكمية الصح مختلفة، بيتراجع عن الغلط وبعدين يسجّل حركة جديدة عادية؛
// الاتنين بيبانوا باسم صاحبهم بدل ما رقم واحد يتغيّر في الخفا.
function ReverseModal({ m, ar, onClose, onDone }: { m: Movement; ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 3) { notify(ar ? 'اكتب سبب التراجع' : 'A reason is required', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/api/ls2/store/movements/${m._id}/reverse`, { reason: reason.trim() });
      notify(ar ? 'تم التراجع ورجع الرصيد' : 'Reversed', 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-red-600">{ar ? 'التراجع عن الحركة' : 'Reverse movement'}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {m.itemName} · <b>{m.type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')} {m.quantity}</b>
          {m.vehiclePlate ? ` · ${m.vehiclePlate}` : ''} · {new Date(m.createdAt).toLocaleDateString('en-GB')}
          {m.performedByName ? ` · ${m.performedByName}` : ''}
        </p>

        <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'سبب التراجع' : 'Reason'} *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          placeholder={ar ? 'مثال: اتسجّلت على العربية الغلط' : 'e.g. recorded against the wrong vehicle'}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />

        <p className="mt-3 text-[11px] leading-relaxed rounded-lg px-3 py-2 bg-slate-50 text-slate-500">
          {ar
            ? 'الحركة الأصلية لا تُعدَّل ولا تُحذَف — تبقى في السجل مشطوبة، وتُسجَّل بجوارها حركة معاكسة باسمك وبسببك، ويعود الرصيد كما كان. وإذا كانت الكمية الصحيحة مختلفة، سجِّل حركة جديدة بعد التراجع.'
            : 'The original is neither edited nor deleted — it stays in the log, struck through, with an opposite entry recorded under your name and reason. If the right quantity differs, record a fresh movement afterwards.'}
        </p>

        <button onClick={submit} disabled={busy || reason.trim().length < 3}
          className="w-full mt-3 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? (ar ? 'جارٍ التنفيذ…' : 'Working…') : (ar ? 'تأكيد التراجع' : 'Confirm reversal')}
        </button>
      </div>
    </div>
  );
}

// صادر لأكتر من صنف مرة واحدة — **نفس** إنبوتس الصادر المفرد (العربية والسبب)،
// بس بتتطبّق على كل اللي اتحدّد. الصنف بينزل منه قطعة واحدة؛ اللي عايز كميات
// مختلفة بيستعمل الصادر المفرد، والحركتين بيدخلوا نفس السجل بنفس الشكل.
// حركة جماعية لعدة أصناف — صادر أو وارد.
//
// الكمية بجوار كل صنف، وافتراضها ١ لأن هذا هو الغالب؛ ومن يحتاج أكثر يكتبه على
// صنفه وحده دون أن يمسّ الباقي. ونفس الشاشة تخدم الوارد، لأن التوريد أيضًا قد
// يحمل كميات مختلفة لكل صنف.
//
// الرصيد المتوقَّع بعد الحركة يظهر بجانب كل سطر قبل التأكيد — فلا يُفاجأ أحد
// بالنتيجة بعد الحفظ. والصنف الذي لا يكفي رصيده يُعلَّم بالأحمر، والعملية كلها
// ترفض إن بقي واحد منها ناقصًا.
function BulkOutModal({ items, plates, ar, kind = 'out', onClose, onDone }: {
  items: Item[]; plates: string[]; ar: boolean; kind?: 'in' | 'out';
  onClose: () => void; onDone: () => void;
}) {
  const { notify } = useDialog();
  const isIn = kind === 'in';
  const t = (a: string, e: string) => (ar ? a : e);
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i._id, '1'])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const n = (id: string) => Math.max(1, Number(qty[id]) || 1);
  const short = isIn ? [] : items.filter((i) => i.quantity < n(i._id));
  const totalQty = items.reduce((a, i) => a + n(i._id), 0);

  const submit = async () => {
    setErrors({}); setBusy(true);
    try {
      const r = await api.post<any>('/api/ls2/store/bulk-movement', {
        type: kind,
        lines: items.map((i) => ({ item: i._id, quantity: n(i._id) })),
        vehiclePlate: plate.trim(), reason: reason.trim(),
      });
      notify(t(
        `${isIn ? 'سُجِّل وارد' : 'سُجِّل صادر'} ${r?.summary?.items ?? items.length} صنف · ${r?.summary?.totalQty ?? totalQty} قطعة`,
        `${isIn ? 'Received' : 'Issued'} ${r?.summary?.items ?? items.length} items · ${r?.summary?.totalQty ?? totalQty} units`), 'success');
      onDone();
    } catch (e: any) {
      const errs = e?.data?.errors || e?.errors;
      if (Array.isArray(errs) && errs.length) {
        const map: Record<string, string> = {};
        errs.forEach((x: any) => { if (x.id) map[String(x.id)] = x.message; });
        setErrors(map);
        notify(t('رُفضت العملية بالكامل — لم يتغيّر أي رصيد', 'Rejected in full — no balance changed'), 'error');
      } else notify(e?.message || 'Failed', 'error');
    } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const accent = isIn ? '#059669' : '#f37121';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h3 className="font-bold text-lg" style={{ color: accent }}>
            {isIn ? t('وارد لعدة أصناف', 'Receive multiple items') : t('صادر لعدة أصناف', 'Issue multiple items')}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="px-5 text-sm text-slate-600 mb-3">
          {t(`${items.length} صنف محدَّد · ${totalQty} قطعة`, `${items.length} items · ${totalQty} units`)}
        </p>

        <div className="px-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {isIn ? t('واردة من مركبة (اختياري)', 'In from vehicle (optional)') : t('صادرة على مركبة', 'Out to vehicle')}
            </label>
            <input list="ls2-plates-bulk" value={plate} onChange={(e) => setPlate(e.target.value)} className={inp}
              placeholder={t('اختر أو اكتب اللوحة…', 'pick or type plate…')} autoFocus />
            <datalist id="ls2-plates-bulk">{plates.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">{t('ملاحظة / سبب', 'Reason')}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inp} />
          </div>
        </div>

        <div className="px-5 mt-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-700">{t('الكمية لكل صنف', 'Quantity per item')}</p>
            <button onClick={() => setQty(Object.fromEntries(items.map((i) => [i._id, '1'])))}
              className="text-[11.5px] text-slate-600 hover:text-slate-900 underline">
              {t('إرجاع الكل إلى ١', 'Reset all to 1')}
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {items.map((i) => {
              const bad = errors[i._id] || (!isIn && i.quantity < n(i._id)
                ? t(`الرصيد ${i.quantity} والمطلوب ${n(i._id)}`, `Stock ${i.quantity}, need ${n(i._id)}`) : '');
              const after = isIn ? i.quantity + n(i._id) : i.quantity - n(i._id);
              return (
                <div key={i._id} className={`px-3 py-2 ${bad ? 'bg-rose-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[13px] text-slate-900 truncate">{i.name}</span>
                    <span className="text-[11.5px] text-slate-600 tabular-nums whitespace-nowrap">
                      {i.quantity} {i.unit}
                    </span>
                    <input type="number" min={1} value={qty[i._id] ?? '1'}
                      onChange={(e) => setQty((q) => ({ ...q, [i._id]: e.target.value }))}
                      className="w-20 px-2 py-1 rounded-lg border border-slate-300 text-[13px] text-center tabular-nums" />
                    <span className={`text-[11.5px] font-bold tabular-nums whitespace-nowrap ${bad ? 'text-rose-700' : 'text-slate-700'}`}>
                      → {Math.max(0, after)}
                    </span>
                  </div>
                  {bad && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">{bad}</p>}
                </div>
              );
            })}
          </div>
          {short.length > 0 && (
            <p className="text-[12px] text-rose-700 font-semibold mt-2">
              {t(`${short.length} صنف رصيده غير كافٍ — سترفض العملية بالكامل`, `${short.length} items short — the whole issue will be rejected`)}
            </p>
          )}
        </div>

        <div className="px-5 py-4">
          <button onClick={submit} disabled={busy || !items.length || short.length > 0}
            className="w-full py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: accent }}>
            {busy ? t('جارٍ التسجيل…', 'Recording…')
              : short.length > 0 ? t('توجد أصناف رصيدها غير كافٍ', 'Some items are short')
              : t(`تسجيل ${isIn ? 'الوارد' : 'الصادر'} (${items.length} صنف · ${totalQty} قطعة)`,
                  `Record ${isIn ? 'receipt' : 'issue'} (${items.length} items · ${totalQty} units)`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ move, plates, ar, onClose, onDone }: { move: { item: Item; type: 'in' | 'out' }; plates: string[]; ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const isIn = move.type === 'in';
  const [qty, setQty] = useState('1');
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const q = Number(qty);
    if (!q || q <= 0) { notify(ar ? 'أدخل كمية صحيحة' : 'Enter a quantity', 'error'); return; }
    setBusy(true);
    try { await api.post(`/api/ls2/store/${move.item._id}/movement`, { type: move.type, quantity: q, vehiclePlate: plate, reason }); notify(ar ? 'تم التسجيل' : 'Recorded', 'success'); onDone(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg" style={{ color: isIn ? '#059669' : '#f37121' }}>{isIn ? (ar ? 'وارد للمخزن' : 'Stock in') : (ar ? 'صادر من المخزن' : 'Stock out')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">{move.item.name} · {ar ? 'الرصيد الحالي' : 'current'}: <b>{move.item.quantity}</b> {move.item.unit}</p>
        <div className="space-y-3">
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'الكمية' : 'Quantity'} *</label><input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={inp} autoFocus /></div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{isIn ? (ar ? 'واردة من عربية (اختياري)' : 'In from vehicle (optional)') : (ar ? 'صادرة على عربية' : 'Out to vehicle')}</label>
            <input list="ls2-plates" value={plate} onChange={(e) => setPlate(e.target.value)} className={inp} placeholder={ar ? 'اختر أو اكتب اللوحة…' : 'pick or type plate…'} />
            <datalist id="ls2-plates">{plates.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'ملاحظة / سبب' : 'Reason'}</label><input value={reason} onChange={(e) => setReason(e.target.value)} className={inp} /></div>
        </div>
        <button onClick={submit} disabled={busy} className="w-full mt-5 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: isIn ? '#059669' : '#f37121' }}>{ar ? 'تسجيل الحركة' : 'Record'}</button>
      </div>
    </div>
  );
}

function ItemFormModal({ item, ar, onClose, onSaved }: { item: Item | null; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const [f, setF] = useState<any>(item || { name: '', category: '', quantity: 0, unit: 'قطعة', unitPrice: 0, minQuantity: 0, code: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name?.trim()) { notify(ar ? 'اسم الصنف مطلوب' : 'Name required', 'error'); return; }
    setBusy(true);
    try {
      if (item) await api.put(`/api/ls2/store/${item._id}`, f);
      else await api.post('/api/ls2/store', f);
      notify(ar ? 'تم الحفظ' : 'Saved', 'success'); onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const L = ({ children }: { children: React.ReactNode }) => <label className="block text-xs font-semibold text-slate-600 mb-1">{children}</label>;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-lg">{item ? (ar ? 'تعديل صنف' : 'Edit item') : (ar ? 'صنف جديد' : 'New item')}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><L>{ar ? 'اسم الصنف' : 'Name'} *</L><input className={inp} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div><L>{ar ? 'التصنيف' : 'Category'}</L><input className={inp} value={f.category || ''} onChange={(e) => set('category', e.target.value)} /></div>
          <div><L>{ar ? 'الكود' : 'Code'}</L><input className={inp} value={f.code || ''} onChange={(e) => set('code', e.target.value)} /></div>
          {!item && <div><L>{ar ? 'الرصيد الابتدائي' : 'Initial qty'}</L><input type="number" className={inp} value={f.quantity} onChange={(e) => set('quantity', Number(e.target.value))} /></div>}
          <div><L>{ar ? 'الوحدة' : 'Unit'}</L><input className={inp} value={f.unit} onChange={(e) => set('unit', e.target.value)} /></div>
          <div><L>{ar ? 'السعر للقطعة' : 'Unit price'}</L><input type="number" className={inp} value={f.unitPrice} onChange={(e) => set('unitPrice', Number(e.target.value))} /></div>
          <div><L>{ar ? 'حد التنبيه (نقص)' : 'Min qty (low alert)'}</L><input type="number" className={inp} value={f.minQuantity || 0} onChange={(e) => set('minQuantity', Number(e.target.value))} /></div>
          <div className="md:col-span-2"><L>{ar ? 'ملاحظات' : 'Notes'}</L><textarea className={inp} rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button><button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm disabled:opacity-60"><Save className="w-4 h-4" /> {ar ? 'حفظ' : 'Save'}</button></div>
      </div>
    </div>
  );
}
