'use client';
// Register or edit an EXCEPTIONAL repair — unscheduled work (a breakdown, an
// accident, a fault). Nothing here goes to Location Solutions: its service
// intervals are strictly periodic, so this record lives only in our system.
import { useState } from 'react';
import { Hammer, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { ls2Text, REPAIR_CATEGORIES, REPAIR_SEVERITIES, REPAIR_STATUSES, type Lang, type Repair } from '@/lib/ls2';

export default function RepairModal({
  unitId, plate, currentOdo, existing, lang, isRTL, onClose, onSaved,
}: {
  unitId: number;
  plate?: string;
  currentOdo?: number | null;
  existing?: Repair | null;
  lang: Lang;
  isRTL: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ar = lang === 'ar';
  const t = ls2Text(lang);
  const [f, setF] = useState({
    title: existing?.title || '',
    category: existing?.category || 'breakdown',
    severity: existing?.severity || 'medium',
    status: existing?.status || 'done',
    repairDate: (existing?.repairDate || new Date().toISOString()).slice(0, 10),
    odometerKm: String(existing?.odometerKm ?? currentOdo ?? ''),
    cost: existing?.cost != null ? String(existing.cost) : '',
    workshop: existing?.workshop || '',
    partsReplaced: existing?.partsReplaced || '',
    description: existing?.description || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      const body = {
        unitId,
        title: f.title, category: f.category, severity: f.severity, status: f.status,
        repairDate: f.repairDate,
        odometerKm: f.odometerKm ? Number(f.odometerKm) : null,
        cost: f.cost ? Number(f.cost) : null,
        workshop: f.workshop, partsReplaced: f.partsReplaced, description: f.description,
      };
      if (existing) await api.patch(`/api/ls2/repairs/${existing._id}`, body);
      else await api.post('/api/ls2/repairs', body);
      onSaved();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    setSaving(false);
  };

  const input = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800';
  const label = 'text-xs font-medium text-slate-600 mb-1 block';
  const Hint = ({ children }: { children: string }) => <p className="text-[10px] text-slate-500 mt-1 leading-snug">{children}</p>;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-1"><Hammer className="w-5 h-5 text-[#f37121]" /> {existing ? t.edit : t.newRepair}</h3>
        <p className="text-xs text-slate-500 mb-4">{plate || `#${unitId}`}</p>

        <div className="space-y-3">
          <div>
            <label className={label}>{t.repairTitle}</label>
            <input value={f.title} onChange={(e) => set('title', e.target.value)} className={input}
              placeholder={ar ? 'مثال: كسر في ماسورة المياه' : 'e.g. Cracked water hose'} />
            <Hint>{t.hintRepairTitle}</Hint>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={label}>{t.category}</label>
              <select value={f.category} onChange={(e) => set('category', e.target.value)} className={input}>
                {Object.entries(REPAIR_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
              </select>
              <Hint>{t.hintCategory}</Hint>
            </div>
            <div>
              <label className={label}>{t.severity}</label>
              <select value={f.severity} onChange={(e) => set('severity', e.target.value)} className={input}>
                {Object.entries(REPAIR_SEVERITIES).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
              </select>
              <Hint>{t.hintSeverity}</Hint>
            </div>
            <div>
              <label className={label}>{t.status}</label>
              <select value={f.status} onChange={(e) => set('status', e.target.value)} className={input}>
                {Object.entries(REPAIR_STATUSES).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
              </select>
              <Hint>{t.hintStatus}</Hint>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={label}>{t.repairDate}</label>
              <input type="date" value={f.repairDate} onChange={(e) => set('repairDate', e.target.value)} className={input} />
              <Hint>{t.hintRepairDate}</Hint>
            </div>
            <div>
              <label className={label}>{ar ? 'العداد (كم)' : 'Odometer (km)'}</label>
              <input type="number" value={f.odometerKm} onChange={(e) => set('odometerKm', e.target.value)} className={`${input} tabular-nums`} />
              <Hint>{t.hintRepairOdo}</Hint>
            </div>
            <div>
              <label className={label}>{ar ? 'التكلفة' : 'Cost'}</label>
              <input type="number" value={f.cost} onChange={(e) => set('cost', e.target.value)} className={`${input} tabular-nums`} />
              <Hint>{t.hintCost}</Hint>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>{t.workshop}</label>
              <input value={f.workshop} onChange={(e) => set('workshop', e.target.value)} className={input} />
              <Hint>{t.hintWorkshop}</Hint>
            </div>
            <div>
              <label className={label}>{t.partsReplaced}</label>
              <input value={f.partsReplaced} onChange={(e) => set('partsReplaced', e.target.value)} className={input} />
              <Hint>{t.hintParts}</Hint>
            </div>
          </div>
          <div>
            <label className={label}>{t.description}</label>
            <textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} className={input} />
            <Hint>{t.hintDescription}</Hint>
          </div>
          <p className="text-[10px] text-slate-500 bg-slate-50 rounded-lg p-2">{t.repairsHint}</p>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={submit} disabled={saving || !f.title.trim()} className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />} {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
