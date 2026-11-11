'use client';
/**
 * Sales requests against what the vendors team realised, in trucks (each placed truck is a transport order). Shows the
 * realisation rate, why the rest was not realised (ranked, % of the unrealised and of all), the daily trend, and the
 * split by branch, customer, route and team member. Every number opens its requests, exportable. Data comes with the
 * page's payload (`salesRequests` on /daily, `salesRealisation` on /overview), so it refreshes with the page.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Kpi, Panel, DataGrid, fmtInt, fmtPct } from '@/components/analytics/AnalyticsKit';
import { DrillModal, type Drill, type DrillCol } from './VendorDrill';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

type Row = Record<string, any>;
const REQ_STATUS: Record<string, [string, string]> = { pending: ['جديد', 'New'], in_progress: ['قيد التنفيذ', 'In progress'], completed: ['مكتمل', 'Completed'], rejected: ['مرفوض', 'Refused'], cancelled: ['مسحوب', 'Withdrawn'] };
const DIMS: [string, string, string, string][] = [['byBranch', 'branch', 'الفرع', 'Branch'], ['byCustomer', 'customerName', 'العميل', 'Customer'], ['byRoute', 'route', 'المسار', 'Route'], ['byMember', 'member', 'عضو الفريق', 'Team member']];

export default function SalesRealisation({ data, ar, title }: { data: Row | null | undefined; ar: boolean; title?: string }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [dim, setDim] = useState('byBranch');
  if (!data) return null;
  const list: Row[] = data.list || [];
  const cols: DrillCol[] = [
    { key: 'number', label: t('الطلب', 'Request'), render: (r) => <Link href={`/system/vendors-mgmt/requests?id=${r.id}`} className="font-mono text-[#f37121] hover:underline">{r.number}</Link> },
    { key: 'day', label: t('اليوم', 'Day') }, { key: 'customerName', label: t('العميل', 'Customer') }, { key: 'route', label: t('المسار', 'Route') }, { key: 'branch', label: t('الفرع', 'Branch') },
    { key: 'trucks', label: t('الشاحنات', 'Trucks'), num: true }, { key: 'placed', label: t('المنفَّذ', 'Placed'), num: true }, { key: 'rest', label: t('غير المحقَّق', 'Not realised'), num: true },
    { key: 'status', label: t('الحالة', 'Status'), render: (r) => REQ_STATUS[r.status]?.[ar ? 0 : 1] || r.status, exportAs: (r) => REQ_STATUS[r.status]?.[ar ? 0 : 1] || r.status },
    { key: 'reason', label: t('سبب عدم التحقيق', 'Why not realised'), render: (r) => r.reason || '—' },
    { key: 'member', label: t('عضو الفريق', 'Team member'), render: (r) => r.member || r.placedBy || '—', exportAs: (r) => r.member || r.placedBy || '' },
    { key: 'hoursToPlace', label: t('ساعات حتى أوّل شاحنة', 'Hours to first truck'), num: true, render: (r) => (r.hoursToPlace == null ? '—' : r.hoursToPlace) },
    { key: 'salesRepName', label: t('المبيعات', 'Sales'), render: (r) => r.salesRepName || '—' },
  ];
  const show = (name: string, f: (r: Row) => boolean) => setDrill({ title: name, rows: list.filter(f), cols, fileName: 'vendors-realisation' });
  const dimKey = DIMS.find((d) => d[0] === dim)!;
  const ofDim = (r: Row, k: string) => (dimKey[1] === 'member' ? (r.member === k || String(r.placedBy || '').split('، ').includes(k)) : (r[dimKey[1]] || '—') === k);

  return (
    <Panel title={title || t('تحقيق طلبات المبيعات', 'Realisation of sales requests')}
      subtitle={t('بالشاحنات: كلُّ شاحنةٍ تُنفَّذ أمرُ نقل · الطلبات المعتمدة فقط · اضغط أيَّ رقمٍ لعرض طلباته وتصديرها', 'In trucks: each placed truck is a transport order · approved requests only · press any number for its requests')}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi ar={ar} label={t('الشاحنات المطلوبة', 'Trucks requested')} value={fmtInt(data.trucks || 0)} sub={t(`${fmtInt(data.requests || 0)} طلب`, `${fmtInt(data.requests || 0)} requests`)} onClick={() => show(t('طلبات المبيعات', 'Sales requests'), () => true)} />
        <Kpi ar={ar} label={t('نسبة التحقيق', 'Realised')} value={fmtPct(data.placeRate || 0)} tone={(data.placeRate || 0) >= 80 ? 'good' : 'warn'} sub={t(`${fmtInt(data.placed || 0)} شاحنة`, `${fmtInt(data.placed || 0)} trucks`)} onClick={() => show(t('طلباتٌ نُفّذت لها شاحنات', 'Requests with placed trucks'), (r) => r.placed > 0)} />
        <Kpi ar={ar} label={t('غير المحقَّق', 'Not realised')} value={fmtPct(data.unrealisedRate || 0)} tone={data.unrealised ? 'bad' : 'muted'} sub={t(`${fmtInt(data.unrealised || 0)} شاحنة`, `${fmtInt(data.unrealised || 0)} trucks`)} onClick={() => show(t('طلباتٌ لم تتحقّق كلُّ شاحناتها', 'Requests not fully realised'), (r) => r.rest > 0)} />
        <Kpi ar={ar} label={t('رفضها الفريق', 'Refused by the team')} value={fmtInt(data.rejected || 0)} tone={data.rejected ? 'bad' : 'muted'} onClick={() => show(t('طلباتٌ رفضها الفريق', 'Refused requests'), (r) => r.status === 'rejected' && r.rest > 0)} />
        <Kpi ar={ar} label={t('سحبتها المبيعات', 'Withdrawn by sales')} value={fmtInt(data.withdrawn || 0)} tone="muted" onClick={() => show(t('طلباتٌ سحبتها المبيعات', 'Withdrawn requests'), (r) => r.status === 'cancelled' && r.rest > 0)} />
        <Kpi ar={ar} label={t('ما زالت مفتوحة', 'Still open')} value={fmtInt(data.open || 0)} tone={data.open ? 'warn' : 'muted'} onClick={() => show(t('طلباتٌ مفتوحة', 'Open requests'), (r) => (r.status === 'pending' || r.status === 'in_progress') && r.rest > 0)} />
        <Kpi ar={ar} label={t('متوسط الوقت حتى أوّل شاحنة', 'Avg time to first truck')} value={data.avgHoursToPlace != null ? `${data.avgHoursToPlace} ${t('س', 'h')}` : '—'} onClick={() => show(t('طلباتٌ نُفّذت لها شاحنات', 'Requests with placed trucks'), (r) => r.hoursToPlace != null)} />
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <p className="px-3 py-2 text-[12.5px] font-bold text-slate-700 bg-slate-50 border-b border-slate-200">{t('لماذا لم تتحقّق؟ (مرتّبة بعدد الشاحنات)', 'Why not realised? (ranked by trucks)')}</p>
          <DataGrid ar={ar} rows={data.reasons || []} rowKey={(r) => r.reason} limit={20} empty={t('تحقّقت كلُّ الشاحنات', 'Every truck realised')} cols={[
            { key: 'reason', label: t('السبب', 'Reason'), render: (r) => <button type="button" className="font-semibold text-start hover:text-[#f37121]" onClick={() => show(`${t('السبب', 'Reason')}: ${r.reason}`, (x) => x.reason === r.reason)}>{r.reason}</button> },
            { key: 'n', label: t('شاحنات', 'Trucks'), num: true },
            { key: 'requests', label: t('طلبات', 'Requests'), num: true },
            { key: 'shareOfUnrealised', label: t('% من غير المحقَّق', '% of not realised'), num: true, render: (r) => fmtPct(r.shareOfUnrealised) },
            { key: 'shareOfAll', label: t('% من كلّ الطلبات', '% of all'), num: true, render: (r) => fmtPct(r.shareOfAll) },
          ]} />
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[12.5px] font-bold text-slate-700 mb-2">{t('الاتجاه يومًا بيوم', 'Day by day')}</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={(data.byDay || []).map((x: Row) => ({ ...x, label: String(x.day).slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis yAxisId="n" tick={{ fontSize: 11 }} /><YAxis yAxisId="p" orientation="right" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip /><Legend />
                <Bar yAxisId="n" dataKey="placed" stackId="a" name={t('محقَّق', 'Realised')} fill="#10b981" />
                <Bar yAxisId="n" dataKey="unrealised" stackId="a" name={t('غير محقَّق', 'Not realised')} fill="#fca5a5" radius={[4, 4, 0, 0]} />
                <Line yAxisId="p" dataKey="rate" name={t('نسبة التحقيق %', 'Realised %')} stroke="#f37121" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-200">
          <span className="text-[12.5px] font-bold text-slate-700 me-2">{t('التوزيع حسب', 'Split by')}</span>
          {DIMS.map(([k, , a, e]) => (
            <button key={k} type="button" onClick={() => setDim(k)} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold ${dim === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'}`}>{ar ? a : e}</button>
          ))}
        </div>
        <DataGrid ar={ar} rows={data[dim] || []} rowKey={(r) => r.key} limit={15} cols={[
          { key: 'key', label: ar ? dimKey[2] : dimKey[3], render: (r) => <button type="button" className="font-semibold text-start hover:text-[#f37121]" onClick={() => show(`${ar ? dimKey[2] : dimKey[3]}: ${r.key}`, (x) => ofDim(x, r.key))}>{r.key}</button> },
          { key: 'trucks', label: t('شاحنات', 'Trucks'), num: true }, { key: 'placed', label: t('محقَّق', 'Realised'), num: true },
          { key: 'unrealised', label: t('غير محقَّق', 'Not realised'), num: true, render: (r) => (r.unrealised ? <button type="button" className="text-red-600 font-semibold hover:underline" onClick={() => show(`${r.key}: ${t('غير المحقَّق', 'not realised')}`, (x) => ofDim(x, r.key) && x.rest > 0)}>{r.unrealised}</button> : <span className="text-slate-300">0</span>) },
          { key: 'rate', label: t('نسبة التحقيق', 'Realised %'), num: true, render: (r) => <span className={r.rate >= 80 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{fmtPct(r.rate)}</span> },
          { key: 'topReason', label: t('أكبر سبب', 'Top reason'), render: (r) => r.topReason || '—' },
        ]} />
      </div>
      <DrillModal drill={drill} onClose={() => setDrill(null)} ar={ar} />
    </Panel>
  );
}
