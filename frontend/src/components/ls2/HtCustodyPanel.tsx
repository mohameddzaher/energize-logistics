'use client';
/**
 * Heavy-transport custody in the vehicle and employee files: an entry in or out appears in the profile instantly.
 * An entry carries its vehicle (unit number and register vehicle) and its HR employee, so it is read from the ledger itself with a filter, not a copy, and listens to `ht:custody`.
 * Shown only to those who can open the ledger (`CUSTODY_ROLES` in htCustodyController); hidden when the vehicle has nothing.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Wallet } from 'lucide-react';

const HT_CUSTODY_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'location_manager', 'cfo', 'accounting_manager', 'accountant'];
const ACC: Record<string, [string, string]> = { cash: ['الكاش', 'Cash'], card: ['الكارت', 'Card'], workshop: ['الورشة', 'Workshop'] };
const SRC: Record<string, [string, string]> = {
  card: ['الكارت', 'Card'], workshop: ['الورشة', 'Workshop'], bank: ['البنك', 'Bank'],
  maintenance: ['الصيانة', 'Maintenance'], rep: ['موظف', 'Employee'], opening: ['رصيد افتتاحي', 'Opening'],
};

interface Entry {
  _id: string; account: string; direction: 'in' | 'out'; amount: number; date: string;
  source?: string; target?: string; repName?: string; repIdNumber?: string; detail?: string;
  vehiclePlate?: string; vehicleName?: string; createdByName?: string;
}

const money = (n?: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const fmt = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

/** `by` is one of three: tracking unit number, register vehicle, or employee file. */
export default function HtCustodyPanel({ by, ar, showVehicle = false }: {
  by: { vehicle?: number | string; vehicleMaster?: string; employee?: string };
  ar: boolean;
  /** In the employee file: the vehicle column. In the vehicle file: the employee column. */
  showVehicle?: boolean;
}) {
  const { user } = useAuth();
  const t = (a: string, e: string) => (ar ? a : e);
  // role-only: the ledger is `authorize.strict` on the server (routes/htCustody); a section grant does not open it.
  const allowed = !!user && (HT_CUSTODY_ROLES.includes(user.role) || !!(user as any).superAdminPowers);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const guard = useLatestRequest();
  const key = by.vehicle != null && by.vehicle !== '' ? `vehicle=${encodeURIComponent(String(by.vehicle))}`
    : by.vehicleMaster ? `vehicleMaster=${encodeURIComponent(by.vehicleMaster)}`
      : by.employee ? `employee=${encodeURIComponent(by.employee)}` : '';

  const load = useCallback(async () => {
    if (!allowed || !key) return;
    const mine = guard.begin();
    try {
      const d = await api.get<{ entries: Entry[] }>(`/api/ls2/custody?${key}`);
      if (guard.isCurrent(mine)) setRows(d.entries || []);
    } catch { if (guard.isCurrent(mine)) setRows([]); }
  }, [allowed, key, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('ht:custody', useCallback(() => load(), [load]));

  if (!allowed || !rows || !rows.length) return null;
  const inSum = rows.filter((e) => e.direction === 'in').reduce((a, e) => a + e.amount, 0);
  const outSum = rows.filter((e) => e.direction === 'out').reduce((a, e) => a + e.amount, 0);
  const party = (e: Entry) => (e.direction === 'in'
    ? (e.source === 'rep' ? `${e.repName || ''} (${e.repIdNumber || ''})` : t(...(SRC[e.source || ''] || [e.source || '—', e.source || '—'])))
    : (e.target === 'rep' ? `${e.repName || ''} (${e.repIdNumber || ''})` : (e.detail || t('الشركة', 'Company'))));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Wallet className="h-5 w-5 text-[#f37121]" />
        <h3 className="text-base font-bold text-slate-800">{t('عهدة النقل الثقيل', 'Heavy transport custody')}</h3>
        <span className="text-[13px] font-semibold text-emerald-700">{t('وارد', 'In')} {money(inSum)}</span>
        <span className="text-[13px] font-semibold text-[#c2410c]">{t('صادر', 'Out')} {money(outSum)}</span>
        <span className="text-[12px] text-slate-500">{rows.length} {t('قيد', 'entries')}</span>
        <Link href="/system/ls2/custody" className="ms-auto text-[12.5px] font-semibold text-[#f37121] hover:underline">{t('الدفتر كاملًا', 'Full ledger')}</Link>
      </div>
      <div className="max-h-80 overflow-auto rounded-xl border border-slate-100">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-[12px] text-slate-600">
            <tr>
              <th className="px-3 py-2 text-start">{t('التاريخ', 'Date')}</th>
              <th className="px-3 py-2 text-start">{t('الحركة', 'Movement')}</th>
              <th className="px-3 py-2 text-start">{t('الحساب', 'Account')}</th>
              <th className="px-3 py-2 text-start">{t('من / إلى', 'From / to')}</th>
              {showVehicle && <th className="px-3 py-2 text-start">{t('السيارة', 'Vehicle')}</th>}
              <th className="px-3 py-2 text-end">{t('المبلغ', 'Amount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((e) => (
              <tr key={e._id}>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{fmt(e.date)}</td>
                <td className={`px-3 py-1.5 font-semibold ${e.direction === 'in' ? 'text-emerald-700' : 'text-[#c2410c]'}`}>{e.direction === 'in' ? t('وارد', 'In') : t('صادر', 'Out')}</td>
                <td className="px-3 py-1.5">{t(...(ACC[e.account] || [e.account, e.account]))}</td>
                <td className="px-3 py-1.5 text-slate-700">{party(e)}</td>
                {showVehicle && <td className="px-3 py-1.5 text-slate-700">{e.vehiclePlate || e.vehicleName || '—'}</td>}
                <td className={`whitespace-nowrap px-3 py-1.5 text-end font-bold tabular-nums ${e.direction === 'in' ? 'text-emerald-700' : 'text-[#c2410c]'}`}>{money(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
