'use client';
/**
 * Customer portal home: one view of everything we do for the customer.
 * One shipment list (no statuses or internal fields), invoices, customs, trends.
 */
import { useRouter } from 'next/navigation';
import { Truck, MapPin, FileText, Ship, ArrowUpRight, TrendingUp, TrendingDown, Receipt, Route, Container } from 'lucide-react';
import { money, customsStageText } from '@/lib/portal';

export interface PortalShipment {
  id: string; kind: 'platform' | 'orders' | 'heavy'; number: string; date: string;
  from: string; to: string; truck: string; plate: string; driver: string; cargo?: string; waybill?: boolean;
}
export interface PortalInvoice {
  number: string; date: string; shipments: number; net: number; tax: number; total: number; paid: boolean; collectedOn?: string; routes?: string;
}
export interface CustomerOverview {
  name: string;
  totals: Record<string, number>;
  topRoutes: { label: string; count: number }[];
  trucks: { label: string; count: number }[];
  recent: { shipments: PortalShipment[]; invoices: PortalInvoice[]; customs: any[] };
  monthly: { month: string; count: number }[];
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const n0 = (v: number) => (Number(v) || 0).toLocaleString('en-US');
const dmy = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

export const shipmentHref = (s: PortalShipment) => `/system/portal/shipments/${s.kind}/${s.id}`;

export default function CustomerHome({ data, ar }: { data: CustomerOverview; ar: boolean }) {
  const router = useRouter();
  const t = data.totals;
  const tx = (en: string, a: string) => (ar ? a : en);
  const delta = t.lastMonth ? Math.round(((t.thisMonth - t.lastMonth) / t.lastMonth) * 100) : null;
  const maxMonth = Math.max(1, ...data.monthly.map((m) => m.count));
  const maxRoute = Math.max(1, ...data.topRoutes.map((r) => r.count));
  const last12 = data.monthly.reduce((a, m) => a + m.count, 0);

  const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b1f3a] via-[#12325c] to-[#1d4a80] p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-[#f37121]/20 blur-3xl" />
        <p className="text-[12px] font-semibold tracking-wide text-white/60">{tx('Customer portal · Energize Logistics', 'بوابة العملاء · تنشيط للخدمات اللوجستية')}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{data.name}</h1>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroStat label={tx('Total shipments', 'إجمالي الشحنات')} value={n0(t.shipments)} sub={tx(`${n0(last12)} in the last 12 months`, `${n0(last12)} خلال آخر 12 شهرًا`)} />
          <HeroStat label={tx('This month', 'هذا الشهر')} value={n0(t.thisMonth)}
            sub={delta === null ? tx(`Last month ${n0(t.lastMonth)}`, `الشهر الماضي ${n0(t.lastMonth)}`) : (
              <span className={`inline-flex items-center gap-1 ${delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {`${delta >= 0 ? '+' : ''}${delta}%`} {tx('vs last month', 'عن الشهر الماضي')}
              </span>
            )} />
          <HeroStat label={tx('Destinations', 'الوجهات')} value={n0(t.destinations)} sub={tx(`${n0(t.routes)} routes`, `${n0(t.routes)} مسارًا`)} />
          <HeroStat label={tx('Invoices', 'الفواتير')} value={n0(t.invoices)}
            sub={t.outstandingCount ? tx(`${n0(t.outstandingCount)} unpaid`, `${n0(t.outstandingCount)} غير مسدّدة`) : tx('All settled', 'كلها مسدّدة')} />
        </div>
      </section>

      {/* Trend + top routes */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">{tx('Shipments per month', 'الشحنات شهريًا')}</h2>
            <span className="text-xs text-slate-400">{tx('Last 12 months', 'آخر 12 شهرًا')}</span>
          </div>
          <div className="flex h-48 items-end gap-1.5" role="img" aria-label={tx('Shipments per month', 'الشحنات شهريًا')}>
            {data.monthly.map((m) => {
              const mi = Number(m.month.slice(5, 7)) - 1;
              const h = Math.round((m.count / maxMonth) * 100);
              return (
                <div key={m.month} className="group flex flex-1 flex-col items-center gap-1" title={`${(ar ? MONTHS_AR : MONTHS_EN)[mi]} ${m.month.slice(0, 4)}: ${m.count}`}>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-500 opacity-0 transition group-hover:opacity-100">{m.count}</span>
                  <div className="flex w-full flex-1 items-end">
                    <div className="w-full rounded-t-md bg-[#12325c]/85 transition group-hover:bg-[#f37121]" style={{ height: `${Math.max(h, m.count ? 4 : 1)}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-400">{(ar ? MONTHS_AR : MONTHS_EN)[mi].slice(0, ar ? 3 : 3)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-900"><Route className="h-4 w-4 text-[#f37121]" />{tx('Top routes', 'أكثر المسارات')}</h2>
          {data.topRoutes.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <ul className="space-y-3">
              {data.topRoutes.map((r) => (
                <li key={r.label}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate text-slate-700" title={r.label}>{r.label}</span>
                    <span className="shrink-0 font-bold tabular-nums text-slate-900">{n0(r.count)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-[#f37121]" style={{ width: `${(r.count / maxRoute) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Latest shipments */}
      <section className={card}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><Truck className="h-4 w-4 text-[#f37121]" />{tx('Latest shipments', 'أحدث الشحنات')}</h2>
          <button type="button" onClick={() => router.push('/system/portal/shipments')} className="inline-flex items-center gap-1 text-sm font-semibold text-[#f37121] hover:underline">
            {tx('All shipments', 'كل الشحنات')} <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-slate-500">
              {[tx('Shipment no.', 'رقم الشحنة'), tx('Date', 'التاريخ'), tx('From', 'من'), tx('To', 'إلى'), tx('Truck', 'الشاحنة'), tx('Plate', 'اللوحة'), tx('Driver', 'السائق')].map((h) => (
                <th key={h} className="whitespace-nowrap px-5 py-2.5 text-start font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.recent.shipments.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">{tx('No shipments yet', 'لا توجد شحنات بعد')}</td></tr>}
              {data.recent.shipments.map((s) => (
                <tr key={`${s.kind}-${s.id}`} onClick={() => router.push(shipmentHref(s))} className="cursor-pointer hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 font-bold text-[#12325c]">#{s.number || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums text-slate-600">{dmy(s.date)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-800">{s.from || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-800">{s.to || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{s.truck || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{s.plate || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{s.driver || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Invoices + customs + trucks */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><Receipt className="h-4 w-4 text-[#f37121]" />{tx('Invoices', 'الفواتير')}</h2>
            {t.invoices > 0 && (
              <button type="button" onClick={() => router.push('/system/portal/invoices')} className="inline-flex items-center gap-1 text-sm font-semibold text-[#f37121] hover:underline">
                {tx('All invoices', 'كل الفواتير')} <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
              </button>
            )}
          </div>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <MiniStat label={tx('Invoices', 'عدد الفواتير')} value={n0(t.invoices)} />
            <MiniStat label={tx('Invoiced (SAR)', 'إجمالي المفوتر (ر.س)')} value={money(t.invoicedTotal)} />
            <MiniStat label={tx('Unpaid (SAR)', 'غير المسدّد (ر.س)')} value={money(t.outstandingTotal)} tone={t.outstandingTotal ? 'warn' : 'ok'} />
          </div>
          {data.recent.invoices.length === 0 ? <p className="text-sm text-slate-400">{tx('No invoices yet', 'لا توجد فواتير بعد')}</p> : (
            <ul className="divide-y divide-slate-100">
              {data.recent.invoices.map((i) => (
                <li key={i.number} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900"><FileText className="me-1 inline h-3.5 w-3.5 text-slate-400" />{i.number}</p>
                    <p className="text-[12px] text-slate-500">{dmy(i.date)} · {i.shipments} {tx('shipments', 'شحنة')}</p>
                  </div>
                  <div className="text-end">
                    <p className="font-bold tabular-nums text-slate-900">{money(i.total)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${i.paid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{i.paid ? tx('Paid', 'مسدّدة') : tx('Unpaid', 'غير مسدّدة')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-5">
          {t.customsFiles > 0 && (
            <div className={`${card} p-5`}>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><Ship className="h-4 w-4 text-[#f37121]" />{tx('Customs clearance', 'التخليص الجمركي')}</h2>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <MiniStat label={tx('Files', 'معاملات')} value={n0(t.customsFiles)} />
                <MiniStat label={tx('Containers', 'حاويات')} value={n0(t.containers)} />
              </div>
              <ul className="space-y-1.5 text-[13px]">
                {data.recent.customs.slice(0, 4).map((c: any) => (
                  <li key={c._id} className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-800"><Container className="me-1 inline h-3.5 w-3.5 text-slate-400" />{c.blNumber || c.refNumber}</span>
                    <span className="shrink-0 text-slate-500">{customsStageText(c.stage, ar ? 'ar' : 'en')}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => router.push('/system/portal/customs')} className="mt-3 text-sm font-semibold text-[#f37121] hover:underline">{tx('Open', 'فتح')}</button>
            </div>
          )}
          <div className={`${card} p-5`}>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><MapPin className="h-4 w-4 text-[#f37121]" />{tx('Truck types used', 'أنواع الشاحنات')}</h2>
            {data.trucks.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
              <ul className="space-y-2 text-[13px]">
                {data.trucks.map((x) => (
                  <li key={x.label} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-700">{x.label}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-bold tabular-nums text-slate-800">{n0(x.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-sm">
      <p className="text-[12px] text-white/70">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11.5px] text-white/60">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className="text-[11.5px] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'warn' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
