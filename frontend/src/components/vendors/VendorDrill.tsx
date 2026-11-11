'use client';
/**
 * The list behind a number on the vendors dashboards: every card opens the carriers it counts, searchable, sortable
 * and exportable. Columns carry their own export value so the sheet matches what is on screen.
 */
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Modal, SearchInput } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { DataGrid, TrendChip, fmtDay, trendLabel } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, vendorHref, contractTone } from '@/lib/vendors';

type Row = Record<string, any>;
export type DrillCol = { key: string; label: string; num?: boolean; render?: (r: Row) => ReactNode; sort?: (r: Row) => any; exportAs?: (r: Row) => any };
export type Drill = { title: string; rows: Row[]; cols: DrillCol[]; fileName?: string };

export function DrillModal({ drill, onClose, ar }: { drill: Drill | null; onClose: () => void; ar: boolean }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim();
    if (!drill) return [];
    return s ? drill.rows.filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.includes(s))) : drill.rows;
  }, [drill, q]);
  if (!drill) return null;
  return (
    <Modal open wide="xl" onClose={() => { setQ(''); onClose(); }} title={`${drill.title} (${drill.rows.length})`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]"><SearchInput value={q} onChange={setQ} placeholder={ar ? 'بحث في القائمة…' : 'Search the list…'} /></div>
        <ExportMenu fileName={drill.fileName || 'vendors-list'} lang={ar ? 'ar' : 'en'} options={[{
          key: 'shown', label: ar ? 'تصدير المعروض' : 'Export shown',
          sheets: [{ name: drill.title.slice(0, 30), rows, columns: drill.cols.map((c) => ({ header: c.label, key: c.key, transform: c.exportAs ? (_v: any, r: Row) => c.exportAs!(r) : undefined })) }],
        }]} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <DataGrid ar={ar} rows={rows} limit={50} rowKey={(r, i) => `${r.id || r.name}-${i}`} cols={drill.cols} />
      </div>
    </Modal>
  );
}

/** Columns shared by the dashboards' lists. */
export const drillCols = (ar: boolean) => {
  const t = (a: string, e: string) => (ar ? a : e);
  return {
    name: { key: 'name', label: t('المورّد', 'Carrier'), render: (r: Row) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> } as DrillCol,
    kind: { key: 'kind', label: t('النوع', 'Kind'), render: (r: Row) => <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${KIND[r.kind]?.cls || ''}`}>{kindLabel(r.kind, ar)}</span>, exportAs: (r: Row) => kindLabel(r.kind, ar) } as DrillCol,
    owner: { key: 'owner', label: t('مسؤول المتابعة', 'Owner'), render: (r: Row) => r.owner || '—' } as DrillCol,
    contractStatus: { key: 'contractStatus', label: t('حالة التعاقد', 'Contract status'), render: (r: Row) => (r.contractStatus ? <span className={`px-2 py-0.5 rounded-full border text-[11px] whitespace-nowrap ${contractTone(r.contractStatus)}`}>{r.contractStatus}</span> : '—') } as DrillCol,
    contracted: { key: 'contracted', label: t('متعاقَدٌ رسميًّا', 'Contracted'), render: (r: Row) => (r.contracted ? <span className="text-emerald-700 font-semibold">{t('نعم', 'Yes')}</span> : <span className="text-slate-500">{t('لا', 'No')}</span>), sort: (r: Row) => (r.contracted ? 1 : 0), exportAs: (r: Row) => (r.contracted ? t('نعم', 'Yes') : t('لا', 'No')) } as DrillCol,
    end: { key: 'contractEndDate', label: t('نهاية العقد', 'Contract end'), render: (r: Row) => <span className="tabular-nums">{fmtDay(r.contractEndDate)}</span> } as DrillCol,
    daysLeft: { key: 'daysLeft', label: t('الأيام المتبقّية', 'Days left'), num: true, render: (r: Row) => (r.daysLeft == null ? '—' : <span className={r.daysLeft < 0 ? 'text-red-600 font-bold' : 'text-amber-700 font-semibold'}>{r.daysLeft}</span>) } as DrillCol,
    docsMissing: { key: 'docsMissingLabels', label: t('المستندات الناقصة', 'Missing papers'), render: (r: Row) => (r.docsMissingLabels ? <span className="text-amber-800">{r.docsMissingLabels}</span> : <span className="text-emerald-700">{t('مكتملة', 'Complete')}</span>) } as DrillCol,
    trips: { key: 'trips', label: t('رحلات العام', 'Year trips'), num: true } as DrillCol,
    month: { key: 'month', label: t('رحلات الشهر', 'Month trips'), num: true } as DrillCol,
    trend: { key: 'trend', label: t('الحالة', 'Trend'), render: (r: Row) => <TrendChip t={r.trend} ar={ar} />, exportAs: (r: Row) => trendLabel(r.trend, ar) } as DrillCol,
    last: { key: 'last', label: t('آخر رحلة', 'Last trip'), render: (r: Row) => <span className="tabular-nums">{fmtDay(r.last)}</span>, sort: (r: Row) => String(r.last || '') } as DrillCol,
  };
};
