'use client';
// Register a completed service on ONE interval — writes to Location Solutions
// (odometer + executions) and keeps our own record (real date, cost, notes, who).
// Shared by the vehicle page and the Maintenance page.
import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import type { Lang, ServiceInterval } from '@/lib/ls2';

export default function RegisterServiceModal({
  unitId, interval, currentOdo, lang, isRTL, onClose, onSaved,
}: {
  unitId: number;
  interval: ServiceInterval;
  currentOdo: number | null;
  lang: Lang;
  isRTL: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ar = lang === 'ar';
  const [odo, setOdo] = useState(String(currentOdo ?? ''));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ syncedToWialon: boolean }>(`/api/ls2/vehicles/${unitId}/register-service`, {
        intervalId: interval.id,
        odometerKm: Number(odo),
        serviceDate: date || undefined,
        cost: cost ? Number(cost) : undefined,
        notes: notes || undefined,
      });
      onSaved();
      if (!res.syncedToWialon) alert(ar ? 'اتسجّلت عندنا، بس الكتابة في Location Solutions فشلت — راجع الصلاحيات.' : 'Saved locally, but the Location Solutions write failed — check permissions.');
    } catch (e: any) { alert(e?.message || 'Failed'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-1"><CheckCircle2 className="w-5 h-5 text-[#f37121]" /> {ar ? 'تسجيل صيانة' : 'Register Service'}</h3>
        <p className="text-xs text-slate-500 mb-4">{interval.name}</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'العداد وقت الصيانة (كم)' : 'Odometer at service (km)'}</label>
            <input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums" />
            <p className="text-[10px] text-slate-400 mt-1">{ar ? 'المبدئي = العداد الحالي. عدّله لو الصيانة اتعملت وهو أقل.' : 'Defaults to current odometer. Edit if the service was done earlier.'}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'تاريخ الصيانة' : 'Service date'}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'التكلفة (اختياري)' : 'Cost (optional)'}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          <p className="text-[10px] text-slate-400 bg-slate-50 rounded-lg p-2">{ar ? 'هيتكتب في Location Solutions فورًا (العداد + عدد المرات)، ويتحفظ عندنا بالتاريخ الحقيقي ومين سجّله.' : 'Writes to Location Solutions instantly (odometer + count), and is kept here with the real date + who logged it.'}</p>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={submit} disabled={saving || !odo} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {ar ? 'تسجيل الصيانة' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}
