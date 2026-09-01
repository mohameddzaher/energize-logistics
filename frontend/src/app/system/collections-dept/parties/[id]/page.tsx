'use client';
/**
 * ملفُّ الطرف — عميلًا كان أو موردًا.
 *
 * السؤالُ الذي لم تكن له شاشة: «كم لنا عند هذا العميل، ومن أيّ كشوف؟» كان
 * جوابُه تصديرَ الجدول كلِّه وفلترتَه في إكسل. وهنا: أرقامُه، وحركتُه بالشهر،
 * وكشوفُه بتفاصيلها — وكلُّ صيغةٍ كُتب بها اسمُه في الكشوف تخصّه.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { kindWords, money, dt, type CollectionsParty } from '@/lib/collections';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Users, Truck, ArrowRight, Phone, Mail, Building2 } from 'lucide-react';

interface Report {
  _id: string; reportNumber?: string; reportDate?: string;
  fromLocation?: string; toLocation?: string; branch?: string; carNumber?: string;
  sellingValue?: number; purchaseValue?: number;
  collectionDate?: string; paymentDate?: string;
  invoiceNumber?: string; invoiceDate?: string; totalInvoice?: number;
  payingBranch?: string; documentNumber?: string; executionStatus?: string;
}
interface Profile {
  party: CollectionsParty;
  reports: Report[];
  reportsTotal: number;
  page: number;
  pages: number;
  monthly: { month: string; reports: number; total: number; settled: number; outstanding: number }[];
}

export default function PartyProfilePage() {
  // `useParams` قد تعود فارغةً أثناء أوّل رسمة، فتُقرأ بحذر.
  const id = String(useParams<{ id: string }>()?.id || '');
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Profile>(`/api/collections-dept/parties/${id}?page=${page}&limit=100`));
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const p = data.party;
  const kind = p.kind;
  const W = kindWords(kind, ar);
  const Icon = kind === 'supplier' ? Truck : Users;
  // العمودُ الذي يحمل المال يختلف بالجهة، وكذلك الذي يقول إنّه أُغلق.
  const valueKey = kind === 'customer' ? 'sellingValue' : 'purchaseValue';
  const closedKey = kind === 'customer' ? 'collectionDate' : 'paymentDate';

  const Stat = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm min-w-0">
      <p className="text-[11px] text-slate-500 truncate">{label}</p>
      <p className={`text-xl font-bold tabular-nums break-words ${accent || 'text-slate-900'}`} title={value}>{value}</p>
    </div>
  );

  const Row = ({ label, value, href }: { label: string; value?: string | number | null; href?: string }) => {
    if (value === undefined || value === null || value === '' || value === 0) return null;
    return (
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-slate-400 text-[12px] shrink-0">{label}</span>
        {href
          ? <a href={href} className="text-[#f37121] hover:underline break-all">{value}</a>
          : <span className="text-slate-800 break-all">{value}</span>}
      </div>
    );
  };

  const reportCols = [
    { header: t('رقم الكشف', 'Report no.'), key: 'reportNumber', width: 16 },
    { header: t('التاريخ', 'Date'), key: 'reportDate', width: 14, transform: (v: any) => dt(v) },
    { header: t('من', 'From'), key: 'fromLocation', width: 16 },
    { header: t('إلى', 'To'), key: 'toLocation', width: 16 },
    { header: t('الفرع', 'Branch'), key: 'branch', width: 14 },
    { header: t('رقم السيارة', 'Vehicle'), key: 'carNumber', width: 14 },
    { header: kind === 'customer' ? t('قيمة البيع', 'Selling') : t('قيمة الشراء', 'Purchase'), key: valueKey, width: 14 },
    { header: t('رقم الفاتورة', 'Invoice no.'), key: 'invoiceNumber', width: 16 },
    { header: kind === 'customer' ? t('تاريخ التحصيل', 'Collected on') : t('تاريخ السداد', 'Paid on'), key: closedKey, width: 14, transform: (v: any) => dt(v) },
    { header: t('رقم السند', 'Voucher'), key: 'documentNumber', width: 14 },
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Icon className="w-6 h-6 text-[#f37121]" />}
        title={p.name}
        subtitle={[p.city, p.partyType, p.status].filter(Boolean).join(' · ') || W.title}
      >
        <button
          type="button"
          onClick={() => router.push(`/system/collections-dept/${kind === 'customer' ? 'customers' : 'suppliers'}`)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-sm"
        >
          <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /> {t('رجوع', 'Back')}
        </button>
        <ExportMenu
          fileName={`collections-${p.name}`}
          lang={ar ? 'ar' : 'en'}
          options={[{
            key: 'shown',
            label: t('كشوف هذه الصفحة', 'Reports on this page'),
            sheets: [{ name: t('الكشوف', 'Reports'), rows: data.reports, columns: reportCols }],
          }]}
        />
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label={t('كشوف', 'Reports')} value={money(p.reports)} />
        <Stat label={W.totalLabel} value={money(p.total)} />
        <Stat label={W.settledLabel} value={money(p.settled)} accent="text-emerald-600" />
        <Stat label={W.dueLabel} value={money(p.outstanding)} accent={p.outstanding > 0 ? 'text-red-600' : 'text-slate-400'} />
        <Stat label={W.openLabel} value={money(p.openReports)} accent={p.openReports > 0 ? 'text-amber-600' : 'text-slate-400'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
          <div>
            <p className="text-[13px] font-bold text-slate-900 mb-2 flex items-center gap-1.5">
              <Phone className="w-4 h-4 text-slate-400" />{t('التواصل', 'Contact')}
            </p>
            <div className="space-y-1.5">
              <Row label={t('الجوال', 'Phone')} value={p.phone} href={p.phone ? `tel:${p.phone}` : undefined} />
              <Row label={t('البريد', 'Email')} value={p.email} href={p.email ? `mailto:${p.email}` : undefined} />
              <Row label={t('مسؤول التواصل', 'Contact')} value={p.contactPerson} />
              <Row label={t('جوال المسؤول', 'Contact phone')} value={p.contactPhone} href={p.contactPhone ? `tel:${p.contactPhone}` : undefined} />
              {/* محاسبُ الطرف: مناقشةُ سندٍ مع المالك تضيّع يومًا. */}
              <Row label={t('محاسب الطرف', 'Their accountant')} value={p.accountantName} />
              <Row label={t('جوال المحاسب', 'Accountant phone')} value={p.accountantPhone} href={p.accountantPhone ? `tel:${p.accountantPhone}` : undefined} />
            </div>
          </div>

          <div>
            <p className="text-[13px] font-bold text-slate-900 mb-2 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-slate-400" />{t('الهوية التجارية', 'Commercial identity')}
            </p>
            <div className="space-y-1.5">
              <Row label={t('السجل التجاري', 'CR')} value={p.commercialRegister} />
              <Row label={t('الرقم الضريبي', 'Tax no.')} value={p.taxNumber} />
              <Row label={t('الآيبان', 'IBAN')} value={p.iban} />
              <Row label={t('البنك', 'Bank')} value={p.bankName} />
              <Row label={t('العنوان', 'Address')} value={p.address} />
            </div>
          </div>

          <div>
            <p className="text-[13px] font-bold text-slate-900 mb-2">{t('شروط التحصيل', 'Collection terms')}</p>
            <div className="space-y-1.5">
              <Row label={t('شروط السداد', 'Payment terms')} value={p.paymentTerms} />
              <Row label={t('حد الائتمان', 'Credit limit')} value={p.creditLimit ? money(p.creditLimit) : ''} />
              <Row label={t('آخر كشف', 'Last report')} value={p.lastReportAt ? dt(p.lastReportAt) : ''} />
              <Row label={kind === 'customer' ? t('آخر تحصيل', 'Last collected') : t('آخر سداد', 'Last paid')} value={p.lastSettledAt ? dt(p.lastSettledAt) : ''} />
              <Row label={t('المتابعة القادمة', 'Next follow-up')} value={p.nextFollowUpAt ? dt(p.nextFollowUpAt) : ''} />
              <Row label={t('ملاحظات', 'Notes')} value={p.notes} />
            </div>
          </div>

          {/* الاسمُ الواحدُ كُتب بصيغتين في الكشوف — يُقال صراحةً، لأنّ من رأى
              الصيغةَ الأخرى في مكانٍ آخر يظنّها طرفًا ثانيًا. */}
          {p.nameVariants && p.nameVariants.length > 1 && (
            <div>
              <p className="text-[13px] font-bold text-slate-900 mb-2">{t('صيغ الاسم في الكشوف', 'Name spellings in the reports')}</p>
              <ul className="text-[12px] text-slate-500 space-y-0.5">
                {p.nameVariants.map((n) => <li key={n}>· {n}</li>)}
              </ul>
              <p className="text-[11px] text-slate-400 mt-1">
                {t('كلُّها مجموعةٌ في هذا الملف', 'All merged into this profile')}
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[13px] font-bold text-slate-900 mb-3">{t('الحركة بالشهر', 'Monthly movement')}</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: any) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name={W.totalLabel} stroke="#334155" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="settled" name={W.settledLabel} stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="outstanding" name={W.dueLabel} stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[13px] font-bold text-slate-900">
            {t(`الكشوف (${money(data.reportsTotal)})`, `Reports (${money(data.reportsTotal)})`)}
          </p>
          <p className="text-[11px] text-slate-400">{t('الملغاة مستثناة', 'Cancelled excluded')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                {[t('رقم الكشف', 'Report'), t('التاريخ', 'Date'), t('المسار', 'Route'), t('الفرع', 'Branch'),
                  kind === 'customer' ? t('قيمة البيع', 'Selling') : t('قيمة الشراء', 'Purchase'),
                  t('رقم الفاتورة', 'Invoice'),
                  kind === 'customer' ? t('تاريخ التحصيل', 'Collected') : t('تاريخ السداد', 'Paid'),
                  t('الحالة', 'Status')].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.reports.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">{t('لا كشوف', 'No reports')}</td></tr>
              ) : data.reports.map((r) => {
                const closed = (r as any)[closedKey];
                return (
                  <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">{r.reportNumber || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.reportDate)}</td>
                    {/* «من» و«إلى» في خليّتين لا خليّةً بسهم: السهمُ يشير يسارًا
                        والنصُّ يجري يمينًا فيُقرأ بالعينين. */}
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {[r.fromLocation, r.toLocation].filter(Boolean).join(' — ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.branch || '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-800">{money((r as any)[valueKey])}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.invoiceNumber || '—'}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${closed ? 'text-emerald-700' : 'text-red-500'}`}>
                      {closed ? dt(closed) : t('لم يُغلق', 'open')}
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.executionStatus || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500">{t(`صفحة ${data.page} من ${data.pages}`, `Page ${data.page} of ${data.pages}`)}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('السابق', 'Prev')}</button>
              <button type="button" disabled={page >= data.pages} onClick={() => setPage((x) => x + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('التالي', 'Next')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
