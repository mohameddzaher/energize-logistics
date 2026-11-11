'use client';
/**
 * The company register's papers and contracts on the vendors dashboards: how many carriers, who misses which required
 * paper, who is officially contracted, whose contract ends soon or ended. Every number opens its list.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Kpi, Panel, BarList, fmtInt, fmtPct } from '@/components/analytics/AnalyticsKit';
import { DrillModal, drillCols, contractStateLabel, type Drill } from './VendorDrill';
import { FileWarning, FileCheck2, Handshake, CalendarX2 } from 'lucide-react';

type Row = Record<string, any>;

export default function VendorRegisterStats({ ar, query = '' }: { ar: boolean; query?: string }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [d, setD] = useState<Row | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const my = guard.begin();
    try { const r = await api.get<Row>(`/api/vendors-mgmt/register-stats${query ? `?${query}` : ''}`); if (guard.isCurrent(my)) setD(r); }
    catch { /* The dashboard stays usable without this block. */ }
  }, [query, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 900); }, [load]);
  useSocket('vendors:changed', soon);
  useSocket('shipmentOrders:updated', soon);
  useSocket('shipmentRequests:changed', soon);

  if (!d) return null;
  const T = d.totals;
  const rows: Row[] = d.rows || [];
  const C = drillCols(ar);
  const base = [C.name, C.kind, C.owner];
  const open = (title: string, f: (r: Row) => boolean, cols = [...base, C.docsMissing, C.contracted, C.end, C.trips, C.last], sort?: (a: Row, b: Row) => number) => {
    const list = rows.filter(f);
    setDrill({ title, rows: sort ? list.slice().sort(sort) : list, cols, fileName: 'vendors-register' });
  };
  const byDays = (a: Row, b: Row) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
  const contractCols = [...base, C.contracted, C.awaitingFile, C.end, C.daysLeft, C.trips, C.last];

  return (
    <Panel title={t('سجلّ الموردين: المستندات والعقود', 'Register: papers and contracts')}
      subtitle={t(`شركاتُ السجلّ كما سجّلها النظام (معتمدون، أو عملوا هذا العام، أو قُدِّموا للاعتماد، أو رُفعت لهم مستنداتٌ أو عقد) · التنبيه قبل نهاية العقد بـ${d.contractDays} يومًا · اضغط أيَّ رقمٍ لعرض قائمته`, `Register companies · contract alert ${d.contractDays} days ahead · press any number for its list`)}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi ar={ar} label={t('موردو السجلّ', 'Register carriers')} value={fmtInt(T.vendors)} sub={t(`معتمدون ${T.master} · غير معتمدين ${T.outside}`, `master ${T.master} · outside ${T.outside}`)} onClick={() => open(t('موردو السجلّ', 'Register carriers'), () => true)} />
        <Kpi ar={ar} icon={<FileWarning className="w-3.5 h-3.5 text-amber-600" />} label={t('مستنداتٌ مطلوبة ناقصة', 'Missing required papers')} value={fmtInt(T.missingDocs)} tone={T.missingDocs ? 'warn' : 'good'} sub={fmtPct((T.missingDocs / Math.max(1, T.vendors)) * 100)}
          onClick={() => open(t('موردون تنقصهم مستنداتٌ مطلوبة', 'Missing required papers'), (r) => r.docsMissing.length > 0, [...base, C.docsMissing, C.trips, C.last])} />
        <Kpi ar={ar} icon={<FileCheck2 className="w-3.5 h-3.5 text-emerald-600" />} label={t('مستنداتٌ مكتملة', 'Papers complete')} value={fmtInt(T.completeDocs)} tone="good"
          onClick={() => open(t('مستنداتُهم مكتملة', 'Papers complete'), (r) => !r.docsMissing.length)} />
        <Kpi ar={ar} icon={<Handshake className="w-3.5 h-3.5 text-emerald-600" />} label={t('متعاقَدٌ معهم رسميًّا', 'Officially contracted')} value={fmtInt(T.contracted)} tone="good" sub={t(`بلا تاريخ نهاية ${T.noEndDate}`, `${T.noEndDate} without end date`)}
          onClick={() => open(t('متعاقَدٌ معهم رسميًّا', 'Officially contracted'), (r) => r.contracted, contractCols, byDays)} />
        <Kpi ar={ar} icon={<FileWarning className="w-3.5 h-3.5 text-amber-600" />} label={t('بانتظار رفع ملف العقد', 'Awaiting contract file')} value={fmtInt(T.awaitingFile || 0)} tone={T.awaitingFile ? 'warn' : 'muted'} sub={t('متعاقَدٌ معهم دون ملفّ', 'contracted, no file yet')}
          onClick={() => open(t('متعاقَدٌ معهم بانتظار رفع ملف العقد', 'Contracted, awaiting the contract file'), (r) => r.awaitingFile, contractCols, byDays)} />
        <Kpi ar={ar} label={t('غير متعاقَدٍ معهم', 'Not contracted')} value={fmtInt(T.notContracted)} tone={T.notContracted ? 'warn' : undefined} sub={t(`منهم نشطون ${T.activeNotContracted}`, `${T.activeNotContracted} active`)}
          onClick={() => open(t('غير متعاقَدٍ معهم (لا عقدَ مسجَّلًا على النظام)', 'Not contracted (no contract recorded)'), (r) => !r.contracted, [...base, C.contractState, C.docsMissing, C.trips, C.last])} />
        <Kpi ar={ar} icon={<CalendarX2 className="w-3.5 h-3.5 text-red-600" />} label={t('عقودٌ تنتهي قريبًا', 'Contracts ending soon')} value={fmtInt(T.expiring)} tone={T.expiring ? 'warn' : 'muted'} sub={t(`منتهية ${T.expired}`, `${T.expired} expired`)}
          onClick={() => open(t('عقودٌ تنتهي قريبًا أو انتهت', 'Contracts ending soon or ended'), (r) => r.contractState === 'expiring' || r.contractState === 'expired', contractCols, byDays)} />
      </div>
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-[12px] font-semibold text-slate-600 mb-2">{t('النقص حسب المستند — اضغط مستندًا لعرض من ينقصه', 'Missing by paper — press one for its list')}</p>
          <BarList ar={ar} color="#f59e0b" limit={4} rows={d.docsByKind.map((k: Row) => ({ key: k.key, label: ar ? k.label : k.labelEn, value: k.missing, hint: fmtPct((k.missing / Math.max(1, T.vendors)) * 100) }))}
            onPick={(k) => { const x = d.docsByKind.find((y: Row) => y.key === k); open(t(`ينقصهم: ${x?.label}`, `Missing: ${x?.labelEn}`), (r) => r.docsMissing.includes(k), [...base, C.docsMissing, C.trips, C.last]); }} />
        </div>
        <div>
          <p className="text-[12px] font-semibold text-slate-600 mb-2">{t('حالة العقود', 'Contract states')}</p>
          <BarList ar={ar} color="#0ea5e9" limit={5} rows={[
            { key: 'active', label: contractStateLabel('active', ar), value: T.active },
            { key: 'expiring', label: contractStateLabel('expiring', ar), value: T.expiring },
            { key: 'expired', label: contractStateLabel('expired', ar), value: T.expired },
            { key: 'noEnd', label: contractStateLabel('noEnd', ar), value: T.noEndDate },
            { key: 'not', label: contractStateLabel('not', ar), value: T.notContracted },
          ]} onPick={(k) => open(`${t('العقود', 'Contracts')}: ${contractStateLabel(k, ar)}`, (r) => r.contractState === k, contractCols, byDays)} />
        </div>
      </div>
      <DrillModal drill={drill} onClose={() => setDrill(null)} ar={ar} />
    </Panel>
  );
}
