'use client';
/**
 * Tax invoice detail: all its statements with their numbers.
 * One invoice may hold several statements, which is normal. A page showing it as one row says how much but not from what, so what is under it opens here.
 */
import { Fragment, useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { money, dt, canEditCollections } from '@/lib/collections';
import { useAuth } from '@/context/AuthContext';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Receipt, ArrowRight } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
import { AttachmentsPanel } from '@/components/collections/InvoiceAttachments';
import CustomsLinkBadge, { type CustomsLinkView } from '@/components/customs/CustomsLinkBadge';
import { useSocket } from '@/hooks/useSocket';
import ReportFollowUps from '@/components/operations/ReportFollowUps';
import { MessageSquareText } from 'lucide-react';

interface Row {
  _id: string; reportNumber?: string; reportDate?: string; username?: string;
  branch?: string; payingBranch?: string; fromLocation?: string; toLocation?: string;
  carNumber?: string; carOwner?: string; sellingValue?: number;
  netInvoice?: number; tax?: number; totalInvoice?: number;
  invoiceDate?: string; deliveryDate?: string; sendingDate?: string; documentNumber?: string;
  collectedAmount?: number; collectionDate?: string; accountingReview?: string;
  /** The clearance transaction the statement serves; see services/customsOpsLink. */
  customs?: CustomsLinkView | null;
  /** Number of follow-ups on the statement; see components/operations/ReportFollowUps. */
  followUps?: number;
}
interface Detail {
  invoiceNumber: string; customer: string; partyId?: string; partyCode?: string;
  kind?: 'tax' | 'cash'; inLedger?: boolean; status?: string; comments?: string;
  invoiceDate: string | null; deliveryDate: string | null; collectionDate?: string | null;
  reports: Row[];
  /** Clearance transactions served by the invoice's statements, combined. */
  customs?: CustomsLinkView[];
  totals: { reports: number; net: number; vat: number; value: number; collectedReports: number };
  /** Its collection status as collections itself reads it; see taxInvoiceDetail on the server. */
  collection?: Collection | null;
}
interface Collection {
  target: 'tax' | 'cash' | 'cashLedger'; value: number; collectedAmount: number;
  collectionState: 'none' | 'partial' | 'full'; remaining: number; collectionDate: string | null;
  payments: { _id: string; amount: number; date: string | null; byName?: string; note?: string; mode?: string }[];
}

const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

/**
 * Collecting the invoice from its own page.
 * A cash invoice in the ledger with no statement here appears neither on the cash page (reads statements) nor on the tax page (reads tax), so this page is the only way to collect it, and it had no button: the invoice stayed a debt on a customer who had paid.
 * So the collection is recorded here by number, and the server knows where to write it.
 */
function CollectionPanel({ invoiceNumber, c, canEdit, ar, onDone }: {
  invoiceNumber: string; c: Collection; canEdit: boolean; ar: boolean; onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm, prompt } = useDialog();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [date, setDate] = useState(todayYmd());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const full = c.collectionState === 'full';
  // Unknown value: the whole amount received is recorded, with no partial.
  const needAmount = !(c.value > 0);

  const collect = async () => {
    const partial = mode === 'partial' && !full;
    const a = Number(String(amount).replace(/,/g, ''));
    if ((partial || (needAmount && !full)) && !(a > 0)) { notify(t('اكتب المبلغ المحصَّل رقمًا أكبر من صفر', 'Enter an amount greater than zero'), 'error'); return; }
    if (!(await confirm({
      title: t('تسجيل التحصيل', 'Record collection'),
      message: partial
        ? t(`دفعةٌ جزئيّة ${money(a)} على الفاتورة ${invoiceNumber} بتاريخ ${date}؟`, `Partial payment ${money(a)} on invoice ${invoiceNumber} dated ${date}?`)
        : t(`تُسجَّل الفاتورة ${invoiceNumber} محصَّلةً بالكامل بتاريخ ${date}؟`, `Mark invoice ${invoiceNumber} fully collected on ${date}?`),
    }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/collect', {
        invoiceNumber, mode: partial ? 'partial' : 'full', collectionDate: date, note,
        ...(partial || needAmount ? { amount: a } : {}),
      });
      notify(r.message || t('سُجِّل التحصيل', 'Recorded'), 'success');
      setAmount(''); setNote('');
      onDone();
    } catch (e: any) { notify(e?.message || t('تعذّر التسجيل', 'Could not record'), 'error'); }
    setBusy(false);
  };

  const undo = async () => {
    const reason = await prompt({
      title: t('لم تُحصَّل', 'Not collected'),
      message: t(`يُرفع التحصيلُ عن الفاتورة ${invoiceNumber} وتعود غيرَ محصَّلة. السبب (اختياريّ):`, `Undo the collection of invoice ${invoiceNumber}. Reason (optional):`),
      confirmLabel: t('لم تُحصَّل', 'Not collected'),
    });
    if (reason === null) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/uncollect', { invoiceNumber, reason });
      notify(r.message || t('رُفع التحصيل', 'Undone'), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || t('تعذّر الرجوع', 'Could not undo'), 'error'); }
    setBusy(false);
  };

  const chip = full
    ? ['bg-emerald-50 text-emerald-700', t('محصَّلة بالكامل', 'Fully collected')]
    : c.collectionState === 'partial'
      ? ['bg-amber-50 text-amber-700', t('محصَّلة جزئيًّا', 'Partly collected')]
      : ['bg-red-50 text-red-600', t('لم تُحصَّل', 'Not collected')];

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-bold text-slate-900">{t('التحصيل', 'Collection')}</p>
        <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${chip[0]}`}>{chip[1]}</span>
        {full && c.collectionDate && <span className="text-xs text-slate-500">{t('بتاريخ', 'on')} {dt(c.collectionDate)}</span>}
        <span className="text-xs text-slate-500 tabular-nums">
          · {t('القيمة', 'Value')} {money(c.value)} · {t('المحصَّل', 'Collected')} {money(c.collectedAmount)}
          {!full && c.value > 0 ? ` · ${t('الباقي', 'Remaining')} ${money(c.remaining)}` : ''}
        </span>
        {c.target === 'cashLedger' && (
          <span className="text-[11px] text-slate-400">{t('— فاتورةٌ نقديّةٌ في دفتر التحصيل بلا أمر نقل', '— a cash book invoice with no operations report')}</span>
        )}
      </div>
      {!!c.payments?.length && (
        <ul className="text-xs text-slate-600 space-y-0.5">
          {c.payments.map((p) => (
            <li key={p._id} className="tabular-nums">{dt(p.date)} · {money(p.amount)}{p.byName ? ` · ${p.byName}` : ''}{p.note ? ` · ${p.note}` : ''}</li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          {!full && !needAmount && (
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              {([['full', t('بالكامل', 'In full')], ['partial', t('جزئي', 'Partial')]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMode(k)}
                  className={`px-3 py-2 ${mode === k ? 'bg-[#f37121] text-white' : 'bg-white text-slate-600'}`}>{l}</button>
              ))}
            </div>
          )}
          <label className="text-xs text-slate-500">{t('تاريخ التحصيل', 'Collection date')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="block mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" dir="ltr" />
          </label>
          {((mode === 'partial' && !full) || (needAmount && !full)) && (
            <label className="text-xs text-slate-500">{t('المبلغ', 'Amount')}
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="block mt-1 w-32 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 tabular-nums" dir="ltr" />
            </label>
          )}
          <label className="text-xs text-slate-500 flex-1 min-w-[160px]">{t('ملاحظة', 'Note')}
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="block mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
          </label>
          <button type="button" disabled={busy} onClick={collect}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
            {full ? t('تعديل تاريخ التحصيل', 'Change collection date') : t('تسجيل التحصيل', 'Record collection')}
          </button>
          {(full || c.collectionState === 'partial') && (
            <button type="button" disabled={busy} onClick={undo}
              className="px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold disabled:opacity-50">
              {t('لم تُحصَّل', 'Not collected')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaxInvoiceDetailPage() {
  const raw = useParams<{ invoiceNumber: string }>()?.invoiceNumber;
  const invoiceNumber = decodeURIComponent(String(raw || ''));
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = canEditCollections(user);

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  // The error is shown on the page.
  // The page used to return `null` on failure, so the user saw blank with no hint whether loading failed or the invoice does not exist. The error is kept and displayed.
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
  // The link between its statements and clearance changes from operations or the transaction page.
  useSocket('collections:changed', useCallback((d: any) => { if (d?.source === 'customs-link') load(); }, [load]));
  // Follow-ups on its statements are also written from operations and clearance, so the count follows them.
  useSocket('workflow:followUps', useCallback((d: any) => {
    if (!d?.invoiceNumber || d.invoiceNumber === invoiceNumber) load();
  }, [invoiceNumber, load]));
  // The statement opened on its follow-ups.
  const [openFu, setOpenFu] = useState('');

  const backToList = () => router.push('/system/collections-dept/invoices/tax');

  // Excel-style funnel over this invoice's statements.
  // One invoice can group 21 statements, so filtering here is not a luxury. Values are the cell texts as read, not raw values.
  const cf = useColumnFilters<any>();
  const RG: Record<string, (r: any) => any> = {
    reportNumber: (r) => r.reportNumber,
    reportDate: (r) => dt(r.reportDate),
    route: (r) => [r.fromLocation, r.toLocation].filter(Boolean).join(' — '),
    branch: (r) => r.branch,
    carNumber: (r) => r.carNumber,
    customs: (r) => r.customs?.refNumber || t('غير مرتبط', 'Not linked'),
    netInvoice: (r) => money(r.netInvoice),
    tax: (r) => money(r.tax),
    totalInvoice: (r) => money(r.totalInvoice),
    deliveryDate: (r) => dt(r.deliveryDate),
    collectionDate: (r) => (r.collectionDate ? dt(r.collectionDate) : t('لم يُحصَّل', 'open')),
  };
  const shown = cf.apply(data?.reports || [], RG);
  const totals = shown.reduce((a: any, r: any) => ({
    net: a.net + (r.netInvoice || 0), vat: a.vat + (r.tax || 0), value: a.value + (r.totalInvoice || 0),
  }), { net: 0, vat: 0, value: 0 });

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
    { header: t('رقم أمر النقل', 'Report no.'), key: 'reportNumber', width: 16 },
    { header: t('التاريخ', 'Date'), key: 'reportDate', width: 14, transform: (v: any) => dt(v) },
    { header: t('من', 'From'), key: 'fromLocation', width: 16 },
    { header: t('إلى', 'To'), key: 'toLocation', width: 16 },
    { header: t('الفرع', 'Branch'), key: 'branch', width: 14 },
    { header: t('رقم السيارة', 'Vehicle'), key: 'carNumber', width: 14 },
    { header: t('معاملة التخليص', 'Clearance'), key: 'customs', width: 16, transform: (v: any) => v?.refNumber || '' },
    { header: t('صافي الفاتورة', 'Net'), key: 'netInvoice', width: 14 },
    { header: t('ضريبة', 'VAT'), key: 'tax', width: 12 },
    { header: t('إجمالي الفاتورة', 'Total'), key: 'totalInvoice', width: 16 },
    { header: t('تاريخ التسليم', 'Delivered'), key: 'deliveryDate', width: 14, transform: (v: any) => dt(v) },
    { header: t('تاريخ التحصيل', 'Collected'), key: 'collectionDate', width: 14, transform: (v: any) => dt(v) },
  ];

  const allCollected = data.totals.reports > 0 && data.totals.collectedReports === data.totals.reports;

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Receipt className="w-6 h-6 text-[#f37121]" />}
        title={t(`فاتورة ${data.invoiceNumber}`, `Invoice ${data.invoiceNumber}`)}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {/* The customer name links to his file, when a file is known. */}
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
          // After the column funnel, not before; see shown.
          options={[{ key: 'shown', label: t('أوامر نقل الفاتورة', 'Invoice reports'), sheets: [{ name: t('أوامر النقل', 'Reports'), rows: shown as any, columns: cols }] }]} />
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label={t('عدد أوامر النقل', 'Reports')} value={money(data.totals.reports)} />
        <Stat label={t('صافي الفواتير', 'Net')} value={money(data.totals.net)} />
        <Stat label={t('الضريبة', 'VAT')} value={money(data.totals.vat)} />
        <Stat label={t('القيمة', 'Value')} value={money(data.totals.value)} accent="text-slate-900" />
        <Stat
          label={t('المحصَّل منها', 'Collected')}
          value={`${data.totals.collectedReports} / ${data.totals.reports}`}
          accent={allCollected ? 'text-emerald-600' : 'text-red-600'}
        />
      </div>

      {data.collection && (
        <CollectionPanel invoiceNumber={data.invoiceNumber} c={data.collection} canEdit={canEdit} ar={ar} onDone={load} />
      )}

      {/* Clearance transactions served by its statements. For a container-transport invoice, 'which transaction and which waybill?' is answered here. */}
      {!!data.customs?.length && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
          <p className="text-[13px] font-bold text-slate-900 mb-2">{t('التخليص الجمركي', 'Customs clearance')}</p>
          <div className="flex flex-wrap gap-3">
            {data.customs.map((c) => (
              <div key={c.clearanceId} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <CustomsLinkBadge link={c} ar={ar} />
                {c.customerName && <span>{c.customerName}</span>}
                <span className="text-slate-400">· {t(`${c.reports || 1} من أوامر النقل`, `${c.reports || 1} report(s)`)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <p className="text-[13px] font-bold text-slate-900">{t('أوامر نقل هذه الفاتورة', 'Reports under this invoice')}</p>
          <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        </div>
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {[['reportNumber', t('رقم أمر النقل', 'Report')], ['reportDate', t('التاريخ', 'Date')],
                  ['route', t('المسار', 'Route')], ['branch', t('الفرع', 'Branch')],
                  ['carNumber', t('السيارة', 'Vehicle')], ['customs', t('التخليص', 'Customs')], ['netInvoice', t('الصافي', 'Net')],
                  ['tax', t('الضريبة', 'VAT')], ['totalInvoice', t('الإجمالي', 'Total')],
                  ['deliveryDate', t('تاريخ التسليم', 'Delivered')], ['collectionDate', t('تاريخ التحصيل', 'Collected')]].map(([k, h]) => (
                  <th key={k} className="px-3 py-2 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">{h}{cf.header(k, data.reports, RG[k], ar)}</span>
                  </th>
                ))}
                <th className="px-3 py-2 text-start font-semibold whitespace-nowrap">{t('المتابعة', 'Follow-up')}</th>
              </tr>
            </thead>
            <tbody>
              {/* No statements is a normal case. Most ledger invoices predate the system and have no transport orders here. State the case instead of leaving the page empty as if something were lost. */}
              {!shown.length && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">
                    {data.inLedger
                      ? t('فاتورةٌ من دفتر التحصيل، لا أوامر نقلٍ مرتبطةً بها.',
                          'A ledger invoice with no linked operations reports.')
                      : t('لا أوامر نقل تحت هذه الفاتورة.', 'No reports under this invoice.')}
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <Fragment key={r._id}>
                <tr className="border-b border-slate-100 hover:bg-slate-50">
                  {/* The statement number links to the statement. */}
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    <button type="button" onClick={() => router.push(`/system/operations/${r._id}`)}
                      className="text-[#f37121] hover:underline font-medium">{r.reportNumber || '—'}</button>
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.reportDate)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{[r.fromLocation, r.toLocation].filter(Boolean).join(' — ') || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.branch || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.carNumber || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.customs ? <CustomsLinkBadge link={r.customs} ar={ar} compact /> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{money(r.netInvoice)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{money(r.tax)}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{money(r.totalInvoice)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.deliveryDate)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${r.collectionDate ? 'text-emerald-700' : 'text-red-500'}`}>
                    {r.collectionDate ? dt(r.collectionDate) : t('لم يُحصَّل', 'open')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button type="button" onClick={() => setOpenFu(openFu === r._id ? '' : r._id)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${openFu === r._id ? 'border-[#f37121]/40 text-[#f37121]' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`}>
                      <MessageSquareText className="w-3.5 h-3.5" />{r.followUps || 0}
                    </button>
                  </td>
                </tr>
                {openFu === r._id && (
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <td colSpan={12} className="px-4 py-3">
                      <p className="mb-2 text-xs font-semibold text-slate-700">{t(`متابعات أمر النقل ${r.reportNumber || ''}`, `Follow-ups — ${r.reportNumber || ''}`)}</p>
                      <ReportFollowUps compact ar={ar} workflowId={r._id}
                        basePath={`/api/collections-dept/reports/${r._id}/follow-ups`} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold text-slate-900">
                <td className="px-3 py-2.5" colSpan={6}>{t('الإجمالي', 'Total')}</td>
                {/* The total follows what remains after the funnel: a total over unseen rows would be read as the total of what is shown, and it is not. */}
                <td className="px-3 py-2.5 tabular-nums">{money(totals.net)}</td>
                <td className="px-3 py-2.5 tabular-nums">{money(totals.vat)}</td>
                <td className="px-3 py-2.5 tabular-nums">{money(totals.value)}</td>
                <td className="px-3 py-2.5" colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </ScrollX>
      </div>

      {/* Invoice papers: the signed copy, the receipt of delivery and what is being claimed. */}
      <AttachmentsPanel kind="tax" invKey={data.invoiceNumber} />
    </div>
  );
}
