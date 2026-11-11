'use client';
// New preventive / roadside / accident maintenance record for one truck.
// Parts come from the heavy store (StorePartsPicker) and leave it through an issue request on save;
// labour and towing are optional amounts.
import { useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { maintenanceTypeLabel, type Lang, type MaintenanceType } from '@/lib/ls2';
import StorePartsPicker, { partsProblem, type PartLine, type StoreItem } from './StorePartsPicker';

const todayYmd = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

export default function MaintenanceRecordModal({
  unitId, plate, type, currentOdo, lang, isRTL, onClose, onSaved,
}: {
  unitId: number;
  plate?: string;
  type: Exclude<MaintenanceType, 'periodic'>;
  currentOdo?: number | null;
  lang: Lang;
  isRTL: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [date, setDate] = useState(todayYmd());
  const [odo, setOdo] = useState(currentOdo != null ? String(Math.round(currentOdo)) : '');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [parts, setParts] = useState<PartLine[]>([]);
  const [items, setItems] = useState<Map<string, StoreItem>>(new Map());
  const [labour, setLabour] = useState('');
  const [towing, setTowing] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const problem = partsProblem(parts, items, ar)
    || (date > todayYmd() ? (ar ? 'التاريخ لا يكون بعد اليوم' : 'Date cannot be in the future') : null)
    || ([labour, towing].some((v) => v !== '' && !(Number(v) >= 0)) ? (ar ? 'التكلفة غير صحيحة' : 'Invalid cost') : null);

  const submit = async () => {
    if (problem) { notify(problem, 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/ls2/maintenance/records', {
        unitId, type, date, odometerKm: odo === '' ? undefined : Number(odo),
        title: title || undefined, location: location || undefined, notes: notes || undefined,
        labourCost: labour === '' ? 0 : Number(labour), towingCost: towing === '' ? 0 : Number(towing),
        parts: parts.map((p) => ({ item: p.item, quantity: Number(p.quantity) })),
      });
      onSaved();
    } catch (e: any) {
      const lines = Array.isArray(e?.data?.errors) ? e.data.errors.map((x: any) => x.message).join(' · ') : '';
      notify([e?.message || (ar ? 'تعذّر الحفظ' : 'Save failed'), lines].filter(Boolean).join(' — '), 'error');
    }
    setSaving(false);
  };

  const input = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#f37121]';
  const label = 'text-xs font-medium text-slate-600 mb-1 block';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">{ar ? 'تسجيل' : 'New'} {maintenanceTypeLabel(type, lang)}</h3>
            {plate && <p className="text-xs text-slate-500">{plate}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={label}>{ar ? 'التاريخ *' : 'Date *'}</label>
              <input type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>{ar ? 'العداد (كم)' : 'Odometer (km)'}</label>
              <input type="number" min={0} value={odo} onChange={(e) => setOdo(e.target.value)} className={`${input} tabular-nums`} />
            </div>
            <div>
              <label className={label}>{type === 'preventive' ? (ar ? 'وصف العمل' : 'Work description') : (ar ? 'الموقع' : 'Location')}</label>
              {type === 'preventive'
                ? <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
                : <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={ar ? 'مثال: طريق الدمام' : 'e.g. Dammam road'} className={input} />}
            </div>
          </div>
          {type !== 'preventive' && (
            <div>
              <label className={label}>{type === 'accident' ? (ar ? 'وصف الحادث' : 'Accident description') : (ar ? 'وصف العطل' : 'Fault description')}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
            </div>
          )}

          <div className="border border-slate-200 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-700 mb-2">{ar ? 'قطع الغيار من المخزن' : 'Spare parts from the store'}</p>
            <StorePartsPicker value={parts} onChange={setParts} ar={ar} onItems={setItems} />
            <p className="text-[10px] text-slate-500 mt-2">{ar ? 'تُصرف القطع من مخزن النقل الثقيل بطلب صرف عند الحفظ، وتظهر في سجل حركات المخزن.' : 'Parts are issued from the heavy store with an issue request on save and appear in the store log.'}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>{ar ? 'تكلفة العمالة (اختياري)' : 'Labour cost (optional)'}</label>
              <input type="number" min={0} value={labour} onChange={(e) => setLabour(e.target.value)} className={`${input} tabular-nums`} />
            </div>
            <div>
              <label className={label}>{ar ? 'تكلفة السحب (اختياري)' : 'Towing cost (optional)'}</label>
              <input type="number" min={0} value={towing} onChange={(e) => setTowing(e.target.value)} className={`${input} tabular-nums`} />
            </div>
          </div>

          <div>
            <label className={label}>{ar ? 'ملاحظات' : 'Notes'}</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
          </div>
          {problem && parts.length > 0 && <p className="text-xs text-red-600">{problem}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={submit} disabled={saving || !!problem} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {ar ? 'حفظ' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
