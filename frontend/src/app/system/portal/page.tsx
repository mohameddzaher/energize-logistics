'use client';
// بوابة العميل / المورد — الصفحة الرئيسية.
//
// What the partner sees the moment they log in. Everything here is decided by
// what they actually have with us: a heavy-transport customer gets loads and
// waybills, a customs customer gets containers and clearance stages, a supplier
// gets the loads they carried for us. Nobody sees an empty tab for a service
// they don't buy.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import {
  Truck, Package, Ship, FileText, Wallet, AlertTriangle, MapPin, Container,
  CheckCircle2, Clock, ArrowRight,
} from 'lucide-react';
import { KpiTile } from '@/components/system/Scorecard';
import {
  statusText, statusColor, customsStageText, money, fmtDate, type Lang, type PortalService,
} from '@/lib/portal';

interface Overview {
  kind: 'customer' | 'vendor';
  name: string;
  services: PortalService[];
  totals: Record<string, number>;
  recent: {
    heavyTransport?: any[]; shipmentOrders?: any[]; customs?: any[]; invoices?: any[]; loads?: any[];
  };
  inTransit?: any[];
  monthly: { month: string; count: number; value: number }[];
}

const SERVICE_ICON: Record<string, any> = {
  heavy_transport: Truck,
  shipment_orders: Package,
  customs: Ship,
  finance: FileText,
};

export default function PortalHomePage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.get<Overview>('/api/portal/overview'));
    } catch (e: any) {
      setError(e?.message || tx('Unable to load your dashboard', 'تعذّر تحميل لوحتك'));
    }
    setLoading(false);
    // tx is stable for a given language; re-creating load on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', load);
  useSocket('invoice:created', load);
  useSocket('payment:received', load);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) return <p className="text-slate-500">{error || tx('No data', 'لا توجد بيانات')}</p>;

  const t = data.totals;
  const isVendor = data.kind === 'vendor';
  const maxMonth = Math.max(1, ...data.monthly.map((m) => m.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{data.name}</h1>
        <p className="text-slate-500 text-sm mt-1">
          {isVendor
            ? tx('Everything you have carried for Energize Logistics.', 'كل ما نفّذته لصالح تنشيط للخدمات اللوجستية.')
            : tx('Everything Energize Logistics is handling for you.', 'كل ما تنفّذه تنشيط للخدمات اللوجستية لصالحك.')}
        </p>
      </div>

      {/* الخدمات — only the ones this partner actually uses */}
      {!!data.services.length && (
        <div className="flex flex-wrap gap-2">
          {data.services.map((s) => {
            const Icon = SERVICE_ICON[s.key] || Package;
            const href = s.key === 'customs' ? '/system/portal/customs'
              : s.key === 'finance' ? '/system/portal/invoices'
                : `/system/portal/shipments?type=${s.key === 'heavy_transport' ? 'heavy' : (isVendor ? 'vendor' : 'orders')}`;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => router.push(href)}
                className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm hover:border-[#f37121] transition-colors"
              >
                <span className="w-8 h-8 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="text-start">
                  <span className="block text-slate-900 text-sm font-medium">{ar ? s.ar : s.en}</span>
                  <span className="block text-slate-400 text-[11px]">{s.count.toLocaleString()} {tx('records', 'سجل')}</span>
                </span>
                <ArrowRight className="w-4 h-4 text-slate-300 rtl:rotate-180" />
              </button>
            );
          })}
        </div>
      )}

      {/* الأرقام */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {isVendor ? (
          <>
            <KpiTile label={tx('Loads carried', 'الحمولات المنفَّذة')} value={(t.loads || 0).toLocaleString()} icon={<Truck className="w-4 h-4" />} />
            <KpiTile label={tx('Delivered', 'تم التسليم')} value={(t.delivered || 0).toLocaleString()} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
            <KpiTile label={tx('In transit', 'في الطريق')} value={(t.inTransit || 0).toLocaleString()} accent="#f59e0b" icon={<MapPin className="w-4 h-4" />} />
            <KpiTile label={tx('Total earnings', 'إجمالي المستحق')} value={money(t.earnings)} accent="#16a34a" icon={<Wallet className="w-4 h-4" />} />
            <KpiTile label={tx('Average per load', 'متوسط الحمولة')} value={money(t.avgPerLoad)} />
            <KpiTile label={tx('Cancelled', 'ملغاة')} value={(t.cancelled || 0).toLocaleString()} accent="#94a3b8" />
          </>
        ) : (
          <>
            <KpiTile label={tx('Shipments', 'إجمالي الشحنات')} value={(t.shipments || 0).toLocaleString()} icon={<Truck className="w-4 h-4" />} />
            <KpiTile label={tx('In transit', 'في الطريق')} value={(t.inTransit || 0).toLocaleString()} accent="#f59e0b" icon={<MapPin className="w-4 h-4" />} />
            <KpiTile label={tx('Delivered', 'تم التسليم')} value={(t.delivered || 0).toLocaleString()} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
            <KpiTile label={tx('Customs files', 'معاملات التخليص')} value={(t.customsFiles || 0).toLocaleString()} accent="#0ea5e9" sub={`${(t.containers || 0).toLocaleString()} ${tx('containers', 'حاوية')}`} icon={<Container className="w-4 h-4" />} />
            <KpiTile label={tx('Outstanding', 'المستحق عليك')} value={money(t.outstanding)} accent={t.overdueAmount ? '#ef4444' : '#f37121'} sub={t.overdueCount ? `${t.overdueCount} ${tx('overdue', 'متأخرة')}` : undefined} icon={<Wallet className="w-4 h-4" />} />
            <KpiTile label={tx('Paid to date', 'إجمالي المدفوع')} value={money(t.paid)} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
          </>
        )}
      </div>

      {/* تنبيه المتأخرات */}
      {!isVendor && !!t.overdueCount && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 font-semibold text-sm">
              {tx(`${t.overdueCount} invoice(s) past due`, `${t.overdueCount} فاتورة تجاوزت موعد السداد`)}
            </p>
            <p className="text-red-600 text-xs mt-0.5">
              {tx('Total overdue', 'إجمالي المتأخر')}: {money(t.overdueAmount)}
              {' · '}
              <button type="button" onClick={() => router.push('/system/portal/invoices')} className="underline">
                {tx('View invoices', 'عرض الفواتير')}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* الشحنات الجارية */}
      {!!data.inTransit?.length && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-[#f37121]" />
            {tx('On the road now', 'على الطريق الآن')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.inTransit.map((s: any) => (
              <button
                key={s._id}
                type="button"
                onClick={() => router.push(`/system/portal/shipments/${s.waybillNumber >= 100000 ? 'heavy' : 'orders'}/${s._id}`)}
                className="text-start bg-slate-50 border border-slate-200 rounded-xl p-3 hover:border-[#f37121] transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-900 font-semibold text-sm">#{s.waybillNumber}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor(s.status)}1f`, color: statusColor(s.status) }}>
                    {statusText(s.status, lang as Lang)}
                  </span>
                </div>
                <p className="text-slate-600 text-xs mt-1.5">{s.fromCity || '—'} ← {s.toCity || '—'}</p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  {[s.vehiclePlate || s.vehicleName, s.driverName].filter(Boolean).join(' · ') || '—'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* الحركة الشهرية */}
      {!!data.monthly.length && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-[#f37121]" />
            {tx('Last 12 months', 'آخر ١٢ شهرًا')}
          </h3>
          <div className="flex items-end gap-1.5 h-32">
            {data.monthly.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group">
                <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">{m.count}</span>
                <div
                  className="w-full rounded-t bg-[#f37121]/80 hover:bg-[#f37121] transition-colors"
                  style={{ height: `${Math.max(2, (m.count / maxMonth) * 100)}%` }}
                  title={`${m.month}: ${m.count} · ${money(m.value)}`}
                />
                <span className="text-[9px] text-slate-400">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* أحدث السجلات لكل خدمة */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {!!data.recent.heavyTransport?.length && (
          <RecentList
            title={tx('Latest heavy-transport loads', 'أحدث حمولات النقل الثقيل')}
            icon={<Truck className="w-4 h-4 text-[#f37121]" />}
            onAll={() => router.push('/system/portal/shipments?type=heavy')}
            allLabel={tx('View all', 'عرض الكل')}
            rows={data.recent.heavyTransport.map((s: any) => ({
              id: s._id,
              href: `/system/portal/shipments/heavy/${s._id}`,
              title: `#${s.waybillNumber}`,
              sub: `${s.fromCity || '—'} ← ${s.toCity || '—'}`,
              meta: fmtDate(s.loadDate || s.createdAt),
              status: s.status,
            }))}
            router={router}
            lang={lang as Lang}
          />
        )}
        {!!data.recent.shipmentOrders?.length && (
          <RecentList
            title={tx('Latest shipment orders', 'أحدث طلبات الشحن')}
            icon={<Package className="w-4 h-4 text-[#f37121]" />}
            onAll={() => router.push('/system/portal/shipments?type=orders')}
            allLabel={tx('View all', 'عرض الكل')}
            rows={data.recent.shipmentOrders.map((s: any) => ({
              id: s._id,
              href: `/system/portal/shipments/orders/${s._id}`,
              title: `#${s.waybillNumber}`,
              sub: `${s.fromCity || '—'} ← ${s.toCity || '—'}`,
              meta: fmtDate(s.createdAt),
              status: s.status,
            }))}
            router={router}
            lang={lang as Lang}
          />
        )}
        {!!data.recent.loads?.length && (
          <RecentList
            title={tx('Latest loads you carried', 'أحدث الحمولات التي نفّذتها')}
            icon={<Truck className="w-4 h-4 text-[#f37121]" />}
            onAll={() => router.push('/system/portal/shipments?type=vendor')}
            allLabel={tx('View all', 'عرض الكل')}
            rows={data.recent.loads.map((s: any) => ({
              id: s._id,
              href: `/system/portal/shipments/vendor/${s._id}`,
              title: `#${s.waybillNumber}`,
              sub: `${s.fromCity || '—'} ← ${s.toCity || '—'}`,
              meta: money(s.buyPrice),
              status: s.status,
            }))}
            router={router}
            lang={lang as Lang}
          />
        )}
        {!!data.recent.customs?.length && (
          <RecentList
            title={tx('Latest customs files', 'أحدث معاملات التخليص')}
            icon={<Ship className="w-4 h-4 text-[#f37121]" />}
            onAll={() => router.push('/system/portal/customs')}
            allLabel={tx('View all', 'عرض الكل')}
            rows={data.recent.customs.map((c: any) => ({
              id: c._id,
              href: '/system/portal/customs',
              title: c.refNumber || c.blNumber || '—',
              sub: customsStageText(c.stage, lang as Lang),
              meta: `${c.containerCount || 0} ${tx('containers', 'حاوية')}`,
              status: '',
            }))}
            router={router}
            lang={lang as Lang}
          />
        )}
        {!!data.recent.invoices?.length && (
          <RecentList
            title={tx('Latest invoices', 'أحدث الفواتير')}
            icon={<FileText className="w-4 h-4 text-[#f37121]" />}
            onAll={() => router.push('/system/portal/invoices')}
            allLabel={tx('View all', 'عرض الكل')}
            rows={data.recent.invoices.map((i: any) => ({
              id: i._id,
              href: `/system/portal/invoices/${i._id}`,
              title: `#${i.invoiceNumber}`,
              sub: `${tx('Balance', 'المتبقي')}: ${money(i.balance)}`,
              meta: fmtDate(i.dueDate),
              status: '',
            }))}
            router={router}
            lang={lang as Lang}
          />
        )}
      </div>
    </div>
  );
}

function RecentList({
  title, icon, rows, onAll, allLabel, router, lang,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { id: string; href: string; title: string; sub: string; meta: string; status: string }[];
  onAll: () => void;
  allLabel: string;
  router: any;
  lang: Lang;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-2">{icon}{title}</h3>
        <button type="button" onClick={onAll} className="text-[#f37121] text-xs hover:underline">{allLabel}</button>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => router.push(r.href)} className="w-full text-start py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 -mx-2 px-2 rounded">
            <div className="min-w-0">
              <p className="text-slate-900 text-sm font-medium truncate">{r.title}</p>
              <p className="text-slate-500 text-xs truncate">{r.sub}</p>
            </div>
            <div className="text-end shrink-0">
              {r.status && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor(r.status)}1f`, color: statusColor(r.status) }}>
                  {statusText(r.status, lang)}
                </span>
              )}
              <p className="text-slate-400 text-[11px] mt-0.5">{r.meta}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
