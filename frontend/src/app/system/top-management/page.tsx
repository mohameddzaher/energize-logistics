'use client';
// Top management: every leave request in the company. It decides the last stage, after the direct manager and HR; the rest is read to follow where each request stands.
import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Check, X, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import { bothDatesShort } from '@/lib/hrDates';

type Decision = { by?: { firstName?: string; lastName?: string }; at?: string; decision?: string; note?: string };
type Leave = {
  _id: string; status: string; currentStage: string; days: number; startDate: string; endDate: string; reason?: string;
  employee?: { firstName?: string; lastName?: string; arabicName?: string; employeeNumber?: string; department?: string; jobTitle?: string };
  leaveType?: { nameAr?: string; nameEn?: string; color?: string };
  managerDecision?: Decision; hrDecision?: Decision; executiveDecision?: Decision; createdAt: string;
};

const STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  pending_manager: { ar: 'عند المدير المباشر', en: 'With manager', cls: 'bg-amber-100 text-amber-800' },
  pending_hr: { ar: 'عند الموارد البشرية', en: 'With HR', cls: 'bg-blue-100 text-blue-800' },
  pending_finance: { ar: 'عند الحسابات', en: 'With finance', cls: 'bg-cyan-100 text-cyan-800' },
  pending_executive: { ar: 'تنتظر قرارك', en: 'Awaiting you', cls: 'bg-orange-100 text-orange-800' },
  info_requested: { ar: 'عند الموظف للرد', en: 'With employee', cls: 'bg-slate-100 text-slate-700' },
  approved: { ar: 'معتمدة', en: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { ar: 'مرفوضة', en: 'Rejected', cls: 'bg-red-100 text-red-700' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled', cls: 'bg-slate-100 text-slate-500' },
};
const TABS = [
  { key: 'awaiting', ar: 'تنتظر قرار الإدارة العليا', en: 'Awaiting top management', statuses: ['pending_executive'] },
  { key: 'in_chain', ar: 'قيد المسار', en: 'In the chain', statuses: ['pending_manager', 'pending_hr', 'pending_finance', 'info_requested'] },
  { key: 'approved', ar: 'معتمدة', en: 'Approved', statuses: ['approved'] },
  { key: 'rejected', ar: 'مرفوضة', en: 'Rejected', statuses: ['rejected'] },
  { key: 'all', ar: 'الكل', en: 'All', statuses: [] as string[] },
];

const nameOf = (u?: { firstName?: string; lastName?: string } | null) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

export default function TopManagementLeavesPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, prompt } = useDialog();
  const [tab, setTab] = useState('awaiting');
  const [rows, setRows] = useState<Leave[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ leaves: Leave[]; counts: Record<string, number> }>(`/api/top-management/leaves?tab=${tab}`);
      setRows(d.leaves || []); setCounts(d.counts || {});
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [tab, notify]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useSocket('hr:leave', useCallback(() => { load(); }, [load]));

  // role-only: the last leave stage belongs to the named top-management accounts (and super admins), not to a section grant.
  const canDecide = user?.isTopManagement === true || ['super_admin', 'admin'].includes(user?.role || '');
  const decide = async (l: Leave, decision: 'approved' | 'rejected') => {
    let note = '';
    if (decision === 'rejected') {
      const v = await prompt(t('سبب الرفض', 'Reason for rejection'));
      if (v === null) return;
      note = v;
    }
    setBusy(l._id);
    try {
      await api.patch(`/api/hr/leaves/${l._id}/decision`, { decision, note });
      notify(decision === 'approved' ? t('اعتُمدت الإجازة', 'Leave approved') : t('رُفضت الإجازة', 'Leave rejected'), 'success');
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(null);
  };

  const countOf = (statuses: string[]) => (statuses.length ? statuses.reduce((n, s) => n + (counts[s] || 0), 0)
    : Object.values(counts).reduce((a, b) => a + b, 0));
  const decisionCell = (d?: Decision) => (d?.at ? (
    <span className={`text-xs ${d.decision === 'rejected' ? 'text-red-600' : 'text-emerald-700'}`}>
      {d.decision === 'rejected' ? t('رفض', 'Rejected') : t('وافق', 'Approved')} · {nameOf(d.by) || '—'}
      <span className="block text-[11px] text-slate-400" dir="ltr">{new Date(d.at).toLocaleDateString('en-GB')}</span>
    </span>
  ) : <span className="text-xs text-slate-300">—</span>);

  return (
    <div className="space-y-4">
      <PageHeader icon={<CalendarCheck className="w-6 h-6" />} title={t('طلبات الإجازات — الإدارة العليا', 'Leave Requests — Top Management')}
        subtitle={t('كل إجازات الشركة. القرار الأخير هنا بعد موافقة المدير المباشر ثم الموارد البشرية.', 'Every leave in the company. The final decision is made here, after the direct manager and HR.')} />

      <div className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x.key} type="button" onClick={() => setTab(x.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold ${tab === x.key ? 'bg-[#12325C] text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
            {ar ? x.ar : x.en} <span className="tabular-nums">{countOf(x.statuses).toLocaleString('en-US')}</span>
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">{t('لا توجد طلبات هنا', 'Nothing here')}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <ScrollX>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-xs">
                  {[t('الموظف', 'Employee'), t('القسم', 'Department'), t('النوع', 'Type'), t('المدة', 'Period'), t('الأيام', 'Days'),
                    t('المدير المباشر', 'Direct manager'), t('الموارد البشرية', 'HR'), t('الإدارة العليا', 'Top management'), t('الحالة', 'Status'), '']
                    .map((h, i) => <th key={i} className="px-3 py-3 text-start font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((l) => {
                  const st = STATUS[l.status] || { ar: l.status, en: l.status, cls: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr key={l._id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-slate-900 whitespace-nowrap">{l.employee?.arabicName || nameOf(l.employee) || '—'}</p>
                        <p className="text-[11px] text-slate-500">{[l.employee?.employeeNumber, l.employee?.jobTitle].filter(Boolean).join(' · ')}</p>
                        {l.reason && <p className="text-[11px] text-slate-500 max-w-[260px] truncate" title={l.reason}>{l.reason}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{l.employee?.department || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{(ar ? l.leaveType?.nameAr : l.leaveType?.nameEn) || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-700 whitespace-nowrap">
                        <span className="block">{t('من', 'From')} {bothDatesShort(l.startDate, ar)}</span>
                        <span className="block">{t('إلى', 'To')} {bothDatesShort(l.endDate, ar)}</span>
                      </td>
                      <td className="px-3 py-2.5 font-bold tabular-nums">{l.days}</td>
                      <td className="px-3 py-2.5">{decisionCell(l.managerDecision)}</td>
                      <td className="px-3 py-2.5">{decisionCell(l.hrDecision)}</td>
                      <td className="px-3 py-2.5">{decisionCell(l.executiveDecision)}</td>
                      <td className="px-3 py-2.5"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${st.cls}`}>{ar ? st.ar : st.en}</span></td>
                      <td className="px-3 py-2.5">
                        {canDecide && l.status === 'pending_executive' && (
                          <div className="flex items-center gap-1.5">
                            <button type="button" disabled={busy === l._id} onClick={() => decide(l, 'approved')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
                              {busy === l._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{t('اعتماد', 'Approve')}
                            </button>
                            <button type="button" disabled={busy === l._id} onClick={() => decide(l, 'rejected')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 disabled:opacity-50">
                              <X className="w-3.5 h-3.5" />{t('رفض', 'Reject')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}
    </div>
  );
}
