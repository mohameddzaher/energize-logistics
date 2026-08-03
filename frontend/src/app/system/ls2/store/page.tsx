'use client';
// مخزن النقل الثقيل — قطع الغيار: أصناف برصيد وسعر، حركات وارد/صادر (صادر على
// عربية / وارد من عربية)، إضافة أصناف، وسجل حركات — كله من هذه الصفحة بسهولة.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { Boxes, Plus, ArrowDownToLine, ArrowUpFromLine, Edit, Trash2, X, Save, History, Search } from 'lucide-react';

type Item = { _id: string; code?: string; name: string; category?: string; categoryAr?: string; groupAr?: string; quantity: number; unit: string; unitPrice: number; minQuantity?: number; compatibleModels?: string[]; notes?: string; status: 'ok' | 'low' | 'out'; value: number };
type Cat = { key: string; ar: string; count: number };
type Movement = { _id: string; itemName: string; type: 'in' | 'out'; quantity: number; vehiclePlate?: string; reason?: string; balanceAfter: number; performedByName?: string; createdAt: string };

const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const LS2_STORE_ADMIN = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'operations', 'workshop_manager', 'workshop_employee', 'moderator'];

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
  const canEdit = user && LS2_STORE_ADMIN.includes(user.role);

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

  if (loading && !items.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Boxes className="w-5 h-5" />} title={ar ? 'مخزن النقل الثقيل' : 'Heavy Transport Store'} subtitle={ar ? 'قطع الغيار — الرصيد والحركات' : 'Spare parts — stock & movements'}>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLog((s) => !s)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${showLog ? 'bg-[#12325c] text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}><History className="w-4 h-4" /> {ar ? 'سجل الحركات' : 'Movements'}</button>
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

      {showLog && <MovementsLog movements={movements} ar={ar} />}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>{[ar ? 'الصنف' : 'Item', ar ? 'التصنيف' : 'Category', ar ? 'الرصيد' : 'Qty', ar ? 'السعر' : 'Price', ar ? 'القيمة' : 'Value', ar ? 'الحالة' : 'Status', ar ? 'حركة' : 'Move', ''].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((it) => (
                <tr key={it._id} className="hover:bg-slate-50">
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

      {move && <MovementModal move={move} plates={plates} ar={ar} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
      {(addNew || editItem) && <ItemFormModal item={editItem} ar={ar} onClose={() => { setAddNew(false); setEditItem(null); }} onSaved={() => { setAddNew(false); setEditItem(null); load(); }} />}
    </div>
  );
}

function MovementsLog({ movements, ar }: { movements: Movement[]; ar: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 font-bold text-sm text-slate-800">{ar ? 'سجل الحركات' : 'Movement log'} ({movements.length})</div>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-500 text-xs sticky top-0"><tr>{[ar ? 'التاريخ' : 'Date', ar ? 'الصنف' : 'Item', ar ? 'الحركة' : 'Type', ar ? 'الكمية' : 'Qty', ar ? 'العربية' : 'Vehicle', ar ? 'الرصيد بعدها' : 'Balance', ar ? 'بواسطة' : 'By'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => (
              <tr key={m._id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap text-xs">{new Date(m.createdAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-3 py-1.5 font-medium text-slate-700">{m.itemName}</td>
                <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-[#f37121]'}`}>{m.type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')}</span></td>
                <td className="px-3 py-1.5 font-bold" style={{ color: m.type === 'in' ? '#059669' : '#f37121' }}>{m.type === 'in' ? '+' : '−'}{m.quantity}</td>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{m.vehiclePlate || '—'}</td>
                <td className="px-3 py-1.5 text-slate-600">{m.balanceAfter}</td>
                <td className="px-3 py-1.5 text-slate-400 text-xs">{m.performedByName || '—'}</td>
              </tr>
            ))}
            {movements.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">{ar ? 'لا حركات بعد' : 'No movements'}</td></tr>}
          </tbody>
        </table>
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
