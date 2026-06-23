'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Briefcase } from 'lucide-react';
import {
  Employee, Contract, LeaveRequest, Asset, LeaveBalance,
  empName, userName, fmtDate, leaveTypeLabel, expiryBadge,
  EMPLOYMENT_STATUS, LEAVE_STATUS, assetTypeLabel,
} from '@/lib/hr';
import { Spinner, PageHeader, Badge, SmallBadge, Tabs, StatCard, ExportButton } from '@/components/hr/HRKit';
import { getHrMeTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

interface Me { employee: Employee | null; contracts: Contract[]; activeContract: Contract | null; balance: LeaveBalance | null; leaves: LeaveRequest[]; assets: Asset[]; }

export default function MyProfilePage() {
  const { lang, isRTL } = useLanguage();
  const tx = getHrMeTranslations(lang);
  const [data, setData] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  const load = useCallback(async () => {
    try { const d = await api.get<Me>('/api/hr/me/profile'); setData(d); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('hr:asset', useCallback(() => load(), [load]));
  useSocket('hr:leave', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;

  if (!data?.employee) {
    return (
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <PageHeader icon={<Briefcase className="w-5 h-5" />} title={tx.myProfile} />
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-xl p-6 text-sm">
          {tx.notLinked}
        </div>
      </div>
    );
  }

  const e = data.employee;
  const b = data.balance;
  const assigned = data.assets.filter((a) => a.status === 'assigned');
  const tabs = [
    { key: 'overview', label: tx.tabOverview },
    { key: 'leaves', label: tx.tabLeaves, badge: data.leaves.length || undefined },
    { key: 'custody', label: tx.tabCustody, badge: assigned.length || undefined },
  ];

  const rows: [string, any][] = [
    [tx.jobTitle, e.jobTitle],
    [tx.department, e.department],
    [tx.employeeNumber, e.employeeNumber],
    [tx.nationality, e.nationality],
    [tx.iqama, e.iqamaNumber],
    [tx.nationalId, e.nationalId],
    [tx.hireDate, fmtDate(e.hireDate)],
    [tx.manager, userName(e.directManager)],
    [tx.phone, e.phone],
    [tx.email, e.email],
  ];
  const iqamaB = expiryBadge(e.iqamaExpiry, lang);

  const exportLeaves = () => exportToExcel(data.leaves, [
    { header: tx.colType, key: 'leaveType', transform: (v) => leaveTypeLabel(v, lang), width: 18 },
    { header: tx.colFrom, key: 'startDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.colTo, key: 'endDate', transform: (v) => fmtDate(v), width: 14 },
    { header: tx.colDays, key: 'days', width: 10 },
    { header: tx.colStatus, key: 'status', transform: (v) => (lang === 'ar' ? LEAVE_STATUS[v]?.ar : LEAVE_STATUS[v]?.en) || v, width: 14 },
  ], 'my-leaves', tx.tabLeaves);

  const exportCustody = () => exportToExcel(data.assets, [
    { header: tx.colItem, key: 'name', width: 22 },
    { header: tx.colType, key: 'type', transform: (v) => assetTypeLabel(v, lang), width: 16 },
    { header: tx.colSerial, key: 'serialNumber', transform: (v) => v || '—', width: 18 },
    { header: tx.colStatus, key: 'status', transform: (v) => v === 'assigned' ? tx.badgeAssigned : tx.badgeReturned, width: 14 },
  ], 'my-custody', tx.tabCustody);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Briefcase className="w-5 h-5" />} title={tx.myProfile} />

      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-4 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-[#f37121]/20 flex items-center justify-center text-[#f37121] text-2xl font-bold">{empName(e).charAt(0)}</div>
        <div>
          <div className="flex items-center gap-3 flex-wrap"><h1 className="text-2xl font-bold text-slate-900">{empName(e, lang)}</h1><Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} /></div>
          <p className="text-slate-500 text-sm mt-1">{e.jobTitle || '—'}</p>
        </div>
      </div>

      {b && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={tx.annual} value={`${b.entitlement} ${tx.dayUnit}`} />
          <StatCard label={tx.accrued} value={`${b.accrued} ${tx.dayUnit}`} accent="text-blue-600" />
          <StatCard label={tx.taken} value={`${b.taken} ${tx.dayUnit}`} accent="text-amber-700" />
          <StatCard label={tx.available} value={`${b.available} ${tx.dayUnit}`} accent={b.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 shadow-sm">
          {rows.filter(([, v]) => v && v !== '—').map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-slate-200/70 pb-2"><span className="text-slate-500 text-sm">{k}</span><span className="text-slate-900 text-sm text-end">{v}</span></div>
          ))}
          {e.iqamaExpiry && <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-2"><span className="text-slate-500 text-sm">{tx.iqamaExpiry}</span><span className="text-slate-900 text-sm flex items-center gap-2">{fmtDate(e.iqamaExpiry)} {iqamaB && <SmallBadge bg={iqamaB.bg} text={iqamaB.text} label={iqamaB.label} />}</span></div>}
          {data.activeContract && <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-2"><span className="text-slate-500 text-sm">{tx.currentContract}</span><span className="text-slate-900 text-sm text-end">{fmtDate(data.activeContract.startDate)} → {data.activeContract.endDate ? fmtDate(data.activeContract.endDate) : tx.unlimited}</span></div>}
        </div>
      )}

      {tab === 'leaves' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {data.leaves.length > 0 && (
            <div className="flex justify-end p-3 border-b border-slate-200">
              <ExportButton onClick={exportLeaves} label={lang === 'ar' ? 'تصدير Excel' : 'Export Excel'} />
            </div>
          )}
          <div className="overflow-x-auto">
          {data.leaves.length === 0 ? <p className="text-center text-slate-500 py-10">{tx.noLeaves}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300"><th className="text-start px-4 py-3 font-semibold">{tx.colType}</th><th className="text-start px-4 py-3 font-semibold">{tx.colFrom}</th><th className="text-start px-4 py-3 font-semibold">{tx.colTo}</th><th className="text-start px-4 py-3 font-semibold">{tx.colDays}</th><th className="text-start px-4 py-3 font-semibold">{tx.colStatus}</th></tr></thead>
              <tbody>{data.leaves.map((l) => (
                <tr key={l._id} className="border-b border-slate-200/70"><td className="px-4 py-3 text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</td><td className="px-4 py-3 text-slate-700">{fmtDate(l.startDate)}</td><td className="px-4 py-3 text-slate-700">{fmtDate(l.endDate)}</td><td className="px-4 py-3 text-slate-700">{l.days}</td><td className="px-4 py-3"><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></td></tr>
              ))}</tbody>
            </table>
          )}
          </div>
        </div>
      )}

      {tab === 'custody' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {data.assets.length > 0 && (
            <div className="flex justify-end p-3 border-b border-slate-200">
              <ExportButton onClick={exportCustody} label={lang === 'ar' ? 'تصدير Excel' : 'Export Excel'} />
            </div>
          )}
          <div className="overflow-x-auto">
          {data.assets.length === 0 ? <p className="text-center text-slate-500 py-10">{tx.noCustody}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300"><th className="text-start px-4 py-3 font-semibold">{tx.colItem}</th><th className="text-start px-4 py-3 font-semibold">{tx.colType}</th><th className="text-start px-4 py-3 font-semibold">{tx.colSerial}</th><th className="text-start px-4 py-3 font-semibold">{tx.colStatus}</th></tr></thead>
              <tbody>{data.assets.map((a) => (
                <tr key={a._id} className="border-b border-slate-200/70"><td className="px-4 py-3 text-slate-900">{a.name}</td><td className="px-4 py-3 text-slate-700">{assetTypeLabel(a.type, lang)}</td><td className="px-4 py-3 text-slate-700">{a.serialNumber || '—'}</td><td className="px-4 py-3">{a.status === 'assigned' ? <SmallBadge bg="bg-amber-500/20" text="text-amber-700" label={tx.badgeAssigned} /> : <SmallBadge bg="bg-green-500/20" text="text-green-600" label={tx.badgeReturned} />}</td></tr>
              ))}</tbody>
            </table>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
