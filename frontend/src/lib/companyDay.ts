/**
 * Company day in the frontend; counterpart of backend/src/utils/companyDay.js.
 * new Date().toISOString().slice(0, 10) was written in many places, and toISOString converts to Greenwich before slicing, so between midnight and 03:00 Riyadh time it returns yesterday: wrong default date fields and filters starting a day early. Worse is toDateInput, where converting a stored time through toISOString shifts it by the offset and a date saved late at night shows a day off.
 */

export const COMPANY_TZ = 'Asia/Riyadh';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Day of a date in company time, YYYY-MM-DD, or '' for an invalid date. */
export function dayKey(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}

/** Current day in company time. */
export const today = (): string => fmt.format(new Date());

/** The day n days before/after today; negative for the past. */
export const dayOffset = (n: number): string => fmt.format(new Date(Date.now() + n * 86400000));

/** First day of the current month. */
export const monthStart = (): string => `${today().slice(0, 7)}-01`;

/** A valid <input type="date"> value from any stored date. Used instead of new Date(v).toISOString().slice(0, 10) in every form. */
export const toDateInput = (v?: string | number | Date | null): string => dayKey(v);

/** A valid <input type="datetime-local"> value in company time. */
export function toDateTimeInput(v?: string | number | Date | null): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: COMPANY_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).reduce<Record<string, string>>((o, x) => { o[x.type] = x.value; return o; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
