'use client';
// One stage's leave desk: every leave in the company, with this stage's own decisions. Finance, top management and the chairman each mount it on their API (backend routes/leaveDesk), so the three screens stay the same.
import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Check, X, Loader2, FileDown } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import { DeductionBadge } from '@/components/hr/LeaveDeduction';
import { bothDatesShort } from '@/lib/hrDates';
import { LEAVE_STAGES, LEAVE_STATUS, LEAVE_OPEN, LeaveStage, leaveWaitNote } from '@/lib/hr';
import { downloadLeaveSheet } from '@/lib/leavePdf';

type Decision = { by?: { firstName?: string; lastName?: string }; at?: string; decision?: string; note?: string };
type Leave = {
  _id: string; status: string; currentStage: string; days: number; startDate: string; endDate: string; reason?: string;
  employee?: { firstName?: string; lastName?: string; arabicName?: string; employeeNumber?: string; department?: string; jobTitle?: string };
  leaveType?: { nameAr?: string; nameEn?: string; color?: string };
  createdAt: string;
  [k: string]: any;
};

const nameOf = (u?: { firstName?: string; lastName?: string } | null) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

export default function LeaveDesk({ base, stage, canDecide, title, subtitle }: {
  base: string; stage: LeaveStage; canDecide: boolean;
  title: { ar: string; en: string }; subtitle: { ar: string; en: string };
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, prompt } = useDialog();
  const [tab, setTab] = useState('awaiting');
  const [rows, setRows] = useState<Leave[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const awaiting = `pending_${stage}`;
  const stageName = LEAVE_STAGES.find((s) => s.key === stage);
  const TABS = [
    { key: 'awaiting', ar: `تنتظر ${stageName?.ar || ''}`, en: 'Awaiting you', statuses: [awaiting] },
    { key: 'in_chain', ar: 'قيد المسار', en: 'In the chain', statuses: [...LEAVE_STAGES.map((s) => `pending_${s.key}`).filter((s) => s !== awaiting), 'info_requested'] },
    { key: 'approved', ar: 'معتمدة', en: 'Approved', statuses: ['approved'] },
    { key: 'rejected', ar: 'مرفوضة', en: 'Rejected', statuses: ['rejected'] },
    { key: 'all', ar: 'الكل', en: 'All', statuses: [] as string[] },
  ];

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ leaves: Leave[]; counts: Record<string, number> }>(`${base}/leaves?tab=${tab}`);
      setRows(d.leaves || []); setCounts(d.counts || {});
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [base, tab, notify]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useSocket('hr:leave', useCallback(() => { load(); }, [load]));

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
      notify(decision === 'approved' ? t('تمت الموافقة ووُضع توقيعك', 'Approved and signed') : t('رُفضت الإجازة', 'Leave rejected'), 'success');
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(null);
  };
  const sheet = async (id: string) => {
    setPdfBusy(id);
    try { await downloadLeaveSheet(id); } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setPdfBusy(null);
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
      <PageHeader icon={<CalendarCheck className="w-6 h-6" />} title={ar ? title.ar : title.en} subtitle={ar ? subtitle.ar : subtitle.en} />

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
                    ...LEAVE_STAGES.map((s) => (ar ? s.ar : s.en)), t('الحالة', 'Status')]
                    .map((h, i) => <th key={i} className="px-3 py-3 text-start font-semibold whitespace-nowrap">{h}</th>)}
                  <th className="sticky end-0 z-20 bg-slate-900 border-s border-slate-600 px-3 py-3 text-start font-semibold whitespace-nowrap">{t('الإجراءات', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((l) => {
                  const st = LEAVE_STATUS[l.status] || { ar: l.status, en: l.status, bg: 'bg-slate-100', text: 'text-slate-700' };
                  return (
                    <tr key={l._id} className="group hover:bg-slate-50">
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
                      {LEAVE_STAGES.map((s) => (
                        <td key={s.key} className="px-3 py-2.5">
                          {decisionCell(l[s.decision as string])}
                          {s.key === 'hr' && <div className="mt-1 flex flex-wrap gap-1"><DeductionBadge leave={l as any} ar={ar} /></div>}
                        </td>
                      ))}
                      <td className="px-3 py-2.5"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${st.bg} ${st.text}`}>{ar ? st.ar : st.en}</span></td>
                      <td className="sticky end-0 z-10 bg-white group-hover:bg-slate-50 border-s border-slate-200 px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {canDecide && l.status === awaiting && (
                            <>
                              <button type="button" disabled={busy === l._id} onClick={() => decide(l, 'approved')}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
                                {busy === l._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{t('موافقة', 'Approve')}
                              </button>
                              <button type="button" disabled={busy === l._id} onClick={() => decide(l, 'rejected')}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 disabled:opacity-50">
                                <X className="w-3.5 h-3.5" />{t('رفض', 'Reject')}
                              </button>
                            </>
                          )}
                          {!(canDecide && l.status === awaiting) && LEAVE_OPEN.includes(l.status) && (
                            <span className="max-w-[240px] text-[11px] leading-snug text-slate-500">{leaveWaitNote(l, ar)}</span>
                          )}
                          <button type="button" title={t('ورقة الإجازة PDF', 'Leave sheet PDF')} onClick={() => sheet(l._id)} disabled={pdfBusy === l._id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-slate-600 text-xs disabled:opacity-50">
                            {pdfBusy === l._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
                          </button>
                        </div>
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
