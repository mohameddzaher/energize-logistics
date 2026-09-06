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
  invoiceNumber: string; customer: string; partyId?: string; partyCode?: string;
  kind?: 'tax' | 'cash'; inLedger?: boolean; status?: string; comments?: string;
  invoiceDate: string | null; deliveryDate: string | null; collectionDate?: string | null;
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
  // ── والخطأُ يُكتب على الصفحة ────────────────────────────────────────────
  // كانت الصفحةُ ترتدُّ `null` عند الفشل، فيرى المستخدمُ بياضًا لا يُخبره
  // بشيء: أفشِل التحميل؟ أم لا فاتورةَ أصلًا؟ فالخطأُ يُحفظ ويُعرَض.
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!invoiceNumber) return;
    setLoading(true);
    try {
      setData(await api.get<Detail>(`/api/collections-dept/invoices/tax/${encodeURIComponent(invoiceNumber)}`));
      setError('');
    } catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNumber]);
  useEffect(() => { load(); }, [load]);

  const backToList = () => router.push('/system/collections-dept/invoices/tax');

  if (loading && !data) return <Spinner />;
  if (!data) return (
    <div className="max-w-lg mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm" dir={isRTL ? 'rtl' : 'ltr'}>
      <Receipt className="w-10 h-10 mx-auto text-slate-300" />
      <p className="mt-3 text-base font-bold text-slate-900">
        {t(`الفاتورة ${invoiceNumber}`, `Invoice ${invoiceNumber}`)}
      </p>
      <p className="mt-1.5 text-sm text-slate-500">{error || t('تعذّر التحميل', 'Could not load')}</p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button type="button" onClick={load}
          className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-slate-900 text-sm">
          {t('إعادة المحاولة', 'Retry')}
        </button>
        <button type="button" onClick={backToList}
          className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium">
          {t('رجوع للفواتير', 'Back to invoices')}
        </button>
      </div>
    </div>
  );

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
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {/* واسمُ العميل بابُ ملفّه — إن عُرف له ملفّ. */}
            {data.partyId ? (
              <button type="button" onClick={() => router.push(`/system/collections-dept/parties/${data.partyId}`)}
                className="font-medium text-[#f37121] hover:underline">{data.customer}</button>
            ) : <span>{data.customer}</span>}
            {data.invoiceDate && <span className="text-slate-400">· {dt(data.invoiceDate)}</span>}
            {data.kind === 'cash' && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                {t('نقديّة', 'Cash')}
              </span>
            )}
          </span>
        }
      >
        <button type="button" onClick={backToList}
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
            <thead className="table-head">
              <tr>
                {[t('رقم الكشف', 'Report'), t('التاريخ', 'Date'), t('المسار', 'Route'), t('الفرع', 'Branch'),
                  t('السيارة', 'Vehicle'), t('الصافي', 'Net'), t('الضريبة', 'VAT'), t('الإجمالي', 'Total'),
                  t('تاريخ التسليم', 'Delivered'), t('تاريخ التحصيل', 'Collected')].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* ── ولا كشوفَ حالٌ طبيعيّة ────────────────────────────────
                  أكثرُ فواتير الدفتر أقدمُ من النظام، فلا كشوفَ لها عندنا.
                  تُقال الحالُ ولا تُترك الصفحةُ فارغةً كأنّ شيئًا فُقد. */}
              {!data.reports.length && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                    {data.inLedger
                      ? t('فاتورةٌ من دفتر التحصيل، لا كشوفَ تشغيلٍ مرتبطةً بها.',
                          'A ledger invoice with no linked operations reports.')
                      : t('لا كشوفَ تحت هذه الفاتورة.', 'No reports under this invoice.')}
                  </td>
                </tr>
              )}
              {data.reports.map((r) => (
                <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                  {/* ورقمُ الكشف بابُ الكشف. */}
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    <button type="button" onClick={() => router.push(`/system/operations/${r._id}`)}
                      className="text-[#f37121] hover:underline font-medium">{r.reportNumber || '—'}</button>
                  </td>
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
