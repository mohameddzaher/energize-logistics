'use client';
// Rims (جنوط) tab of the fleet-asset registry: counted stock per brand/size/condition with an immutable movement ledger.
// Rims carry no serial, so they are quantities, not Ls2TireAsset rows. Mistakes are reversed, never edited (same rule as the store).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Minus, ArrowLeftRight, Pencil, Trash2, History, X, Undo2, Truck, PackageCheck } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import ManagedSelect from '@/components/system/ManagedSelect';
import ScrollX from '@/components/system/ScrollX';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import SearchSelect from '@/components/ls2/SearchSelect';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { fmtNum, fmtDateTime, type Lang } from '@/lib/ls2';

export interface Rim {
  _id: string; name: string; brand: string; size: string; condition: 'new' | 'used' | 'scrap';
  quantity: number; unit: string; unitPrice: number; minQuantity: number; notes: string;
  status: 'ok' | 'low' | 'out'; value: number; conditionAr?: string;
}
interface RimMovement {
  _id: string; rim: string; rimName: string; type: 'in' | 'out' | 'edit'; reason: string; reasonAr: string; reasonEn: string;
  quantity: number; balanceAfter: number; unitPrice: number | null; total: number | null; supplierName: string; vehiclePlate: string;
  date: string; at: string; notes: string; counterpartName: string; issueReason?: string; issueReasonLabel?: string; legacy: boolean; performedByName: string;
  reversed: boolean; reversedByName: string; reversalReason: string; reversalOf: string | null; canReverse: boolean;
}
type Reason = { key: string; ar: string; en: string };
type PlateOption = { value: string; label: string; hint?: string };

const COND: Record<string, { ar: string; en: string; cls: string }> = {
  new: { ar: 'جديد', en: 'New', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  used: { ar: 'مستعمل', en: 'Used', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  scrap: { ar: 'سكراب', en: 'Scrap', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};
const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#f37121] bg-white';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1';
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-5xl' : 'max-w-md'} p-5 space-y-4 max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const rimCols = (ar: boolean): ExportColumn[] => [
  { header: ar ? 'الصنف' : 'Rim', key: 'name', width: 24 },
  { header: ar ? 'النوع' : 'Brand', key: 'brand', width: 12 },
  { header: ar ? 'المقاس' : 'Size', key: 'size', width: 9 },
  { header: ar ? 'الحالة' : 'Condition', key: 'condition', transform: (v) => (ar ? COND[v]?.ar : COND[v]?.en) || v, width: 10 },
  { header: ar ? 'الرصيد' : 'Quantity', key: 'quantity', type: 'number', width: 9 },
  { header: ar ? 'سعر القطعة' : 'Unit price', key: 'unitPrice', type: 'number', width: 11 },
  { header: ar ? 'القيمة' : 'Value', key: 'value', type: 'number', width: 11 },
  { header: ar ? 'حد التنبيه' : 'Alert at', key: 'minQuantity', type: 'number', width: 9 },
  { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 24 },
];
const movementCols = (ar: boolean): ExportColumn[] => [
  { header: ar ? 'التاريخ' : 'Date', key: 'date', width: 12 },
  { header: ar ? 'الصنف' : 'Rim', key: 'rimName', width: 22 },
  { header: ar ? 'الحركة' : 'Movement', key: 'type', transform: (v) => (v === 'in' ? (ar ? 'وارد' : 'In') : v === 'out' ? (ar ? 'صادر' : 'Out') : (ar ? 'تعديل' : 'Edit')), width: 9 },
  { header: ar ? 'السبب' : 'Reason', key: 'reasonAr', transform: (v, r) => (ar ? v : r.reasonEn), width: 18 },
  { header: ar ? 'العدد' : 'Qty', key: 'quantity', type: 'number', width: 7 },
  { header: ar ? 'الرصيد بعدها' : 'Balance after', key: 'balanceAfter', type: 'number', width: 10 },
  { header: ar ? 'المركبة' : 'Vehicle', key: 'vehiclePlate', width: 10 },
  { header: ar ? 'سبب الصرف' : 'Issue reason', key: 'issueReasonLabel', width: 16 },
  { header: ar ? 'من / إلى صنف' : 'Other rim', key: 'counterpartName', width: 20 },
  { header: ar ? 'المورد' : 'Supplier', key: 'supplierName', width: 16 },
  { header: ar ? 'سعر القطعة' : 'Unit price', key: 'unitPrice', type: 'number', width: 10 },
  { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  { header: ar ? 'تم التراجع' : 'Reversed', key: 'reversed', transform: (v, r) => (v ? `${ar ? 'نعم' : 'Yes'} — ${r.reversalReason || ''}` : ''), width: 18 },
  { header: ar ? 'بواسطة' : 'By', key: 'performedByName', width: 16 },
];

// Add or edit a rim type. Quantity is set only on creation; afterwards it moves through movements.
function RimForm({ rim, ar, onClose, onSaved }: { rim: Rim | null; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const [brand, setBrand] = useState(rim?.brand || '');
  const [size, setSize] = useState(rim?.size || '');
  const [condition, setCondition] = useState<string>(rim?.condition || 'new');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState(rim ? String(rim.unitPrice || '') : '');
  const [minQuantity, setMinQuantity] = useState(rim ? String(rim.minQuantity || '') : '');
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState(rim?.notes || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body: any = { brand, size, condition, unitPrice: unitPrice === '' ? 0 : Number(unitPrice), minQuantity: minQuantity === '' ? 0 : Number(minQuantity), notes };
      if (rim) await api.patch(`/api/ls2/assets/rims/${rim._id}`, body);
      else await api.post('/api/ls2/assets/rims', { ...body, quantity: quantity === '' ? 0 : Number(quantity), supplierName, date });
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={rim ? (ar ? `تعديل ${rim.name}` : `Edit ${rim.name}`) : (ar ? 'إضافة صنف جنوط' : 'Add a rim type')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>{ar ? 'النوع' : 'Brand'}</label>
          <ManagedSelect type="ls2_rim_brand" storeLabel value={brand} onChange={setBrand} placeholder={ar ? 'اختر النوع' : 'Pick a brand'} /></div>
        <div><label className={labelCls}>{ar ? 'المقاس' : 'Size'}</label>
          <ManagedSelect type="ls2_rim_size" storeLabel value={size} onChange={setSize} placeholder={ar ? 'اختر المقاس' : 'Pick a size'} /></div>
        <div className="col-span-2"><label className={labelCls}>{ar ? 'الحالة' : 'Condition'}</label>
          <div className="flex gap-2">
            {Object.entries(COND).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setCondition(k)}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium ${condition === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>{ar ? v.ar : v.en}</button>
            ))}
          </div></div>
        {!rim && <div><label className={labelCls}>{ar ? 'العدد الموجود' : 'Quantity on hand'}</label>
          <input type="number" min={0} step={1} className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" /></div>}
        <div><label className={labelCls}>{ar ? 'سعر القطعة (ريال)' : 'Unit price (SAR)'}</label>
          <input type="number" min={0} step="0.01" className={inputCls} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
        <div><label className={labelCls}>{ar ? 'نبّهني عند (حد أدنى)' : 'Alert at (minimum)'}</label>
          <input type="number" min={0} step={1} className={inputCls} value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} /></div>
        {!rim && <div><label className={labelCls}>{ar ? 'تاريخ الشراء' : 'Purchase date'}</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>}
        {!rim && <div className="col-span-2"><label className={labelCls}>{ar ? 'المورد (اختياري)' : 'Supplier (optional)'}</label>
          <input className={inputCls} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></div>}
        <div className="col-span-2"><label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      {rim && <p className="text-[11px] text-slate-400">{ar ? 'الرصيد لا يُعدَّل من هنا — سجّل وارد أو صادر أو تسوية جرد، فيبقى في السجل من غيّره ولماذا.' : 'The balance is not edited here — record an in, out or count adjustment so the log keeps who and why.'}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" disabled={busy || !brand || !size} onClick={save} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium disabled:opacity-50">{busy ? '…' : (ar ? 'حفظ' : 'Save')}</button>
      </div>
    </Modal>
  );
}

// In (add stock) or out (reduce stock) on one rim type.
function MovementForm({ rim, type, reasons, issueReasons, plateOptions, ar, onClose, onSaved }: {
  rim: Rim; type: 'in' | 'out'; reasons: Reason[]; issueReasons: Reason[]; plateOptions: PlateOption[]; ar: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [issueReason, setIssueReason] = useState('');
  const { notify } = useDialog();
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState(type === 'in' ? 'purchase' : '');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [unitPrice, setUnitPrice] = useState(rim.unitPrice ? String(rim.unitPrice) : '');
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const needsPlate = reason === 'mounted' || reason === 'returned';
  const qty = Number(quantity);
  const valid = Number.isInteger(qty) && qty >= 1 && !!reason && (!needsPlate || !!vehiclePlate) && (reason !== 'other' || notes.trim().length >= 3)
    && (reason !== 'mounted' || !!issueReason)
    && (type === 'in' || qty <= rim.quantity);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/ls2/assets/rims/${rim._id}/movement`, {
        type, quantity: qty, reason, vehiclePlate, date, notes, ...(reason === 'mounted' ? { issueReason } : {}),
        ...(type === 'in' ? { unitPrice: unitPrice === '' ? undefined : Number(unitPrice), supplierName } : {}),
      });
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={`${type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')} — ${rim.name}`} onClose={onClose}>
      <p className="text-xs text-slate-500">{ar ? `الرصيد الحالي: ${rim.quantity} ${rim.unit}` : `On hand: ${rim.quantity}`}</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>{ar ? 'العدد' : 'Quantity'}</label>
          <input type="number" min={1} step={1} max={type === 'out' ? rim.quantity : undefined} className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        <div><label className={labelCls}>{ar ? 'التاريخ' : 'Date'}</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="col-span-2"><label className={labelCls}>{ar ? 'السبب' : 'Reason'}</label>
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{ar ? '— اختر السبب —' : '— choose —'}</option>
            {reasons.map((r) => <option key={r.key} value={r.key}>{ar ? r.ar : r.en}</option>)}
          </select></div>
        {(needsPlate || reason === 'sold' || reason === 'damaged') && (
          <div className="col-span-2"><label className={labelCls}>{ar ? `المركبة${needsPlate ? '' : ' (اختياري)'}` : `Vehicle${needsPlate ? '' : ' (optional)'}`}</label>
            <SearchSelect value={vehiclePlate} onChange={setVehiclePlate} options={plateOptions} ar={ar} emptyLabel={needsPlate ? undefined : (ar ? '— بلا مركبة —' : '— none —')}
              placeholder={ar ? '— اختر الشاحنة —' : '— choose truck —'} searchPlaceholder={ar ? 'ابحث برقم اللوحة…' : 'Search plate…'} /></div>
        )}
        {reason === 'mounted' && (
          <div className="col-span-2"><label className={labelCls}>{ar ? 'سبب الصرف' : 'Issue reason'}</label>
            <select className={inputCls} value={issueReason} onChange={(e) => setIssueReason(e.target.value)}>
              <option value="">{ar ? '— اختر سبب الصرف —' : '— choose —'}</option>
              {issueReasons.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
            </select></div>
        )}
        {type === 'in' && <>
          <div><label className={labelCls}>{ar ? 'سعر القطعة (ريال)' : 'Unit price (SAR)'}</label>
            <input type="number" min={0} step="0.01" className={inputCls} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
          <div><label className={labelCls}>{ar ? 'المورد (اختياري)' : 'Supplier (optional)'}</label>
            <input className={inputCls} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></div>
        </>}
        <div className="col-span-2"><label className={labelCls}>{ar ? `ملاحظات${reason === 'other' ? ' (مطلوبة)' : ''}` : `Notes${reason === 'other' ? ' (required)' : ''}`}</label>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      {type === 'out' && qty > rim.quantity && <p className="text-xs text-red-600">{ar ? 'العدد أكبر من الرصيد المتاح' : 'More than on hand'}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" disabled={busy || !valid} onClick={save} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium disabled:opacity-50">{busy ? '…' : (ar ? 'تسجيل' : 'Record')}</button>
      </div>
    </Modal>
  );
}

// Out to a truck (fitted) or in from it (returned), several rim types at once, like the store's issue to a vehicle.
function VehicleMoveForm({ type, rims, issueReasons, plateOptions, ar, onClose, onSaved }: {
  type: 'in' | 'out'; rims: Rim[]; issueReasons: Reason[]; plateOptions: PlateOption[]; ar: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [issueReason, setIssueReason] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ rimId: string; quantity: string }[]>([{ rimId: '', quantity: '1' }]);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(rims.map((r) => [r._id, r])), [rims]);
  const options = rims.filter((r) => type === 'in' || r.quantity > 0)
    .map((r) => ({ value: r._id, label: r.name, hint: ar ? `الرصيد ${r.quantity}` : `on hand ${r.quantity}` }));
  const lineError = (l: { rimId: string; quantity: string }) => {
    const q = Number(l.quantity); const rim = byId.get(l.rimId);
    if (!l.rimId) return '';
    if (!Number.isInteger(q) || q < 1) return ar ? 'عدد غير صحيح' : 'Bad quantity';
    if (type === 'out' && rim) {
      const asked = lines.filter((x) => x.rimId === l.rimId).reduce((a, x) => a + (Number(x.quantity) || 0), 0);
      if (asked > rim.quantity) return ar ? `أكبر من الرصيد (${rim.quantity})` : `More than on hand (${rim.quantity})`;
    }
    return '';
  };
  const filled = lines.filter((l) => l.rimId);
  const valid = !!vehiclePlate && filled.length > 0 && filled.every((l) => !lineError(l)) && (type === 'in' || !!issueReason);
  const setLine = (i: number, patch: Partial<{ rimId: string; quantity: string }>) => setLines((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/ls2/assets/rims/vehicle-movement', {
        type, vehiclePlate, date, notes, ...(type === 'out' ? { issueReason } : {}),
        items: filled.map((l) => ({ rimId: l.rimId, quantity: Number(l.quantity) })),
      });
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={type === 'out' ? (ar ? 'صادر جنوط على مركبة' : 'Issue rims to a vehicle') : (ar ? 'وارد جنوط من مركبة' : 'Return rims from a vehicle')} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2"><label className={labelCls}>{ar ? 'المركبة' : 'Vehicle'}</label>
          <SearchSelect value={vehiclePlate} onChange={setVehiclePlate} options={plateOptions} ar={ar}
            placeholder={ar ? '— اختر الشاحنة —' : '— choose truck —'} searchPlaceholder={ar ? 'ابحث برقم اللوحة…' : 'Search plate…'} /></div>
        <div><label className={labelCls}>{ar ? 'التاريخ' : 'Date'}</label>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {type === 'out' && (
          <div><label className={labelCls}>{ar ? 'سبب الصرف' : 'Issue reason'}</label>
            <select className={inputCls} value={issueReason} onChange={(e) => setIssueReason(e.target.value)}>
              <option value="">{ar ? '— اختر سبب الصرف —' : '— choose —'}</option>
              {issueReasons.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
            </select></div>
        )}
        <div className={type === 'out' ? 'sm:col-span-2' : 'sm:col-span-3'}><label className={labelCls}>{ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">{ar ? 'الجنوط' : 'Rims'}</p>
        {lines.map((l, i) => {
          const err = lineError(l); const rim = byId.get(l.rimId);
          return (
            <div key={i} className="grid grid-cols-[1fr_110px_120px_36px] gap-2 items-start">
              <SearchSelect value={l.rimId} onChange={(v) => setLine(i, { rimId: v })} options={options} ar={ar}
                placeholder={ar ? '— اختر الصنف —' : '— choose rim —'} searchPlaceholder={ar ? 'ابحث بالنوع أو المقاس…' : 'Search brand or size…'} />
              <input type="number" min={1} step={1} className={inputCls} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label={ar ? 'العدد' : 'Quantity'} />
              <div className={`text-xs pt-2.5 ${err ? 'text-red-600' : 'text-slate-500'}`}>
                {err || (rim ? (ar ? `بعدها: ${rim.quantity + (type === 'in' ? 1 : -1) * (Number(l.quantity) || 0)}` : `after: ${rim.quantity + (type === 'in' ? 1 : -1) * (Number(l.quantity) || 0)}`) : '')}
              </div>
              <button type="button" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, k) => k !== i))}
                className="p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => setLines((p) => [...p, { rimId: '', quantity: '1' }])}
          className="inline-flex items-center gap-1 text-sm font-medium text-[#f37121] hover:underline"><Plus className="w-4 h-4" />{ar ? 'صنف آخر' : 'Another rim'}</button>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" disabled={busy || !valid} onClick={save} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium disabled:opacity-50">{busy ? '…' : (ar ? 'تسجيل' : 'Record')}</button>
      </div>
    </Modal>
  );
}

// Move stock from one rim type to another, e.g. used rims declared scrap.
function TransferForm({ rim, rims, ar, onClose, onSaved }: { rim: Rim; rims: Rim[]; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const [toRimId, setToRimId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const qty = Number(quantity);
  const valid = !!toRimId && Number.isInteger(qty) && qty >= 1 && qty <= rim.quantity;
  const options = rims.filter((r) => r._id !== rim._id)
    .map((r) => ({ value: r._id, label: r.name, hint: ar ? `الرصيد ${r.quantity}` : `on hand ${r.quantity}` }));
  const save = async () => {
    setBusy(true);
    try { await api.post(`/api/ls2/assets/rims/${rim._id}/transfer`, { toRimId, quantity: qty, date, notes }); onSaved(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={ar ? `تحويل من ${rim.name}` : `Transfer from ${rim.name}`} onClose={onClose}>
      <p className="text-xs text-slate-500">{ar ? `مثال: جنوط مستعملة صارت سكراب. يُسجَّل صادر من هذا الصنف ووارد إلى الآخر في حركة واحدة. الرصيد الحالي: ${rim.quantity}` : `E.g. used rims declared scrap. One out and one in, recorded together. On hand: ${rim.quantity}`}</p>
      <div className="space-y-3">
        <div><label className={labelCls}>{ar ? 'إلى صنف' : 'To rim type'}</label>
          <SearchSelect value={toRimId} onChange={setToRimId} options={options} ar={ar} placeholder={ar ? '— اختر الصنف —' : '— choose —'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>{ar ? 'العدد' : 'Quantity'}</label>
            <input type="number" min={1} step={1} max={rim.quantity} className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div><label className={labelCls}>{ar ? 'التاريخ' : 'Date'}</label>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div><label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" disabled={busy || !valid} onClick={save} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium disabled:opacity-50">{busy ? '…' : (ar ? 'تحويل' : 'Transfer')}</button>
      </div>
    </Modal>
  );
}

// Movement log for one rim or all of them; reversal writes an opposite row with a stated reason.
function MovementLog({ rim, ar, lang, admin, refreshKey, onClose, onChanged }: {
  rim: Rim | null; ar: boolean; lang: Lang; admin: boolean; refreshKey: number; onClose: () => void; onChanged: () => void;
}) {
  const { notify, prompt } = useDialog();
  const [rows, setRows] = useState<RimMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLegacy, setShowLegacy] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await api.get<{ movements: RimMovement[] }>(`/api/ls2/assets/rims/movements?limit=5000${rim ? `&rim=${rim._id}` : ''}`);
      setRows(res.movements || []);
    } catch { /* keep */ }
    setLoading(false);
  }, [rim]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const shown = showLegacy ? rows : rows.filter((m) => !m.legacy);
  const reverse = async (m: RimMovement) => {
    const why = await prompt({
      title: ar ? 'التراجع عن الحركة' : 'Reverse movement',
      message: ar ? `سبب التراجع عن ${m.type === 'in' ? 'وارد' : 'صادر'} ${m.quantity} — ${m.rimName}${m.reason === 'transfer' ? ' (يُتراجَع عن طرفي التحويل معًا)' : ''}` : `Reason for reversing ${m.type} ${m.quantity} — ${m.rimName}`,
      placeholder: ar ? 'مثال: سُجّلت على صنف آخر خطأً' : 'e.g. recorded on the wrong type',
    });
    if (why == null) return;
    if (why.trim().length < 3) { notify(ar ? 'اكتب سبب التراجع (3 أحرف على الأقل)' : 'Write a reason (3+ chars)', 'error'); return; }
    try { await api.post(`/api/ls2/assets/rims/movements/${m._id}/reverse`, { reason: why.trim() }); await load(); onChanged(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };
  return (
    <Modal wide title={rim ? (ar ? `سجل حركات ${rim.name}` : `Movements — ${rim.name}`) : (ar ? 'سجل حركات الجنوط' : 'Rim movements')} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showLegacy} onChange={(e) => setShowLegacy(e.target.checked)} />
          {ar ? 'اعرض الحركات السابقة من المخزن' : 'Show earlier store movements'}
        </label>
        <div className="ms-auto">
          <ExportMenu fileName={`ls2-rims-movements${rim ? `-${rim.size}` : ''}`} lang={lang}
            options={[{ key: 'shown', label: ar ? 'الحركات المعروضة' : 'Shown movements', sheets: [{ name: ar ? 'حركات الجنوط' : 'Rim movements', rows: shown, columns: movementCols(ar) }] }]} />
        </div>
      </div>
      {loading ? <div className="text-center text-slate-400 py-8 text-sm">…</div> : (
        <ScrollX>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-3 py-2">{ar ? 'التاريخ' : 'Date'}</th>
                {!rim && <th className="text-start font-semibold px-3 py-2">{ar ? 'الصنف' : 'Rim'}</th>}
                <th className="text-start font-semibold px-3 py-2">{ar ? 'الحركة' : 'Movement'}</th>
                <th className="text-end font-semibold px-3 py-2">{ar ? 'العدد' : 'Qty'}</th>
                <th className="text-end font-semibold px-3 py-2">{ar ? 'الرصيد بعدها' : 'Balance'}</th>
                <th className="text-start font-semibold px-3 py-2">{ar ? 'التفاصيل' : 'Details'}</th>
                <th className="text-start font-semibold px-3 py-2">{ar ? 'بواسطة' : 'By'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m._id} className={`border-b border-slate-100 ${m.reversed ? 'opacity-60' : ''} ${m.legacy ? 'bg-slate-50/60' : ''}`}>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{m.date || fmtDateTime(m.at, lang)}</td>
                  {!rim && <td className="px-3 py-2 text-xs font-medium text-slate-700">{m.rimName}</td>}
                  <td className="px-3 py-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${m.type === 'in' ? 'bg-emerald-100 text-emerald-700' : m.type === 'out' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      {m.type === 'in' ? (ar ? 'وارد' : 'In') : m.type === 'out' ? (ar ? 'صادر' : 'Out') : (ar ? 'تعديل' : 'Edit')}
                    </span>{' '}
                    <span className={`text-slate-600 ${m.reversed ? 'line-through' : ''}`}>{ar ? m.reasonAr : m.reasonEn}</span>
                    {m.legacy && <span className="ms-1 text-[10px] text-slate-400">{ar ? '(من المخزن)' : '(from store)'}</span>}
                  </td>
                  <td className={`px-3 py-2 text-end tabular-nums ${m.reversed ? 'line-through' : ''}`}>{m.type === 'edit' ? '—' : m.quantity}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-slate-500">{m.type === 'edit' ? '—' : m.balanceAfter}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 max-w-[320px]">
                    {[m.vehiclePlate && (ar ? `المركبة ${m.vehiclePlate}` : `vehicle ${m.vehiclePlate}`),
                      m.issueReasonLabel,
                      m.counterpartName && (m.type === 'out' ? (ar ? `إلى ${m.counterpartName}` : `to ${m.counterpartName}`) : (ar ? `من ${m.counterpartName}` : `from ${m.counterpartName}`)),
                      m.supplierName && (ar ? `المورد ${m.supplierName}` : `supplier ${m.supplierName}`),
                      m.unitPrice != null && m.type !== 'edit' && `${fmtNum(m.unitPrice)} ${ar ? 'ريال/قطعة' : 'SAR/pc'}`,
                      m.notes].filter(Boolean).join(' · ') || '—'}
                    {m.reversed && <div className="text-[11px] text-red-600">{ar ? `تراجع ${m.reversedByName || ''}: ${m.reversalReason}` : `Reversed by ${m.reversedByName || ''}: ${m.reversalReason}`}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{m.performedByName || '—'}</td>
                  <td className="px-3 py-2 text-end">
                    {admin && m.canReverse && (
                      <button type="button" onClick={() => reverse(m)} title={ar ? 'تراجع' : 'Reverse'} className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-600"><Undo2 className="w-4 h-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">{ar ? 'لا توجد حركات' : 'No movements'}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      )}
      <p className="text-[11px] text-slate-400">{ar ? 'الحركة المسجَّلة لا تُعدَّل ولا تُحذف: الخطأ يُصحَّح بالتراجع بسبب مكتوب، وتبقى الحركتان في السجل.' : 'A recorded movement is never edited or deleted: a mistake is reversed with a written reason and both rows stay.'}</p>
    </Modal>
  );
}

export default function RimsPanel({ ar, lang, admin, query, onQuery, plateOptions, onRows }: {
  ar: boolean; lang: Lang; admin: boolean; query: string; onQuery: (v: string) => void;
  plateOptions: PlateOption[]; onRows?: (rows: Rim[]) => void;
}) {
  const { confirm, notify } = useDialog();
  const [rims, setRims] = useState<Rim[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [reasons, setReasons] = useState<{ in: Reason[]; out: Reason[]; issue?: Reason[] }>({ in: [], out: [] });
  const [vehicleMove, setVehicleMove] = useState<'in' | 'out' | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<{ rim: Rim | null } | null>(null);
  const [move, setMove] = useState<{ rim: Rim; type: 'in' | 'out' } | null>(null);
  const [transfer, setTransfer] = useState<Rim | null>(null);
  const [log, setLog] = useState<{ rim: Rim | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any>('/api/ls2/assets/rims');
      setRims(res.rims || []); setTotals(res.totals || {}); setReasons(res.reasons || { in: [], out: [] });
    } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onRows?.(rims); }, [rims, onRows]);
  useSocket('ls2:updated', useCallback((p: any) => {
    if (p?.vehicles !== undefined) return;   // telemetry poller pulse
    load(); setRefreshKey((k) => k + 1);
  }, [load]));

  const CHIPS: Chip[] = useMemo(() => [
    { key: '', label: ar ? 'الكل' : 'All' },
    { key: 'new', label: ar ? 'جديد' : 'New', tone: 'sky', test: (r: Rim) => r.condition === 'new' },
    { key: 'used', label: ar ? 'مستعمل' : 'Used', tone: 'blue', test: (r: Rim) => r.condition === 'used' },
    { key: 'scrap', label: ar ? 'سكراب' : 'Scrap', tone: 'slate', test: (r: Rim) => r.condition === 'scrap' },
    { key: 'low', label: ar ? 'ناقص أو نفد' : 'Low or out', tone: 'red', test: (r: Rim) => r.status !== 'ok' },
  ], [ar]);
  const searchIn = useCallback((r: Rim) => [r.name, r.brand, r.size, r.notes, COND[r.condition]?.ar], []);
  const f = useChipFilter(rims, CHIPS, filter, query, searchIn);

  const saved = (msg: string) => { setForm(null); setMove(null); setTransfer(null); setVehicleMove(null); load(); setRefreshKey((k) => k + 1); notify(msg, 'success'); };
  const hide = async (r: Rim) => {
    if (!(await confirm(ar ? `حذف «${r.name}» من القائمة؟ يبقى سجله محفوظًا.` : `Remove ${r.name}? Its log is kept.`))) return;
    try { await api.delete(`/api/ls2/assets/rims/${r._id}`); load(); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  if (loading && !rims.length) return <div className="text-center text-slate-400 py-10 text-sm">…</div>;
  const cards = [
    { label: ar ? 'كل الجنوط' : 'All rims', value: totals.units ?? 0, cls: 'text-slate-800' },
    { label: ar ? 'جديد' : 'New', value: totals.byCondition?.new ?? 0, cls: 'text-sky-700' },
    { label: ar ? 'مستعمل' : 'Used', value: totals.byCondition?.used ?? 0, cls: 'text-blue-700' },
    { label: ar ? 'سكراب' : 'Scrap', value: totals.byCondition?.scrap ?? 0, cls: 'text-slate-600' },
    { label: ar ? 'القيمة (ريال)' : 'Value (SAR)', value: fmtNum(totals.value ?? 0), cls: 'text-emerald-700' },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {ar ? 'الجنوط لا تحمل رقمًا تسلسليًا، فتُتابَع بالعدد لكل نوع ومقاس وحالة. كل إضافة أو خصم أو تحويل حركة في السجل باسم من سجّلها.'
          : 'Rims carry no serial, so they are counted per brand, size and condition. Every add, reduce or transfer is a logged movement under its author.'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
            <div className="text-[11px] text-slate-500">{c.label}</div>
            <div className={`text-xl font-bold tabular-nums ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <FilterBar chips={CHIPS} counts={f.counts} active={filter} onChange={setFilter} query={query} onQuery={onQuery}
        placeholder={ar ? 'نوع · مقاس · حالة…' : 'Brand · size · condition…'} shown={f.shown.length} total={rims.length} ar={ar} />
      <div className="flex flex-wrap items-center gap-2">
        {admin && (
          <button type="button" onClick={() => setForm({ rim: null })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-sm">
            <Plus className="w-4 h-4 text-[#f37121]" /> {ar ? 'إضافة صنف جنوط' : 'Add rim type'}
          </button>
        )}
        {admin && <>
          <button type="button" onClick={() => setVehicleMove('out')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e0651a]">
            <Truck className="w-4 h-4" /> {ar ? 'صادر على مركبة' : 'Issue to vehicle'}
          </button>
          <button type="button" onClick={() => setVehicleMove('in')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-emerald-400 text-slate-700 text-sm">
            <PackageCheck className="w-4 h-4 text-emerald-600" /> {ar ? 'وارد من مركبة' : 'Return from vehicle'}
          </button>
        </>}
        <button type="button" onClick={() => setLog({ rim: null })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-sm">
          <History className="w-4 h-4" /> {ar ? 'سجل حركات الجنوط' : 'Rim movements'}
        </button>
        <div className="ms-auto">
          <ExportMenu fileName="ls2-rims" lang={lang} options={[
            { key: 'shown', label: ar ? 'الجنوط المعروضة (بعد الفلتر)' : 'Shown rims (filtered)', sheets: [{ name: ar ? 'الجنوط' : 'Rims', rows: f.shown, columns: rimCols(ar) }] },
            {
              key: 'all', label: ar ? 'كل الجنوط + سجل الحركات' : 'All rims + movement log',
              resolve: async () => {
                const res = await api.get<{ movements: RimMovement[] }>('/api/ls2/assets/rims/movements?limit=5000');
                return [
                  { name: ar ? 'الجنوط' : 'Rims', rows: rims, columns: rimCols(ar) },
                  { name: ar ? 'حركات الجنوط' : 'Rim movements', rows: res.movements || [], columns: movementCols(ar) },
                ];
              },
            },
          ]} />
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{ar ? 'الصنف' : 'Rim'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة' : 'Condition'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'الرصيد' : 'On hand'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'سعر القطعة' : 'Unit price'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'القيمة' : 'Value'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'ملاحظات' : 'Notes'}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {f.shown.map((r) => (
                <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${COND[r.condition]?.cls || ''}`}>{ar ? COND[r.condition]?.ar : COND[r.condition]?.en}</span></td>
                  <td className="px-4 py-3 text-end">
                    <span className={`font-bold tabular-nums ${r.status === 'out' ? 'text-red-600' : r.status === 'low' ? 'text-amber-600' : 'text-slate-800'}`}>{r.quantity}</span>
                    {r.minQuantity > 0 && <span className="block text-[10px] text-slate-400">{ar ? `التنبيه عند ${r.minQuantity}` : `alert at ${r.minQuantity}`}</span>}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-slate-600">{r.unitPrice ? fmtNum(r.unitPrice) : '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-slate-600">{r.value ? fmtNum(r.value) : '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px]">{r.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {admin && <>
                        <button type="button" title={ar ? 'وارد' : 'In'} onClick={() => setMove({ rim: r, type: 'in' })} className="p-1.5 rounded-md hover:bg-emerald-50 text-slate-400 hover:text-emerald-600"><Plus className="w-4 h-4" /></button>
                        <button type="button" title={ar ? 'صادر' : 'Out'} disabled={r.quantity <= 0} onClick={() => setMove({ rim: r, type: 'out' })} className="p-1.5 rounded-md hover:bg-amber-50 text-slate-400 hover:text-amber-600 disabled:opacity-30"><Minus className="w-4 h-4" /></button>
                        <button type="button" title={ar ? 'تحويل إلى صنف آخر' : 'Transfer to another type'} disabled={r.quantity <= 0 || rims.length < 2} onClick={() => setTransfer(r)} className="p-1.5 rounded-md hover:bg-blue-50 text-slate-400 hover:text-blue-600 disabled:opacity-30"><ArrowLeftRight className="w-4 h-4" /></button>
                        <button type="button" title={ar ? 'تعديل' : 'Edit'} onClick={() => setForm({ rim: r })} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
                      </>}
                      <button type="button" title={ar ? 'السجل' : 'Log'} onClick={() => setLog({ rim: r })} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700"><History className="w-4 h-4" /></button>
                      {admin && r.quantity === 0 && (
                        <button type="button" title={ar ? 'حذف من القائمة' : 'Remove'} onClick={() => hide(r)} className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {f.shown.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-10">{ar ? 'لا توجد جنوط مطابقة' : 'No matching rims'}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {form && <RimForm rim={form.rim} ar={ar} onClose={() => setForm(null)} onSaved={() => saved(ar ? 'تم الحفظ' : 'Saved')} />}
      {vehicleMove && <VehicleMoveForm type={vehicleMove} rims={rims} issueReasons={reasons.issue || []} plateOptions={plateOptions} ar={ar}
        onClose={() => setVehicleMove(null)} onSaved={() => saved(ar ? 'تم تسجيل الحركة' : 'Recorded')} />}
      {move && <MovementForm rim={move.rim} type={move.type} reasons={move.type === 'in' ? reasons.in : reasons.out} issueReasons={reasons.issue || []} plateOptions={plateOptions} ar={ar}
        onClose={() => setMove(null)} onSaved={() => saved(ar ? 'تم تسجيل الحركة' : 'Recorded')} />}
      {transfer && <TransferForm rim={transfer} rims={rims} ar={ar} onClose={() => setTransfer(null)} onSaved={() => saved(ar ? 'تم التحويل' : 'Transferred')} />}
      {log && <MovementLog rim={log.rim} ar={ar} lang={lang} admin={admin} refreshKey={refreshKey} onClose={() => setLog(null)} onChanged={() => load()} />}
    </div>
  );
}
