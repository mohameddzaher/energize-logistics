'use client';
/**
 * فواتيرُ عملاء التخليص — ما أصدره القسمُ ليُفوتَر.
 *
 * «طلبات الصرف» أعلاه ما ندفعه؛ وهذه ما نقبضه: كلُّ معاملةٍ أصدر قسمُ التخليص
 * فاتورتَها تظهر هنا برقمها ومجاميعها (محسوبةً في الخادم — utils/customsInvoice).
 *
 * والفاتورةُ تصدر بلا انتظار فاتورة النقل، فتصل إلى هنا كأيّ فاتورة. وما لم تصل
 * فاتورةُ نقله بعدُ يُلوَّن بالأحمر — ليُعرَف أنّ في المعاملة ورقةً ما زالت
 * منتظَرة، لا ليُؤخَّر تحصيلُها.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import ScrollX from '@/components/system/ScrollX';
import { Receipt, AlertTriangle, Loader2 } from 'lucide-react';

interface Inv {
  _id: string; refNumber: string; blNumber?: string; customerName: string; invoiceNumber: string; invoiceAt?: string;
  isCompleted?: boolean; awaitingTransportInvoice?: boolean; lines: number;
  totals: { net: number; vat: number; grand: number };
}
const money = (n?: number) => (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

export default function CustomsCustomerInvoices({ onOpen }: { onOpen: (id: string) => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [rows, setRows] = useState<Inv[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ invoices: Inv[]; summary: any }>('/api/customs-clearance/invoices?limit=300');
      setRows(d.invoices || []); setSummary(d.summary || {});
    } catch { /* الصفحةُ تبقى بما فيها */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('customs:updated', load);

  const shown = onlyAwaiting ? rows.filter((r) => r.awaitingTransportInvoice) : rows;
  const awaiting = summary.awaitingTransportInvoice || 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f37121]/15"><Receipt className="h-5 w-5 text-[#f37121]" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-slate-900">{t('فواتير عملاء التخليص', 'Customs customer invoices')}</p>
          <p className="text-xs text-slate-500">
            {t(`${summary.count || 0} فاتورة · الإجمالي ${money(summary.grand)} ر.س — اضغط الفاتورة لعرض معاملتها`,
               `${summary.count || 0} invoices · total ${money(summary.grand)} SAR — click one to see its transaction`)}
          </p>
        </div>
        <button type="button" onClick={() => setOnlyAwaiting((v) => !v)} disabled={!awaiting && !onlyAwaiting}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
            onlyAwaiting ? 'bg-red-600 text-white' : awaiting ? 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100' : 'bg-slate-100 text-slate-500'}`}>
          <AlertTriangle className="h-3.5 w-3.5" />
          {t(`بانتظار فاتورة النقل: ${awaiting}`, `Awaiting transport invoice: ${awaiting}`)}
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">{t('لا فواتير.', 'No invoices.')}</p>
      ) : (
        <ScrollX>
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-[12px] text-slate-500">
                {[t('رقم الفاتورة', 'Invoice no.'), t('التاريخ', 'Date'), t('رقم البوليصة', 'BL no.'), t('رقم المعاملة', 'Transaction no.'),
                  t('العميل', 'Customer'), t('قبل الضريبة', 'Net'), t('الضريبة', 'VAT'), t('الإجمالي', 'Total'), t('حالة المعاملة', 'Transaction state')].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r._id} onClick={() => onOpen(r._id)}
                  className={`cursor-pointer hover:bg-slate-50 ${r.awaitingTransportInvoice ? 'bg-red-50/70' : ''}`}>
                  <td className="px-3 py-2.5 font-bold text-slate-900"><bdi>{r.invoiceNumber}</bdi></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{r.invoiceAt ? new Date(r.invoiceAt).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700"><bdi>{r.blNumber || '—'}</bdi></td>
                  <td className="px-3 py-2.5 text-slate-500"><bdi>{r.refNumber}</bdi></td>
                  <td className="max-w-[14rem] truncate px-3 py-2.5 text-slate-700">{r.customerName || '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">{money(r.totals?.net)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">{money(r.totals?.vat)}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums text-slate-900">{money(r.totals?.grand)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {r.awaitingTransportInvoice
                      ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">{t('بانتظار فاتورة النقل', 'Awaiting transport invoice')}</span>
                      : r.isCompleted
                        ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">{t('مغلقة', 'Closed')}</span>
                        : <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">{t('مفتوحة', 'Open')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
    </div>
  );
}
