'use client';
/**
 * Receivables filters shared by the dashboard and the details page, carried in the URL.
 * Every dashboard number opens a shareable page whose URL holds the dashboard filters (officer, parties, pay, dueState, issue, from, to) plus the clicked node (kind, subtype, due, band, risk, attach, term, lateBand; see nodeOf in collectionsReceivablesController).
 */
import { useMemo } from 'react';
import { X } from 'lucide-react';
import MultiSearchSelect from '@/components/system/MultiSearchSelect';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import { paymentKindLabel } from '@/lib/paymentKind';
import { BANDS, RISKS } from '@/components/collections/ReceivablesTree';

export const DASHBOARD_PATH = '/system/collections-dept/dashboard';
export const RECEIVABLES_PATH = '/system/collections-dept/dashboard/receivables';

export type FilterKey = 'officer' | 'parties' | 'pay' | 'dueState' | 'issue';
export const FILTER_KEYS: FilterKey[] = ['officer', 'parties', 'pay', 'dueState', 'issue'];
export interface DashFilters extends Record<FilterKey, string[]> { from: string; to: string }
export const NO_FILTERS: DashFilters = { officer: [], parties: [], pay: [], dueState: [], issue: [], from: '', to: '' };

export const NODE_KEYS = ['kind', 'subtype', 'due', 'band', 'risk', 'attach', 'term', 'lateBand'] as const;
export type NodeKey = typeof NODE_KEYS[number];

export const PAY_ORDER = ['tax', 'cash', 'deferred_invoice', 'deferred_cash', 'cash_3pl', 'cash_ht'];
export const DUE_LABELS: Record<string, [string, string]> = {
  late: ['مستحق — تجاوز موعده', 'Due — past its date'],
  noterm: ['مستحق — بلا مدّة سداد', 'Due — no credit term'],
  within: ['غير مستحق', 'Not yet due'],
};
export const ISSUE_LABELS: Record<string, [string, string]> = {
  none: ['بلا مشكلة', 'No issue'],
  negotiating: ['تحت التفاوض', 'Negotiating'],
  legal: ['قضايا', 'Legal'],
};

type Params = { get: (k: string) => string | null };
const split = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Dashboard filters parsed from the URL. */
export function filtersFromParams(p: Params | null | undefined): DashFilters {
  if (!p) return NO_FILTERS;
  return {
    officer: split(p.get('officer')), parties: split(p.get('parties')), pay: split(p.get('pay')),
    dueState: split(p.get('dueState')), issue: split(p.get('issue')),
    from: p.get('from') || '', to: p.get('to') || '',
  };
}

/** Serializes filters back to the URL, comma-separated as the server's parseFilters reads them. */
export function filtersToQuery(f: DashFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.from) q.from = f.from;
  if (f.to) q.to = f.to;
  FILTER_KEYS.forEach((k) => { if (f[k].length) q[k] = f[k].join(','); });
  return q;
}

export const activeFilterCount = (f: DashFilters) =>
  FILTER_KEYS.filter((k) => f[k].length).length + (f.from || f.to ? 1 : 0);

/** Details-page link for a node under the dashboard filters. */
export function receivablesHref(f: DashFilters, node: Record<string, string> = {}) {
  const p = new URLSearchParams({ ...filtersToQuery(f), ...node });
  const s = p.toString();
  return s ? `${RECEIVABLES_PATH}?${s}` : RECEIVABLES_PATH;
}

/** Node label as shown in the page header. */
export function nodeLabel(key: string, value: string, ar: boolean): string {
  const t = (a: string, e: string) => (ar ? a : e);
  switch (key) {
    case 'kind': return value === 'tax' ? t('المديونية الضريبية (فواتير)', 'Tax receivables') : t('المديونية الكاش', 'Cash receivables');
    case 'subtype': return paymentKindLabel(value, ar);
    case 'due': return value === 'due' ? t('مستحق', 'Due') : t('غير مستحق', 'Not yet due');
    case 'band': {
      if (value === 'nodate') return t('بلا تاريخ', 'No date');
      const b = BANDS.find((x) => x.key === value);
      return b ? `${t('العمر', 'Age')}: ${t(b.ar, b.en)}` : value;
    }
    case 'risk': {
      const r = RISKS.find((x) => x.key === value);
      return r ? `${t('الخطورة', 'Risk')}: ${t(r.ar, r.en)}` : value;
    }
    case 'attach': return value === 'missing_tax' ? t('ضريبي (بلا نوع) — بلا مرفق', 'Tax (no subtype) — no attachment') : t('آجل - فاتورة — بلا مرفق', 'Deferred invoice — no attachment');
    case 'term': return t('على المدّة الافتراضية', 'On the default term');
    case 'lateBand': return `${t('التأخير', 'Late')}: ${value}`;
    default: return value;
  }
}

export type FacetOpt = { value: string; label?: string; count: number; amount: number; code?: string; isManager?: boolean };
export interface Facets { officer: FacetOpt[]; parties: FacetOpt[]; pay: FacetOpt[]; dueState: FacetOpt[]; issue: FacetOpt[] }

/** Five searchable multi-select lists, each option with its count under the other filters (from `facets` in the dashboard response), plus the date range. */
export function ReceivablesFilterBar({ filters, onChange, facets, ar, manager }: {
  filters: DashFilters; onChange: (f: DashFilters) => void; facets?: Facets; ar: boolean;
  manager?: { name: string } | null;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const options = useMemo(() => ({
    officer: (facets?.officer || []).map((o) => ({
      value: o.value, count: o.count,
      label: o.isManager ? `${o.value} — ${t('مدير القسم', 'Dept. manager')}` : o.value,
      hint: o.isManager ? t('ومعه كلُّ عميلٍ غيرِ مُسنَد', 'incl. every unassigned customer') : undefined,
    })),
    parties: (facets?.parties || []).map((o) => ({ value: o.value, count: o.count, label: o.label || o.value, hint: o.code || undefined })),
    pay: PAY_ORDER.map((k) => ({ value: k, label: paymentKindLabel(k, ar), count: facets?.pay.find((x) => x.value === k)?.count ?? 0 })),
    dueState: ['late', 'noterm', 'within'].map((k) => ({ value: k, label: t(...DUE_LABELS[k]), count: facets?.dueState.find((x) => x.value === k)?.count ?? 0 })),
    issue: ['none', 'negotiating', 'legal'].map((k) => ({ value: k, label: t(...ISSUE_LABELS[k]), count: facets?.issue?.find((x) => x.value === k)?.count ?? 0 })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [facets, ar]);
  const set = (k: FilterKey) => (v: string[]) => onChange({ ...filters, [k]: v });
  const active = activeFilterCount(filters);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <MultiSearchSelect ar={ar} label={t('مسؤول التحصيل', 'Collector')} value={filters.officer} onChange={set('officer')} options={options.officer} />
        <MultiSearchSelect ar={ar} label={t('العميل', 'Customer')} value={filters.parties} onChange={set('parties')} options={options.parties} />
        <MultiSearchSelect ar={ar} label={t('نوع الدفع', 'Payment type')} value={filters.pay} onChange={set('pay')} options={options.pay} />
        <MultiSearchSelect ar={ar} label={t('الاستحقاق', 'Due status')} value={filters.dueState} onChange={set('dueState')} options={options.dueState} searchable={false} />
        <MultiSearchSelect ar={ar} label={t('القضايا', 'Cases')} value={filters.issue} onChange={set('issue')} options={options.issue} searchable={false} />
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <DateRangeFilter from={filters.from} to={filters.to}
          onFrom={(v) => onChange({ ...filters, from: v })} onTo={(v) => onChange({ ...filters, to: v })} ar={ar} />
        {active > 0 && (
          <button type="button" onClick={() => onChange(NO_FILTERS)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-600 text-sm">
            <X className="w-4 h-4" />{t(`إزالة الفلاتر (${active})`, `Clear filters (${active})`)}
          </button>
        )}
        {manager && (
          <span className="ms-auto text-[11px] text-slate-400">
            {t(`كلُّ عميلٍ غيرِ مُسنَدٍ على مدير القسم: ${manager.name}`, `Every unassigned customer falls to the dept. manager: ${manager.name}`)}
          </span>
        )}
      </div>
    </div>
  );
}
