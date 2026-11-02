'use client';
// Expiries and renewal: the single screen for which document is close to expiry or expired, and renewing it in place. It replaced the separate vehicle alerts screen, which showed the same rows from buildExpiryRows under another name.
// The period is a number the user types; the 30/60/90 buttons are shortcuts. Main filtering is on the server so the summary describes exactly the rows below.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { CalendarClock, RefreshCw, ArrowRight, Settings, BellOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import SelectionBar from '@/components/ls2/SelectionBar';
import { RenewModal, BulkRenewModal } from '@/components/vehicles/RenewModals';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { LEAD, LEAD_2, useLeadOffset } from '@/components/vehicles/stickyLead';
import { stateMeta,
  getExpiring, canEditVehicles, STATE_META, stateLabel, publicState, fmtDate, daysText,
  type ExpiringRow,
} from '@/lib/vehicleRegistry';
import ScrollX from '@/components/system/ScrollX';

const QUICK = [7, 15, 30, 60, 90, 180];

// Expiry table columns and each column's reader: one definition for header and filter.
const COL_DEFS: [string, string, string][] = [
  // Vehicle identity in the order used across the whole section: plate, chassis, serial, registration type, make, model, year, colour. Titles match the registry and operating cards, so a filter carries between them without translation and two Excel files compare column by column.
  ['plate', 'رقم اللوحة', 'Plate'],
  ['chassisNumber', 'رقم الهيكل', 'Chassis'],
  ['serialNumber', 'الرقم التسلسلي', 'Serial'],
  ['registrationTypeAr', 'نوع التسجيل', 'Registration type'],
  ['brandAr', 'ماركة المركبة', 'Brand'],
  ['modelAr', 'طراز المركبة', 'Model'],
  ['modelYear', 'الموديل', 'Year'],
  ['colorAr', 'اللون', 'Colour'],
  // The driver is not the document owner. This used to be filled for authorization only and was empty in most rows. It is now the vehicle's authorized person on all its documents, and the card holder on a driver-card row, with his card number beside him.
  ['holder', 'السائق', 'Driver'],
  ['driverCardNumber', 'رقم البطاقة', 'Driver card no.'],
  ['doc', 'المستند', 'Document'],
  ['expiry', 'ينتهي في', 'Expires'],
  ['left', 'المتبقي', 'Left'],
  ['state', 'الحالة', 'State'],
  ['sector', 'القطاع', 'Sector'],
  ['owner', 'المالك', 'Owner'],
];
// The three tiers are selectable separately. Critical is today's work, warning is the week's, near is preparation for next month. They used to be folded into "close to expiry", so someone wanting critical alone had nothing to choose. Their day thresholds are set per document in section settings.
const STATES = ['expired', 'critical', 'warning', 'upcoming', 'valid'] as const;

function ExpiringInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify } = useDialog();

  const [within, setWithin] = useState<string>(sp?.get('withinDays') || '60');
  const [doc, setDoc] = useState(sp?.get('doc') || '');
  const [state, setState] = useState(sp?.get('state') || '');
  const [includeExpired, setIncludeExpired] = useState(sp?.get('includeExpired') !== '0');
  // Free search inherited from the alerts screen: the section manager looks up a specific plate, not a period, and without it had to scan hundreds of rows by eye.
  const [q, setQ] = useState('');
  // A document whose alert is disabled in settings always stays visible here; hiding it is what made an actually expired document vanish silently. This filter shows only that category for whoever sets thresholds.
  const [mutedOnly, setMutedOnly] = useState(false);
  const [d, setD] = useState<Awaited<ReturnType<typeof getExpiring>> | null>(null);
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  // Actions column width is measured so the plate column can stick beside it; see components/vehicles/stickyLead.
  const lead = useLeadOffset();
  // Renew more than one document with the same date. The key is composite (vehicle + document) because one vehicle can have several expiring documents, one renewed and the other not.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  // Row identity is sent by the server. It used to be composed from `vehicleId` and `docKey`; a driver card has no vehicle, so all 57 cards had the single key `null:driverCard`: one rendered and the rest were dropped, and selection landed on a row that could not be clicked. `rowId` is unique per row.
  const rowKey = (r: any) => String(r.rowId || `${r.vehicleId}:${r.docKey}`);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState<ExpiringRow | null>(null);

  // Stale responses must not overwrite newer ones. Typing the period fires two requests, old and new; the larger result is slower and lands after the smaller, so the writer sees his result for seconds and then the screen reverts to the pre-filter state. Uses hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const res = await getExpiring({
        withinDays: within === '' ? undefined : within,
        doc, state, includeExpired: includeExpired ? '1' : '0',
      });
      if (!guard.isCurrent(mine)) return;
      setD(res);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [within, doc, state, includeExpired, notify, guard]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const cf = useColumnFilters<any>();
  const all = useMemo(() => d?.rows || [], [d]);
  const needle = q.trim().toLowerCase();
  // Search and the disabled-alert filter apply here, not on the server, so the summary must be recomputed on them too; otherwise the number above describes different rows than the ones below.
  const rows = useMemo(() => all.filter((r: any) => {
    if (mutedOnly && r.alertEnabled !== false) return false;
    if (!needle) return true;
    return [r.plateNumber, r.chassisNumber, r.serialNumber, r.driverCardNumber, r.holder, r.brandAr, r.modelAr, r.modelYear, r.sectorAr, r.ownerNameAr, r.docAr, r.docEn, r.reference]
      .some((v) => String(v || '').toLowerCase().includes(needle));
  }), [all, mutedOnly, needle]);

  const GETTERS = useMemo<Record<string, (r: any) => any>>(() => ({
    plate: (r) => r.plateNumber,
    chassisNumber: (r) => r.chassisNumber || '',
    serialNumber: (r) => r.serialNumber || '',
    registrationTypeAr: (r) => r.registrationTypeAr || '',
    colorAr: (r) => r.colorAr || '',
    driverCardNumber: (r) => r.driverCardNumber || '',
    brandAr: (r) => r.brandAr,
    modelAr: (r) => r.modelAr,
    modelYear: (r) => (r.modelYear || ''),
    holder: (r) => (r.holder || ''),
    doc: (r) => (ar ? r.docAr : r.docEn),
    expiry: (r) => fmtDate(r.expiryDate),
    left: (r) => daysText(r.daysRemaining, ar),
    state: (r) => r.state,
    sector: (r) => r.sectorAr,
    owner: (r) => r.ownerNameAr,
  }), [ar]);
  // Applied last: above search, status and period.
  const shownRows = useMemo(() => cf.apply(rows, GETTERS), [cf, rows, GETTERS]);

  const summary = useMemo(() => {
    const s: Record<string, number> = { total: rows.length };
    for (const k of STATES) s[k] = 0;
    // Each tier is counted by its own name; a chip with no rows shows an honest zero.
    for (const r of rows) { const k = publicState(r.state); s[k] = (s[k] || 0) + 1; }
    return s;
  }, [rows]);
  const byDoc = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.docKey] = (c[r.docKey] || 0) + 1;
    return (d?.byDoc || []).map((x) => ({ ...x, count: c[x.key] || 0 }));
  }, [rows, d]);
  const mutedCount = useMemo(() => all.filter((r: any) => r.alertEnabled === false).length, [all]);

  const cols: ExportColumn[] = [
    { header: t('رقم اللوحة', 'Plate'), key: 'plateNumber', width: 16 },
    { header: t('رقم الهيكل', 'Chassis'), key: 'chassisNumber', width: 22 },
    { header: t('الرقم التسلسلي', 'Serial'), key: 'serialNumber', width: 16 },
    { header: t('نوع التسجيل', 'Registration type'), key: 'registrationTypeAr', width: 14 },
    { header: t('ماركة المركبة', 'Brand'), key: 'brandAr', width: 14 },
    { header: t('طراز المركبة', 'Model'), key: 'modelAr', width: 14 },
    { header: t('الموديل', 'Year'), key: 'modelYear', width: 10 },
    { header: t('اللون', 'Colour'), key: 'colorAr', width: 10 },
    { header: t('السائق', 'Driver'), key: 'holder', width: 24 },
    { header: t('رقم البطاقة', 'Driver card no.'), key: 'driverCardNumber', width: 16 },
    { header: t('المستند', 'Document'), key: 'docAr', width: 18 },
    { header: t('ينتهي في', 'Expires'), key: 'expiryDate', transform: (v) => fmtDate(v), width: 14 },
    { header: t('الأيام المتبقية', 'Days left'), key: 'daysRemaining', width: 12 },
    { header: t('الحالة', 'State'), key: 'state', transform: (v) => stateLabel(v, ar), width: 16 },
    { header: t('القطاع', 'Sector'), key: 'sectorAr', width: 16 },
    { header: t('المالك', 'Owner'), key: 'ownerNameAr', width: 26 },
    { header: t('المرجع', 'Reference'), key: 'reference', width: 22 },
    { header: t('التنبيه مفعّل', 'Alert on'), key: 'alertEnabled', transform: (v) => (v === false ? t('لا', 'No') : t('نعم', 'Yes')), width: 12 },
  ];


  // Period, document and status apply on the server, while search and disabled-alert apply in memory, so the rows in hand are a slice of a slice. "All" repeats the call without a time window; otherwise whoever opened the screen on sixty days would export a file believed to be the whole expiry register.
  const hasActiveFilters = !!(needle || mutedOnly || doc || state || within !== '' || !includeExpired || cf.count);
  const fetchAllForExport = async () => {
    const res = await getExpiring({ withinDays: undefined, includeExpired: '1' });
    return [{ name: t('الانتهاءات', 'Expiries'), rows: (res.rows || []) as unknown as Record<string, any>[], columns: cols }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    // "Shown" is what is displayed after column filters. It used to export `rows`, the pre-funnel set, so someone filtering a make and exporting "shown" got the whole table while believing it was his slice.
    { key: 'shown', label: scope.shown, sheets: [{ name: t('الانتهاءات', 'Expiries'), rows: shownRows as unknown as Record<string, any>[], columns: cols }] },
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
        icon={<CalendarClock className="w-5 h-5" />}
        title={t('الانتهاءات والتجديد', 'Expiries & Renewals')}
        subtitle={t('كل مستند له تاريخ — اختر المدة التي تهمّك', 'Every dated document — pick the window that matters to you')}
      >
        <div className="flex items-center gap-2">
          {/* Thresholds are set in settings and decide critical vs warning, so the link to them belongs on the screen that shows their effect. */}
          <Link href="/system/vehicles/settings"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
            <Settings className="w-4 h-4" /> {t('إعدادات التنبيهات', 'Alert settings')}
          </Link>
          <ExportMenu fileName="vehicle-expiries" lang={lang as 'ar' | 'en'} options={exportOptions} />
        </div>
      </PageHeader>

      {/* The period: the part the user controls. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{t('ينتهي خلال', 'Expiring within')}</span>
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} max={3650} value={within}
              onChange={(e) => setWithin(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm text-center font-bold" />
            <span className="text-sm text-slate-500">{t('يوم', 'days')}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((qd) => (
              <button key={qd} onClick={() => setWithin(String(qd))}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  within === String(qd) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}>{qd}</button>
            ))}
            <button onClick={() => setWithin('')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${within === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>
              {t('الكل', 'All')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('لوحة · اسم · مالك · قطاع · ماركة…', 'Plate · name · owner · sector · brand…')}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm w-64 max-w-full" />
          <select value={doc} onChange={(e) => setDoc(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{t('كل المستندات', 'All documents')}</option>
            {(d?.docs || []).map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{t('كل الحالات', 'All states')}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{stateLabel(s, ar)}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
            {t('اعرض المنتهي بالفعل', 'Include already expired')}
          </label>
          {mutedCount > 0 && (
            <button onClick={() => setMutedOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                mutedOnly ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}>
              <BellOff className="w-3.5 h-3.5" />{t('تنبيهه متقفول', 'Alert muted')} <b>{mutedCount}</b>
            </button>
          )}
          <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
          <span className="text-xs text-slate-400 ms-auto">
            {shownRows.length}{shownRows.length !== all.length ? ` / ${all.length}` : ''} {t('صف', 'rows')}
          </span>
        </div>
      </div>

      {/* Summary: computed over the same rows that are displayed. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {STATES.map((k) => {
          const m = stateMeta(k);
          return (
            <button key={k} onClick={() => setState(state === k ? '' : k)}
              className={`text-start bg-white border rounded-xl p-3 shadow-sm transition-colors ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className="text-2xl font-extrabold leading-none" style={{ color: m.color }}>{summary[k] ?? 0}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">{ar ? m.ar : m.en}</p>
            </button>
          );
        })}
        <div className="bg-slate-900 rounded-xl p-3 text-white">
          <p className="text-2xl font-extrabold leading-none">{summary.total}</p>
          <p className="text-[11px] text-slate-300 mt-1.5">{t('الإجمالي', 'Total')}</p>
        </div>
      </div>

      {/* Distribution across documents. */}
      <div className="flex flex-wrap gap-1.5">
        {byDoc.map((x) => (
          <button key={x.key} onClick={() => setDoc(doc === x.key ? '' : x.key)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              doc === x.key ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            {ar ? x.ar : x.en} <b>{x.count}</b>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {/* Selection and renewal are one action on the row, so they share one pinned column at the start of the table (components/vehicles/stickyLead). */}
                <th ref={lead.ref} className={`${LEAD} bg-slate-900 px-3 py-3 text-start font-bold whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    {canEdit && (
                      <input type="checkbox" className="accent-[#f37121]"
                        title={t('اختيار كل المعروض', 'Select all shown')}
                        checked={rows.length > 0 && rows.every((x) => picked.has(rowKey(x)))}
                        onChange={(e) => setPicked((p) => {
                          const n = new Set(p);
                          rows.forEach((x) => (e.target.checked ? n.add(rowKey(x)) : n.delete(rowKey(x))));
                          return n;
                        })} />
                    )}
                    {t('إجراءات', 'Actions')}
                  </span>
                </th>
                {COL_DEFS.map(([key, arL, enL], i) => (
                  // Plate is the first column and pinned with the actions: the row identity.
                  <th key={key}
                    className={`px-3 py-3 text-center font-bold whitespace-nowrap ${i === 0 ? `${LEAD_2} bg-slate-900` : ''}`}
                    style={i === 0 ? { insetInlineStart: lead.offset } : undefined}>
                    <span className="inline-flex items-center">
                      {t(arL, enL)}
                      {cf.header(key, rows, GETTERS[key], ar,
                        key === 'state' ? (v: any) => stateLabel(String(v), ar) : undefined)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shownRows.map((r: any) => {
                const m = stateMeta(r.state);
                return (
                  <tr key={rowKey(r)}
                    className={`group text-center ${picked.has(rowKey(r)) ? 'bg-orange-50/70' : 'hover:bg-slate-50'}`}>
                    <td className={`${LEAD} px-3 py-2.5 ${picked.has(rowKey(r)) ? 'bg-orange-50' : 'bg-white'} group-hover:bg-slate-50`}>
                      <div className="flex items-center gap-1.5">
                        {canEdit && (
                          <input type="checkbox" className="accent-[#f37121]"
                            checked={picked.has(rowKey(r))}
                            onChange={() => setPicked((p) => {
                              const n = new Set(p); const k = rowKey(r);
                              if (n.has(k)) n.delete(k); else n.add(k);
                              return n;
                            })} />
                        )}
                        <button onClick={() => setRenewing(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold whitespace-nowrap">
                          <RefreshCw className="w-3.5 h-3.5" />{t('تجديد', 'Renew')}
                        </button>
                      </div>
                    </td>
                    <td className={`${LEAD_2} px-3 py-2.5 ${picked.has(rowKey(r)) ? 'bg-orange-50' : 'bg-white'} group-hover:bg-slate-50`}
                      style={{ insetInlineStart: lead.offset }}>
                      {r.vehicleId
                        ? (
                          <button onClick={() => router.push(`/system/vehicles/registry/${r.vehicleId}`)}
                            className="font-semibold text-slate-800 hover:text-[#f37121]">{r.plateNumber}</button>
                        )
                        // A driver card has no vehicle, so there is no plate and no vehicle file to open.
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap font-mono text-[12px]" dir="ltr">{r.chassisNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap font-mono text-[12px]" dir="ltr">{r.serialNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.registrationTypeAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.brandAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.modelAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap tabular-nums">{r.modelYear || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.colorAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap max-w-[220px] truncate" title={r.holder || ''}>
                      {r.holder || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap font-mono text-[12px]" dir="ltr">{r.driverCardNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      <span className="inline-flex items-center gap-1 justify-center">
                        {ar ? r.docAr : r.docEn}
                        {/* A disabled alert is marked, not hidden: the row stays and the user knows why no notification reached him. */}
                        {r.alertEnabled === false && (
                          <BellOff className="w-3.5 h-3.5 text-slate-400" aria-label={t('تنبيهه متقفول', 'Alert muted')} />
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.expiryDate)}</td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: m.color }}>{daysText(r.daysRemaining, ar)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg}`}>{stateLabel(r.state, ar)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-[12px]">{r.sectorAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-[12px] max-w-[220px] truncate">{r.ownerNameAr || '—'}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={COL_DEFS.length + 1} className="px-3 py-12 text-center text-slate-500">
                  {t('لا شيء ينتهي خلال هذه المدة', 'Nothing expires in this window')}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {/* Bulk action bar: fixed at the bottom of the screen, appears as soon as the first document is selected. It used to be sticky after the table, so with hundreds of rows it appeared only after scrolling to the end, and selecting a row near the top seemed to have no button. */}
      {canEdit && (
        <SelectionBar
          count={picked.size} ar={ar} tone="green"
          label={t(`${picked.size} مستند محدَّد`, `${picked.size} selected`)}
          hint={t('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date')}
          actionLabel={t(`تجديدها بتاريخ واحد (${picked.size})`, `Renew to one date (${picked.size})`)}
          onAction={() => setBulk(true)}
          onClear={() => setPicked(new Set())} />
      )}

      {bulk && (
        <BulkRenewModal
          rows={rows.filter((r) => picked.has(rowKey(r)))} ar={ar}
          onClose={() => setBulk(false)}
          onDone={() => { setBulk(false); setPicked(new Set()); load(); }}
        />
      )}

      {renewing && (
        <RenewModal row={renewing} ar={ar} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); setPicked(new Set()); load(); }} />
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ExpiringInner /></Suspense>;
}
