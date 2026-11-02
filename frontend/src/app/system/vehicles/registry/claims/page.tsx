'use client';
// Accidents and insurance claims: the question here is money, how much we paid and how much we will recover.
// Warning: this page is distinct from authorization accidents in the same section. That one records the accident operationally (which driver, under which authorization); this one tracks the claim: fault percentage, Najm number, insurer, estimate, and recovered amount.
import { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { formatPlate } from '@/lib/flexMatch';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, SearchableSelect } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  TriangleAlert, Search, ArrowRight, Clock, Plus, Pencil, Trash2, X, Paperclip,
} from 'lucide-react';
import { LEAD, LEAD_CELL, LEAD_2, useLeadOffset } from '@/components/vehicles/stickyLead';
import { useAuth } from '@/context/AuthContext';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import {
  getClaims, money, fmtDate, canEditVehicles, canEditClaims,
  createClaim, updateClaim, deleteClaim,
} from '@/lib/vehicleRegistry';
import ScrollX from '@/components/system/ScrollX';
import ClaimAttachments from '@/components/vehicles/ClaimAttachments';
import PersonLookup from '@/components/vehicles/PersonLookup';
import api from '@/lib/api';

// Accident table columns and each column's reader: one definition for header and filter.
const COL_DEFS: [string, string, string][] = [
  ['plate', 'اللوحة', 'Plate'],
  ['date', 'التاريخ', 'Date'],
  ['driver', 'اسم السائق', 'Driver'],
  ['driverId', 'رقم الإقامة', 'Iqama'],
  ['vehicleType', 'نوع السيارة', 'Vehicle type'],
  ['estimateNo', 'رقم التقدير', 'Estimate no.'],
  // The rest of the row is shown and filterable. These fields were in the database but never reached the screen: how it was reported, the insurer's claim number, and attached papers. All filter from their column header.
  ['reportedVia', 'تم الإبلاغ عبر', 'Reported via'],
  ['claimNumber', 'رقم المطالبة', 'Claim no.'],
  ['fault', 'نسبة الخطأ', 'Fault'],
  ['insurer', 'شركة التأمين', 'Insurer'],
  ['estimated', 'مبلغ التقدير', 'Estimate amount'],
  ['recovery', 'المبلغ المسترد', 'Recovered amount'],
  ['gap', 'الفرق', 'Difference'],
  ['status', 'الحالة', 'Status'],
  ['lastReply', 'آخر رد', 'Last reply'],
  ['files', 'المرفقات', 'Files'],
  ['notes', 'الملاحظات', 'Notes'],
];
const GETTERS: Record<string, (r: any) => any> = {
  plate: (r) => r.vehiclePlate || r.incidentSubjectAr,
  date: (r) => fmtDate(r.accidentDate),
  // Who was driving. The other party alone is not enough: the violation is recorded against our driver, his account is taken and his licence is reviewed, so these four are where every accident starts.
  driver: (r) => r.driverNameAr || '',
  driverId: (r) => r.driverIdNumber || '',
  vehicleType: (r) => r.vehicleTypeAr || '',
  estimateNo: (r) => r.reportOrEstimateNumber || '',
  reportedVia: (r) => r.reportedViaAr || '',
  claimNumber: (r) => r.claim?.claimNumber || '',
  // Difference = estimated minus recovered; computed only at closing (by the server).
  gap: (r) => (r.claim?.recoveryGapSar != null ? money(r.claim.recoveryGapSar) : ''),
  files: (r) => (r.attachments?.length ? String(r.attachments.length) : ''),
  fault: (r) => (r.faultPercent == null ? '' : `${r.faultPercent}%`),
  insurer: (r) => r.claim?.insurerAr,
  estimated: (r) => (r.claim?.estimatedAmountSar ? money(r.claim.estimatedAmountSar) : ''),
  recovery: (r) => (r.claim?.expectedRecoverySar ? money(r.claim.expectedRecoverySar) : ''),
  // Status is a single fact. `statusAr` was read first, but it is free text from the import, so a closed claim still showed "wait". The code is the source of truth and the text is derived from it in the screen's language, so Arabic and English do not mix.
  status: (r) => (r.statusCode === 'closed' ? 'مقفولة' : 'قيد المتابعة'),
  lastReply: (r) => fmtDate(r.claim?.lastInsurerUpdateDate),
  notes: (r) => r.claim?.notesAr,
};

function ClaimsInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify, confirm } = useDialog();
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  // Actions column width is measured so the plate column can stick beside it; see components/vehicles/stickyLead.
  const lead = useLeadOffset();
  // Edit and delete are for management and finance only; registration is for the vehicles team (canEdit).
  const canManage = canEditClaims(user);
  const canDelete = canManage;
  // null = closed, {} = new accident, record = edit.
  const [form, setForm] = useState<any | null>(null);

  // Search is read from the URL: the vehicle file sends its plate in the link, so clicking accidents and claims opens this vehicle's claims, not the whole register.
  const [q, setQ] = useState(sp?.get('q') || '');
  const [status, setStatus] = useState(sp?.get('status') || '');
  // Dormant: open with thirty days and no insurer reply. Computed on the same row the table renders, not requested from the server again.
  const [stale, setStale] = useState(sp?.get('stale') === '1');
  // "Fault is ours" arrives from a card on the overview, so it is read from the URL: clicking there must open the same rows that were counted there.
  const [fault, setFault] = useState(sp?.get('fault') || '');
  // New page filters are computed over the loaded rows, so they answer questions about what is displayed.
  const [reportedVia, setReportedVia] = useState('');
  const [insurer, setInsurer] = useState('');
  const [files, setFiles] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [d, setD] = useState<Awaited<ReturnType<typeof getClaims>> | null>(null);
  const [loading, setLoading] = useState(true);

  // Stale responses must not overwrite newer ones. Typing the period fires two requests, old and new; the larger result is slower and lands after the smaller, so the writer sees his result for seconds and then the screen reverts to the pre-filter state. Uses hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const res = await getClaims({ q: q.trim(), status });
      if (!guard.isCurrent(mine)) return;
      setD(res);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [q, status, notify, guard]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const cf = useColumnFilters<any>();
  const allRows = d?.claims || [];
  // The dormant criterion matches the server literally (statusCode !== 'closed' and last reply thirty days old). If they differed the card would show one number and the table another, which is worse than a card that cannot be clicked.
  const staleRows = useMemo(() => {
    const cutoff = Date.now() - 30 * 864e5;
    let out = allRows;
    if (stale) {
      out = out.filter((r: any) => r.statusCode !== 'closed'
        && r.claim?.lastInsurerUpdateDate
        && new Date(r.claim.lastInsurerUpdateDate).getTime() < cutoff);
    }
    // Half the fault is ours: the same cutoff as the server (>= 50%), not "more than half".
    if (fault === 'ours') out = out.filter((r: any) => (r.faultPercent || 0) >= 50);
    if (reportedVia) out = out.filter((r: any) => (r.reportedViaAr || '') === reportedVia);
    if (insurer) out = out.filter((r: any) => (r.claim?.insurerAr || '') === insurer);
    if (files === 'with') out = out.filter((r: any) => (r.attachments?.length || 0) > 0);
    if (files === 'without') out = out.filter((r: any) => !(r.attachments?.length || 0));
    // The range applies to the accident date, not its registration date.
    if (from) out = out.filter((r: any) => r.accidentDate && String(r.accidentDate).slice(0, 10) >= from);
    if (to) out = out.filter((r: any) => r.accidentDate && String(r.accidentDate).slice(0, 10) <= to);
    return out;
  }, [allRows, stale, fault, reportedVia, insurer, files, from, to]);

  /** Filter values come from the rows themselves; a fixed list would drift from the real data. */
  const viaOptions = useMemo(
    () => [...new Set(allRows.map((r: any) => String(r.reportedViaAr || '').trim()).filter(Boolean))].sort(),
    [allRows]);
  const insurerOptions = useMemo(
    () => [...new Set(allRows.map((r: any) => String(r.claim?.insurerAr || '').trim()).filter(Boolean))].sort(),
    [allRows]);
  // Applied last: above search and the status filter.
  const rows = cf.apply(staleRows, GETTERS);
  const cols: ExportColumn[] = [
    { header: t('رقم الحادث', 'Accident no.'), key: 'accidentNumber', width: 18 },
    { header: t('اللوحة', 'Plate'), key: 'vehiclePlate', width: 16 },
    { header: t('التاريخ', 'Date'), key: 'accidentDate', transform: (v) => fmtDate(v), width: 14 },
    // Empty stays empty: zero fault is a result and its absence is not zero.
    { header: t('نسبة الخطأ %', 'Fault %'), key: 'faultPercent', width: 12, transform: (v: any) => (v == null ? '' : v) },
    { header: t('شركة التأمين', 'Insurer'), key: 'claim', transform: (v: any) => v?.insurerAr || '', width: 20 },
    { header: t('مبلغ التقدير', 'Estimate amount'), key: 'claim', transform: (v: any) => v?.estimatedAmountSar ?? '', width: 16 },
    { header: t('المبلغ المسترد', 'Recovered amount'), key: 'claim', transform: (v: any) => v?.expectedRecoverySar ?? '', width: 18 },
    { header: t('الحالة', 'Status'), key: 'statusCode', width: 14,
      transform: (v: any) => (v === 'closed' ? t('مقفولة', 'Closed') : t('قيد المتابعة', 'Pending')) },
    { header: t('اسم السائق', 'Driver'), key: 'driverNameAr', width: 26 },
    { header: t('رقم الإقامة', 'Iqama'), key: 'driverIdNumber', width: 14 },
    { header: t('نوع السيارة', 'Vehicle type'), key: 'vehicleTypeAr', width: 14 },
    { header: t('رقم التقدير', 'Estimate no.'), key: 'reportOrEstimateNumber', width: 16 },
    { header: t('تم الإبلاغ عبر', 'Reported via'), key: 'reportedViaAr', width: 14 },
    { header: t('رقم المطالبة', 'Claim no.'), key: 'claim', transform: (v: any) => v?.claimNumber || '', width: 16 },
    { header: t('الفرق', 'Difference'), key: 'claim', width: 14,
      transform: (v: any) => {
        return v?.recoveryGapSar != null ? v.recoveryGapSar : '';
      } },
    { header: t('عدد المرفقات', 'Attachments'), key: 'attachments', transform: (v: any) => (v?.length || 0), width: 12 },
    { header: t('سجّلها', 'Recorded by'), key: 'createdByName', width: 20 },
    { header: t('آخر من عدّلها', 'Last edited by'), key: 'lastModifiedByName', width: 20 },
    { header: t('الملاحظات', 'Notes'), key: 'claim', transform: (v: any) => v?.notesAr || '', width: 46 },
  ];

  // Search and status run on the server, so the array in hand is filter results, not the claims register; without a second call without params there is no "all".
  const hasActiveFilters = !!(q.trim() || status || stale || fault);
  const fetchAllForExport = async () => {
    const all = await getClaims();
    return [{ name: t('الحوادث', 'Claims'), rows: all.claims || [], columns: cols }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: t('الحوادث', 'Claims'), rows, columns: cols }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (loading && !d) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={() => router.push('/system/vehicles/registry/overview')}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('النظرة الشاملة', 'Overview')}
      </button>

      <PageHeader
        icon={<TriangleAlert className="w-5 h-5" />}
        title={t('الحوادث والمطالبات التأمينية', 'Accidents & Insurance Claims')}
        subtitle={t('متابعة المطالبة من الحادث لحد الاسترداد', 'From the accident to the money back')}
      >
        <div className="flex items-center gap-2">
          {canEdit && (
            <button onClick={() => setForm({})}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold">
              <Plus className="w-4 h-4" />{t('تسجيل حادث', 'New accident')}
            </button>
          )}
          <ExportMenu fileName="vehicle-claims" lang={lang as 'ar' | 'en'} options={exportOptions} />
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={t('إجمالي الحوادث', 'Total')} value={d?.totals.total ?? 0} c="#0f172a"
          onClick={() => { setStatus(''); setStale(false); }} on={!status && !stale} />
        <Stat label={t('مفتوحة', 'Open')} value={d?.totals.open ?? 0} c="#f59e0b"
          onClick={() => { setStatus('pending'); setStale(false); }} on={status === 'pending' && !stale} />
        {/* An amount card with no rows behind it stays a readable number. */}
        <Stat label={t('مبلغ التقدير (ر.س)', 'Estimate amount (SAR)')} value={money(d?.totals.estimatedSar)} c="#0ea5e9" />
        <Stat label={t('المبلغ المسترد (ر.س)', 'Recovered amount')} value={money(d?.totals.expectedRecoverySar)} c="#16a34a" />
        <Stat label={t('الفرق — المقفلة (ر.س)', 'Difference — closed (SAR)')} value={money(d?.totals.gapSar)} c="#dc2626" />
        {/* Dormant = open for 30 days with no reply from the insurer. */}
        <Stat label={t('بدون رد من التأمين +30 يوم', 'No insurer reply 30d+')} value={d?.totals.stale ?? 0} c="#ea580c"
          onClick={() => { setStale((v) => !v); setStatus(''); }} on={stale} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('لوحة / رقم حادث / شركة تأمين / الطرف الآخر…', 'plate / accident no / insurer…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-80 max-w-full" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          <option value="pending">{t('قيد المتابعة', 'Pending')}</option>
          <option value="closed">{t('مقفولة', 'Closed')}</option>
        </select>
        {/* A filter that came from a card or a link is lifted to where it is read; otherwise the table stays reduced for no reason visible in the filter bar. */}
        {fault === 'ours' && (
          <button onClick={() => setFault('')}
            className="px-2.5 py-2 rounded-lg border border-[#f37121] text-[#d95f13] bg-orange-50 text-sm font-semibold">
            {t('الخطأ علينا ✕', 'Our fault ✕')}
          </button>
        )}
        {stale && (
          <button onClick={() => setStale(false)}
            className="px-2.5 py-2 rounded-lg border border-[#f37121] text-[#d95f13] bg-orange-50 text-sm font-semibold">
            {t('بدون رد +30 يوم ✕', 'No reply 30d+ ✕')}
          </button>
        )}
        {/* Filters for daily questions: this month's accidents, those from Najm, those without papers, a given company. These used to be answered by opening columns one by one. */}
        <select value={reportedVia} onChange={(e) => setReportedVia(e.target.value)}
          aria-label={t('تم الإبلاغ عبر', 'Reported via')}
          className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل طرق الإبلاغ', 'All report channels')}</option>
          {viaOptions.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={insurer} onChange={(e) => setInsurer(e.target.value)}
          aria-label={t('شركة التأمين', 'Insurer')}
          className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل شركات التأمين', 'All insurers')}</option>
          {insurerOptions.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={files} onChange={(e) => setFiles(e.target.value)}
          aria-label={t('المرفقات', 'Attachments')}
          className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('المرفقات: الكل', 'Files: all')}</option>
          <option value="with">{t('لها مرفقات', 'With files')}</option>
          <option value="without">{t('بلا مرفقات', 'Without files')}</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          aria-label={t('من تاريخ', 'From')} className="px-2 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          aria-label={t('إلى تاريخ', 'To')} className="px-2 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
        {(reportedVia || insurer || files || from || to) && (
          <button onClick={() => { setReportedVia(''); setInsurer(''); setFiles(''); setFrom(''); setTo(''); }}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-slate-500 text-sm">
            {t('مسح الفلاتر', 'Clear filters')}
          </button>
        )}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="text-xs text-slate-400 ms-auto">{rows.length} {t('حادث', 'claims')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {/* Actions first and sticky (components/vehicles/stickyLead). */}
                {canManage && (
                  <th ref={lead.ref} className={`${LEAD} bg-slate-900 px-3 py-3 text-center font-bold whitespace-nowrap`}>
                    {t('إجراءات', 'Actions')}
                  </th>
                )}
                {COL_DEFS.map(([key, arL, enL], i) => (
                  // Plate is the first column and pinned with the actions: the row identity.
                  <th key={key}
                    className={`px-3 py-3 text-center font-bold whitespace-nowrap ${i === 0 ? `${LEAD_2} bg-slate-900` : ''}`}
                    style={i === 0 ? { insetInlineStart: canManage ? lead.offset : 0 } : undefined}>
                    <span className="inline-flex items-center">
                      {t(arL, enL)}
                      {cf.header(key, allRows, GETTERS[key], ar)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                // Open claim with a month and no reply: the ones that get lost.
                const staleDays = r.claim?.lastInsurerUpdateDate
                  ? Math.floor((Date.now() - new Date(r.claim.lastInsurerUpdateDate).getTime()) / 86400000) : null;
                const stale = r.statusCode !== 'closed' && staleDays != null && staleDays > 30;
                return (
                  <tr key={r._id} className="group hover:bg-slate-50 text-center align-middle">
                    {canManage && (
                      <td className={`${LEAD_CELL} px-3 py-2.5 whitespace-nowrap`}>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setForm(r)} title={t('تعديل', 'Edit')}
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                            <Pencil className="w-4 h-4" />
                          </button>
                          {canDelete && (
                            <button title={t('حذف', 'Delete')}
                              onClick={async () => {
                                if (!(await confirm(t(
                                  `حذف الحادث ${r.accidentNumber || r.claimId || ''}؟ هيتشال من القوايم والتقارير.`,
                                  `Delete accident ${r.accidentNumber || r.claimId || ''}?`)))) return;
                                try { await deleteClaim(r._id); notify(t('اتشال', 'Deleted'), 'success'); load(); }
                                catch (e: any) { notify(e?.message || 'Failed', 'error'); }
                              }}
                              className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                    <td className={`${LEAD_2} px-3 py-2.5 bg-white group-hover:bg-slate-50`}
                      style={{ insetInlineStart: canManage ? lead.offset : 0 }}>
                      {/* The name opens the accident file, not the vehicle file. It used to open the vehicle, which answers a different question: someone on a row here wants the accident itself (other party, insurer replies, papers). The vehicle file opens from inside the accident file. */}
                      <button onClick={() => router.push(`/system/vehicles/registry/claims/${r._id}`)}
                        title={t('ملفّ الحادثة', 'Claim file')}
                        className="font-semibold text-slate-800 hover:text-[#f37121] text-start">
                        {formatPlate(r.vehiclePlate) || r.incidentSubjectAr || '—'}
                      </button>
                      <p className="text-[10px] text-slate-400">
                        {[r.claimId, r.accidentNumber].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.accidentDate)}</td>
                    {/* Four columns were in the header but had no body cells. They were added to `COL_DEFS` (driver, residency, vehicle type, estimate number) but not to the body, so every column after the date shifted four cells from its title: driver name showed fault percentage, fault percentage showed "closed", insurer showed "48 days". Header and body are written in two places and one gets updated while the other is forgotten. */}
                    <td className="px-3 py-2.5 text-slate-700 text-[12px] whitespace-nowrap max-w-[220px] truncate"
                      title={r.driverNameAr || ''}>{r.driverNameAr || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600 font-mono text-[12px] whitespace-nowrap">
                      {r.driverIdNumber || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600 text-[12px] whitespace-nowrap max-w-[160px] truncate"
                      title={r.vehicleTypeAr || ''}>{r.vehicleTypeAr || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600 font-mono text-[12px] whitespace-nowrap">
                      {r.reportOrEstimateNumber || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600 text-[12px] whitespace-nowrap">
                      {r.reportedViaAr || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-600 font-mono text-[12px] whitespace-nowrap">
                      {r.claim?.claimNumber || <span className="text-slate-300">—</span>}</td>
                    {/* Zero percent is a result, not blank. A blank cell used to render "0%", but zero fault is a real result (the accident is not ours), so an unassessed claim read as cleared, and the difference is money paid or not. Unwritten values stay a dash like other columns. */}
                    <td className="px-3 py-2.5">
                      {r.faultPercent == null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          r.faultPercent >= 50 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {r.faultPercent}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-[12px]">{r.claim?.insurerAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-semibold whitespace-nowrap">{r.claim?.estimatedAmountSar ? money(r.claim.estimatedAmountSar) : '—'}</td>
                    <td className="px-3 py-2.5 text-emerald-700 font-semibold whitespace-nowrap">{r.claim?.expectedRecoverySar ? money(r.claim.expectedRecoverySar) : '—'}</td>
                    {/* The difference is computed when the claim closes (when the money is collected); before that there is none. */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.claim?.recoveryGapSar != null
                        ? <span className="font-semibold text-red-600">{money(r.claim.recoveryGapSar)}</span>
                        : <span className="text-slate-300" title={r.statusCode !== 'closed' ? t('يُحسب عند الإقفال', 'Computed on close') : ''}>—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        r.statusCode === 'closed' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                        {r.statusCode === 'closed' ? t('مقفولة', 'Closed') : t('قيد المتابعة', 'Pending')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {staleDays == null ? <span className="text-slate-300">—</span> : (
                        <span className={`inline-flex items-center gap-1 text-[12px] ${stale ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                          {stale && <Clock className="w-3.5 h-3.5" />}{staleDays} {t('يوم', 'd')}
                        </span>
                      )}
                    </td>
                    {/* Number of attached papers, read from the row so accidents without papers are identifiable. */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.attachments?.length
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
                          <Paperclip className="w-3 h-3" />{r.attachments.length}
                        </span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Notes in the table, not in the dialog. Each of the 49 claims carries a note holding the next step, for example waiting for the repair invoice; it is read daily, and hiding it behind an edit button means opening 49 dialogs to see where each stands. */}
                    <td className="px-3 py-2.5 text-start text-[12px] text-slate-600 min-w-[16rem] max-w-[26rem]">
                      {r.claim?.notesAr
                        ? <span className="line-clamp-2 leading-snug" title={r.claim.notesAr}>{r.claim.notesAr}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={COL_DEFS.length + (canManage ? 1 : 0)} className="px-3 py-12 text-center text-slate-500">{t('لا توجد حوادث', 'No claims')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {/* The form is rebuilt for each accident it opens on. Its state is initialized from the prop once at mount, so switching accidents (or to a new registration) without remounting would keep the old field values with the new id on save, writing one accident's data over another. `key` gives each target its own form. */}
      {form && (
        <ClaimForm key={form._id || 'new'} claim={form} ar={ar}
          onClose={() => setForm(null)}
          onSaved={(created) => { setForm(created || null); load(); }} />
      )}
    </div>
  );
}

/** The number read is the one opened. Cards were inert numbers: reading "open 17" gave no way to reach those 17 except opening the list and filtering by hand, so a click with no effect looked like a broken screen. Cards that cannot open (amount cards such as estimated and gap) are not lists of rows, so they carry no click cursor or motion and read as plain numbers. */
function Stat({ label, value, c, onClick, on }: {
  label: string; value: any; c: string; onClick?: () => void; on?: boolean;
}) {
  const body = (
    <>
      <p className="text-2xl font-extrabold leading-none" style={{ color: c }}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-tight">{label}</p>
    </>
  );
  if (!onClick) {
    return <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">{body}</div>;
  }
  return (
    <button type="button" onClick={onClick}
      className={`text-start bg-white border rounded-xl p-3.5 shadow-sm transition hover:border-[#f37121] hover:shadow
        ${on ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200'}`}>
      {body}
    </button>
  );
}

// Register / edit accident. Only hand-written fields are here. The recovery gap is computed on the server (estimated minus expected), so it is not written here; the screen and the report must not say two different things.
function ClaimForm({ claim, ar, onClose, onSaved }: {
  claim: any; ar: boolean; onClose: () => void;
  /** The newly created row is passed in so the form stays open on it for attachments. */
  onSaved: (created?: any) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const isNew = !claim?._id;
  // Attachments are read from the row and updated from the server response, so uploads appear without reopening.
  const [attachments, setAttachments] = useState<any[]>(claim?.attachments || []);
  /** Registry plates for selection. A vehicle in an accident is registered with us, so its plate is picked rather than typed, which would produce a format that does not match the registry. */
  const [plates, setPlates] = useState<{
    plate: string; typeAr: string; serial?: string; sectorAr?: string; ownerCompanyAr?: string;
    registrationTypeAr?: string; authorizedName: string; actualDriverName: string; actualDriverId: string;
  }[]>([]);
  useEffect(() => {
    api.get<{ plates: typeof plates }>('/api/vehicle-registry/plate-options')
      .then((d) => setPlates(d.plates || [])).catch(() => {});
  }, []);
  const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const [f, setF] = useState({
    vehiclePlate: claim?.vehiclePlate || '',
    incidentSubjectAr: claim?.incidentSubjectAr || '',
    accidentDate: d(claim?.accidentDate),
    accidentNumber: claim?.accidentNumber || '',
    driverNameAr: claim?.driverNameAr || '',
    driverIdNumber: claim?.driverIdNumber || '',
    vehicleTypeAr: claim?.vehicleTypeAr || '',
    reportOrEstimateNumber: claim?.reportOrEstimateNumber || '',
    faultPercent: claim?.faultPercent ?? '',
    reportedViaAr: claim?.reportedViaAr || '',
    statusCode: claim?.statusCode || 'pending',
    insurerAr: claim?.claim?.insurerAr || '',
    claimNumber: claim?.claim?.claimNumber || '',
    estimatedAmountSar: claim?.claim?.estimatedAmountSar ?? '',
    expectedRecoverySar: claim?.claim?.expectedRecoverySar ?? '',
    lastInsurerUpdateDate: d(claim?.claim?.lastInsurerUpdateDate),
    notesAr: claim?.claim?.notesAr || '',
  });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const num = (v: any) => (v === '' || v == null ? null : Number(v));
  // The difference exists only at closing; mirrors claimDifference on the server.
  const gap = f.statusCode === 'closed' && num(f.estimatedAmountSar) != null && num(f.expectedRecoverySar) != null
    ? Number(f.estimatedAmountSar) - Number(f.expectedRecoverySar) : null;

  const save = async () => {
    if (!f.vehiclePlate.trim() && !f.incidentSubjectAr.trim()) {
      notify(t('اكتب اللوحة أو موضوع الواقعة', 'Enter the plate or the subject'), 'error'); return;
    }
    setBusy(true);
    try {
      const body = {
        vehiclePlate: f.vehiclePlate.trim(),
        incidentSubjectAr: f.incidentSubjectAr.trim(),
        isVehicleIncident: !!f.vehiclePlate.trim(),
        accidentDate: f.accidentDate || null,
        accidentNumber: f.accidentNumber.trim(),
        driverNameAr: f.driverNameAr.trim(),
        driverIdNumber: f.driverIdNumber.trim(),
        vehicleTypeAr: f.vehicleTypeAr.trim(),
        reportOrEstimateNumber: f.reportOrEstimateNumber.trim(),
        faultPercent: num(f.faultPercent),
        reportedViaAr: f.reportedViaAr.trim(),
        statusCode: f.statusCode,
        // The text is not stored: it is derived from the code at display time in the screen's language.
        statusAr: '',
        claim: {
          insurerAr: f.insurerAr.trim(),
          claimNumber: f.claimNumber.trim(),
          estimatedAmountSar: num(f.estimatedAmountSar),
          expectedRecoverySar: num(f.expectedRecoverySar),
          lastInsurerUpdateDate: f.lastInsurerUpdateDate || null,
          notesAr: f.notesAr.trim(),
        },
      };
      /** Attachments need an existing row. A file is uploaded onto an accident that has an id, so there is nowhere for it before saving. The form used to close after registering, and most users never reopened it to attach a photo, leaving the accident without papers. Now it stays open on the same accident: with an id the attachments box appears and photos upload in the same flow. */
      if (isNew) {
        const created = await createClaim(body);
        notify(t('اتسجّل الحادث — تقدر ترفع الملفات دلوقتي', 'Recorded — you can attach files now'), 'success');
        onSaved(created?.claim || null);
        return;
      }
      await updateClaim(claim._id, body);
      notify(t('اتعدّل', 'Updated'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">
            {isNew ? t('تسجيل حادث جديد', 'New accident') : t(`تعديل ${claim.accidentNumber || claim.claimId}`, `Edit ${claim.accidentNumber || claim.claimId}`)}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div><label className={lbl}>{t('لوحة المركبة', 'Plate')}</label>
              {/* The plate is picked from the registry. Picking it fills vehicle type and the actual driver from its row; they are written there, and retyping here produces an accident with a plate matching no vehicle. */}
              {/* A searchable plate list of 338, not a scroll. It was a plain list scanned by eye, with look-alike Arabic letters in the plates. The second line shows make and model, not registration type: 68 trucks are all general transport, so the description was identical beside every row. */}
              <SearchableSelect
                value={f.vehiclePlate} searchAfter={0}
                onChange={(v2) => {
                  set('vehiclePlate', v2);
                  const hit = plates.find((x) => x.plate === v2);
                  if (hit) {
                    setF((x) => ({
                      ...x,
                      vehiclePlate: v2,
                      vehicleTypeAr: x.vehicleTypeAr || hit.typeAr || '',
                      driverNameAr: x.driverNameAr || hit.actualDriverName || hit.authorizedName || '',
                      driverIdNumber: x.driverIdNumber || hit.actualDriverId || '',
                    }));
                  }
                }}
                placeholder={t('— اختر اللوحة —', '— pick the plate —')}
                searchPlaceholder={t('اللوحة أو الرقم التسلسلي أو الماركة…', 'Plate, serial or brand…')}
                emptyLabel={t('لا لوحةَ تطابق — المركبة يجب أن تكون مسجّلةً عندنا', 'No match — the vehicle must be in our registry')}
                options={[
                  { value: '', label: t('— اختر اللوحة —', '— pick the plate —') },
                  ...plates.map((x) => ({
                    value: x.plate,
                    label: x.plate,
                    hint: [x.typeAr, x.sectorAr, x.ownerCompanyAr, x.serial && `#${x.serial}`].filter(Boolean).join(' · '),
                  })),
                  // An old plate on an accident recorded before the vehicle was deleted stays readable.
                  ...(f.vehiclePlate && !plates.some((x) => x.plate === f.vehiclePlate)
                    ? [{ value: f.vehiclePlate, label: f.vehiclePlate, hint: t('ليست في سجلّ المركبات', 'not in the registry') }]
                    : []),
                ]} /></div>
            <div><label className={lbl}>{t('موضوع الواقعة (إن لم تكن مركبة)', 'Subject (if not a vehicle)')}</label>
              <input value={f.incidentSubjectAr} onChange={(e) => set('incidentSubjectAr', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('تاريخ الحادث', 'Accident date')}</label>
              <input type="date" value={f.accidentDate} onChange={(e) => set('accidentDate', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('رقم الحادث', 'Accident no.')}</label>
              <input value={f.accidentNumber} onChange={(e) => set('accidentNumber', e.target.value)} className={inp} /></div>
            {/* Search the driver and his fields fill. Entering his name or ID number is answered from HR, the light-transport register and driver cards together, so the name is not written in two forms and residency is not looked up in another file. */}
            <div className="sm:col-span-2 lg:col-span-3">
              <PersonLookup ar={ar}
                label={t('ابحث عن السائق فتُملأ خاناته', 'Find the driver to fill his fields')}
                hint={t('بالاسم أو رقم الهوية أو الإقامة — والكتابة اليدوية تبقى متاحة.',
                        'By name, national ID or iqama — typing by hand still works.')}
                onPick={(pp) => setF((x) => ({
                  ...x,
                  driverNameAr: pp.name || x.driverNameAr,
                  driverIdNumber: pp.idNumber || x.driverIdNumber,
                }))} />
            </div>
            {/* The driver is suggested from the actual section driver or the vehicle's authorized person and corrected here; the authorized person is not always the rider (24 vehicles). */}
            <div><label className={lbl}>{t('اسم السائق', 'Driver name')}</label>
              <input value={f.driverNameAr} onChange={(e) => set('driverNameAr', e.target.value)} className={inp}
                placeholder={t('يُملأ تلقائيًّا من المركبة', 'auto-filled from the vehicle')} /></div>
            <div><label className={lbl}>{t('رقم إقامة السائق', 'Driver iqama')}</label>
              <input value={f.driverIdNumber} onChange={(e) => set('driverIdNumber', e.target.value)} className={inp} dir="ltr" /></div>
            <div><label className={lbl}>{t('نوع السيارة', 'Vehicle type')}</label>
              <input value={f.vehicleTypeAr} onChange={(e) => set('vehicleTypeAr', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('رقم التقدير', 'Estimate number')}</label>
              <input value={f.reportOrEstimateNumber} onChange={(e) => set('reportOrEstimateNumber', e.target.value)} className={inp} dir="ltr" /></div>

            <div><label className={lbl}>{t('نسبة الخطأ علينا %', 'Our fault %')}</label>
              <input type="number" min={0} max={100} value={f.faultPercent} onChange={(e) => set('faultPercent', e.target.value)} className={inp} /></div>
            {/* Reporting channel is a list managed in section settings, dropdowns. It was a free field, so "Najm" and the traffic department were written differently and nothing was counted from them. */}
            <div><label className={lbl}>{t('تم الإبلاغ عبر', 'Reported via')}</label>
              <ManagedSelect storeLabel type="vehicle_reported_via" value={f.reportedViaAr}
                onChange={(v) => set('reportedViaAr', v)} placeholder={t('اختر…', 'Select…')} /></div>
            <div><label className={lbl}>{t('الحالة', 'Status')}</label>
              <select value={f.statusCode} onChange={(e) => set('statusCode', e.target.value)} className={inp}>
                <option value="pending">{t('قيد المتابعة', 'Pending')}</option>
                <option value="closed">{t('مقفولة', 'Closed')}</option>
              </select></div>
          </div>

          {/* Insurer replies: an append-only log. The company replies several times to one claim (asks for a document, estimates, offers an amount), and overwriting the reply erases the negotiation history that is cited in a dispute. Newest first. */}
          {/* Papers can be uploaded from here too. Attaching used to be in the accident file only, while whoever opens edit to record an estimate has the report in hand and would close the dialog to attach it, or postpone and forget. It exists in both places over a single record. */}
          {!isNew && (
            <div className="rounded-xl border border-slate-200 p-3">
              <ClaimAttachments claimId={claim._id} attachments={attachments} canEdit
                onChange={(c2) => setAttachments(c2?.attachments || [])} />
            </div>
          )}

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[12.5px] font-bold text-slate-800 mb-2">
              {t('ردود شركة التأمين', 'Insurer replies')}
              {!!(claim?.insurerReplies?.length) && (
                <span className="ms-1.5 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11px] font-bold">
                  {claim!.insurerReplies!.length}
                </span>
              )}
            </p>

            {!!(claim?.insurerReplies?.length) && (
              <ul className="mb-3 space-y-1.5 max-h-48 overflow-y-auto">
                {[...claim!.insurerReplies!]
                  .sort((a2, b2) => new Date(b2.at).getTime() - new Date(a2.at).getTime())
                  .map((rep, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>{fmtDate(rep.at)}{rep.byName ? ` · ${rep.byName}` : ''}</span>
                        {rep.amountSar != null && (
                          <span className="font-bold text-slate-800 tabular-nums">{Number(rep.amountSar).toLocaleString()}</span>
                        )}
                      </div>
                      <p className="text-[13px] text-slate-800 mt-0.5 whitespace-pre-wrap">{rep.text}</p>
                    </li>
                  ))}
              </ul>
            )}

          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[12.5px] font-bold text-slate-800 mb-2">{t('المطالبة التأمينية', 'Insurance claim')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><label className={lbl}>{t('شركة التأمين', 'Insurer')}</label>
                <input value={f.insurerAr} onChange={(e) => set('insurerAr', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('رقم المطالبة', 'Claim no.')}</label>
                <input value={f.claimNumber} onChange={(e) => set('claimNumber', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('آخر رد من التأمين', 'Last insurer reply')}</label>
                <input type="date" value={f.lastInsurerUpdateDate} onChange={(e) => set('lastInsurerUpdateDate', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('مبلغ التقدير', 'Estimate amount (SAR)')}</label>
                <input type="number" value={f.estimatedAmountSar} onChange={(e) => set('estimatedAmountSar', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('المبلغ المسترد', 'Recovered amount')}</label>
                <input type="number" value={f.expectedRecoverySar} onChange={(e) => set('expectedRecoverySar', e.target.value)} className={inp} /></div>
              <div>
                <label className={lbl}>{t('الفرق (محسوب عند الإقفال)', 'Difference (computed on close)')}</label>
                <div className={`${inp} bg-slate-50 font-bold ${gap && gap > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                  {gap == null ? (f.statusCode === 'closed' ? '—' : t('يُحسب عند الإقفال', 'On close')) : money(gap)}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className={lbl}>{t('ملاحظات', 'Notes')}</label>
              <textarea rows={2} value={f.notesAr} onChange={(e) => set('notesAr', e.target.value)} className={inp} />
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy}
            className="w-full py-2.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t('جارٍ الحفظ…', 'Saving…') : isNew ? t('تسجيل الحادث', 'Record accident') : t('حفظ التعديل', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ClaimsInner /></Suspense>;
}
