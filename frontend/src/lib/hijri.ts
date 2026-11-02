/**
 * Hijri calendar (Umm al-Qura), converted both ways in the browser.
 * Identical to backend/src/utils/hijri.js: both sides use Intl as the single source, so a date never differs between display and calculation.
 * The Hijri date is not stored: the database field is one Gregorian instant and Hijri is another way to write it. The two columns on screen are two views of one value, editing one updates the other, and only the Gregorian is saved.
 */

const FMT = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
});

export type HijriParts = { y: number; m: number; d: number };

export function toHijriParts(input: any): HijriParts | null {
  if (!input) return null;
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  const p = FMT.formatToParts(dt);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const y = get('year'); const m = get('month'); const d = get('day');
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** Gregorian to Hijri "yyyy-mm-dd" (same order so it reads and edits like the Gregorian one). */
export function toHijri(input: any): string {
  const h = toHijriParts(input);
  if (!h) return '';
  return `${h.y}-${String(h.m).padStart(2, '0')}-${String(h.d).padStart(2, '0')}`;
}

const cmp = (a: HijriParts, b: HijriParts) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
const DAY = 86400000;

/** Hijri to Gregorian. Binary search over the same Intl, so the two directions agree. */
export function fromHijri(y: number | string, m: number | string, d: number | string): Date | null {
  const Y = Number(y); const M = Number(m); const D = Number(d);
  if (!Y || !M || !D || M < 1 || M > 12 || D < 1 || D > 30) return null;
  const want = { y: Y, m: M, d: D };

  const approx = Date.UTC(622, 6, 16) + ((Y - 1) * 354.367 + (M - 1) * 29.53 + (D - 1)) * DAY;
  let lo = approx - 20 * DAY;
  let hi = approx + 20 * DAY;
  for (let i = 0; i < 8; i += 1) {
    const a = toHijriParts(new Date(lo));
    const b = toHijriParts(new Date(hi));
    if (a && cmp(a, want) > 0) { lo -= 60 * DAY; continue; }
    if (b && cmp(b, want) < 0) { hi += 60 * DAY; continue; }
    break;
  }
  let loD = Math.floor(lo / DAY);
  let hiD = Math.ceil(hi / DAY);
  while (loD < hiD) {
    const mid = Math.floor((loD + hiD) / 2);
    const h = toHijriParts(new Date(mid * DAY));
    if (h && cmp(h, want) < 0) loD = mid + 1; else hiD = mid;
  }
  const out = new Date(loD * DAY);
  const check = toHijriParts(out);
  if (!check || cmp(check, want) !== 0) return null;
  return out;
}

/** "1449-01-09" or "09/01/1449" to Gregorian "yyyy-mm-dd". */
export function hijriToGregorian(text: string): string {
  const s = String(text || '').trim();
  let m = /^(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  let g: Date | null = null;
  if (m) g = fromHijri(m[1], m[2], m[3]);
  else {
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{3,4})$/.exec(s);
    if (m) g = fromHijri(m[3], m[2], m[1]);
  }
  return g ? g.toISOString().slice(0, 10) : '';
}

/** Gregorian "yyyy-mm-dd" to Hijri, for display in an adjacent column. */
export const gregorianToHijri = (text: any): string => toHijri(text);
