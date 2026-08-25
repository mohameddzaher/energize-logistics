'use client';
// اللوحة الرئيسية لإدارة الأسطول — كل سيارة بطاقة واحدة، مجمّعة تحت مشرفها،
// بحالة تلقائية اللون: أحمر متأخرة عن الوصول المتوقع، أخضر وصلت موقع التنزيل,
// أصفر في الطريق، أزرق تحميل/تجهيز، رمادي بدون حمولة. فوقها بطاقات الأرقام
// الجاهزة (المتأخرات، الواصلة، صيانة متأخرة/قريبة…) ووجهات السفر الحالية —
// فلا أحد يفتش في القوائم ليعرف من تأخر أو من استحق صيانة.
//
// مدير القسم يرى كل السيارات؛ المشرف يصله من الخادم سياراته هو فقط.
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  LayoutGrid, RefreshCw, Truck, MapPin, Clock, Wrench, User as UserIcon, Search, X, AlertTriangle, CalendarClock,
} from 'lucide-react';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';

// أعمدة تصدير اللوحة — بطاقةُ كل سيارة مسطّحةً في صفّ.
const BOARD_COLUMNS = [
  { header: 'Plate', key: 'plate', width: 16 },
  { header: 'Description', key: 'name', width: 20 },
  { header: 'Trailer', key: 'trailerType', width: 14 },
  { header: 'Supervisor', key: 'supervisorName', width: 20 },
  { header: 'State', key: 'state', width: 12 },
  { header: 'Drivers', key: 'drivers', transform: (v: any) => (v || []).map((d: any) => d.name).join(' + '), width: 26 },
  { header: 'Waybill', key: 'trip', transform: (v: any) => v?.waybillNumber ?? '', width: 10 },
  { header: 'Customer', key: 'trip', transform: (v: any) => v?.customerName || '', width: 24 },
  { header: 'From', key: 'trip', transform: (v: any) => v?.fromCity || '', width: 14 },
  { header: 'To', key: 'trip', transform: (v: any) => v?.toCity || '', width: 14 },
  { header: 'Expected arrival', key: 'trip', transform: (v: any) => (v?.expectedArrival ? fmtDT(v.expectedArrival, 'en') : ''), width: 20 },
  { header: 'Live city', key: 'liveCity', width: 14 },
  { header: 'Maintenance', key: 'maintenance', transform: (v: any) => v?.status || '', width: 14 },
];
import { canViewFleet, fleetStatusLabel, fmtDT, hoursSince, BOARD_STATES, foldAr, Lang } from '@/lib/fleet';

interface BoardTrip {
  _id: string; waybillNumber: number; status: string;
  fromCity: string; toCity: string;
  expectedArrival: string | null; loadDate: string | null;
  customerName: string; driverName: string; lastContactAt: string | null;
}
interface BoardCard {
  _id: string; plate: string; name: string; trailerType: string;
  supervisor: string | null; supervisorName: string;
  drivers: { name: string; working: boolean }[];
  trip: BoardTrip | null;
  state: 'late' | 'arrived' | 'moving' | 'preparing' | 'idle';
  liveCity: string | null;      // أين هي الآن جغرافيًا (من GPS لوكيشن سوليوشن)
  atDestination: boolean;       // دخلت نطاق مدينة وجهتها — يُفترض أنها تُفرِّغ
  maintenance: { status: 'ok' | 'due' | 'overdue'; kmToService: number | null; nextServiceName: string; odometerKm: number | null } | null;
}
interface BoardSummary {
  total: number; moving: number; late: number; arrived: number; preparing: number; idle: number;
  maintOverdue: number; maintDue: number;
  byDestination: { city: string; n: number }[];
}

export default function FleetBoardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();

  const [cards, setCards] = useState<BoardCard[]>([]);
  const [summary, setSummary] = useState<BoardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ cards: BoardCard[]; summary: BoardSummary }>('/api/fleet/board');
      setCards(d.cards || []);
      setSummary(d.summary || null);
      setError('');
    } catch (e: any) {
      // An empty board must never masquerade as "no trucks" — say what failed.
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));
  useSocket('ls2:updated', useCallback(() => load(), [load]));
  // Belt-and-braces: the board is the operations command view — even if the
  // socket drops, it must never sit stale for long.
  useEffect(() => {
    const id = setInterval(() => load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    let r = cards;
    if (stateFilter === 'maintOverdue') r = r.filter((c) => c.maintenance?.status === 'overdue');
    else if (stateFilter === 'maintDue') r = r.filter((c) => c.maintenance?.status === 'due');
    else if (stateFilter) r = r.filter((c) => c.state === stateFilter);
    if (cityFilter) r = r.filter((c) => c.trip?.toCity === cityFilter);
    const s = foldAr(q.trim());
    if (s) r = r.filter((c) => [c.plate, c.name, c.supervisorName, c.liveCity, c.trip?.toCity, c.trip?.customerName, c.trip?.driverName, ...c.drivers.map((d) => d.name)].some((x) => foldAr(String(x || '')).includes(s)));
    return r;
  }, [cards, stateFilter, cityFilter, q]);

  // المجموعات: مشرف ← سياراته. غير المُسند في مجموعة أخيرة.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; cards: BoardCard[] }>();
    for (const c of filtered) {
      const key = c.supervisor || '_none';
      if (!m.has(key)) m.set(key, { name: c.supervisorName || (ar ? 'غير مُسند لمشرف' : 'Unassigned'), cards: [] });
      m.get(key)!.cards.push(c);
    }
    return [...m.entries()].sort((a, b) => (a[0] === '_none' ? 1 : b[0] === '_none' ? -1 : a[1].name.localeCompare(b[1].name)));
  }, [filtered, ar]);

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح.' : 'Not authorized.'}</div>;
  if (loading && !cards.length) return <Spinner />;

  const KPIS: { key: string; label: string; value: number; cls: string }[] = summary ? [
    { key: '', label: ar ? 'إجمالي السيارات' : 'Total', value: summary.total, cls: 'text-slate-800' },
    { key: 'late', label: ar ? 'متأخرة عن الوصول' : 'Late', value: summary.late, cls: 'text-red-600' },
    { key: 'moving', label: ar ? 'في الطريق' : 'On the road', value: summary.moving, cls: 'text-amber-600' },
    { key: 'arrived', label: ar ? 'وصلت' : 'Arrived', value: summary.arrived, cls: 'text-emerald-600' },
    { key: 'preparing', label: ar ? 'تحميل / تجهيز' : 'Loading', value: summary.preparing, cls: 'text-blue-600' },
    { key: 'idle', label: ar ? 'بدون حمولة' : 'Idle', value: summary.idle, cls: 'text-slate-500' },
    { key: 'maintOverdue', label: ar ? 'صيانة متأخرة' : 'Service overdue', value: summary.maintOverdue, cls: 'text-red-600' },
    { key: 'maintDue', label: ar ? 'صيانة قريبة' : 'Service due', value: summary.maintDue, cls: 'text-amber-600' },
  ] : [];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutGrid className="w-5 h-5" />} title={ar ? 'اللوحة الرئيسية للأسطول' : 'Fleet Board'}
        subtitle={ar ? 'كل سيارة ببطاقة — الحالة والوجهة والصيانة تلقائيًا' : 'Every truck as one card — state, destination and maintenance, automatically'}>
        {/* اللوحة تُظهر حالة اللحظة؛ ومَن أراد التخطيط لما هو آتٍ ينتقل من هنا. */}
        <Link href="/system/fleet/arrivals" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 hover:bg-[#f37121]/20 text-[#f37121] text-sm font-medium">
          <CalendarClock className="w-4 h-4" /> {ar ? 'المتوقع للوصول' : 'Expected arrivals'}
        </Link>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-board"
          options={[
            { key: 'view', label: ar ? 'المعروض حسب الفلتر' : 'Filtered view', sheets: [{ name: 'Board', rows: filtered as any[], columns: BOARD_COLUMNS }] },
            { key: 'all', label: ar ? 'كل السيارات' : 'All vehicles', sheets: [{ name: 'Board', rows: cards as any[], columns: BOARD_COLUMNS }] },
          ]} />
        <button type="button" onClick={() => { setLoading(true); load(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={() => { setLoading(true); load(); }} />}

      {/* بطاقات الأرقام — الضغط على أي بطاقة يرشح السيارات تحتها */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {KPIS.map((k) => (
          <button key={k.label} type="button" onClick={() => setStateFilter(stateFilter === k.key ? '' : k.key)}
            className={`bg-white border rounded-xl p-3 text-center shadow-sm transition ${stateFilter === k.key && k.key ? 'border-[#f37121] ring-1 ring-[#f37121]/40' : 'border-slate-200 hover:border-slate-300'}`}>
            <p className={`text-2xl font-bold tabular-nums ${k.cls}`}>{k.value}</p>
            <p className="text-[11px] font-medium text-slate-600 mt-0.5">{k.label}</p>
          </button>
        ))}
      </div>

      {/* الوجهات الحالية — "عدد السيارات المتّجهة إلى جدة" بنظرة واحدة */}
      {summary && summary.byDestination.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-[#f37121]" /> {ar ? 'الوجهات الآن:' : 'Destinations now:'}</span>
          {summary.byDestination.map((d) => (
            <button key={d.city} type="button" onClick={() => setCityFilter(cityFilter === d.city ? '' : d.city)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border ${cityFilter === d.city ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]'}`}>
              {d.city} <b className="tabular-nums">{d.n}</b>
            </button>
          ))}
        </div>
      )}

      <div className="relative w-full sm:w-72">
        <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث باللوحة أو السائق أو المشرف أو المدينة…' : 'Search plate / driver / supervisor / city…'}
          className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
        {q && <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
      </div>

      {/* المجموعات: المشرف وتحته سياراته */}
      {groups.map(([key, g]) => (
        <div key={key} className="space-y-2">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-[#f37121]" /> {g.name}
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] tabular-nums">{g.cards.length}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {g.cards.map((c) => {
              const st = BOARD_STATES[c.state] || BOARD_STATES.idle;
              const m = c.maintenance;
              const stale = c.trip && ['moving', 'late', 'preparing'].includes(c.state) ? hoursSince(c.trip.lastContactAt) : null;
              return (
                <button key={c._id} type="button"
                  onClick={() => c.trip ? router.push(`/system/fleet/${c.trip._id}`) : router.push(`/system/fleet/vehicles?q=${encodeURIComponent(c.plate)}`)}
                  className={`text-start border rounded-xl p-3.5 shadow-sm hover:shadow-md transition ${st.card}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 flex items-center gap-1.5 min-w-0">
                      <Truck className="w-4 h-4 text-slate-500 shrink-0" /> {c.plate}
                      {c.liveCity && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/70 border border-slate-200 text-slate-600 text-[10px] font-medium">
                          <MapPin className="w-2.5 h-2.5 text-[#f37121]" /> {c.liveCity}
                        </span>
                      )}
                    </p>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.chip}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} /> {ar ? st.ar : st.en}
                    </span>
                  </div>
                  {/* GPS يقول إنها داخل نطاق وجهتها — يُفترض أنها تُفرِّغ الآن */}
                  {c.atDestination && (
                    <p className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                      <MapPin className="w-3 h-3" /> {ar ? `دخلت نطاق ${c.trip?.toCity} — يُفترض بدء التفريغ` : `Entered ${c.trip?.toCity} — presumably unloading`}
                    </p>
                  )}
                  {c.trip ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-700">
                      <p className="flex items-center gap-1.5 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        {c.trip.fromCity || '—'} ← <b>{c.trip.toCity || '—'}</b>
                        <span className="text-slate-500 font-normal">· {ar ? 'بوليصة' : 'WB'} {c.trip.waybillNumber}</span>
                      </p>
                      <p className="text-slate-600 truncate">{c.trip.customerName || '—'} · {c.trip.driverName || (c.drivers[0]?.name ?? '—')}</p>
                      {c.trip.expectedArrival && (
                        <p className={`flex items-center gap-1.5 ${c.state === 'late' ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                          <Clock className="w-3.5 h-3.5 shrink-0" /> {ar ? 'الوصول المتوقع' : 'ETA'}: {fmtDT(c.trip.expectedArrival, lang as Lang)}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-500">{fleetStatusLabel(c.trip.status, lang as Lang)}{stale != null && stale >= 3 && <span className="text-amber-700 font-medium"> · {ar ? `بدون تواصل منذ ${stale} س` : `no contact for ${stale}h`}</span>}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">{c.drivers.length ? c.drivers.map((d) => d.name).join(' · ') : (ar ? 'لا يوجد سائق مُسند' : 'No driver assigned')}</p>
                  )}
                  {/* شارة الصيانة — من مرآة Location Solutions مباشرة */}
                  {m && m.status !== 'ok' && (
                    <p className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {m.status === 'overdue' ? <AlertTriangle className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                      {m.status === 'overdue'
                        ? (ar ? `صيانة متأخرة${m.kmToService != null ? ` ${Math.abs(m.kmToService).toLocaleString('en-US')} كم` : ''}` : `Service overdue${m.kmToService != null ? ` by ${Math.abs(m.kmToService).toLocaleString('en-US')} km` : ''}`)
                        : (ar ? `صيانة قريبة${m.kmToService != null ? ` — باقي ${m.kmToService.toLocaleString('en-US')} كم` : ''}` : `Service due${m.kmToService != null ? ` in ${m.kmToService.toLocaleString('en-US')} km` : ''}`)}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="text-center text-slate-400 py-16">{ar ? 'لا توجد سيارات مطابقة.' : 'No matching vehicles.'}</p>}
    </div>
  );
}
