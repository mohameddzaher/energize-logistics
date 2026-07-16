'use client';
// Register a completed service on ONE interval — writes to Location Solutions
// (odometer + executions) and keeps our own record (real date, cost, notes, who).
// Shared by the vehicle page and the Maintenance page.
//
// The checklist is OURS, not Wialon's: each task is ticked done, marked not
// needed, or DEFERRED — inspected and judged good for another N km, which we
// turn into an odometer deadline and alert on before it runs out.
import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Clock, MinusCircle } from 'lucide-react';
import api from '@/lib/api';
import { ls2Text, type Lang, type ServiceInterval, type ChecklistItem, type ChecklistTemplates } from '@/lib/ls2';

type Status = 'done' | 'deferred' | 'na';
type Row = { label: string; status: Status; deferKm: string; note: string };

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
  const t = ls2Text(lang);
  const [odo, setOdo] = useState(String(currentOdo ?? ''));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  // Pull this service's checklist template (edited in the section's Settings).
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ checklists: ChecklistTemplates }>('/api/ls2/settings');
        const items: ChecklistItem[] = res.checklists?.[String(interval.id)] || [];
        setRows(items.map((i) => ({
          label: ar && i.labelAr ? i.labelAr : i.label,
          status: 'done' as Status, deferKm: '', note: '',
        })));
      } catch { /* no template → plain service, no checklist */ }
    })();
  }, [interval.id, ar]);

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  // A deferral is only meaningful with the extra km attached.
  const incomplete = rows.some((r) => r.status === 'deferred' && !Number(r.deferKm));

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ syncedToWialon: boolean }>(`/api/ls2/vehicles/${unitId}/register-service`, {
        intervalId: interval.id,
        odometerKm: Number(odo),
        serviceDate: date || undefined,
        cost: cost ? Number(cost) : undefined,
        notes: notes || undefined,
        checklist: rows.map((r) => ({
          label: r.label,
          status: r.status,
          deferKm: r.status === 'deferred' ? Number(r.deferKm) : null,
          note: r.note || '',
        })),
      });
      onSaved();
      if (!res.syncedToWialon) alert(ar ? 'اتسجّلت عندنا، بس الكتابة في Location Solutions فشلت — راجع الصلاحيات.' : 'Saved locally, but the Location Solutions write failed — check permissions.');
    } catch (e: any) { alert(e?.message || 'Failed'); }
    setSaving(false);
  };

  const STATES: { key: Status; label: string; icon: any; on: string }[] = [
    { key: 'done', label: t.done, icon: CheckCircle2, on: 'bg-emerald-600 text-white border-emerald-600' },
    { key: 'deferred', label: t.deferred, icon: Clock, on: 'bg-amber-500 text-white border-amber-500' },
    { key: 'na', label: t.notApplicable, icon: MinusCircle, on: 'bg-slate-500 text-white border-slate-500' },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
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

          {/* Checklist — only when this service has a template configured */}
          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-3">
              <p className="text-xs font-bold text-slate-700 mb-2">{t.checklist}</p>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 p-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800">{r.label}</span>
                      <div className="flex gap-1">
                        {STATES.map((st) => {
                          const Icon = st.icon;
                          const active = r.status === st.key;
                          return (
                            <button key={st.key} type="button" onClick={() => setRow(i, { status: st.key })}
                              className={`px-2 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 ${active ? st.on : 'bg-white text-slate-600 border-slate-200'}`}>
                              <Icon className="w-3 h-3" /> {st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {r.status === 'deferred' && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-600">{t.deferFor}</span>
                        <input type="number" value={r.deferKm} onChange={(e) => setRow(i, { deferKm: e.target.value })}
                          placeholder="2000" className="w-24 px-2 py-1 rounded-md border border-amber-300 text-xs tabular-nums" />
                        <span className="text-[11px] text-slate-600">{ar ? 'كم' : 'km'}</span>
                        {Number(r.deferKm) > 0 && Number(odo) > 0 && (
                          <span className="text-[11px] text-amber-700 font-medium">
                            {t.dueAt} {(Number(odo) + Number(r.deferKm)).toLocaleString()} {ar ? 'كم' : 'km'}
                          </span>
                        )}
                        <input value={r.note} onChange={(e) => setRow(i, { note: e.target.value })}
                          placeholder={t.notes} className="flex-1 min-w-[120px] px-2 py-1 rounded-md border border-slate-200 text-xs" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">{t.deferHint}</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          <p className="text-[10px] text-slate-400 bg-slate-50 rounded-lg p-2">{ar ? 'هيتكتب في Location Solutions فورًا (العداد + عدد المرات)، ويتحفظ عندنا بالتاريخ الحقيقي ومين سجّله.' : 'Writes to Location Solutions instantly (odometer + count), and is kept here with the real date + who logged it.'}</p>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={submit} disabled={saving || !odo || incomplete} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {ar ? 'تسجيل الصيانة' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}
