'use client';
// One truck's maintenance by type: the four tabs (periodic / preventive / roadside / accident).
// The periodic tab shows the caller's service-interval cards unchanged, then the periodic records with their parts
// and technician work; the other three list their records and add new ones. Shared by the maintenance page and the vehicle profile.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Ban, Package, Wrench, Truck as TowIcon } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { MAINTENANCE_TYPES, fmtKm, type Lang, type MaintenanceRecord, type MaintenanceType } from '@/lib/ls2';
import MaintenanceRecordModal from './MaintenanceRecordModal';

const money = (n?: number | null) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

function RecordCard({ r, ar, admin, onCancel }: { r: MaintenanceRecord; ar: boolean; admin: boolean; onCancel: () => void }) {
  const cancelled = r.status === 'cancelled';
  return (
    <div className={`bg-white border rounded-lg p-3 ${cancelled ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold text-slate-800 ${cancelled ? 'line-through' : ''}`}>
            {r.intervalName || r.title || (ar ? 'بدون وصف' : 'No description')}
          </p>
          <p className="text-[11px] text-slate-500 tabular-nums">
            {r.date}{r.odometerKm != null ? ` · ${fmtKm(r.odometerKm)}` : ''}{r.location ? ` · ${r.location}` : ''}
            {r.issueRequestNo ? ` · ${ar ? 'طلب صرف' : 'Issue'} ${r.issueRequestNo}` : ''}{r.createdByName ? ` · ${r.createdByName}` : ''}
          </p>
        </div>
        <div className="text-end shrink-0">
          <p className="text-sm font-bold tabular-nums text-slate-900">{money(r.totalCost)} <span className="text-[10px] font-normal text-slate-500">{ar ? 'ر.س' : 'SAR'}</span></p>
          {cancelled
            ? <span className="text-[10px] font-semibold text-red-600">{ar ? 'ملغى' : 'Cancelled'}</span>
            : admin && (
              <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-600">
                <Ban className="w-3 h-3" /> {ar ? 'إلغاء السجل' : 'Cancel record'}
              </button>
            )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200"><Package className="w-3 h-3" /> {ar ? 'قطع' : 'Parts'} {money(r.partsCost)}</span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-200"><Wrench className="w-3 h-3" /> {ar ? 'عمالة' : 'Labour'} {money(r.labourCost)}</span>
        {r.towingCost > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"><TowIcon className="w-3 h-3" /> {ar ? 'سحب' : 'Towing'} {money(r.towingCost)}</span>}
      </div>
      {r.parts.length > 0 && (
        <p className="text-[11px] text-slate-600 mt-1.5">{r.parts.map((p) => `${p.itemName} × ${p.quantity}`).join('، ')}</p>
      )}
      {r.work.length > 0 && (
        <p className="text-[11px] text-slate-600 mt-1">{r.work.map((w) => `${w.label}${w.cost ? ` (${money(w.cost)})` : ''}`).join('، ')}</p>
      )}
      {r.notes && <p className="text-[11px] text-slate-500 mt-1">{r.notes}</p>}
      {cancelled && r.cancelReason && <p className="text-[11px] text-red-600 mt-1">{ar ? 'سبب الإلغاء' : 'Reason'}: {r.cancelReason}{r.cancelledByName ? ` — ${r.cancelledByName}` : ''}</p>}
    </div>
  );
}

export default function MaintenanceRecords({
  unitId, plate, currentOdo, lang, isRTL, admin, periodic,
}: {
  unitId: number;
  plate?: string;
  currentOdo?: number | null;
  lang: Lang;
  isRTL: boolean;
  admin: boolean;
  periodic: ReactNode; // the existing service-interval cards
}) {
  const ar = lang === 'ar';
  const { prompt, notify } = useDialog();
  const [tab, setTab] = useState<MaintenanceType>('periodic');
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [adding, setAdding] = useState<Exclude<MaintenanceType, 'periodic'> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ records: MaintenanceRecord[] }>(`/api/ls2/maintenance/records?unitId=${unitId}&status=all`);
      setRecords(r.records || []);
    } catch { /* keep */ }
  }, [unitId]);
  useEffect(() => { load(); }, [load]);
  // The poller's pulse carries `vehicles`; only real writes reload.
  useSocket('ls2:updated', useCallback((d: any) => { if (!d?.vehicles) load(); }, [load]));

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of records) if (r.status === 'active') c[r.type] = (c[r.type] || 0) + 1;
    return c;
  }, [records]);
  const shown = records.filter((r) => r.type === tab);

  const cancel = async (r: MaintenanceRecord) => {
    const reason = await prompt({
      title: ar ? 'إلغاء سجل الصيانة' : 'Cancel maintenance record',
      message: ar ? 'تعود قطع الغيار إلى المخزن ويبقى السجل ظاهرًا كملغى. اكتب السبب:' : 'Parts return to the store and the record stays as cancelled. Reason:',
      confirmLabel: ar ? 'إلغاء السجل' : 'Cancel record',
    });
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.post(`/api/ls2/maintenance/records/${r._id}/cancel`, { reason: reason.trim() });
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {MAINTENANCE_TYPES.map((m) => (
          <button key={m.key} type="button" onClick={() => setTab(m.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${tab === m.key ? 'bg-slate-900 text-white border-slate-900' : `${m.cls}`}`}>
            {ar ? m.ar : m.en}{counts[m.key] ? ` (${counts[m.key]})` : ''}
          </button>
        ))}
        {admin && tab !== 'periodic' && (
          <button type="button" onClick={() => setAdding(tab as Exclude<MaintenanceType, 'periodic'>)}
            className="ms-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-xs font-medium">
            <Plus className="w-3.5 h-3.5" /> {ar ? 'تسجيل جديد' : 'New record'}
          </button>
        )}
      </div>

      {tab === 'periodic' && periodic}

      {(tab !== 'periodic' || shown.length > 0) && (
        <div className="space-y-2">
          {tab === 'periodic' && <p className="text-xs font-semibold text-slate-600 pt-1">{ar ? 'سجلات الصيانة الدورية (القطع وأعمال الفني)' : 'Periodic records (parts and technician work)'}</p>}
          {shown.length === 0 && <p className="text-sm text-slate-400 text-center py-6">{ar ? 'لا توجد سجلات من هذا النوع لهذه المركبة.' : 'No records of this type for this vehicle.'}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {shown.map((r) => <RecordCard key={r._id} r={r} ar={ar} admin={admin} onCancel={() => cancel(r)} />)}
          </div>
        </div>
      )}

      {adding && (
        <MaintenanceRecordModal
          unitId={unitId} plate={plate} type={adding} currentOdo={currentOdo} lang={lang} isRTL={isRTL}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); load(); }}
        />
      )}
    </div>
  );
}
