'use client';
// Register a completed service on ONE interval — writes to Location Solutions
// (odometer + executions) and keeps our own record (real date, cost, notes, who).
// Shared by the vehicle page and the Maintenance page.
//
// The checklist is OURS, not Wialon's: each task is ticked done, marked not
// needed, or DEFERRED — inspected and judged good for another N km, which we
// turn into an odometer deadline and alert on before it runs out.
import { useState, useEffect } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { CheckCircle2, Loader2, Clock, MinusCircle, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { ls2Text, serviceTemplateKey, MIN_DEFER_KM, type Lang, type ServiceInterval, type ChecklistItem, type ChecklistTemplates } from '@/lib/ls2';
import StorePartsPicker, { partsProblem, type PartLine, type StoreItem } from './StorePartsPicker';

type Status = 'done' | 'deferred' | 'na';
// `label` stays the CANONICAL (English) template label — the backend matches
// deferrals against it, so it must not vary with the registrar's UI language.
// `labelAr` is carried for display here and in the history/deferral lists.
type Row = { label: string; labelAr: string; status: Status; deferKm: string; note: string };
// Technician work line (greasing, adjustment…); its cost is optional.
type WorkLine = { label: string; cost: string };

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
  const { notify } = useDialog();
  const ar = lang === 'ar';
  const t = ls2Text(lang);
  const [odo, setOdo] = useState(String(currentOdo ?? ''));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [parts, setParts] = useState<PartLine[]>([]);
  const [storeItems, setStoreItems] = useState<Map<string, StoreItem>>(new Map());
  const [work, setWork] = useState<WorkLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  // Pull this service's checklist template (edited in the section's Settings).
  // Templates are keyed by serviceTemplateKey(name) — NEVER by interval.id, which
  // is per-vehicle noise in Wialon (the same id is a different service on
  // different trucks). The id lookup remains only as a legacy fallback.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ checklists: ChecklistTemplates }>('/api/ls2/settings');
        const items: ChecklistItem[] =
          res.checklists?.[serviceTemplateKey(interval.name)] || res.checklists?.[String(interval.id)] || [];
        setRows(items.map((i) => ({
          label: i.label, labelAr: i.labelAr || '',
          status: 'done' as Status, deferKm: '', note: '',
        })));
      } catch { /* no template → plain service, no checklist */ }
    })();
  }, [interval.id, interval.name, ar]);

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  // Deferred (مؤجّل) needs at least MIN_DEFER_KM; the server refuses less.
  const shortDefer = rows.some((r) => r.status === 'deferred' && !(Number(r.deferKm) >= MIN_DEFER_KM));
  const partsError = partsProblem(parts, storeItems, ar);
  const workError = work.some((w) => w.cost !== '' && !(Number(w.cost) >= 0)) ? (ar ? 'تكلفة بند العمل غير صحيحة' : 'Invalid work cost') : null;
  const incomplete = shortDefer || !!partsError || !!workError;
  const setWorkLine = (i: number, patch: Partial<WorkLine>) => setWork((w) => w.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ syncedToWialon: boolean }>(`/api/ls2/vehicles/${unitId}/register-service`, {
        intervalId: interval.id,
        odometerKm: Number(odo),
        serviceDate: date || undefined,
        notes: notes || undefined,
        parts: parts.map((p) => ({ item: p.item, quantity: Number(p.quantity) })),
        work: work.filter((w) => w.label.trim()).map((w) => ({ label: w.label.trim(), cost: w.cost === '' ? null : Number(w.cost) })),
        checklist: rows.map((r) => ({
          label: r.label,
          labelAr: r.labelAr,
          status: r.status,
          deferKm: r.status === 'deferred' ? Number(r.deferKm) : null,
          note: r.note || '',
        })),
      });
      onSaved();
      if (!res.syncedToWialon) notify(ar ? 'سُجّلت الصيانة في النظام، لكن تعذّر تسجيلها في Location Solutions — راجع الصلاحيات.' : 'Saved locally, but the Location Solutions write failed — check permissions.');
    } catch (e: any) {
      const lines = Array.isArray(e?.data?.errors) ? e.data.errors.map((x: any) => x.message).join(' · ') : '';
      notify([e?.message || 'Failed', lines].filter(Boolean).join(' — '), 'error');
    }
    setSaving(false);
  };

  const STATES: { key: Status; label: string; icon: any; on: string }[] = [
    { key: 'done', label: t.done, icon: CheckCircle2, on: 'bg-emerald-600 text-white border-emerald-600' },
    { key: 'deferred', label: t.deferred, icon: Clock, on: 'bg-amber-500 text-white border-amber-500' },
    { key: 'na', label: t.notApplicable, icon: MinusCircle, on: 'bg-slate-500 text-white border-slate-500' },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-1"><CheckCircle2 className="w-5 h-5 text-[#f37121]" /> {ar ? 'تسجيل صيانة' : 'Register Service'}</h3>
        <p className="text-xs text-slate-500 mb-4">{interval.name}</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'العداد وقت الصيانة (كم)' : 'Odometer at service (km)'}</label>
            <input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums" />
            <p className="text-[10px] text-slate-400 mt-1">{ar ? 'المبدئي = العداد الحالي. عدّله لو الصيانة اتعملت وهو أقل.' : 'Defaults to current odometer. Edit if the service was done earlier.'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'تاريخ الصيانة' : 'Service date'}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>

          {/* Part 1: spare parts from the heavy store */}
          <div className="border border-slate-200 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-700 mb-2">{ar ? '١. قطع الغيار (من مخزن النقل الثقيل)' : '1. Spare parts (heavy-transport store)'}</p>
            <StorePartsPicker value={parts} onChange={setParts} ar={ar} onItems={setStoreItems} />
            {partsError && parts.length > 0 && <p className="text-[11px] text-red-600 mt-1">{partsError}</p>}
          </div>

          {/* Part 2: technician work */}
          <div className="border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-700">{ar ? '٢. أعمال الفني (تشحيم، ضبط…)' : '2. Technician work (greasing, adjustment…)'}</p>
              <button type="button" onClick={() => setWork((w) => [...w, { label: '', cost: '' }])}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium">
                <Plus className="w-3 h-3" /> {ar ? 'إضافة عمل' : 'Add work'}
              </button>
            </div>
            {work.length === 0 && <p className="text-[11px] text-slate-400">{ar ? 'لا توجد أعمال مضافة.' : 'No work lines.'}</p>}
            <div className="space-y-1.5">
              {work.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={w.label} onChange={(e) => setWorkLine(i, { label: e.target.value })} placeholder={ar ? 'العمل المنفّذ' : 'Work done'}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-slate-200 text-sm" />
                  <input type="number" min={0} value={w.cost} onChange={(e) => setWorkLine(i, { cost: e.target.value })} placeholder={ar ? 'التكلفة' : 'Cost'}
                    className="w-28 px-2 py-1.5 rounded-md border border-slate-200 text-sm tabular-nums" />
                  <button type="button" onClick={() => setWork((x) => x.filter((_, k) => k !== i))} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Checklist — only when this service has a template configured */}
          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-3">
              <p className="text-xs font-bold text-slate-700 mb-2">{t.checklist}</p>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 p-2.5">
                    {/* Label and the 3 choices are two blocks that never intermix:
                        the label takes the space it needs (up to 2 lines), the
                        choices stay ONE group. Side by side (choices centered on
                        the label) once there's room; stacked on narrow screens. */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 break-words">{ar && r.labelAr ? r.labelAr : r.label}</span>
                      <div className="grid grid-cols-3 sm:flex gap-1 shrink-0">
                        {STATES.map((st) => {
                          const Icon = st.icon;
                          const active = r.status === st.key;
                          return (
                            <button key={st.key} type="button" onClick={() => setRow(i, { status: st.key })}
                              className={`px-2 py-1.5 rounded-md text-[11px] font-medium border flex items-center justify-center gap-1 ${active ? st.on : 'bg-white text-slate-600 border-slate-200'}`}>
                              <Icon className="w-3 h-3 shrink-0" /> {st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {r.status === 'deferred' && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-600">{t.deferFor}</span>
                        <input type="number" min={MIN_DEFER_KM} step={1000} value={r.deferKm} onChange={(e) => setRow(i, { deferKm: e.target.value })}
                          placeholder={String(MIN_DEFER_KM)} className={`w-24 px-2 py-1 rounded-md border text-xs tabular-nums ${r.deferKm && Number(r.deferKm) < MIN_DEFER_KM ? 'border-red-400 bg-red-50' : 'border-amber-300'}`} />
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
              <p className={`text-[10px] mt-1 ${shortDefer ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                {ar ? `التأجيل مسموح فقط لمسافة ${MIN_DEFER_KM.toLocaleString('en-US')} كم أو أكثر؛ ما دون ذلك يُنجَز الآن.` : `Deferral is allowed only for ${MIN_DEFER_KM.toLocaleString('en-US')} km or more; anything shorter is done now.`}
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
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
