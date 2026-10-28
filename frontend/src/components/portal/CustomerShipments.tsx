'use client';
/**
 * The customer's single shipment list: every shipment from every source, without
 * statuses or operations fields; From and To are separate columns (owner's rule).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Truck } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import ScrollX from '@/components/system/ScrollX';
import PeriodFilter from '@/components/system/PeriodFilter';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { shipmentHref, type PortalShipment } from '@/components/portal/CustomerHome';

const dmy = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const PAGE = 100;

export default function CustomerShipments({ ar }: { ar: boolean }) {
  const router = useRouter();
  const tx = (en: string, a: string) => (ar ? a : en);
  const [items, setItems] = useState<PortalShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dest, setDest] = useState('');
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: PortalShipment[] }>('/api/portal/shipments?type=all');
      setItems(r.items || []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', load);

  const dests = useMemo(() => [...new Set(items.map((x) => x.to).filter(Boolean))].sort(), [items]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((x) => (!from || x.date >= from) && (!to || x.date <= to) && (!dest || x.to === dest)
      && (!t || `${x.number} ${x.from} ${x.to} ${x.driver} ${x.plate} ${x.truck}`.toLowerCase().includes(t)));
  }, [items, q, from, to, dest]);
  useEffect(() => { setShown(PAGE); }, [q, from, to, dest]);

  const columns: ExportColumn[] = [
    { header: tx('Shipment no.', 'رقم الشحنة'), key: 'number', width: 14 },
    { header: tx('Date', 'التاريخ'), key: 'date', transform: (v: any) => dmy(v), width: 13 },
    { header: tx('From', 'من'), key: 'from', width: 20 },
    { header: tx('To', 'إلى'), key: 'to', width: 20 },
    { header: tx('Truck', 'الشاحنة'), key: 'truck', width: 18 },
    { header: tx('Plate', 'اللوحة'), key: 'plate', width: 14 },
    { header: tx('Driver', 'السائق'), key: 'driver', width: 24 },
    { header: tx('Cargo', 'نوع الحمولة'), key: 'cargo', width: 16 },
  ];
  const scope = exportScopeLabels(ar);
  const name = tx('My shipments', 'شحناتي');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Truck className="h-6 w-6 text-[#f37121]" />{name}</h1>
          <p className="mt-1 text-sm text-slate-500">{tx(`${items.length.toLocaleString('en-US')} shipments`, `${items.length.toLocaleString('en-US')} شحنة`)}</p>
        </div>
        <ExportMenu fileName="my-shipments" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx('Export Excel', 'تصدير Excel')}
          options={[
            { key: 'shown', label: scope.shown, sheets: [{ name, rows: filtered, columns }] },
            { key: 'all', label: scope.all, sheets: [{ name, rows: items, columns }] },
          ]} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search number, city, driver, plate…', 'ابحث برقم الشحنة أو المدينة أو السائق أو اللوحة…')}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-sm text-slate-800 focus:border-[#f37121] focus:outline-none" />
        </div>
        <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label={tx('Destination', 'الوجهة')}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
          <option value="">{tx('All destinations', 'كل الوجهات')}</option>
          {dests.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <PeriodFilter from={from} to={to} onChange={(f, t2) => { setFrom(f); setTo(t2); }} ar={ar} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="bg-[#0b1f3a] text-[12px] text-white/80">
              {[tx('Shipment no.', 'رقم الشحنة'), tx('Date', 'التاريخ'), tx('From', 'من'), tx('To', 'إلى'), tx('Truck', 'الشاحنة'), tx('Plate', 'اللوحة'), tx('Driver', 'السائق')].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3 text-start font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{tx('Loading…', 'جارٍ التحميل…')}</td></tr>}
              {!loading && filtered.slice(0, shown).map((s) => (
                <tr key={`${s.kind}-${s.id}`} onClick={() => router.push(shipmentHref(s))} className="cursor-pointer hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-[#12325c]">#{s.number || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{dmy(s.date)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-800">{s.from || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-800">{s.to || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{s.truck || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{s.plate || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{s.driver || '—'}</td>
                </tr>
              ))}
              {!loading && !filtered.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{tx('No shipments', 'لا توجد شحنات')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
        {filtered.length > shown && (
          <div className="border-t border-slate-100 p-3 text-center">
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-sm font-semibold text-[#f37121] hover:underline">
              {tx(`Show more (${filtered.length - shown} left)`, `عرض المزيد (${filtered.length - shown} متبقية)`)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
