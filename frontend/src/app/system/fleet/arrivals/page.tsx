'use client';
// المتوقع للوصول — جدولان لقرارٍ واحد.
//
// المشرف يسأل سؤالًا مركّبًا: «مين العربيات اللي هتوصل يوم السبت في جدة؟ وإيه
// العربيات اللي هتكون فاضية وقتها؟». الجدول الأول يجيب شطره الأول، والثاني
// شطره الثاني — ووضعهما في شاشةٍ واحدة هو الفكرة كلّها: إن لم تكفِ الواصلةُ
// حمولةَ الغد، فمن الفاضية يُكمِل، دون أن ينتقل بين شاشتين ويحمل الأرقام بذهنه.
//
// و«فاضية» هنا تعني بلا حمولةٍ نشطة أصلًا — لا تسير ولا تُحمِّل ولا متجهةٌ إلى
// جهة؛ وهذا ما يُصرَّح به في الجدول كي لا تُقرأ على أنها «وصلت وتُفرِّغ».
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, StatCard, ErrorNotice, SearchInput } from '@/components/hr/HRKit';
import ExportMenu, { type ExportSheet } from '@/components/ls2/ExportMenu';
import PeriodFilter, { PeriodBanner, periodParams, periodFromParams, EMPTY_PERIOD, type Period } from '@/components/fleet/PeriodFilter';
import {
  type FleetArrivals, type FleetShipment, fleetStatus, fleetStatusLabel, fmtDT, fmtD,
  hoursSince, canViewFleet, money, shipmentVehicleId, type Lang,
} from '@/lib/fleet';
import { CalendarClock, MapPin, Truck, CircleSlash } from 'lucide-react';

function ArrivalsInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const sp = useSearchParams();

  const [d, setD] = useState<FleetArrivals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // كل فلاتر الشاشة تعيش في العنوان: تفلتر، تفتح حمولة، ترجع بزرّ المتصفّح
  // فتجد ما بنيتَه كما تركتَه — ورابطُ «الواصل جدة السبت» يُرسَل كما هو.
  const [period, setPeriod] = useState<Period>(() => periodFromParams(sp));
  const [city, setCity] = useState(() => sp?.get('toCity') || '');
  const [q, setQ] = useState(() => sp?.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q]);

  const params = useMemo(() => {
    const p: Record<string, string> = { ...periodParams(period) };
    if (city.trim()) p.toCity = city.trim();
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    return p;
  }, [period, city, debouncedQ]);

  const load = useCallback(async () => {
    try {
      setD(await api.get<FleetArrivals>(`/api/fleet/arrivals?${new URLSearchParams(params)}`));
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));

  // `replace` لا `push`: ضغطةُ فلترٍ لا تستحقّ خطوةً في تاريخ المتصفّح.
  useEffect(() => {
    const qs = new URLSearchParams(params).toString();
    router.replace(`/system/fleet/arrivals${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [params, router]);

  const shipCols = [
    { header: 'Waybill', key: 'waybillNumber', width: 10 },
    { header: 'Plate', key: 'vehiclePlate', width: 14 },
    { header: 'Driver', key: 'driverName', width: 18 },
    { header: 'Customer', key: 'customerName', width: 24 },
    { header: 'From', key: 'fromCity', width: 14 },
    { header: 'To', key: 'toCity', width: 14 },
    { header: 'Load date', key: 'loadDate', transform: (v: any) => fmtD(v), width: 14 },
    { header: 'Expected arrival', key: 'expectedArrival', transform: (v: any) => (v ? fmtDT(v, 'en') : ''), width: 20 },
    { header: 'Status', key: 'status', transform: (v: any) => fleetStatusLabel(v, 'en'), width: 14 },
    { header: 'Supervisor', key: 'supervisorName', width: 18 },
    { header: 'Vehicle rent', key: 'price', width: 12 },
  ];
  const idleCols = [
    { header: 'Plate', key: 'plate', width: 14 },
    { header: 'Trailer', key: 'trailerType', width: 14 },
    { header: 'GPS', key: 'gpsType', width: 8 },
    { header: 'Drivers', key: 'drivers', transform: (v: any) => (v || []).map((x: any) => x.name).join(' + '), width: 26 },
    { header: 'Supervisor', key: 'supervisorName', width: 18 },
    { header: 'Carrying', key: '_carrying', transform: () => 'NOTHING — idle', width: 16 },
    { header: 'Last trip to', key: 'lastTrip', transform: (v: any) => v?.toCity || '', width: 14 },
    { header: 'Last trip date', key: 'lastTrip', transform: (v: any) => (v?.at ? fmtD(v.at) : ''), width: 14 },
  ];

  const sheets: ExportSheet[] = d ? [
    { name: ar ? 'المتوقع وصولها' : 'Arriving', rows: d.arriving as any[], columns: shipCols },
    { name: ar ? 'بلا موعد وصول' : 'No ETA', rows: d.noEta as any[], columns: shipCols },
    { name: ar ? 'السيارات الفاضية' : 'Idle vehicles', rows: d.idle as any[], columns: idleCols },
  ] : [];

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading && !d) return <Spinner />;

  const th = 'text-start font-semibold px-3 py-3 whitespace-nowrap';
  const openShipment = (s: FleetShipment) => router.push(`/system/fleet/${s._id}`);

  const shipmentRow = (s: FleetShipment) => {
    const st = fleetStatus(s.status);
    const hrs = hoursSince(s.lastContactAt);
    const vid = shipmentVehicleId(s);
    const overdue = s.expectedArrival ? new Date(s.expectedArrival).getTime() < Date.now() : false;
    return (
      <tr key={s._id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => openShipment(s)}>
        <td className="px-3 py-3 font-mono font-bold text-slate-900">{s.waybillNumber}</td>
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          {vid
            ? <Link href={`/system/fleet/vehicles/${vid}`} className="font-mono text-xs font-semibold text-[#f37121] hover:underline">{s.vehiclePlate || '—'}</Link>
            : <span className="font-mono text-xs">{s.vehiclePlate || '—'}</span>}
        </td>
        <td className="px-3 py-3 text-slate-700 text-xs max-w-[160px] truncate">{[s.driverName, s.secondDriverName].filter(Boolean).join(' + ') || '—'}</td>
        <td className="px-3 py-3 text-slate-900 text-xs max-w-[180px] truncate" title={s.customerName}>{s.customerName || '—'}</td>
        <td className="px-3 py-3 text-slate-700 text-xs whitespace-nowrap">{s.fromCity || '—'} ← <b className="text-slate-900">{s.toCity || '—'}</b></td>
        <td className="px-3 py-3 text-slate-600 text-xs whitespace-nowrap">{fmtD(s.loadDate)}</td>
        <td className="px-3 py-3 text-xs whitespace-nowrap">
          {s.expectedArrival
            ? <span className={overdue ? 'font-semibold text-red-600' : 'text-slate-800'}>{fmtDT(s.expectedArrival, lang as Lang)}</span>
            : <span className="text-amber-600">{ar ? 'غير محدَّد' : 'Not set'}</span>}
        </td>
        <td className="px-3 py-3 text-xs whitespace-nowrap">
          <span className={`rounded-full px-2 py-1 font-medium ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}>{fleetStatusLabel(s.status, lang as Lang)}</span>
        </td>
        <td className="px-3 py-3 text-slate-600 text-xs max-w-[130px] truncate">{s.supervisorName || '—'}</td>
        <td className="px-3 py-3 text-xs">
          <span className={hrs === null || hrs >= 3 ? 'text-red-600 font-medium' : 'text-slate-600'}>
            {hrs === null ? (ar ? 'لم يُتواصل' : 'Never') : (ar ? `منذ ${hrs} س` : `${hrs}h`)}
          </span>
        </td>
        <td className="px-3 py-3 text-xs font-semibold text-emerald-700 whitespace-nowrap">{s.price ? money(s.price) : '—'}</td>
      </tr>
    );
  };

  const shipHead = (
    <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
      {[
        ar ? 'البوليصة' : 'Waybill', ar ? 'اللوحة' : 'Plate', ar ? 'السائقون' : 'Drivers',
        ar ? 'العميل' : 'Customer', ar ? 'المسار' : 'Route', ar ? 'تاريخ التحميل' : 'Load date',
        ar ? 'الوصول المتوقع' : 'Expected arrival', ar ? 'الحالة' : 'Status',
        ar ? 'المشرف' : 'Supervisor', ar ? 'آخر تواصل' : 'Last contact', ar ? 'الإيجار' : 'Rent',
      ].map((h, i) => <th key={i} className={th}>{h}</th>)}
    </tr>
  );

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarClock className="w-5 h-5" />}
        title={ar ? 'المتوقع للوصول' : 'Expected arrivals'}
        subtitle={ar
          ? 'مَن يصل ومتى وأين — ومعه السيارات التي ستكون فاضية في نفس الوقت'
          : 'Who arrives, when and where — plus the trucks that will be idle then'}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-arrivals"
          options={[
            { key: 'view', label: ar ? 'حسب الفلتر الحالي' : 'Current filter', sheets },
            { key: 'arriving', label: ar ? 'المتوقع وصولها فقط' : 'Arriving only', sheets: sheets.slice(0, 1) },
            { key: 'idle', label: ar ? 'السيارات الفاضية فقط' : 'Idle vehicles only', sheets: sheets.slice(2) },
          ]} />
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <PeriodFilter value={period} onChange={setPeriod} lang={ar ? 'ar' : 'en'} showFuture />
        <div className="flex flex-wrap gap-3 items-center">
          <div className="w-56 grow sm:grow-0">
            <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'مدينة الوصول' : 'Destination city'}</label>
            <input value={city} onChange={(e) => setCity(e.target.value)}
              placeholder={ar ? 'جدة، الرياض…' : 'Jeddah, Riyadh…'}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          </div>
          <div className="flex-1 min-w-[220px] self-end">
            <SearchInput value={q} onChange={setQ} placeholder={ar ? 'بحث بلوحة أو سائق أو عميل…' : 'plate / driver / customer…'} />
          </div>
        </div>
        {/* وجهات الفترة — الضغط على مدينةٍ يرشّح الجدولين معًا. */}
        {d && d.byCity.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><MapPin className="w-3.5 h-3.5" /> {ar ? 'الوجهات:' : 'Destinations:'}</span>
            {d.byCity.map((c) => (
              <button key={c.city} type="button" onClick={() => setCity(city === c.city ? '' : c.city)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${city === c.city ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]'}`}>
                {c.city} <b className="tabular-nums">{c.n}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      <PeriodBanner period={d?.period} lang={ar ? 'ar' : 'en'} count={d?.summary.arriving} />

      {d && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label={ar ? 'متوقع وصولها' : 'Arriving'} value={d.summary.arriving} accent="text-[#f37121]" />
          <StatCard label={ar ? 'بلا موعد وصول' : 'No ETA'} value={d.summary.noEta} accent={d.summary.noEta ? 'text-amber-600' : undefined} />
          <StatCard label={ar ? 'سيارات فاضية' : 'Idle vehicles'} value={d.summary.idle} accent="text-slate-900" />
          <StatCard label={ar ? 'سيارات مشغولة' : 'Busy vehicles'} value={d.summary.busy} accent="text-emerald-600" />
          <StatCard label={ar ? 'إجمالي السيارات' : 'Total vehicles'} value={d.summary.vehicles} />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <Truck className="w-4 h-4 text-[#f37121]" />
          <p className="font-bold text-slate-900">{ar ? 'العربيات المتوقع وصولها' : 'Trucks arriving'}</p>
          <span className="text-xs text-slate-500">({d?.arriving.length || 0})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{shipHead}</thead>
            <tbody>
              {(d?.arriving.length || 0) === 0
                ? <tr><td colSpan={11} className="text-center text-slate-500 py-12">{ar ? 'لا توجد حمولات يُتوقَّع وصولها ضمن هذه الفترة والوجهة.' : 'Nothing expected in this period/destination.'}</td></tr>
                : d!.arriving.map(shipmentRow)}
            </tbody>
          </table>
        </div>
      </div>

      {/* بلا موعدٍ متوقَّع: سائرةٌ فعلًا لكنها لا تدخل أيّ نافذةٍ زمنية، وإخفاؤها
          يجعل سيارتَها «لا واصلة ولا فاضية» فتسقط من التخطيط بلا أثر. */}
      {(d?.noEta.length || 0) > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <p className="font-bold text-amber-800">{ar ? 'سائرة بلا موعد وصول مُسجَّل' : 'On the road with no ETA recorded'}</p>
            <p className="text-xs text-amber-700">
              {ar ? 'هذه الحمولات لن تظهر في أي فترة حتى يُسجَّل لها «الوصول المتوقع» — سجّله من صفحة الحمولة.'
                  : 'These never fall inside a period until an expected arrival is recorded.'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead>{shipHead}</thead><tbody>{d!.noEta.map(shipmentRow)}</tbody></table>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <CircleSlash className="w-4 h-4 text-slate-500" />
          <p className="font-bold text-slate-900">{ar ? 'السيارات الفاضية — بدون حمولة إطلاقًا' : 'Idle vehicles — carrying nothing'}</p>
          <span className="text-xs text-slate-500">({d?.idle.length || 0})</span>
          <span className="ms-auto text-[11px] text-slate-500">
            {ar ? 'ليست عليها حمولة نشطة، ولا متجهة إلى أي مكان' : 'No active load, going nowhere'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              {[ar ? 'اللوحة' : 'Plate', ar ? 'نوع التيدر' : 'Trailer', 'GPS', ar ? 'السائقون' : 'Drivers',
                ar ? 'المشرف' : 'Supervisor', ar ? 'الحمولة الحالية' : 'Current load', ar ? 'آخر رحلة' : 'Last trip',
              ].map((h, i) => <th key={i} className={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(d?.idle.length || 0) === 0
                ? <tr><td colSpan={7} className="text-center text-slate-500 py-12">{ar ? 'كل السيارات عليها حمولة نشطة الآن.' : 'Every truck is carrying something.'}</td></tr>
                : d!.idle.map((v) => (
                  <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <Link href={`/system/fleet/vehicles/${v._id}`} className="font-mono font-bold text-[#f37121] hover:underline">{v.plate}</Link>
                      {v.name && <span className="block text-[11px] text-slate-500">{v.name}</span>}
                    </td>
                    <td className="px-3 py-3 text-slate-700 text-xs">{v.trailerType || '—'}</td>
                    <td className="px-3 py-3 text-slate-600 text-xs">{v.gpsType || '—'}</td>
                    <td className="px-3 py-3">
                      {v.drivers.length === 0
                        ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">{ar ? 'بدون سائق' : 'No driver'}</span>
                        : <div className="flex flex-wrap gap-1">{v.drivers.map((x) => (
                            <span key={x._id} className={`px-2 py-0.5 rounded-lg text-[11px] ${x.working === false ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                              {x.name}{x.working === false ? (ar ? ' · لا يعمل' : ' · off') : ''}
                            </span>))}</div>}
                    </td>
                    <td className="px-3 py-3 text-slate-600 text-xs">{v.supervisorName || '—'}</td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">
                        {ar ? 'لا شيء — فاضية' : 'Nothing — idle'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {v.lastTrip
                        ? <>{v.lastTrip.toCity || '—'} · <span className="text-slate-400">{v.lastTrip.at ? fmtD(v.lastTrip.at) : '—'}</span></>
                        : (ar ? 'لا رحلات سابقة' : 'No past trips')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function FleetArrivalsPage() {
  return <Suspense fallback={<Spinner />}><ArrivalsInner /></Suspense>;
}
