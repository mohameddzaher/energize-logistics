'use client';
// بوابة العميل — تفاصيل الشحنة كاملة.
//
// «يشوف تفاصيله كلها كاملة» — everything about one load: the route, the truck,
// the driver, the price agreed with them, and the follow-up story (where the
// truck was and when), plus the بوليصة PDF for heavy-transport loads.
//
// What is NOT here is deliberate: our cost, the supplier's rate, internal notes.
// The customer sees their side of the transaction, not our margin.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import {
  ArrowRight, FileDown, MapPin, Truck, User, Calendar, Package, Clock, Loader2,
} from 'lucide-react';
import { statusText, statusColor, money, fmtDate, fmtDateTime, type Lang } from '@/lib/portal';

interface Detail {
  type: string;
  shipment: any;
  timeline: { type: string; at: string; status: string | null; location: string; note: string; expectedArrival: string | null }[];
  waybillUrl: string | null;
}

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
      setError(e?.message || tx('Shipment not found', 'الشحنة غير موجودة'));
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, lang]);
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
    } catch { /* the button simply does nothing rather than breaking the page */ }
    setPdfBusy(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (error || !data) return <p className="text-slate-500">{error}</p>;

  const s = data.shipment;
  const price = type === 'vendor' ? s.buyPrice : (s.price ?? s.sellPrice);

  const rows: [string, any][] = [
    [tx('Waybill number', 'رقم البوليصة'), `#${s.waybillNumber}`],
    [tx('Status', 'الحالة'), statusText(s.status, lang as Lang)],
    [tx('Load date', 'تاريخ التحميل'), fmtDate(s.loadDate || s.pickupTime || s.createdAt)],
    [tx('From', 'من'), s.fromCity || '—'],
    [tx('To', 'إلى'), s.toCity || '—'],
    [tx('Pickup address', 'عنوان الاستلام'), s.addressFrom || '—'],
    [tx('Delivery address', 'عنوان التسليم'), s.addressTo || '—'],
    [tx('Cargo type', 'نوع الحمولة'), s.loadType || s.cargoType || '—'],
    [tx('Truck type', 'نوع المركبة'), s.trailerType || s.truckType || '—'],
    [tx('Truck', 'المركبة'), s.vehiclePlate || s.vehicleName || '—'],
    [tx('Driver', 'السائق'), s.driverName || '—'],
    [tx('Driver phone', 'جوال السائق'), s.driverPhone || '—'],
    [tx('Quantity', 'الكمية'), s.quantity ?? '—'],
    [tx('Branch', 'الفرع'), s.branch || '—'],
    [tx('Amount', 'المبلغ'), money(price)],
    [tx('Expected arrival', 'الوصول المتوقع'), s.expectedArrival ? fmtDateTime(s.expectedArrival) : (s.arrivalTime ? fmtDateTime(s.arrivalTime) : '—')],
  ];

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => router.push(`/system/portal/shipments?type=${type}`)} className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {tx('Back to shipments', 'رجوع للشحنات')}
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">#{s.waybillNumber}</h1>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: `${statusColor(s.status)}1f`, color: statusColor(s.status) }}>
                {statusText(s.status, lang as Lang)}
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-1.5 inline-flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-[#f37121]" />
              {s.fromCity || '—'} ← {s.toCity || '—'}
            </p>
          </div>
          {data.waybillUrl && (
            <button
              type="button"
              onClick={downloadWaybill}
              disabled={pdfBusy}
              className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-medium rounded-lg px-3.5 py-2 disabled:opacity-60"
            >
              {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {tx('Download waybill (PDF)', 'تحميل البوليصة (PDF)')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Fact icon={<Truck className="w-4 h-4" />} label={tx('Truck', 'المركبة')} value={s.vehiclePlate || s.vehicleName || '—'} />
          <Fact icon={<User className="w-4 h-4" />} label={tx('Driver', 'السائق')} value={s.driverName || '—'} />
          <Fact icon={<Calendar className="w-4 h-4" />} label={tx('Load date', 'تاريخ التحميل')} value={fmtDate(s.loadDate || s.pickupTime || s.createdAt)} />
          <Fact icon={<Package className="w-4 h-4" />} label={tx('Amount', 'المبلغ')} value={money(price)} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-block mb-3">{tx('Full details', 'كل التفاصيل')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {rows.map(([k, v]) => (
              <div key={k} className="border-b border-slate-100 pb-1.5">
                <p className="text-slate-400 text-[11px] uppercase tracking-wide">{k}</p>
                <p className="text-slate-800 text-sm break-words">{v === null || v === undefined || v === '' ? '—' : String(v)}</p>
              </div>
            ))}
          </div>
          {s.notes && (
            <div className="mt-3">
              <p className="text-slate-400 text-[11px] uppercase tracking-wide mb-1">{tx('Notes', 'ملاحظات')}</p>
              <p className="text-slate-800 text-sm bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{s.notes}</p>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[#f37121]" />
            {tx('Tracking history', 'سجل التتبّع')}
          </h3>
          {data.timeline.length ? (
            <ol className="relative border-s border-slate-200 ms-2 space-y-4">
              {data.timeline.map((e, i) => (
                <li key={i} className="ms-4">
                  <span
                    className="absolute -start-1.5 w-3 h-3 rounded-full border-2 border-white"
                    style={{ backgroundColor: e.status ? statusColor(e.status) : '#cbd5e1' }}
                  />
                  <p className="text-slate-900 text-sm font-medium">
                    {e.status ? statusText(e.status, lang as Lang)
                      : e.type === 'followup' ? tx('Follow-up', 'متابعة')
                        : tx('Created', 'تم الإنشاء')}
                  </p>
                  {e.location && <p className="text-slate-600 text-xs mt-0.5 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{e.location}</p>}
                  {e.note && <p className="text-slate-500 text-xs mt-0.5">{e.note}</p>}
                  {e.expectedArrival && <p className="text-slate-400 text-[11px] mt-0.5">{tx('Expected arrival', 'الوصول المتوقع')}: {fmtDateTime(e.expectedArrival)}</p>}
                  <p className="text-slate-400 text-[11px] mt-0.5">{fmtDateTime(e.at)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-slate-400 text-sm">{tx('No tracking updates recorded for this shipment yet.', 'لا توجد تحديثات تتبّع مسجّلة لهذه الشحنة بعد.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <p className="text-slate-400 text-[10px] uppercase tracking-wide inline-flex items-center gap-1">{icon}{label}</p>
      <p className="text-slate-900 text-sm font-semibold mt-0.5 truncate">{value}</p>
    </div>
  );
}
