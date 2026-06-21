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
import { Spinner, PageHeader, Badge, SmallBadge, Tabs, StatCard } from '@/components/hr/HRKit';

interface Me { employee: Employee | null; contracts: Contract[]; activeContract: Contract | null; balance: LeaveBalance | null; leaves: LeaveRequest[]; assets: Asset[]; }

export default function MyProfilePage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
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
        <PageHeader icon={<Briefcase className="w-5 h-5" />} title={ar ? 'ملفي' : 'My Profile'} />
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-xl p-6 text-sm">
          {ar ? 'حسابك غير مرتبط بملف موظف بعد. تواصل مع الموارد البشرية.' : 'Your account is not linked to an employee profile yet. Contact HR.'}
        </div>
      </div>
    );
  }

  const e = data.employee;
  const b = data.balance;
  const assigned = data.assets.filter((a) => a.status === 'assigned');
  const tabs = [
    { key: 'overview', label: ar ? 'بياناتي' : 'Overview' },
    { key: 'leaves', label: ar ? 'إجازاتي' : 'Leaves', badge: data.leaves.length || undefined },
    { key: 'custody', label: ar ? 'عهدي' : 'Custody', badge: assigned.length || undefined },
  ];

  const rows: [string, any][] = [
    [ar ? 'المسمى الوظيفي' : 'Job Title', e.jobTitle],
    [ar ? 'القسم' : 'Department', e.department],
    [ar ? 'رقم الموظف' : 'Employee #', e.employeeNumber],
    [ar ? 'الجنسية' : 'Nationality', e.nationality],
    [ar ? 'رقم الإقامة' : 'Iqama', e.iqamaNumber],
    [ar ? 'رقم الهوية' : 'National ID', e.nationalId],
    [ar ? 'تاريخ التعيين' : 'Hire Date', fmtDate(e.hireDate)],
    [ar ? 'المدير المباشر' : 'Manager', userName(e.directManager)],
    [ar ? 'الجوال' : 'Phone', e.phone],
    [ar ? 'البريد' : 'Email', e.email],
  ];
  const iqamaB = expiryBadge(e.iqamaExpiry, lang);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Briefcase className="w-5 h-5" />} title={ar ? 'ملفي' : 'My Profile'} />

      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-4 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-[#f37121]/20 flex items-center justify-center text-[#f37121] text-2xl font-bold">{empName(e).charAt(0)}</div>
        <div>
          <div className="flex items-center gap-3 flex-wrap"><h1 className="text-2xl font-bold text-slate-900">{empName(e, lang)}</h1><Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} /></div>
          <p className="text-slate-500 text-sm mt-1">{e.jobTitle || '—'}</p>
        </div>
      </div>

      {b && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={ar ? 'الاستحقاق السنوي' : 'Annual'} value={`${b.entitlement} ${ar ? 'يوم' : 'd'}`} />
          <StatCard label={ar ? 'المتراكم' : 'Accrued'} value={`${b.accrued} ${ar ? 'يوم' : 'd'}`} accent="text-blue-600" />
          <StatCard label={ar ? 'المستخدم' : 'Taken'} value={`${b.taken} ${ar ? 'يوم' : 'd'}`} accent="text-amber-700" />
          <StatCard label={ar ? 'المتاح' : 'Available'} value={`${b.available} ${ar ? 'يوم' : 'd'}`} accent={b.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 shadow-sm">
          {rows.filter(([, v]) => v && v !== '—').map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-slate-200/70 pb-2"><span className="text-slate-500 text-sm">{k}</span><span className="text-slate-900 text-sm text-end">{v}</span></div>
          ))}
          {e.iqamaExpiry && <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-2"><span className="text-slate-500 text-sm">{ar ? 'انتهاء الإقامة' : 'Iqama Expiry'}</span><span className="text-slate-900 text-sm flex items-center gap-2">{fmtDate(e.iqamaExpiry)} {iqamaB && <SmallBadge bg={iqamaB.bg} text={iqamaB.text} label={iqamaB.label} />}</span></div>}
          {data.activeContract && <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-2"><span className="text-slate-500 text-sm">{ar ? 'العقد الحالي' : 'Current Contract'}</span><span className="text-slate-900 text-sm text-end">{fmtDate(data.activeContract.startDate)} → {data.activeContract.endDate ? fmtDate(data.activeContract.endDate) : (ar ? 'غير محدد' : 'Unlimited')}</span></div>}
        </div>
      )}

      {tab === 'leaves' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          {data.leaves.length === 0 ? <p className="text-center text-slate-500 py-10">{ar ? 'لا توجد إجازات' : 'No leaves'}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300"><th className="text-start px-4 py-3 font-semibold">{ar ? 'النوع' : 'Type'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'من' : 'From'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'إلى' : 'To'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'الأيام' : 'Days'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'الحالة' : 'Status'}</th></tr></thead>
              <tbody>{data.leaves.map((l) => (
                <tr key={l._id} className="border-b border-slate-200/70"><td className="px-4 py-3 text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</td><td className="px-4 py-3 text-slate-700">{fmtDate(l.startDate)}</td><td className="px-4 py-3 text-slate-700">{fmtDate(l.endDate)}</td><td className="px-4 py-3 text-slate-700">{l.days}</td><td className="px-4 py-3"><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'custody' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          {data.assets.length === 0 ? <p className="text-center text-slate-500 py-10">{ar ? 'لا توجد عهد' : 'No custody items'}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300"><th className="text-start px-4 py-3 font-semibold">{ar ? 'العهدة' : 'Item'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'النوع' : 'Type'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'الرقم التسلسلي' : 'Serial'}</th><th className="text-start px-4 py-3 font-semibold">{ar ? 'الحالة' : 'Status'}</th></tr></thead>
              <tbody>{data.assets.map((a) => (
                <tr key={a._id} className="border-b border-slate-200/70"><td className="px-4 py-3 text-slate-900">{a.name}</td><td className="px-4 py-3 text-slate-700">{assetTypeLabel(a.type, lang)}</td><td className="px-4 py-3 text-slate-700">{a.serialNumber || '—'}</td><td className="px-4 py-3">{a.status === 'assigned' ? <SmallBadge bg="bg-amber-500/20" text="text-amber-700" label={ar ? 'بعهدتي' : 'Assigned'} /> : <SmallBadge bg="bg-green-500/20" text="text-green-600" label={ar ? 'سُلّمت' : 'Returned'} />}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
