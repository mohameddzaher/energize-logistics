'use client';
/**
 * Carrier approvals: carriers the team added wait here until the operations manager (or a member he delegates)
 * reviews the file and papers, then approves, rejects or returns them for edits. Only approved carriers are offered
 * in pickers. Live: a new submission or decision refreshes the list.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { LiveDot, fmtDay } from '@/components/analytics/AnalyticsKit';
import { ApprovalBlock } from '@/components/vendors/VendorFilesPanel';
import { APPROVAL, approvalLabel, docKindLabel, canEditVendors } from '@/lib/vendors';
import { useAuth } from '@/context/AuthContext';
import { ClipboardCheck, FileText, AlertTriangle } from 'lucide-react';

type Row = Record<string, any>;
const TABS = ['pending', 'returned', 'rejected', 'approved'] as const;

export default function VendorApprovalsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [status, setStatus] = useState<(typeof TABS)[number]>('pending');
  const [d, setD] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const my = guard.begin(); setBusy(true);
    try { const r = await api.get<Row>(`/api/vendors-mgmt/approvals?status=${status}`); if (guard.isCurrent(my)) { setD(r); setError(''); } }
    catch (e: any) { if (guard.isCurrent(my)) setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    if (guard.isCurrent(my)) setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 700); }, [load]);
  useSocket('vendors:changed', soon);

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const editor = canEditVendors(user);

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardCheck className="w-6 h-6 text-[#f37121]" />} title={t('اعتماد الموردين', 'Carrier approvals')}
        subtitle={d.canApprove ? t('راجِع ملفَّ المورّد ومستنداتِه ثمّ اعتمِده أو أعِده للتعديل أو ارفضه', 'Review the file and papers, then approve, return or reject')
          : t('الموردون الذين أضفتموهم ينتظرون اعتماد مدير العمليات أو من يفوّضه', 'Carriers you added wait for the operations manager or his delegates')}>
        <LiveDot ar={ar} busy={busy} />
        <ExportMenu fileName="vendor-approvals" lang={ar ? 'ar' : 'en'} options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: approvalLabel(status, ar), rows: d.vendors, columns: [
          { header: t('المورّد', 'Carrier'), key: 'name', width: 34 }, { header: t('الحالة', 'Status'), key: 'approvalStatus', transform: (v: string) => approvalLabel(v, ar) },
          { header: t('أضافه', 'Added by'), key: 'submittedByName' }, { header: t('تاريخ التقديم', 'Submitted'), key: 'submittedAt', transform: (v: string) => fmtDay(v) },
          { header: t('صاحب المنشأة', 'Owner'), key: 'ownerName' }, { header: t('جوال صاحب المنشأة', 'Owner mobile'), key: 'ownerPhone' },
          { header: t('المشغّل', 'Operator'), key: 'operatorName' }, { header: t('جوال المشغّل', 'Operator mobile'), key: 'operatorPhone' },
          { header: t('المستندات الناقصة', 'Missing papers'), key: 'missingDocs', transform: (v: Row[]) => (v || []).map((m) => (ar ? m.label : m.labelEn)).join('، ') },
          { header: t('الملاحظة', 'Note'), key: 'rejectNote' },
        ] }] }]} />
      </PageHeader>
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((k) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold border ${status === k ? 'bg-slate-900 text-white border-slate-900' : `${APPROVAL[k].cls}`}`}>
            {approvalLabel(k, ar)}{k !== 'approved' && <span className="ms-1.5 tabular-nums opacity-70">{d.counts?.[k] ?? 0}</span>}
          </button>
        ))}
      </div>
      {!d.vendors.length && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">{t('لا موردين في هذه القائمة', 'Nobody in this list')}</p>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {d.vendors.map((v: Row) => (
          <section key={v._id} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/system/vendors-mgmt/vendors/${v._id}`} className="text-lg font-extrabold text-slate-900 hover:text-[#f37121]">{v.name}</Link>
              {v.inMaster && <span className="px-2 py-0.5 rounded-full border border-orange-200 bg-orange-50 text-orange-800 text-[11px] font-semibold">{t('ضمن القائمة المعتمدة', 'On the master')}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
              {([['ownerName', 'صاحب المنشأة', 'Owner'], ['ownerPhone', 'جوال صاحب المنشأة', 'Owner mobile'], ['operatorName', 'المشغّل', 'Operator'], ['operatorPhone', 'جوال المشغّل', 'Operator mobile'], ['phone', 'جوال المنشأة', 'Company phone'], ['followOwner', 'مسؤول المتابعة', 'Follow-up owner']] as const).map(([k, a, e]) => (
                <div key={k}><dt className="text-slate-500">{ar ? a : e}</dt><dd className="font-semibold text-slate-900">{v[k] || '—'}</dd></div>
              ))}
            </dl>
            {!!v.missingDocs?.length && <p className="flex items-center gap-1.5 text-[12.5px] text-red-700"><AlertTriangle className="w-4 h-4" />{t('ناقص: ', 'Missing: ')}{v.missingDocs.map((m: Row) => (ar ? m.label : m.labelEn)).join('، ')}</p>}
            <ul className="flex flex-wrap gap-1.5">
              {(v.documents || []).map((f: Row) => (
                <li key={f._id}><a href={f.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] text-sky-700 hover:underline">
                  <FileText className="w-3.5 h-3.5" />{f.kind === 'other' ? f.title : docKindLabel(f.kind, ar)}{f.fileName ? ` · ${f.fileName}` : ''}</a></li>
              ))}
            </ul>
            <ApprovalBlock ar={ar} editor={editor} onChanged={load}
              d={{ vendor: v, approval: { status: v.approvalStatus, note: v.rejectNote, submittedByName: v.submittedByName, submittedAt: v.submittedAt, approvedByName: v.approvedByName, approvedAt: v.approvedAt, log: v.approvalLog, canApprove: d.canApprove } }} />
          </section>
        ))}
      </div>
    </div>
  );
}
