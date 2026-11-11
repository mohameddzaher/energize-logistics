'use client';
/**
 * Team performance on sales requests: per person (the fleet as one «النقل الثقيل») the sourcing credit on transport
 * orders, «تحصيل السيارات» records, «بمساعدة» helps and claims with how many ran out. Each number opens its list.
 * Own period, live on request and order changes. Data: GET /api/shipment-requests/team-performance.
 */
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Modal, SearchInput, Spinner, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Kpi, Panel, LiveDot, PRESETS, presetRange, fmtInt } from '@/components/analytics/AnalyticsKit';
import { Users, TrendingUp, TrendingDown } from 'lucide-react';

type Item = Record<string, any>;
interface Person {
  key: string; name: string; team: 'vendors' | 'fleet';
  creditCount: number; creditFromRequests: number; sourcedCars: number; sourcedEntries: number;
  helpsCount: number; claimsCount: number; expiredCount: number; expiredRate: number; releases: number;
  credit: Item[]; sourced: Item[]; helps: Item[]; claims: Item[]; expired: Item[];
}
interface Data { from: string; to: string; people: Person[]; totals: { credit: number; sourcedCars: number; sourcedEntries: number; helps: number; claims: number; expired: number } }

type Metric = 'creditCount' | 'sourcedCars' | 'helpsCount' | 'claimsCount' | 'expiredCount';
const METRICS: { key: Metric; list: keyof Pick<Person, 'credit' | 'sourced' | 'helps' | 'claims' | 'expired'>; ar: string; en: string }[] = [
  { key: 'creditCount', list: 'credit', ar: 'مسؤول التوريد', en: 'Sourcing credit' },
  { key: 'sourcedCars', list: 'sourced', ar: 'تحصيل السيارات', en: 'Trucks sourced' },
  { key: 'helpsCount', list: 'helps', ar: 'بمساعدة', en: 'Helped' },
  { key: 'claimsCount', list: 'claims', ar: 'التولّي', en: 'Claims' },
  { key: 'expiredCount', list: 'expired', ar: 'انتهى دون إكمال', en: 'Expired claims' },
];
const when = (v?: string) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const inputSm = 'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

export default function TeamPerformance() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [[from, to], setRange] = useState<[string, string]>(presetRange('month'));
  const [team, setTeam] = useState<'' | 'vendors' | 'fleet'>('');
  const [q, setQ] = useState('');
  const [metric, setMetric] = useState<Metric>('creditCount');
  const [sort, setSort] = useState<{ key: Metric | 'name' | 'expiredRate'; dir: 1 | -1 }>({ key: 'creditCount', dir: -1 });
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ person: Person; metric: Metric } | null>(null);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const my = guard.begin(); setBusy(true);
    try {
      const r = await api.get<Data>(`/api/shipment-requests/team-performance?from=${from}&to=${to}`);
      if (guard.isCurrent(my)) { setD(r); setError(''); }
    } catch (e: any) { if (guard.isCurrent(my)) setError(e?.message || (ar ? 'تعذّر التحميل' : 'Could not load')); }
    if (guard.isCurrent(my)) setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1000); }, [load]);
  useSocket('shipmentRequests:changed', soon);
  useSocket('shipmentOrders:updated', soon);

  const people = useMemo(() => (d?.people || []).filter((p) => (!team || p.team === team) && (!q.trim() || p.name.includes(q.trim()))), [d, team, q]);
  const sorted = useMemo(() => [...people].sort((a, b) => {
    const av = (a as any)[sort.key]; const bv = (b as any)[sort.key];
    return (typeof av === 'string' ? av.localeCompare(bv, 'ar') : (av - bv)) * sort.dir;
  }), [people, sort]);
  const ranked = useMemo(() => [...people].sort((a, b) => b[metric] - a[metric]), [people, metric]);
  const top = ranked.filter((p) => p[metric] > 0).slice(0, 5);
  const bottom = ranked.length > 5 ? [...ranked].reverse().slice(0, 5) : [];
  const totals = useMemo(() => people.reduce((s, p) => ({
    credit: s.credit + p.creditCount, sourcedCars: s.sourcedCars + p.sourcedCars, helps: s.helps + p.helpsCount, claims: s.claims + p.claimsCount, expired: s.expired + p.expiredCount,
  }), { credit: 0, sourcedCars: 0, helps: 0, claims: 0, expired: 0 }), [people]);
  const activePreset = PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === from && b === to; })?.[0] || '';
  const label = (m: Metric) => { const x = METRICS.find((y) => y.key === m)!; return ar ? x.ar : x.en; };

  // Excel: the people table plus one sheet per detail kind, each row naming its person.
  const exportOptions = useMemo(() => {
    const flat = (k: 'credit' | 'sourced' | 'helps' | 'claims' | 'expired') => people.flatMap((p) => p[k].map((x) => ({ person: p.name, ...x, at: when(x.at) })));
    const cols = (list: [string, string, string][]): ExportColumn[] => list.map(([key, a, e]) => ({ key, header: ar ? a : e }));
    const base: [string, string, string][] = [['person', 'الشخص', 'Person'], ['requestNumber', 'رقم الطلب', 'Request'], ['customer', 'العميل', 'Customer'], ['route', 'المسار', 'Route'], ['at', 'التاريخ', 'Date']];
    return [{
      key: 'all', label: t('أداء الفريق — كلّ الأوراق', 'Team performance — all sheets'),
      sheets: [
        { name: t('الأشخاص', 'People'), rows: people as any[], columns: cols([['name', 'الشخص', 'Person'], ['team', 'الفريق', 'Team'], ['creditCount', 'مسؤول التوريد', 'Sourcing credit'], ['creditFromRequests', 'منها من طلبات المبيعات', 'From requests'], ['sourcedCars', 'تحصيل السيارات', 'Trucks sourced'], ['sourcedEntries', 'عدد التسجيلات', 'Entries'], ['helpsCount', 'بمساعدة', 'Helped'], ['claimsCount', 'التولّي', 'Claims'], ['expiredCount', 'انتهى دون إكمال', 'Expired'], ['expiredRate', '% الانتهاء', 'Expired %'], ['releases', 'التخلّي', 'Releases']]).map((c) => (c.key === 'team' ? { ...c, transform: (v: any) => (v === 'fleet' ? t('النقل الثقيل', 'Heavy trucks') : t('فريق الموردين', 'Vendors team')) } : c)) },
        { name: t('مسؤول التوريد', 'Sourcing credit'), rows: flat('credit'), columns: cols([...base, ['waybillNumber', 'أمر النقل', 'Order'], ['supplier', 'المورّد', 'Supplier']]) },
        { name: t('تحصيل السيارات', 'Trucks sourced'), rows: flat('sourced'), columns: cols([...base, ['count', 'العدد', 'Count'], ['helper', 'بمساعدة', 'Helper'], ['note', 'ملاحظة', 'Note']]) },
        { name: t('بمساعدة', 'Helped'), rows: flat('helps'), columns: cols([...base, ['waybillNumber', 'أمر النقل', 'Order'], ['count', 'العدد', 'Count'], ['main', 'ساعد مَن', 'Helped whom']]) },
        { name: t('التولّي', 'Claims'), rows: flat('claims'), columns: cols([...base, ['branch', 'الفرع', 'Branch'], ['note', 'ملاحظة', 'Note']]) },
        { name: t('انتهى دون إكمال', 'Expired'), rows: flat('expired'), columns: cols([...base, ['branch', 'الفرع', 'Branch']]) },
      ],
    }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, ar]);

  const head = (key: Metric | 'name' | 'expiredRate', text: string, num = true) => (
    <th className={`whitespace-nowrap px-3 py-2 font-semibold ${num ? 'text-end' : 'text-start'}`}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'name' ? 1 : -1) }))} className="hover:text-white">
        {text}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  const cell = (p: Person, m: Metric) => (
    <td className="px-3 py-2 text-end tabular-nums">
      {p[m] > 0
        ? <button type="button" onClick={() => setOpen({ person: p, metric: m })} className="font-semibold text-[#c2410c] hover:underline">{fmtInt(p[m])}</button>
        : <span className="text-slate-400">0</span>}
    </td>
  );
  const rankRow = (p: Person, i: number) => (
    <li key={p.key} className="flex items-center gap-2 py-1.5">
      <span className="w-5 text-center text-[11.5px] font-bold text-slate-400 tabular-nums">{i + 1}</span>
      <span className="flex-1 truncate text-[13px] font-semibold text-slate-800">{p.name}</span>
      <button type="button" onClick={() => setOpen({ person: p, metric })} className="text-[13px] font-extrabold tabular-nums text-slate-900 hover:text-[#f37121]">{fmtInt(p[metric])}</button>
    </li>
  );

  return (
    <div id="team-performance" className="scroll-mt-20" dir={isRTL ? 'rtl' : 'ltr'}>
      <Panel title={t('أداء الفريق — طلبات المبيعات', 'Team performance — sales requests')}
        subtitle={t(`${from} — ${to} · مسؤول التوريد على أوامر النقل، وتحصيل السيارات، والمساعدة، والتولّي`, `${from} — ${to} · sourcing credit, trucks sourced, helps and claims`)}
        actions={<><LiveDot ar={ar} busy={busy} /><ExportMenu fileName="team-performance" lang={ar ? 'ar' : 'en'} label={t('تصدير Excel', 'Export Excel')} options={exportOptions} /></>}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap rounded-lg border border-slate-200 p-0.5">
              {PRESETS.map(([k, a, e]) => (
                <button key={k} type="button" onClick={() => setRange(presetRange(k))}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap ${activePreset === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{ar ? a : e}</button>
              ))}
            </div>
            <input type="date" value={from} onChange={(e) => e.target.value && setRange([e.target.value, to])} className={inputSm} title={t('من تاريخ', 'From')} />
            <span className="text-slate-400">→</span>
            <input type="date" value={to} onChange={(e) => e.target.value && setRange([from, e.target.value])} className={inputSm} title={t('إلى تاريخ', 'To')} />
            <select value={team} onChange={(e) => setTeam(e.target.value as any)} className={inputSm}>
              <option value="">{t('كلّ الفرق', 'All teams')}</option>
              <option value="vendors">{t('فريق الموردين', 'Vendors team')}</option>
              <option value="fleet">{t('النقل الثقيل', 'Heavy trucks')}</option>
            </select>
            <div className="min-w-[200px] flex-1"><SearchInput value={q} onChange={setQ} placeholder={t('ابحث بالاسم…', 'Search name…')} /></div>
          </div>

          {error && <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />}
          {!d && !error ? <Spinner /> : d && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Kpi ar={ar} label={t('مسؤول التوريد (أوامر نقل)', 'Sourcing credit (orders)')} value={fmtInt(totals.credit)} tone="brand" active={metric === 'creditCount'} onClick={() => setMetric('creditCount')} />
                <Kpi ar={ar} label={t('تحصيل السيارات', 'Trucks sourced')} value={fmtInt(totals.sourcedCars)} active={metric === 'sourcedCars'} onClick={() => setMetric('sourcedCars')} />
                <Kpi ar={ar} label={t('بمساعدة شخصٍ آخر', 'Helped by another')} value={fmtInt(totals.helps)} active={metric === 'helpsCount'} onClick={() => setMetric('helpsCount')} />
                <Kpi ar={ar} label={t('مرّات التولّي', 'Claims')} value={fmtInt(totals.claims)} active={metric === 'claimsCount'} onClick={() => setMetric('claimsCount')} />
                <Kpi ar={ar} label={t('انتهى دون إكمال', 'Expired claims')} value={fmtInt(totals.expired)} tone={totals.expired ? 'warn' : undefined}
                  sub={totals.claims ? `${Math.round((totals.expired / totals.claims) * 100)}%` : undefined} active={metric === 'expiredCount'} onClick={() => setMetric('expiredCount')} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-slate-600">{t('الترتيب حسب', 'Rank by')}</span>
                {METRICS.map((m) => (
                  <button key={m.key} type="button" onClick={() => setMetric(m.key)}
                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${metric === m.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{ar ? m.ar : m.en}</button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-800"><TrendingUp className="h-4 w-4" />{t(`الأعلى — ${label(metric)}`, `Top — ${label(metric)}`)}</p>
                  {top.length ? <ol>{top.map(rankRow)}</ol> : <p className="py-2 text-[12.5px] text-slate-500">{t('لا أرقام في الفترة', 'Nothing in the period')}</p>}
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50/40 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-red-800"><TrendingDown className="h-4 w-4" />{t(`الأدنى — ${label(metric)}`, `Bottom — ${label(metric)}`)}</p>
                  {bottom.length ? <ol>{bottom.map(rankRow)}</ol> : <p className="py-2 text-[12.5px] text-slate-500">{t('يظهر عند وجود أكثر من خمسة أشخاص', 'Shown with more than five people')}</p>}
                </div>
              </div>

              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-900 text-slate-200">
                    <tr>
                      {head('name', t('الشخص', 'Person'), false)}
                      {METRICS.map((m) => <Fragment key={m.key}>{head(m.key, ar ? m.ar : m.en)}</Fragment>)}
                      {head('expiredRate', t('% الانتهاء', 'Expired %'))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((p) => (
                      <tr key={p.key} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-900">
                          {p.team === 'fleet' && <Users className="me-1 inline h-3.5 w-3.5 text-[#f37121]" />}{p.name}
                          {p.creditFromRequests > 0 && <span className="ms-1.5 text-[11px] font-normal text-slate-500">{t(`(${p.creditFromRequests} من الطلبات)`, `(${p.creditFromRequests} from requests)`)}</span>}
                        </td>
                        {METRICS.map((m) => <Fragment key={m.key}>{cell(p, m.key)}</Fragment>)}
                        <td className={`px-3 py-2 text-end tabular-nums ${p.expiredRate >= 50 ? 'font-semibold text-red-600' : 'text-slate-700'}`}>{p.claimsCount ? `${p.expiredRate}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!sorted.length && <p className="py-8 text-center text-slate-500">{t('لا نشاط في الفترة', 'No activity in the period')}</p>}
              </div>
            </>
          )}
        </div>
      </Panel>

      {open && (
        <Modal open wide onClose={() => setOpen(null)} title={`${open.person.name} — ${label(open.metric)}`}>
          <DetailList person={open.person} metric={open.metric} ar={ar} />
        </Modal>
      )}
    </div>
  );
}

/** The items behind one number: transport orders, sourcing records, helps or claims. */
function DetailList({ person, metric, ar }: { person: Person; metric: Metric; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const list = person[METRICS.find((m) => m.key === metric)!.list];
  if (!list.length) return <p className="py-6 text-center text-slate-500">{t('لا عناصر', 'No items')}</p>;
  return (
    <div className="max-h-[65vh] overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-slate-100 text-slate-700">
          <tr>
            <th className="px-2 py-1.5 text-start">{t('التاريخ', 'Date')}</th>
            <th className="px-2 py-1.5 text-start">{t('رقم الطلب', 'Request')}</th>
            <th className="px-2 py-1.5 text-start">{t('أمر النقل', 'Order')}</th>
            <th className="px-2 py-1.5 text-start">{t('العميل', 'Customer')}</th>
            <th className="px-2 py-1.5 text-start">{t('المسار', 'Route')}</th>
            <th className="px-2 py-1.5 text-start">{t('تفاصيل', 'Details')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((x, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{when(x.at)}</td>
              <td className="px-2 py-1.5 tabular-nums">{x.requestNumber || '—'}</td>
              <td className="px-2 py-1.5 tabular-nums">{x.waybillNumber ? <Link href={`/system/shipment-orders?q=${x.waybillNumber}`} className="font-semibold text-emerald-700 hover:underline">{x.waybillNumber}</Link> : '—'}</td>
              <td className="px-2 py-1.5">{x.customer || '—'}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{x.route || '—'}</td>
              <td className="px-2 py-1.5 text-slate-600">
                {[
                  x.count ? t(`${x.count} سيارة`, `${x.count} trucks`) : '',
                  x.supplier || '',
                  x.helper ? t(`بمساعدة ${x.helper}`, `helped by ${x.helper}`) : '',
                  x.main ? (x.kind === 'order' ? t(`ساعد ${x.main} على أمر نقل`, `helped ${x.main} on an order`) : t(`ساعد ${x.main} في التحصيل`, `helped ${x.main} sourcing`)) : '',
                  x.branch || '', x.note || '',
                ].filter(Boolean).join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
