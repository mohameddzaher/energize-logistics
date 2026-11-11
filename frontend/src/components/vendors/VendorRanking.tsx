'use client';
/**
 * Carriers ranked by executed trips in a chosen month (our fleet excluded), with the move against last month, and
 * the carriers we worked with for the first time that month. Live from the shipments; the page filters apply.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Panel, DataGrid, fmtInt, fmtMoney, fmtPct } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, monthName, vendorHref } from '@/lib/vendors';
import { ArrowUp, ArrowDown, Sparkles } from 'lucide-react';

type Row = Record<string, any>;

export default function VendorRanking({ ar, query = '', month: initial }: { ar: boolean; query?: string; month: string }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [month, setMonth] = useState(initial);
  useEffect(() => { setMonth(initial); }, [initial]);
  const [kind, setKind] = useState('');
  const [d, setD] = useState<Row | null>(null);
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const my = guard.begin();
    try { const r = await api.get<Row>(`/api/vendors-mgmt/ranking?month=${month}${query ? `&${query}` : ''}`); if (guard.isCurrent(my)) setD(r); }
    catch { /* The rest of the dashboard stays usable. */ }
  }, [month, query, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1200); }, [load]);
  useSocket('shipmentOrders:updated', soon);
  useSocket('vendors:changed', soon);

  if (!d) return null;
  const money = d.rows[0]?.buy != null;
  const rows = d.rows.filter((r: Row) => !kind || r.kind === kind);
  const y = month.slice(0, 4);
  const name = { key: 'name', label: t('المورّد', 'Carrier'), render: (r: Row) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}{r.firstTime && <Sparkles className="inline w-3.5 h-3.5 ms-1 text-emerald-600" />}</Link> };
  const kindCol = { key: 'kind', label: t('النوع', 'Kind'), render: (r: Row) => <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> };
  const mName = monthName(d.month, ar);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Panel className="xl:col-span-2" pad={false} title={t(`ترتيب الموردين في ${mName} ${d.year}`, `Carrier ranking — ${mName} ${d.year}`)}
        subtitle={t(`${fmtInt(d.vendors)} مورّد · ${fmtInt(d.trips)} رحلة منفّذة (دون أسطول تنشيط) · ✦ = أوّل تعاملٍ معه`, `${fmtInt(d.vendors)} carriers · ${fmtInt(d.trips)} trips (excl. our fleet) · ✦ = first time`)}
        actions={<div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} max={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] [color-scheme:light]" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] bg-white">
            <option value="">{t('كلّ الأنواع', 'All kinds')}</option>
            {d.byKind.map((k: Row) => <option key={k.kind} value={k.kind}>{kindLabel(k.kind, ar)} ({k.vendors})</option>)}
          </select>
          <ExportMenu fileName={`vendors-ranking-${month}`} lang={ar ? 'ar' : 'en'} options={[{ key: 'all', label: t('الترتيب وأوّل تعامل', 'Ranking and first-time'), sheets: [
            { name: t('الترتيب', 'Ranking'), rows, columns: [{ header: '#', key: 'rank' }, { header: t('ترتيب الشهر السابق', 'Last month rank'), key: 'prevRank' }, { header: t('المورّد', 'Carrier'), key: 'name', width: 34 }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('رحلات الشهر', 'Month trips'), key: 'trips' }, { header: t('الحصّة %', 'Share %'), key: 'share' }, ...(money ? [{ header: t('الشراء', 'Purchase'), key: 'buy' }, { header: t('متوسط الرحلة', 'Avg trip'), key: 'avg' }] : []), { header: t('رحلات العام', 'Year trips'), key: 'yearTrips' }, { header: t('أوّل تعامل', 'First time'), key: 'firstTime', transform: (v: boolean) => (v ? t('نعم', 'Yes') : '') }] },
            { name: t('أوّل تعامل', 'First time'), rows: d.firstTime, columns: [{ header: t('المورّد', 'Carrier'), key: 'name', width: 34 }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) }, { header: t('مسؤول المتابعة', 'Owner'), key: 'owner' }, { header: t('أوّل رحلة', 'First trip'), key: 'first' }, { header: t('رحلات الشهر', 'Month trips'), key: 'monthTrips' }, { header: t('رحلات العام', 'Year trips'), key: 'yearTrips' }] },
          ] }]} />
        </div>}>
        <DataGrid ar={ar} rows={rows} limit={20} rowKey={(r) => `${r.rank}-${r.name}`} cols={[
          { key: 'rank', label: '#', num: true },
          { key: 'move', label: t('الحركة', 'Move'), sort: (r) => (r.prevRank ? r.prevRank - r.rank : -999), render: (r) => (!r.prevRank ? <span className="text-[11px] text-slate-400">{t('جديد', 'new')}</span>
            : r.prevRank > r.rank ? <span className="inline-flex items-center text-emerald-700 text-[12px] font-semibold"><ArrowUp className="w-3.5 h-3.5" />{r.prevRank - r.rank}</span>
              : r.prevRank < r.rank ? <span className="inline-flex items-center text-red-600 text-[12px] font-semibold"><ArrowDown className="w-3.5 h-3.5" />{r.rank - r.prevRank}</span> : <span className="text-slate-400">=</span>) },
          name, kindCol,
          { key: 'owner', label: t('المتابعة', 'Owner'), render: (r) => r.owner || '—' },
          { key: 'trips', label: t('رحلات الشهر', 'Month trips'), num: true },
          { key: 'share', label: t('الحصّة', 'Share'), num: true, render: (r) => fmtPct(r.share) },
          ...(money ? [{ key: 'buy', label: t('الشراء', 'Purchase'), num: true, render: (r: Row) => fmtMoney(r.buy) }, { key: 'avg', label: t('متوسط', 'Avg'), num: true, render: (r: Row) => fmtMoney(r.avg) }] : []),
          { key: 'yearTrips', label: t('رحلات العام', 'Year'), num: true },
        ]} />
      </Panel>
      <Panel pad={false} title={t(`أوّل تعاملٍ في ${mName}`, `First time in ${mName}`)} subtitle={t('موردون أوّلُ رحلةٍ لهم على الإطلاق في الشهر — اختر شهرًا', 'Carriers whose first ever trip fell in the month — pick a month')}>
        <div className="flex flex-wrap gap-1 p-3 border-b border-slate-100">
          {d.firstByMonth.map((x: Row) => (
            <button key={x.month} type="button" onClick={() => setMonth(`${y}-${String(x.month).padStart(2, '0')}`)}
              className={`px-2 py-1 rounded-lg text-[11.5px] font-semibold ${x.month === d.month ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {monthName(x.month, ar)} <span className="tabular-nums opacity-70">{x.n}</span>
            </button>
          ))}
        </div>
        <DataGrid ar={ar} rows={d.firstTime} limit={15} rowKey={(r, i) => `${r.name}-${i}`} empty={t('لا موردين جددًا في هذا الشهر', 'No first-time carriers this month')} cols={[
          name, kindCol,
          { key: 'first', label: t('أوّل رحلة', 'First trip'), render: (r) => <span className="tabular-nums">{r.first}</span> },
          { key: 'monthTrips', label: t('رحلات الشهر', 'Month'), num: true },
        ]} />
      </Panel>
    </div>
  );
}
