'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  isHRStaff, Employee, Contract, LeaveRequest, Asset, HRRequest, LeaveBalance,
  empName, userName, fmtDate, fmtDateTime, leaveTypeLabel, expiryBadge,
  EMPLOYMENT_STATUS, CONTRACT_STATUS, LEAVE_STATUS, REQUEST_STATUS, assetTypeLabel, conditionLabel,
} from '@/lib/hr';
import { Spinner, Badge, SmallBadge, Tabs, StatCard } from '@/components/hr/HRKit';

interface Profile {
  employee: Employee | null;
  contracts: Contract[];
  activeContract: Contract | null;
  balance: LeaveBalance | null;
  leaves: LeaveRequest[];
  assets: Asset[];
  requests: HRRequest[];
}

export default function EmployeeProfilePage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const Back = isRTL ? ArrowRight : ArrowLeft;

  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  const load = useCallback(async () => {
    try {
      const d = await api.get<Profile>(`/api/hr/employees/${id}`);
      setData(d);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('hr:leave', useCallback(() => load(), [load]));
  useSocket('hr:asset', useCallback(() => load(), [load]));
  useSocket('hr:contract', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!data?.employee) return <div className="text-slate-500 p-8">{ar ? 'الموظف غير موجود' : 'Employee not found'}</div>;

  const e = data.employee;
  const b = data.balance;
  const assignedAssets = data.assets.filter((a) => a.status === 'assigned');

  const tabs = [
    { key: 'overview', label: ar ? 'نظرة عامة' : 'Overview' },
    { key: 'leaves', label: ar ? 'الإجازات' : 'Leaves', badge: data.leaves.length || undefined },
    { key: 'custody', label: ar ? 'العهد' : 'Custody', badge: assignedAssets.length || undefined },
    { key: 'contracts', label: ar ? 'العقود' : 'Contracts', badge: data.contracts.length || undefined },
    { key: 'requests', label: ar ? 'الطلبات' : 'Requests', badge: data.requests.length || undefined },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm"><Back className="w-4 h-4" /> {ar ? 'رجوع' : 'Back'}</button>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-[#f37121]/20 flex items-center justify-center text-[#f37121] text-2xl font-bold">
          {empName(e).charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{empName(e, lang)}</h1>
            <Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} />
          </div>
          <p className="text-slate-500 text-sm mt-1">{e.jobTitle || '—'} {e.department ? `· ${e.department}` : ''} {e.employeeNumber ? `· #${e.employeeNumber}` : ''}</p>
          <p className="text-slate-500 text-xs mt-1">
            {e.user ? (ar ? `مرتبط بحساب: ${userName(e.user)}` : `Linked login: ${userName(e.user)}`) : (ar ? 'غير مرتبط بحساب دخول' : 'No login linked')}
          </p>
        </div>
      </div>

      {/* Leave balance stats */}
      {b && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={ar ? 'الاستحقاق السنوي' : 'Annual Entitlement'} value={`${b.entitlement} ${ar ? 'يوم' : 'd'}`} />
          <StatCard label={ar ? 'المتراكم حتى اليوم' : 'Accrued to date'} value={`${b.accrued} ${ar ? 'يوم' : 'd'}`} accent="text-blue-600" />
          <StatCard label={ar ? 'المستخدم' : 'Taken'} value={`${b.taken} ${ar ? 'يوم' : 'd'}`} accent="text-amber-700" />
          <StatCard label={ar ? 'الرصيد المتاح' : 'Available'} value={`${b.available} ${ar ? 'يوم' : 'd'}`} accent={b.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <Overview e={e} ar={ar} lang={lang} />}

      {tab === 'leaves' && (
        <DataCard empty={!data.leaves.length} emptyText={ar ? 'لا توجد إجازات' : 'No leaves'}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{ar ? 'النوع' : 'Type'}</Th><Th>{ar ? 'من' : 'From'}</Th><Th>{ar ? 'إلى' : 'To'}</Th><Th>{ar ? 'الأيام' : 'Days'}</Th><Th>{ar ? 'الحالة' : 'Status'}</Th><Th>{ar ? 'التاريخ' : 'Submitted'}</Th>
            </tr></thead>
            <tbody>{data.leaves.map((l) => (
              <Tr key={l._id}>
                <Td className="text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</Td>
                <Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                <Td><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></Td>
                <Td>{fmtDate(l.createdAt)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}

      {tab === 'custody' && (
        <DataCard empty={!data.assets.length} emptyText={ar ? 'لا توجد عهد' : 'No custody items'}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{ar ? 'العهدة' : 'Item'}</Th><Th>{ar ? 'النوع' : 'Type'}</Th><Th>{ar ? 'الرقم التسلسلي' : 'Serial'}</Th><Th>{ar ? 'الحالة' : 'Condition'}</Th><Th>{ar ? 'الحالة' : 'Status'}</Th><Th>{ar ? 'تاريخ الاستلام' : 'Assigned'}</Th>
            </tr></thead>
            <tbody>{data.assets.map((a) => (
              <Tr key={a._id}>
                <Td className="text-slate-900">{a.name}</Td><Td>{assetTypeLabel(a.type, lang)}</Td><Td>{a.serialNumber || '—'}</Td>
                <Td>{a.condition ? conditionLabel(a.condition, lang) : '—'}</Td>
                <Td>{a.status === 'assigned' ? <SmallBadge bg="bg-amber-500/20" text="text-amber-700" label={ar ? 'بعهدته' : 'Assigned'} /> : <SmallBadge bg="bg-green-500/20" text="text-green-600" label={ar ? 'تم تسليمها' : 'Returned'} />}</Td>
                <Td>{fmtDate(a.assignedDate)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}

      {tab === 'contracts' && (
        <DataCard empty={!data.contracts.length} emptyText={ar ? 'لا توجد عقود' : 'No contracts'}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{ar ? 'النوع' : 'Type'}</Th><Th>{ar ? 'من' : 'Start'}</Th><Th>{ar ? 'إلى' : 'End'}</Th><Th>{ar ? 'إجازة سنوية' : 'Annual Leave'}</Th><Th>{ar ? 'الراتب' : 'Salary'}</Th><Th>{ar ? 'الحالة' : 'Status'}</Th>
            </tr></thead>
            <tbody>{data.contracts.map((c) => (
              <Tr key={c._id}>
                <Td className="text-slate-900">{c.type === 'unlimited' ? (ar ? 'غير محدد' : 'Unlimited') : (ar ? 'محدد المدة' : 'Fixed')}</Td>
                <Td>{fmtDate(c.startDate)}</Td><Td>{c.endDate ? fmtDate(c.endDate) : '—'}</Td>
                <Td>{c.annualLeaveDays} {ar ? 'يوم' : 'd'}</Td><Td>{(c.basicSalary || 0).toLocaleString()}</Td>
                <Td><Badge style={CONTRACT_STATUS[c.status]} lang={lang} /></Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}

      {tab === 'requests' && (
        <DataCard empty={!data.requests.length} emptyText={ar ? 'لا توجد طلبات' : 'No requests'}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{ar ? 'الموضوع' : 'Subject'}</Th><Th>{ar ? 'الحالة' : 'Status'}</Th><Th>{ar ? 'التاريخ' : 'Date'}</Th>
            </tr></thead>
            <tbody>{data.requests.map((r) => (
              <Tr key={r._id}>
                <Td className="text-slate-900">{r.subject}</Td>
                <Td><Badge style={REQUEST_STATUS[r.status]} lang={lang} /></Td>
                <Td>{fmtDateTime(r.createdAt)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}
    </div>
  );
}

function Overview({ e, ar, lang }: { e: Employee; ar: boolean; lang: 'en' | 'ar' }) {
  const rows: [string, any][] = [
    [ar ? 'الاسم بالعربي' : 'Arabic Name', e.arabicName],
    [ar ? 'الجنسية' : 'Nationality', e.nationality],
    [ar ? 'الجنس' : 'Gender', e.gender ? (e.gender === 'male' ? (ar ? 'ذكر' : 'Male') : (ar ? 'أنثى' : 'Female')) : ''],
    [ar ? 'تاريخ الميلاد' : 'Date of Birth', fmtDate(e.dateOfBirth)],
    [ar ? 'نوع الهوية' : 'ID Type', e.idType === 'national_id' ? (ar ? 'هوية وطنية' : 'National ID') : (ar ? 'إقامة' : 'Iqama')],
    [ar ? 'رقم الإقامة' : 'Iqama Number', e.iqamaNumber],
    [ar ? 'رقم الهوية' : 'National ID', e.nationalId],
    [ar ? 'رقم الجواز' : 'Passport', e.passportNumber],
    [ar ? 'رقم عقد قوى' : 'Qiwa Contract', e.qiwaContractNumber],
    [ar ? 'رقم التأمينات' : 'GOSI #', e.gosiNumber],
    [ar ? 'حالة أبشر' : 'Absher Status', e.absherStatus],
    [ar ? 'الكفيل' : 'Sponsor', e.sponsorName],
    [ar ? 'تاريخ التعيين' : 'Hire Date', fmtDate(e.hireDate)],
    [ar ? 'مكان العمل' : 'Work Location', e.workLocation],
    [ar ? 'المدير المباشر' : 'Direct Manager', userName(e.directManager)],
    [ar ? 'الجوال' : 'Phone', e.phone],
    [ar ? 'البريد' : 'Email', e.email],
    [ar ? 'العنوان' : 'Address', e.address],
    [ar ? 'جهة الطوارئ' : 'Emergency Contact', e.emergencyContactName ? `${e.emergencyContactName} ${e.emergencyContactPhone || ''}` : ''],
    [ar ? 'الراتب الأساسي' : 'Basic Salary', e.basicSalary ? e.basicSalary.toLocaleString() : ''],
  ];
  const iqamaB = expiryBadge(e.iqamaExpiry, lang);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
        {rows.filter(([, v]) => v && v !== '—').map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-slate-200/70 pb-2">
            <span className="text-slate-500 text-sm">{k}</span>
            <span className="text-slate-900 text-sm text-end">{v}</span>
          </div>
        ))}
        {e.iqamaExpiry && (
          <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-2">
            <span className="text-slate-500 text-sm">{ar ? 'انتهاء الإقامة' : 'Iqama Expiry'}</span>
            <span className="text-slate-900 text-sm flex items-center gap-2">{fmtDate(e.iqamaExpiry)} {iqamaB && <SmallBadge bg={iqamaB.bg} text={iqamaB.text} label={iqamaB.label} />}</span>
          </div>
        )}
      </div>
      {e.notes && <p className="text-slate-500 text-sm mt-4 border-t border-slate-200 pt-4">{e.notes}</p>}
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="text-start font-medium px-4 py-3">{children}</th>;
const Td = ({ children, className }: { children: React.ReactNode; className?: string }) => <td className={`px-4 py-3 text-slate-700 ${className || ''}`}>{children}</td>;
const Tr = ({ children }: { children: React.ReactNode }) => <tr className="border-b border-slate-200/70 hover:bg-slate-100">{children}</tr>;

function DataCard({ children, empty, emptyText }: { children: React.ReactNode; empty?: boolean; emptyText: string }) {
  if (empty) return <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 shadow-sm">{emptyText}</div>;
  return <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">{children}</div>;
}
