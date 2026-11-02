'use client';
/**
 * Residence and driving-licence expiry in driver lists.
 * Every place with driver data shows these two dates as columns, with filters. The server computes them from the employee file (utils/personDocDates) with a status: expired, within 30 days, valid, not recorded. This file holds the cell and the status label for filter and export, shared by all pages.
 */
export type DocState = 'expired' | 'soon' | 'valid' | 'missing';
export type PersonDocs = { iqamaExpiry?: string; licenseExpiry?: string; iqamaState?: DocState; licenseState?: DocState };

const LABELS: Record<DocState, [string, string, string]> = {
  expired: ['منتهية', 'Expired', 'text-red-600 font-bold'],
  soon: ['تنتهي خلال 30 يومًا', 'Expires within 30 days', 'text-amber-600 font-semibold'],
  valid: ['سارية', 'Valid', 'text-slate-700'],
  missing: ['غير مسجَّلة', 'Not recorded', 'text-slate-400'],
};

export const docStateLabel = (s: DocState | undefined, ar: boolean) => {
  const l = LABELS[s || 'missing'];
  return ar ? l[0] : l[1];
};

const dmy = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : '');

/** Gregorian date coloured by status, with the status name underneath when expired or near. */
export function PersonDocDate({ date, state, ar }: { date?: string; state?: DocState; ar: boolean }) {
  const s = state || 'missing';
  const d = dmy(date);
  if (!d) return <span className="text-slate-300">—</span>;
  return (
    <span className={`whitespace-nowrap tabular-nums ${LABELS[s][2]}`} title={docStateLabel(s, ar)}>
      {d}
      {(s === 'expired' || s === 'soon') && <span className="block text-[10.5px] font-semibold">{docStateLabel(s, ar)}</span>}
    </span>
  );
}

/** The two export columns (date and status) for every page that exports a driver. */
export const personDocExportColumns = (ar: boolean, get: (row: any) => PersonDocs = (r) => r) => [
  { header: ar ? 'انتهاء الإقامة' : 'Iqama expiry', key: '_iqamaExpiry', width: 14,
    transform: (_v: any, row: any) => dmy(get(row)?.iqamaExpiry) },
  { header: ar ? 'حالة الإقامة' : 'Iqama status', key: '_iqamaState', width: 16,
    transform: (_v: any, row: any) => docStateLabel(get(row)?.iqamaState, ar) },
  { header: ar ? 'انتهاء رخصة القيادة' : 'Licence expiry', key: '_licenseExpiry', width: 16,
    transform: (_v: any, row: any) => dmy(get(row)?.licenseExpiry) },
  { header: ar ? 'حالة رخصة القيادة' : 'Licence status', key: '_licenseState', width: 16,
    transform: (_v: any, row: any) => docStateLabel(get(row)?.licenseState, ar) },
];
