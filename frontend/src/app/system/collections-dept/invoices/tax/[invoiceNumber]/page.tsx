'use client';
/**
 * تفصيلُ فاتورةٍ ضريبيّة — كشوفُها كلُّها بأرقامها.
 *
 * الفاتورةُ الواحدة قد تضمّ كشوفًا عدّة، وذلك معتاد. والصفحةُ التي تعرضها صفًّا
 * واحدًا تقول «كم» ولا تقول «ممّ» — فهنا يُفتَح ما تحتها.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { money, dt } from '@/lib/collections';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Receipt, ArrowRight } from 'lucide-react';

interface Row {
  _id: string; reportNumber?: string; reportDate?: string; username?: string;
  branch?: string; payingBranch?: string; fromLocation?: string; toLocation?: string;
  carNumber?: string; carOwner?: string; sellingValue?: number;
  netInvoice?: number; tax?: number; totalInvoice?: number;
  invoiceDate?: string; deliveryDate?: string; sendingDate?: string; documentNumber?: string;
  collectedAmount?: number; collectionDate?: string; accountingReview?: string;
}
interface Detail {
  invoiceNumber: string; customer: string;
  invoiceDate: string | null; deliveryDate: string | null;
  reports: Row[];
  totals: { reports: number; net: number; vat: number; value: number; collectedReports: number };
}

export default function TaxInvoiceDetailPage() {
  const raw = useParams<{ invoiceNumber: string }>()?.invoiceNumber;
  const invoiceNumber = decodeURIComponent(String(raw || ''));
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!invoiceNumber) return;
    setLoading(true);
    try {
      setData(await api.get<Detail>(`/api/collections-dept/invoices/tax/${encodeURIComponent(invoiceNumber)}`));
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNumber]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const Stat = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm min-w-0">
      <p className="text-[11px] text-slate-500 truncate">{label}</p>
      <p className={`text-xl font-bold tabular-nums break-words ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  );

  const cols = [
    { header: t('رقم الكشف', 'Report no.'), key: 'reportNumber', width: 16 },
    { header: t('التاريخ', 'Date'), key: 'reportDate', width: 14, transform: (v: any) => dt(v) },
    { header: t('من', 'From'), key: 'fromLocation', width: 16 },
    { header: t('إلى', 'To'), key: 'toLocation', width: 16 },
    { header: t('الفرع', 'Branch'), key: 'branch', width: 14 },
    { header: t('رقم السيارة', 'Vehicle'), key: 'carNumber', width: 14 },
    { header: t('صافي الفاتورة', 'Net'), key: 'netInvoice', width: 14 },
    { header: t('ضريبة', 'VAT'), key: 'tax', width: 12 },
    { header: t('إجمالي الفاتورة', 'Total'), key: 'totalInvoice', width: 16 },
    { header: t('تاريخ التسليم', 'Delivered'), key: 'deliveryDate', width: 14, transform: (v: any) => dt(v) },
    { header: t('تاريخ التحصيل', 'Collected'), key: 'collectionDate', width: 14, transform: (v: any) => dt(v) },
  ];

  const allCollected = data.totals.collectedReports === data.totals.reports;

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Receipt className="w-6 h-6 text-[#f37121]" />}
        title={t(`فاتورة ${data.invoiceNumber}`, `Invoice ${data.invoiceNumber}`)}
        subtitle={[data.customer, data.invoiceDate ? dt(data.invoiceDate) : ''].filter(Boolean).join(' · ')}
      >
        <button type="button" onClick={() => router.push('/system/collections-dept/invoices/tax')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-sm">
          <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} />{t('رجوع', 'Back')}
        </button>
        <ExportMenu fileName={`invoice-${data.invoiceNumber}`} lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('كشوف الفاتورة', 'Invoice reports'), sheets: [{ name: t('الكشوف', 'Reports'), rows: data.reports as any, columns: cols }] }]} />
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label={t('عدد الكشوفات', 'Reports')} value={money(data.totals.reports)} />
        <Stat label={t('صافي الفواتير', 'Net')} value={money(data.totals.net)} />
        <Stat label={t('الضريبة', 'VAT')} value={money(data.totals.vat)} />
        <Stat label={t('القيمة', 'Value')} value={money(data.totals.value)} accent="text-slate-900" />
        <Stat
          label={t('المحصَّل منها', 'Collected')}
          value={`${data.totals.collectedReports} / ${data.totals.reports}`}
          accent={allCollected ? 'text-emerald-600' : 'text-red-600'}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-[13px] font-bold text-slate-900">{t('كشوف هذه الفاتورة', 'Reports under this invoice')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                {[t('رقم الكشف', 'Report'), t('التاريخ', 'Date'), t('المسار', 'Route'), t('الفرع', 'Branch'),
                  t('السيارة', 'Vehicle'), t('الصافي', 'Net'), t('الضريبة', 'VAT'), t('الإجمالي', 'Total'),
                  t('تاريخ التسليم', 'Delivered'), t('تاريخ التحصيل', 'Collected')].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">{r.reportNumber || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.reportDate)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{[r.fromLocation, r.toLocation].filter(Boolean).join(' — ') || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.branch || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.carNumber || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{money(r.netInvoice)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{money(r.tax)}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{money(r.totalInvoice)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.deliveryDate)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${r.collectionDate ? 'text-emerald-700' : 'text-red-500'}`}>
                    {r.collectionDate ? dt(r.collectionDate) : t('لم يُحصَّل', 'open')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold text-slate-900">
                <td className="px-3 py-2.5" colSpan={5}>{t('الإجمالي', 'Total')}</td>
                <td className="px-3 py-2.5 tabular-nums">{money(data.totals.net)}</td>
                <td className="px-3 py-2.5 tabular-nums">{money(data.totals.vat)}</td>
                <td className="px-3 py-2.5 tabular-nums">{money(data.totals.value)}</td>
                <td className="px-3 py-2.5" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
