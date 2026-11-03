'use client';
// Top management: every staff request to HR across the company (letters, documents…), with where each one stands.
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';

type Req = {
  _id: string; subject?: string; category?: string; type?: string; status: string; createdAt: string; updatedAt?: string;
  requester?: { firstName?: string; lastName?: string; email?: string };
  assignedTo?: { firstName?: string; lastName?: string };
  thread?: { body?: string; sender?: { firstName?: string; lastName?: string }; at?: string }[];
};

const STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  open: { ar: 'جديد', en: 'Open', cls: 'bg-orange-100 text-orange-800' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress', cls: 'bg-blue-100 text-blue-800' },
  received: { ar: 'تم الاستلام', en: 'Received', cls: 'bg-cyan-100 text-cyan-800' },
  resolved: { ar: 'مُنجز', en: 'Resolved', cls: 'bg-emerald-100 text-emerald-800' },
  closed: { ar: 'مغلق', en: 'Closed', cls: 'bg-slate-100 text-slate-600' },
};
const TABS = [
  { key: 'open', ar: 'مفتوحة', en: 'Open', statuses: ['open', 'in_progress', 'received'] },
  { key: 'resolved', ar: 'منجزة', en: 'Resolved', statuses: ['resolved'] },
  { key: 'closed', ar: 'مغلقة', en: 'Closed', statuses: ['closed'] },
  { key: '', ar: 'الكل', en: 'All', statuses: [] as string[] },
];
const CATEGORY: Record<string, { ar: string; en: string }> = {
  salary_certificate: { ar: 'تعريف بالراتب', en: 'Salary certificate' },
  letter: { ar: 'خطاب', en: 'Letter' },
  document: { ar: 'مستند', en: 'Document' },
  data_update: { ar: 'تحديث بيانات', en: 'Data update' },
  complaint: { ar: 'شكوى', en: 'Complaint' },
  other: { ar: 'أخرى', en: 'Other' },
};
const nameOf = (u?: { firstName?: string; lastName?: string } | null) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

export default function TopManagementRequestsPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState<Req[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ requests: Req[]; counts: Record<string, number> }>(`/api/top-management/requests${tab ? `?status=${tab}` : ''}`);
      setRows(d.requests || []); setCounts(d.counts || {});
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [tab, notify]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useSocket('hr:request', useCallback(() => { load(); }, [load]));

  const countOf = (statuses: string[]) => (statuses.length ? statuses.reduce((n, s) => n + (counts[s] || 0), 0)
    : Object.values(counts).reduce((a, b) => a + b, 0));

  return (
    <div className="space-y-4">
      <PageHeader icon={<MessageSquare className="w-6 h-6" />} title={t('طلبات الموظفين — الإدارة العليا', 'Staff Requests — Top Management')}
        subtitle={t('كل ما طلبه الموظفون من الموارد البشرية (أوراق، خطابات، مستندات…) وحالته الآن.', 'Everything staff asked HR for (letters, documents…) and where it stands.')} />
      <div className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x.key || 'all'} type="button" onClick={() => setTab(x.key)}
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
                  {[t('الموظف', 'Employee'), t('الطلب', 'Request'), t('آخر رد', 'Last reply'), t('المسؤول', 'Assigned to'), t('التاريخ', 'Date'), t('الحالة', 'Status')]
                    .map((h, i) => <th key={i} className="px-3 py-3 text-start font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const st = STATUS[r.status] || { ar: r.status, en: r.status, cls: 'bg-slate-100 text-slate-700' };
                  const last = r.thread && r.thread.length ? r.thread[r.thread.length - 1] : null;
                  return (
                    <tr key={r._id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-slate-900">{nameOf(r.requester) || '—'}</p>
                        <p className="text-[11px] text-slate-500">{r.requester?.email || ''}</p>
                      </td>
                      <td className="px-3 py-2.5 max-w-[320px]">
                        <p className="font-medium text-slate-800 truncate" title={r.subject}>{r.subject || '—'}</p>
                        {r.category && <p className="text-[11px] text-slate-500">{(ar ? CATEGORY[r.category]?.ar : CATEGORY[r.category]?.en) || r.category}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[260px]">
                        {last ? <><span className="font-semibold">{nameOf(last.sender)}</span> <span className="truncate inline-block max-w-[200px] align-bottom">{last.body || ''}</span></> : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-700 whitespace-nowrap">{nameOf(r.assignedTo) || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap" dir="ltr">{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
                      <td className="px-3 py-2.5"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${st.cls}`}>{ar ? st.ar : st.en}</span></td>
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
