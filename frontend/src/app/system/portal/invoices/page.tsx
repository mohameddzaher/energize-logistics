'use client';
/**
 * Portal — the customer's invoices: invoice number, date and the shipments it covers.
 * No money at all in the customer portal (owner's rule).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import ScrollX from '@/components/system/ScrollX';
import PeriodFilter from '@/components/system/PeriodFilter';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import type { PortalInvoice } from '@/components/portal/CustomerHome';

const dmy = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

export default function PortalInvoicesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);
  const [items, setItems] = useState<PortalInvoice[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: PortalInvoice[]; totals: Record<string, number> }>('/api/portal/invoices');
      setItems(r.items || []);
      setTotals(r.totals || {});
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('workflow:updated', load);

  const filtered = useMemo(() => items.filter((i) => (!from || i.date >= from) && (!to || i.date <= to)
    && (!q.trim() || `${i.number} ${i.routes || ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, from, to, q]);

  const columns: ExportColumn[] = [
    { header: tx('Invoice no.', 'رقم الفاتورة'), key: 'number', width: 16 },
    { header: tx('Date', 'التاريخ'), key: 'date', transform: (v: any) => dmy(v), width: 13 },
    { header: tx('Shipments', 'عدد الشحنات'), key: 'shipments', width: 12 },
    { header: tx('Route', 'المسار'), key: 'routes', width: 30 },
  ];
  const scope = exportScopeLabels(ar);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FileText className="h-6 w-6 text-[#f37121]" />{tx('My invoices', 'فواتيري')}</h1>
          <p className="mt-1 text-sm text-slate-500">{tx('Invoices issued on your shipments', 'الفواتير الصادرة على شحناتك')}</p>
        </div>
        <ExportMenu fileName="my-invoices" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx('Export Excel', 'تصدير Excel')}
          options={[
            { key: 'shown', label: scope.shown, sheets: [{ name: tx('Invoices', 'الفواتير'), rows: filtered, columns }] },
            { key: 'all', label: scope.all, sheets: [{ name: tx('Invoices', 'الفواتير'), rows: items, columns }] },
          ]} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[12px] text-slate-500">{tx('Invoices', 'الفواتير')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{(totals.count || 0).toLocaleString('en-US')}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[12px] text-slate-500">{tx('Shipments invoiced', 'شحنات مفوترة')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{(totals.shipments || 0).toLocaleString('en-US')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search invoice number…', 'ابحث برقم الفاتورة…')}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-sm focus:border-[#f37121] focus:outline-none" />
        </div>
        <PeriodFilter from={from} to={to} onChange={(f, t2) => { setFrom(f); setTo(t2); }} ar={ar} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-[#0b1f3a] text-[12px] text-white/80">
              {[tx('Invoice no.', 'رقم الفاتورة'), tx('Date', 'التاريخ'), tx('Shipments', 'الشحنات'), tx('Route', 'المسار')].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3 text-start font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">{tx('Loading…', 'جارٍ التحميل…')}</td></tr>}
              {!loading && filtered.map((i) => (
                <tr key={i.number} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-[#12325c]">{i.number}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{dmy(i.date)}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{i.shipments}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{i.routes || '—'}</td>
                </tr>
              ))}
              {!loading && !filtered.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">{tx('No invoices', 'لا توجد فواتير')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
