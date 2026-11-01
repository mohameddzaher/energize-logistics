'use client';
/**
 * Portal — one shipment. A customer sees what concerns him only: number, date,
 * route, truck, plate, driver, cargo, where the truck was reported, and the
 * waybill PDF for our own trucks. No status or operations data (owner's rule).
 * A supplier still sees the amount owed for the load he carried.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { ArrowRight, FileDown, MapPin, Truck, User, Calendar, Package, Loader2, Hash } from 'lucide-react';
import { money, fmtDateTime } from '@/lib/portal';

interface Detail {
  type: string;
  shipment: any;
  timeline: { at: string; location: string }[];
  waybillUrl: string | null;
}

const dmy = (d?: string) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '—');

export default function PortalShipmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);
  const type = String(params?.type || 'heavy');
  const id = String(params?.id || '');

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.get<Detail>(`/api/portal/shipments/${type}/${id}`));
    } catch (e: any) {
      setError(e?.message || (ar ? 'الشحنة غير موجودة' : 'Shipment not found'));
    }
    setLoading(false);
  }, [type, id, ar]);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', load);

  const downloadWaybill = async () => {
    if (!data?.waybillUrl) return;
    setPdfBusy(true);
    try {
      const blob = await api.getBlob(data.waybillUrl);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { /* the button does nothing rather than breaking the page */ }
    setPdfBusy(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (error || !data) return <p className="text-slate-500">{error}</p>;

  const isVendor = type === 'vendor';
  const raw = data.shipment || {};
  // Customers receive the public shape; a supplier's load comes raw.
  const s = isVendor ? {
    number: raw.reference || raw.waybillNumber, date: String(raw.pickupTime || raw.createdAt || '').slice(0, 10),
    from: raw.fromCity, to: raw.toCity, truck: raw.truckType, plate: raw.vehicleName, driver: raw.driverName, cargo: raw.cargoType,
  } : raw;

  const facts: [React.ReactNode, string, string][] = [
    [<Hash key="n" className="w-4 h-4" />, tx('Shipment no.', 'رقم الشحنة'), s.number ? `#${s.number}` : '—'],
    [<Calendar key="d" className="w-4 h-4" />, tx('Date', 'التاريخ'), dmy(s.date)],
    [<Truck key="t" className="w-4 h-4" />, tx('Truck', 'الشاحنة'), s.truck || '—'],
    [<Truck key="p" className="w-4 h-4" />, tx('Plate', 'اللوحة'), s.plate || '—'],
    [<User key="r" className="w-4 h-4" />, tx('Driver', 'السائق'), s.driver || '—'],
    [<Package key="c" className="w-4 h-4" />, tx('Cargo', 'نوع الحمولة'), s.cargo || '—'],
    ...(isVendor ? [[<Package key="a" className="w-4 h-4" />, tx('Amount', 'المبلغ'), money(raw.buyPrice)] as [React.ReactNode, string, string]] : []),
  ];

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => router.push('/system/portal/shipments')} className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 ltr:rotate-180" />
        {tx('Back to shipments', 'رجوع للشحنات')}
      </button>

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b1f3a] via-[#12325c] to-[#1d4a80] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-white/60">{tx('Shipment', 'شحنة')}</p>
            <h1 className="text-3xl font-bold">#{s.number || '—'}</h1>
            <p className="mt-1 text-sm text-white/70">{dmy(s.date)}</p>
          </div>
          {data.waybillUrl && (
            <button type="button" onClick={downloadWaybill} disabled={pdfBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e06010] disabled:opacity-60">
              {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {tx('Transport order (PDF)', 'أمر النقل (PDF)')}
            </button>
          )}
        </div>
        {/* Route: from → to, each on its own */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-[12px] text-white/60">{tx('From', 'من')}</p>
            <p className="mt-0.5 text-lg font-bold">{s.from || '—'}</p>
          </div>
          <MapPin className="mx-auto h-5 w-5 text-[#f37121]" />
          <div className="rounded-xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-[12px] text-white/60">{tx('To', 'إلى')}</p>
            <p className="mt-0.5 text-lg font-bold">{s.to || '—'}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {facts.map(([icon, label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">{icon}{label}</p>
            <p className="mt-1 truncate text-base font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </section>

      {data.timeline?.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold text-slate-900">{tx('Truck location updates', 'مواقع الشاحنة المسجّلة')}</h2>
          <ol className="relative ms-2 space-y-4 border-s border-slate-200">
            {data.timeline.map((e, i) => (
              <li key={i} className="ms-4">
                <span className="absolute -start-1.5 h-3 w-3 rounded-full border-2 border-white bg-[#f37121]" />
                <p className="inline-flex items-center gap-1 text-sm font-medium text-slate-900"><MapPin className="h-3.5 w-3.5" />{e.location}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(e.at)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
