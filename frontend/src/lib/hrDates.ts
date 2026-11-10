/** HR dates: every date is two columns, Gregorian then its Hijri equivalent. Hijri is derived from the Gregorian day via the shared Umm al-Qura converter (lib/hijri), never stored. Both come from the same company day (dayKey, Riyadh) so the two columns never differ by a day. */
import { dayKey } from './companyDay';
import { toHijri, toHijriParts } from './hijri';

type DateLike = string | number | Date | null | undefined;

const PLAIN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Gregorian day yyyy-mm-dd as shown on screen, or '' for a non-date. */
export const gregDay = (v: DateLike): string => {
  if (v === null || v === undefined || v === '') return '';
  // A yyyy-mm-dd string is a day without time: used as is, no timezone conversion.
  if (typeof v === 'string' && PLAIN.test(v.trim())) return v.trim();
  return dayKey(v);
};

/** Hijri date yyyy-mm-dd, or '' if the input is not a date. */
export const hijriDay = (v: DateLike): string => {
  const g = gregDay(v);
  return g ? toHijri(g) : '';
};

/** Table cell: the Hijri date or a dash. */
export const hijriCell = (v: DateLike): string => hijriDay(v) || '—';

/** Gregorian dd/mm/yyyy (HR table format), from the same day the Hijri date is computed from. */
export const gregCell = (v: DateLike): string => {
  const g = gregDay(v);
  if (!g) return '—';
  const [y, m, d] = g.split('-');
  return `${d}/${m}/${y}`;
};

// Hijri month names; counterpart of HIJRI_MONTHS_AR in backend/src/utils/hijri.js.
const HIJRI_MONTHS_AR = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
const HIJRI_MONTHS_EN = ['Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II',
  'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'];

const G_AR = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const G_EN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Long Gregorian date, e.g. 12 October 2026. */
export const gregLong = (v: DateLike, ar: boolean): string => {
  const g = gregDay(v);
  return g ? (ar ? G_AR : G_EN).format(new Date(`${g}T00:00:00Z`)) : '';
};

/** Long Hijri date, e.g. 1 Jumada al-Awwal 1448. */
export const hijriLong = (v: DateLike, ar: boolean): string => {
  const g = gregDay(v);
  const h = g ? toHijriParts(`${g}T00:00:00Z`) : null;
  if (!h) return '';
  return `${h.d} ${(ar ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN)[h.m - 1]} ${h.y}`;
};

/** Detail line with both calendars, Gregorian first. */
export const bothDates = (v: DateLike, ar: boolean, empty = '—'): string => {
  const g = gregLong(v, ar);
  if (!g) return empty;
  const h = hijriLong(v, ar);
  return h ? `${g} · ${h}${ar ? ' هـ' : ' AH'}` : g;
};

/** Short form for tight spaces: 12/10/2026 · 1448-05-01 H. */
export const bothDatesShort = (v: DateLike, ar: boolean, empty = '—'): string => {
  const g = gregDay(v);
  if (!g) return empty;
  const h = toHijri(g);
  return h ? `${gregCell(g)} · ${h}${ar ? ' هـ' : ' AH'}` : gregCell(g);
};

/** Names of the two columns from one label: [Gregorian, Hijri]. Where the root repeats, the qualifier goes in parentheses, as in config/hrFields on the server. */
export const pairLabels = (base: string, ar: boolean): [string, string] => {
  // The required marker stays at the end of the name, not the middle.
  const star = /\s*\*\s*$/.test(base) ? ' *' : '';
  let b = base.replace(/\s*\*\s*$/, '').trim()
    // The server already names master fields with the Gregorian qualifier (config/hrFields), so it is not repeated.
    .replace(/\s*(الميلادي|\(ميلادي\)|\(Gregorian\))$/, '').trim();
  // The expiry label reads as an adjective of expiry, so the name is prefixed with the word for date.
  if (ar && /^انتهاء/.test(b)) b = `تاريخ ${b}`;
  if (!ar) return [`${b} (Gregorian)${star}`, `${b} (Hijri)`];
  if (/ميلاد/.test(b)) return [`${b} (ميلادي)${star}`, `${b} (هجري)`];
  return [`${b} الميلادي${star}`, `${b} الهجري`];
};

export type HrExportColumn = {
  header: string; key: string; width?: number;
  transform?: (value: any, row: any) => any;
  type?: 'text' | 'date' | 'number' | 'hijri';
};

/** Export columns for one date, side by side, from the same value. Gregorian is a real date cell (type: 'date'); Hijri is the Umm al-Qura text as on screen (type: 'hijri' in exportExcel). Both go through gregDay so the file matches the page. */
export const exportDatePair = (
  base: string, key: string, ar: boolean,
  // empty: what both columns get when there is no date (e.g. 'until now' for an ongoing authorization).
  opts: { width?: number; get?: (row: any) => DateLike; empty?: string } = {},
): HrExportColumn[] => {
  const [g, h] = pairLabels(base, ar);
  const read = (raw: any, row: any) => gregDay(opts.get ? opts.get(row) : raw) || opts.empty || '';
  return [
    { header: g, key, width: opts.width ?? 16, type: 'date', transform: read },
    { header: h, key, width: opts.width ?? 16, type: 'hijri', transform: read },
  ];
};

/** No-duplicates check: two columns with the same title in one table is a build bug (the Hijri column once appeared twice in the master, one from the server and one from the browser). Called in development when building export columns. */
export const duplicateHeaders = (columns: { header: string }[]): string[] => {
  const seen = new Set<string>(); const dup = new Set<string>();
  for (const c of columns) { if (seen.has(c.header)) dup.add(c.header); seen.add(c.header); }
  return [...dup];
};

/** A period in a detail line, each end shown in both calendars. */
export const bothPeriod = (from: DateLike, to: DateLike, ar: boolean): string =>
  `${ar ? 'من' : 'From'} ${bothDates(from, ar)} ${ar ? 'إلى' : 'to'} ${bothDates(to, ar)}`;
