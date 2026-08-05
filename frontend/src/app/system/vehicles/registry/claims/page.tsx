'use client';
// الحوادث والمطالبات التأمينية — السؤال هنا فلوس: صرفنا كام وهنسترد كام.
//
// ⚠️ الصفحة دي غير «حوادث التفاويض» في نفس القسم. تلك بتسجّل الحادث من ناحية
// التشغيل (أي سائق، بأي تفويض). دي بتتابع **المطالبة**: نسبة الخطأ، رقم نجم،
// شركة التأمين، المقدَّر، والمتوقع استرداده.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { TriangleAlert, Search, ArrowRight, Clock } from 'lucide-react';
import { getClaims, money, fmtDate } from '@/lib/vehicleRegistry';

function ClaimsInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify } = useDialog();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp?.get('status') || '');
  const [d, setD] = useState<Awaited<ReturnType<typeof getClaims>> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await getClaims({ q: q.trim(), status })); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [q, status, notify]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const rows = d?.claims || [];
  const cols: ExportColumn[] = [
    { header: t('رقم الحادث', 'Accident no.'), key: 'accidentNumber', width: 18 },
    { header: t('اللوحة', 'Plate'), key: 'vehiclePlate', width: 16 },
    { header: t('التاريخ', 'Date'), key: 'accidentDate', transform: (v) => fmtDate(v), width: 14 },
    { header: t('نسبة الخطأ %', 'Fault %'), key: 'faultPercent', width: 12 },
    { header: t('شركة التأمين', 'Insurer'), key: 'claim', transform: (v: any) => v?.insurerAr || '', width: 20 },
    { header: t('المبلغ المقدَّر', 'Estimated'), key: 'claim', transform: (v: any) => v?.estimatedAmountSar ?? '', width: 16 },
    { header: t('متوقع استرداده', 'Expected recovery'), key: 'claim', transform: (v: any) => v?.expectedRecoverySar ?? '', width: 18 },
    { header: t('الحالة', 'Status'), key: 'statusAr', width: 14 },
    { header: t('الطرف الآخر', 'Counterparty'), key: 'counterpartyNameAr', width: 24 },
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
        <ExportMenu fileName="vehicle-claims" lang={lang as 'ar' | 'en'}
          options={[{ key: 'all', label: t('تصدير', 'Export'), sheets: [{ name: t('الحوادث', 'Claims'), rows, columns: cols }] }]} />
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={t('إجمالي الحوادث', 'Total')} value={d?.totals.total ?? 0} c="#0f172a" />
        <Stat label={t('مفتوحة', 'Open')} value={d?.totals.open ?? 0} c="#f59e0b" />
        <Stat label={t('المبلغ المقدَّر (ر.س)', 'Estimated (SAR)')} value={money(d?.totals.estimatedSar)} c="#0ea5e9" />
        <Stat label={t('متوقع استرداده (ر.س)', 'Expected recovery')} value={money(d?.totals.expectedRecoverySar)} c="#16a34a" />
        <Stat label={t('الفجوة (ر.س)', 'Gap (SAR)')} value={money(d?.totals.gapSar)} c="#dc2626" />
        {/* «نايمة» = مفتوحة وعدّى عليها ٣٠ يوم من غير أي رد من التأمين. */}
        <Stat label={t('بدون رد من التأمين +٣٠ يوم', 'No insurer reply 30d+')} value={d?.totals.stale ?? 0} c="#ea580c" />
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
        <span className="text-xs text-slate-400 ms-auto">{rows.length} {t('حادث', 'claims')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>{[t('اللوحة', 'Plate'), t('التاريخ', 'Date'), t('نسبة الخطأ', 'Fault'), t('شركة التأمين', 'Insurer'),
                t('المقدَّر', 'Estimated'), t('متوقع استرداده', 'Recovery'), t('الحالة', 'Status'), t('آخر رد', 'Last reply')].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                // مطالبة مفتوحة وعدّى عليها شهر من غير رد — دي اللي بتضيع.
                const staleDays = r.claim?.lastInsurerUpdateDate
                  ? Math.floor((Date.now() - new Date(r.claim.lastInsurerUpdateDate).getTime()) / 86400000) : null;
                const stale = r.statusCode !== 'closed' && staleDays != null && staleDays > 30;
                return (
                  <tr key={r._id} className="hover:bg-slate-50 text-center align-middle">
                    <td className="px-3 py-2.5">
                      {r.vehicle
                        ? <button onClick={() => router.push(`/system/vehicles/registry/${r.vehicle}`)}
                            className="font-semibold text-slate-800 hover:text-[#f37121]">{r.vehiclePlate || r.incidentSubjectAr}</button>
                        : <span className="text-slate-600">{r.vehiclePlate || r.incidentSubjectAr || '—'}</span>}
                      {r.accidentNumber && <p className="text-[10px] text-slate-400">{r.accidentNumber}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.accidentDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        (r.faultPercent || 0) >= 50 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {r.faultPercent ?? 0}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-[12px]">{r.claim?.insurerAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-semibold whitespace-nowrap">{r.claim?.estimatedAmountSar ? money(r.claim.estimatedAmountSar) : '—'}</td>
                    <td className="px-3 py-2.5 text-emerald-700 font-semibold whitespace-nowrap">{r.claim?.expectedRecoverySar ? money(r.claim.expectedRecoverySar) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        r.statusCode === 'closed' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                        {r.statusAr || (r.statusCode === 'closed' ? t('مقفولة', 'Closed') : t('قيد المتابعة', 'Pending'))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {staleDays == null ? <span className="text-slate-300">—</span> : (
                        <span className={`inline-flex items-center gap-1 text-[12px] ${stale ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                          {stale && <Clock className="w-3.5 h-3.5" />}{staleDays} {t('يوم', 'd')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">{t('لا توجد حوادث', 'No claims')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, c }: { label: string; value: any; c: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
      <p className="text-2xl font-extrabold leading-none" style={{ color: c }}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-tight">{label}</p>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ClaimsInner /></Suspense>;
}
