'use client';
/**
 * The carrier register as the vendors team works it: every master carrier, every carrier seen in shipments this year
 * (registered or only by name), with its activity, trend, contract, file completeness and score. Filters for the
 * team's daily lists (stopped master carriers, active outside the master, signed but idle) and a three-way compare.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice, SearchInput, Modal } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { DataGrid, Grade, TrendChip, LiveDot, fmtInt, fmtMoney, fmtDay, trendLabel } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, contractTone, vendorHref, canEditVendors, monthName, APPROVAL, approvalLabel, docKindLabel } from '@/lib/vendors';
import NewVendorModal from '@/components/vendors/NewVendorModal';
import { Users, Plus, GitCompare, X } from 'lucide-react';

type Row = Record<string, any>;
const QUICK: [string, string, string][] = [
  ['', 'الكلّ', 'All'], ['master', 'الموردون المعتمدون', 'Master'], ['stopped', 'معتمدون متوقّفون', 'Master stopped'], ['leads', 'نشطون غير معتمدين', 'Active outside master'],
  ['signedIdle', 'موقّعون غير نشطين', 'Signed, idle'], ['unsigned', 'نشطون دون عقد', 'Active unsigned'], ['freelancers', 'السائقون الأفراد', 'Freelancers'], ['incomplete', 'ملفٌّ ناقص', 'Incomplete file'],
  ['missingDocs', 'مستنداتٌ مطلوبة ناقصة', 'Missing papers'], ['contracted', 'متعاقَدٌ رسميًّا', 'Contracted'], ['notContracted', 'غير متعاقَد', 'Not contracted'],
  ['expiring', 'عقودٌ تنتهي أو انتهت', 'Contracts ending'], ['pending', 'بانتظار الاعتماد', 'Pending approval'],
];
/** Quick lists as one predicate, shared by the filter and its count. */
const quickOf = (k: string, v: Row) => {
  switch (k) {
    case 'master': return v.inMaster;
    case 'stopped': return v.inMaster && v.trend === 'stopped';
    case 'leads': return v.kind === 'outside' && v.active;
    case 'signedIdle': return v.signed && !v.active;
    case 'unsigned': return v.inMaster && !v.signed && v.active;
    case 'freelancers': return v.kind === 'freelancer';
    case 'incomplete': return v.inMaster && v.completeness < 70;
    case 'missingDocs': return !!v.id && v.kind !== 'freelancer' && (v.docsMissing || []).length > 0;
    case 'contracted': return !!v.contracted;
    case 'notContracted': return !!v.id && v.kind !== 'freelancer' && !v.contracted;
    case 'expiring': return v.contractState === 'expiring' || v.contractState === 'expired';
    case 'pending': return ['pending', 'returned'].includes(v.approvalStatus);
    default: return true;
  }
};

export default function VendorsRegisterPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();
  const [d, setD] = useState<{ vendors: Row[]; owners: string[]; curMonth: number; year: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('quick') || '' : ''));
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [contract, setContract] = useState('');
  const [trend, setTrend] = useState('');
  const [cmp, setCmp] = useState<Row[]>([]);
  const [cmpData, setCmpData] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setD(await api.get(`/api/vendors-mgmt/vendors`)); setError(''); }
    catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1200); }, [load]);
  useSocket('vendors:changed', soon);
  useSocket('shipmentOrders:fleet', soon);
  useSocket('shipmentOrders:updated', soon);

  const rows = useMemo(() => {
    if (!d) return [];
    const fq = q.trim();
    return d.vendors.filter((v) => {
      if (quick && !quickOf(quick, v)) return false;
      if (owner && v.followOwner !== owner) return false;
      if (contract && (v.contractStatus || '—') !== contract) return false;
      if (trend && v.trend !== trend) return false;
      if (fq && !`${v.name} ${v.phone || ''} ${v.headOffice || ''} ${v.representative || ''}`.includes(fq)) return false;
      return true;
    });
  }, [d, quick, q, owner, contract, trend]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!d) return out;
    for (const [k] of QUICK) out[k] = d.vendors.filter((v) => quickOf(k, v)).length;
    return out;
  }, [d]);

  const toggleCmp = (v: Row) => setCmp((p) => (p.some((x) => x.id === v.id) ? p.filter((x) => x.id !== v.id) : p.length >= 3 ? p : [...p, v]));
  const openCompare = async () => {
    try { const r = await api.get<{ vendors: Row[] }>(`/api/vendors-mgmt/compare?ids=${cmp.map((x) => x.id).join(',')}`); setCmpData(r.vendors); }
    catch (e: any) { notify(e?.message || t('تعذّرت المقارنة', 'Compare failed'), 'error'); }
  };

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const money = d.vendors.some((v) => v.buy != null);
  const contracts = [...new Set(d.vendors.map((v) => v.contractStatus || '—'))];
  const cm = d.curMonth;

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-6 h-6 text-[#f37121]" />} title={t('الموردون', 'Carriers')}
        subtitle={t('سجلّ الموردين ونشاطُهم هذا العام وتقييمُهم — اضغط مورّدًا لفتح بطاقته', 'The carrier register, its activity this year and score — press one to open its card')}>
        <LiveDot ar={ar} busy={busy} />
        {canEditVendors(user) && <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold"><Plus className="w-4 h-4" />{t('إضافة مورّد', 'Add carrier')}</button>}
        <ExportMenu fileName="carriers" lang={ar ? 'ar' : 'en'} options={[{
          key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: t('الموردون', 'Carriers'), rows, columns: [
            { header: t('المورّد', 'Carrier'), key: 'name', width: 34 }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) },
            { header: t('الرقم في القائمة المعتمدة', 'Master no.'), key: 'masterNo' }, { header: t('مسؤول المتابعة', 'Owner'), key: 'followOwner' }, { header: t('حالة العقد', 'Contract'), key: 'contractStatus' },
            { header: t('التصنيف الضريبي', 'Tax class'), key: 'taxClass' }, { header: t('المقر', 'HQ'), key: 'headOffice' }, { header: t('الوجهات', 'Destinations'), key: 'destinations' },
            { header: t('نوع السيارات', 'Truck types'), key: 'vehicleTypes' }, { header: t('عدد السيارات', 'Fleet'), key: 'fleetSize' }, { header: t('ممثل المورد', 'Representative'), key: 'representative' }, { header: t('الجوال', 'Phone'), key: 'phone' },
            ...(Array.from({ length: cm }, (_, i) => ({ header: monthName(i + 1, ar), key: `m${i}`, transform: (_v: any, r: Row) => r.mon?.[i] || 0 }))),
            { header: t('رحلات العام', 'Year trips'), key: 'trips' }, ...(money ? [{ header: t('المشتريات', 'Purchase'), key: 'buy' }, { header: t('متوسط الرحلة', 'Avg trip'), key: 'avg' }] : []),
            { header: t('أوّل رحلة', 'First'), key: 'first' }, { header: t('آخر رحلة', 'Last'), key: 'last' }, { header: t('الحالة', 'Trend'), key: 'trend', transform: (v: string) => trendLabel(v, ar) },
            { header: t('الاعتماد', 'Approval'), key: 'approvalStatus', transform: (v: string) => approvalLabel(v, ar) },
            { header: t('متعاقَدٌ رسميًّا', 'Contracted'), key: 'contracted', transform: (v: boolean) => (v ? t('نعم', 'Yes') : t('لا', 'No')) }, { header: t('نهاية العقد', 'Contract end'), key: 'contractEndDate' },
            { header: t('المستندات الناقصة', 'Missing papers'), key: 'docsMissing', transform: (v: string[]) => (v || []).map((k) => docKindLabel(k, ar)).join('، ') },
            { header: t('صاحب المنشأة', 'Owner'), key: 'ownerPhone' }, { header: t('المشغّل', 'Operator'), key: 'operatorName' }, { header: t('جوال المشغّل', 'Operator mobile'), key: 'operatorPhone' },
            { header: t('التقييم', 'Grade'), key: 'grade' }, { header: t('الدرجة', 'Score'), key: 'score' }, { header: t('اكتمال الملف %', 'File %'), key: 'completeness' },
          ] }],
        }]} />
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        {QUICK.map(([k, a, e]) => (
          <button key={k || 'all'} type="button" onClick={() => setQuick(k)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold border ${quick === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
            {ar ? a : e}<span className="ms-1.5 tabular-nums opacity-70">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={setQ} placeholder={t('اسم المورّد، الجوال، المقر، الممثل…', 'Name, phone, HQ, representative…')} /></div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"><option value="">{t('كلّ مسؤولي المتابعة', 'All owners')}</option>{d.owners.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        <select value={contract} onChange={(e) => setContract(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"><option value="">{t('كلّ حالات العقد', 'All contract states')}</option>{contracts.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={trend} onChange={(e) => setTrend(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"><option value="">{t('كلّ الحالات', 'All trends')}</option>{['up', 'steady', 'down', 'new', 'stopped', 'never'].map((k) => <option key={k} value={k}>{trendLabel(k, ar)}</option>)}</select>
        <span className="text-[12.5px] text-slate-500 tabular-nums">{t(`${rows.length} من ${d.vendors.length}`, `${rows.length} of ${d.vendors.length}`)}</span>
      </div>

      {cmp.length > 0 && (
        <div className="rounded-2xl border border-[#f37121]/40 bg-[#f37121]/5 px-4 py-2.5 flex flex-wrap items-center gap-2 text-[12.5px]">
          <GitCompare className="w-4 h-4 text-[#f37121]" /><span className="font-semibold">{t('للمقارنة', 'To compare')}:</span>
          {cmp.map((v) => <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2 py-0.5">{v.name}<button type="button" onClick={() => toggleCmp(v)}><X className="w-3 h-3" /></button></span>)}
          <button type="button" onClick={openCompare} disabled={cmp.length < 2} className="ms-auto px-3 py-1.5 rounded-lg bg-[#f37121] text-white font-semibold disabled:opacity-50">{t('قارن', 'Compare')}</button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <DataGrid ar={ar} rows={rows} limit={50} rowKey={(r, i) => r.id || `n${i}`} onRow={(r) => router.push(vendorHref(r))} cols={[
          { key: 'cmp', label: '⇄', render: (r) => (r.id ? <input type="checkbox" checked={cmp.some((x) => x.id === r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCmp(r)} className="accent-[#f37121]" title={t('للمقارنة (حتى 3)', 'Compare (up to 3)')} /> : null) },
          { key: 'grade', label: t('التقييم', 'Grade'), render: (r) => <Grade g={r.grade} score={r.score} />, sort: (r) => r.score },
          { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => (
            <div className="min-w-[200px]"><Link href={vendorHref(r)} onClick={(e) => e.stopPropagation()} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link>
              <div className="flex flex-wrap gap-1 mt-0.5"><span className={`px-1.5 py-0.5 rounded border text-[10.5px] font-semibold ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span>
                {r.unregistered && <span className="px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 text-[10.5px]">{t('غير مسجّل', 'Unregistered')}</span>}
                {r.leadPriority && <span className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[10.5px]">{r.leadPriority}</span>}
                {r.approvalStatus && r.approvalStatus !== 'approved' && <span className={`px-1.5 py-0.5 rounded border text-[10.5px] font-semibold ${APPROVAL[r.approvalStatus]?.cls}`}>{approvalLabel(r.approvalStatus, ar)}</span>}
                {(r.docsMissing || []).length > 0 && r.kind !== 'freelancer' && <span className="px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 text-[10.5px]" title={(r.docsMissing || []).map((k: string) => docKindLabel(k, ar)).join('، ')}>{t(`ينقصه ${r.docsMissing.length} مستند`, `${r.docsMissing.length} papers missing`)}</span>}
                {r.contracted && <span className={`px-1.5 py-0.5 rounded border text-[10.5px] ${r.contractState === 'expired' ? 'border-red-200 bg-red-50 text-red-700' : r.contractState === 'expiring' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{t('متعاقَد', 'Contracted')}{r.contractEndDate ? ` · ${r.contractEndDate}` : ''}</span>}
                {r.names > 1 && <span className="px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 text-[10.5px]">{t(`${r.names} أسماء`, `${r.names} names`)}</span>}</div></div>
          ) },
          { key: 'followOwner', label: t('المتابعة', 'Owner'), render: (r) => r.followOwner || '—' },
          { key: 'contractStatus', label: t('العقد', 'Contract'), render: (r) => (r.contractStatus ? <span className={`px-2 py-0.5 rounded-full border text-[11px] whitespace-nowrap ${contractTone(r.contractStatus)}`}>{r.contractStatus}</span> : '—') },
          { key: 'trend', label: t('الحالة', 'Trend'), render: (r) => <TrendChip t={r.trend} ar={ar} /> },
          { key: 'month', label: monthName(cm, ar), num: true },
          { key: 'trips', label: t('رحلات العام', 'Year'), num: true },
          ...(money ? [{ key: 'avg', label: t('متوسط الرحلة', 'Avg trip'), num: true, render: (r: Row) => fmtMoney(r.avg) }] : []),
          { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => <span className="tabular-nums">{fmtDay(r.last)}</span>, sort: (r) => String(r.last || '') },
          { key: 'headOffice', label: t('المقر', 'HQ'), render: (r) => r.headOffice || '—' },
          { key: 'completeness', label: t('الملف', 'File'), num: true, render: (r) => (r.id ? <span className={r.completeness >= 70 ? 'text-emerald-700' : 'text-amber-700'}>{r.completeness}%</span> : '—') },
          { key: 'phone', label: t('الجوال', 'Phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—') },
        ]} />
      </div>

      {adding && (
        <NewVendorModal ar={ar} owners={d.owners} onClose={() => setAdding(false)}
          onCreated={(nv) => { setAdding(false); if (nv?._id) router.push(`/system/vendors-mgmt/vendors/${nv._id}`); }} />
      )}
      {cmpData && (
        <Modal open wide onClose={() => setCmpData(null)} title={t('مقارنة الموردين', 'Compare carriers')}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-slate-100">
                {([
                  ['name', t('المورّد', 'Carrier')], ['owner', t('المتابعة', 'Owner')], ['contract', t('العقد', 'Contract')], ['trips', t('رحلات العام', 'Year trips')],
                  ...(cmpData[0]?.buy != null ? [['buy', t('المشتريات', 'Purchase')], ['avg', t('متوسط الرحلة', 'Avg trip')]] : []),
                  ['topBranch', t('أكبر فرع', 'Top branch')], ['topRep', t('أكثر مندوب تعاملًا', 'Top rep')], ['topCustomer', t('أكبر عميل', 'Top customer')], ['topRoute', t('أكثر مسار', 'Top route')], ['last', t('آخر رحلة', 'Last trip')],
                ] as [string, string][]).map(([k, l]) => (
                  <tr key={k}><td className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{l}</td>
                    {cmpData.map((v) => <td key={v.id} className={`px-3 py-2 ${k === 'name' ? 'font-bold text-slate-900' : ''} ${['trips', 'buy', 'avg'].includes(k) ? 'tabular-nums' : ''}`}>{['buy', 'avg'].includes(k) ? fmtMoney(v[k]) : k === 'trips' ? fmtInt(v[k]) : (v[k] || '—')}</td>)}</tr>
                ))}
                <tr><td className="px-3 py-2 font-semibold text-slate-600">{t('الرحلات شهريًّا', 'Monthly trips')}</td>
                  {cmpData.map((v) => <td key={v.id} className="px-3 py-2"><div className="flex items-end gap-0.5 h-10">{v.mon.slice(0, cm).map((n: number, i: number) => <div key={i} title={`${monthName(i + 1, ar)}: ${n}`} className="w-2 rounded-t bg-[#f37121]" style={{ height: `${Math.max(2, (n / Math.max(1, ...v.mon)) * 40)}px` }} />)}</div></td>)}</tr>
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
