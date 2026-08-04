'use client';
// بوابة العميل — كل الرحلات.
//
// The full trip register for whichever service the partner is looking at, with
// the بوليصة number on every row. Rows open the detail page, where the whole
// story of the load is (route, truck, driver, status timeline, waybill PDF).
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { Truck, Package, Search, Download, MapPin } from 'lucide-react';
import { statusText, statusColor, money, fmtDate, type Lang, type PortalService } from '@/lib/portal';
import { exportToExcel } from '@/utils/exportExcel';

type TripType = 'heavy' | 'orders' | 'vendor';

interface Trip {
  _id: string;
  waybillNumber: number;
  customerName?: string;
  fromCity?: string; toCity?: string;
  vehiclePlate?: string; vehicleName?: string; trailerType?: string;
  driverName?: string; driverPhone?: string;
  status: string;
  price?: number; sellPrice?: number; buyPrice?: number;
  loadType?: string; cargoType?: string; truckType?: string;
  branch?: string;
  loadDate?: string; createdAt?: string; expectedArrival?: string;
}

function ShipmentsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [type, setType] = useState<TripType>((sp?.get('type') as TripType) || 'heavy');
  const [items, setItems] = useState<Trip[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [services, setServices] = useState<PortalService[]>([]);
  const [kind, setKind] = useState<'customer' | 'vendor'>('customer');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  // Which tabs exist at all is a property of the partner, not of this page.
  useEffect(() => {
    api.get<{ services: PortalService[]; kind: 'customer' | 'vendor' }>('/api/portal/me')
      .then((m) => {
        setServices(m.services || []);
        setKind(m.kind);
        if (m.kind === 'vendor') setType('vendor');
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: Trip[]; byStatus: Record<string, number> }>(`/api/portal/shipments?type=${type}`);
      setItems(r.items || []);
      setByStatus(r.byStatus || {});
    } catch { setItems([]); }
    setLoading(false);
  }, [type]);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', load);

  const filtered = useMemo(() => {
    let list = items;
    if (status) list = list.filter((s) => s.status === status);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((s) => `${s.waybillNumber} ${s.fromCity} ${s.toCity} ${s.driverName} ${s.vehiclePlate || s.vehicleName}`.toLowerCase().includes(t));
    return list;
  }, [items, status, q]);

  const priceOf = (s: Trip) => (type === 'vendor' ? s.buyPrice : (s.price ?? s.sellPrice));

  const tabs: { key: TripType; label: string; icon: any }[] = kind === 'vendor'
    ? [{ key: 'vendor', label: tx('Loads I carried', 'الحمولات التي نفّذتها'), icon: Truck }]
    : [
      ...(services.some((s) => s.key === 'heavy_transport') ? [{ key: 'heavy' as TripType, label: tx('Heavy transport', 'النقل الثقيل'), icon: Truck }] : []),
      ...(services.some((s) => s.key === 'shipment_orders') ? [{ key: 'orders' as TripType, label: tx('Shipment orders', 'طلبات الشحن'), icon: Package }] : []),
    ];

  const exportRows = () => exportToExcel(
    filtered as unknown as Record<string, any>[],
    [
      { header: tx('Waybill #', 'رقم البوليصة'), key: 'waybillNumber', width: 14 },
      { header: tx('Date', 'التاريخ'), key: 'loadDate', transform: (v: any, r: any) => fmtDate(v || r.createdAt), width: 14 },
      { header: tx('From', 'من'), key: 'fromCity', width: 16 },
      { header: tx('To', 'إلى'), key: 'toCity', width: 16 },
      { header: tx('Truck', 'المركبة'), key: 'vehiclePlate', transform: (v: any, r: any) => v || r.vehicleName || '—', width: 16 },
      { header: tx('Driver', 'السائق'), key: 'driverName', width: 20 },
      { header: tx('Status', 'الحالة'), key: 'status', transform: (v: string) => statusText(v, lang as Lang), width: 16 },
      { header: tx('Amount', 'المبلغ'), key: 'price', transform: (_v: any, r: any) => money(priceOf(r)), width: 14 },
    ],
    `my-shipments-${type}`,
    tx('My shipments', 'شحناتي')
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tx('My shipments', 'شحناتي')}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {tx('Every trip with its waybill number and current status.', 'كل رحلة برقم بوليصتها وحالتها الحالية.')}
          </p>
        </div>
        <button type="button" onClick={exportRows} className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50">
          <Download className="w-4 h-4" />
          {tx('Export Excel', 'تصدير Excel')}
        </button>
      </div>

      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setType(t.key); setStatus(''); router.replace(`/system/portal/shipments?type=${t.key}`); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${
                  type === t.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Status chips double as the counts summary */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatus('')}
          className={`px-3 py-1 rounded-full text-xs font-medium border ${!status ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
        >
          {tx('All', 'الكل')} ({items.length})
        </button>
        {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(status === s ? '' : s)}
            className="px-3 py-1 rounded-full text-xs font-medium border"
            style={status === s
              ? { backgroundColor: statusColor(s), color: '#fff', borderColor: statusColor(s) }
              : { backgroundColor: `${statusColor(s)}14`, color: statusColor(s), borderColor: `${statusColor(s)}40` }}
          >
            {statusText(s, lang as Lang)} ({n})
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tx('Search waybill, city, driver…', 'ابحث برقم البوليصة أو المدينة أو السائق…')}
          className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Waybill', 'البوليصة')}</th>
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Date', 'التاريخ')}</th>
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Route', 'المسار')}</th>
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Truck', 'المركبة')}</th>
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Driver', 'السائق')}</th>
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Amount', 'المبلغ')}</th>
                <th className="px-4 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Status', 'الحالة')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">{tx('Loading…', 'جارٍ التحميل…')}</td></tr>}
              {!loading && filtered.map((s) => (
                <tr key={s._id} className="hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/portal/shipments/${type}/${s._id}`)}>
                  <td className="px-4 py-3 text-sm text-slate-900 font-semibold">#{s.waybillNumber}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(s.loadDate || s.createdAt)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {s.fromCity || '—'} ← {s.toCity || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{s.vehiclePlate || s.vehicleName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{s.driverName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">{money(priceOf(s))}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor(s.status)}1f`, color: statusColor(s.status) }}>
                      {statusText(s.status, lang as Lang)}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">{tx('No shipments', 'لا توجد شحنات')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function PortalShipmentsPage() {
  return (
    <Suspense fallback={<div className="h-64 flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>}>
      <ShipmentsInner />
    </Suspense>
  );
}
