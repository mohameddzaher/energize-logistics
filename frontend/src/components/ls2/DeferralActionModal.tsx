'use client';
// Settle ONE deferred checklist task without registering a full periodic service.
// Three actions, all leaving the Wialon interval untouched:
//   done  → it was actually done now (clears the alert)
//   defer → still fine, grant it another N km (pushes its due odometer forward)
//   skip  → decided not to do it at all (clears the alert, logged as won't-do)
// Shared by the vehicle profile and the Maintenance page's fleet list.
import { useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { CheckCircle2, Clock, XCircle, Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import { ls2Text, fmtKm, fmtNum, checklistLabel, dayEstimateText, type Lang, type Deferral } from '@/lib/ls2';

type Action = 'done' | 'defer' | 'skip';

// The fleet list carries plate/unitId; the profile passes unitId separately.
export type DeferralLike = Deferral & { unitId?: number; plate?: string; currentOdometerKm?: number | null };

export default function DeferralActionModal({
  deferral, unitId, currentOdo, lang, isRTL, onClose, onDone,
}: {
  deferral: DeferralLike;
  unitId: number;
  currentOdo?: number | null;
  lang: Lang;
  isRTL: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useDialog();
  const ar = lang === 'ar';
  const t = ls2Text(lang);
  const [action, setAction] = useState<Action>('done');
  const [odo, setOdo] = useState<string>(
    currentOdo != null ? String(currentOdo) : (deferral.currentOdometerKm != null ? String(deferral.currentOdometerKm) : '')
  );
  const [addKm, setAddKm] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (action === 'defer' && !(Number(addKm) > 0)) { notify(ar ? 'اكتب المسافة الإضافية' : 'Enter the extra km'); return; }
    setBusy(true);
    try {
      await api.post(`/api/ls2/vehicles/${unitId}/resolve-deferral`, {
        logId: deferral.logId, label: deferral.label, action,
        odometerKm: odo.trim() ? Number(odo) : undefined,
        addKm: action === 'defer' ? Number(addKm) : undefined,
        note: note.trim() || undefined,
      });
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  const OPTIONS: { key: Action; label: string; hint: string; icon: any; on: string }[] = [
    { key: 'done', label: t.deferralDone, hint: t.deferralDoneHint, icon: CheckCircle2, on: 'bg-emerald-600 text-white border-emerald-600' },
    { key: 'defer', label: t.deferralDefer, hint: t.deferralDeferHint, icon: Clock, on: 'bg-amber-500 text-white border-amber-500' },
    { key: 'skip', label: t.deferralSkip, hint: t.deferralSkipHint, icon: XCircle, on: 'bg-slate-600 text-white border-slate-600' },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-slate-900">{t.deferralActionTitle}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500 mb-1">
          <b className="text-slate-700">{checklistLabel(deferral, lang)}</b>
          {deferral.plate ? <> · {deferral.plate}</> : null}
          {deferral.intervalName ? <> · {deferral.intervalName}</> : null}
        </p>
        <p className="text-[11px] text-slate-500 mb-4">
          {ar ? 'العداد الحالي' : 'Odometer now'}: <b className="tabular-nums text-slate-700">{fmtKm(deferral.currentOdometerKm ?? currentOdo)}</b>
          {' · '}{t.dueAt} {fmtKm(deferral.dueAtOdometerKm)}
          {deferral.remainingKm != null && (
            <> · {deferral.remainingKm < 0
              ? <span className="text-red-600 font-medium">−{fmtNum(Math.abs(deferral.remainingKm))} {t.kmOverdue}</span>
              : <span className="text-amber-700 font-medium">{fmtNum(deferral.remainingKm)} {t.kmLeft}</span>}</>
          )}
          {dayEstimateText(deferral, lang) && (deferral.remainingKm ?? 0) >= 0 && (
            <span className="block text-amber-700 font-medium mt-0.5">{dayEstimateText(deferral, lang)}</span>
          )}
        </p>

        <div className="space-y-2 mb-3">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = action === o.key;
            return (
              <button key={o.key} type="button" onClick={() => setAction(o.key)}
                className={`w-full text-start px-3 py-2.5 rounded-xl border flex items-center gap-3 ${active ? o.on : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                <Icon className="w-5 h-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className={`block text-[11px] ${active ? 'text-white/80' : 'text-slate-400'}`}>{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Extra fields per action */}
        {action === 'defer' ? (
          <div className="mb-3">
            <label className="text-xs font-medium text-slate-600 mb-1 block">{t.deferralAddKm} *</label>
            <input type="number" value={addKm} onChange={(e) => setAddKm(e.target.value)} placeholder="2000"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums" />
            <p className="text-[10px] text-slate-400 mt-1">
              {ar ? 'يبدأ العدّ من العداد الحالي.' : 'Counted from the current odometer.'}
              {Number(addKm) > 0 && Number(odo) > 0 && (
                <> {t.dueAt} <b>{(Number(odo) + Number(addKm)).toLocaleString()} {ar ? 'كم' : 'km'}</b></>
              )}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{t.deferralOdoNow}</label>
            <input type="number" value={odo} onChange={(e) => setOdo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">{t.deferralNote}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {ar ? 'تأكيد' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
