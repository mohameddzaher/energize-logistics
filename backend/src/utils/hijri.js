/**
 * Hijri and Gregorian dates are two views of one date, not two fields.
 * Only the Gregorian `YYYY-MM-DD` is stored; Hijri is derived (Umm al-Qura via Intl), so the two cannot disagree. Hijri input is converted to Gregorian before saving.
 * Hijri to Gregorian is not offered by Intl, so it uses a binary search over days against the same Intl, which makes the round trip exact.
 */

const DAY = 86400000;
const PAD = (n) => String(n).padStart(2, '0');

// Formatter built once; building it per date costs more than the conversion.
let fmt = null;
const formatter = () => {
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
    });
  }
  return fmt;
};

const asDate = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Day/month/year text, as some imports wrote it.
  const dm = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dm && +dm[2] >= 1 && +dm[2] <= 12 && +dm[1] >= 1 && +dm[1] <= 31) return new Date(Date.UTC(+dm[3], +dm[2] - 1, +dm[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Gregorian to Hijri `YYYY-MM-DD`, or '' if not a readable date. */
const toHijri = (value) => {
  const d = asDate(value);
  if (!d) return '';
  try {
    const parts = formatter().formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    // Some Intl versions append an era suffix to the year, so only the digits are taken.
    const y = String(get('year')).replace(/\D/g, '');
    const mo = String(get('month')).replace(/\D/g, '');
    const da = String(get('day')).replace(/\D/g, '');
    if (!y || !mo || !da) return '';
    return `${y.padStart(4, '0')}-${PAD(mo)}-${PAD(da)}`;
  } catch (e) {
    return '';
  }
};

/** Numeric comparison key: 1446-07-03 becomes 14460703. */
const hKey = (s) => {
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
};

/**
 * Hijri `YYYY-MM-DD` to a Gregorian `Date` (UTC midnight), or null.
 * Binary search over roughly year 600 to 1600 AH, enough for any entered value.
 */
const fromHijri = (value) => {
  const want = hKey(value);
  if (!want) return null;
  // First estimate: Hijri year is 354.367 days; 1 Muharram 1 AH is 622-07-19 CE.
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  const [, hy, hm, hd] = m.map(Number);
  const guess = Date.UTC(622, 6, 19) + Math.round(((hy - 1) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * DAY);
  let lo = guess - 40 * DAY;
  let hi = guess + 40 * DAY;
  // If the estimate is off, widen the range rather than trust the approximation.
  if (hKey(toHijri(new Date(lo))) > want) lo = Date.UTC(600, 0, 1);
  if (hKey(toHijri(new Date(hi))) < want) hi = Date.UTC(2200, 0, 1);
  for (let i = 0; i < 64 && lo <= hi; i += 1) {
    const mid = lo + Math.floor((hi - lo) / 2 / DAY) * DAY;
    const got = hKey(toHijri(new Date(mid)));
    if (got === want) return new Date(mid);
    if (got == null) return null;
    if (got < want) lo = mid + DAY; else hi = mid - DAY;
  }
  return null;
};

/** Hijri to Gregorian string `YYYY-MM-DD`, or ''. */
const fromHijriString = (value) => {
  const d = fromHijri(value);
  return d ? `${d.getUTCFullYear()}-${PAD(d.getUTCMonth() + 1)}-${PAD(d.getUTCDate())}` : '';
};

/** Hijri month names, for display when a date is written out in words. */
const HIJRI_MONTHS_AR = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];

/**
 * fillHijriPairs: completes the twin date in a flat update (`{ 'block.expiryDate': ... }`).
 * Hijri only derives the Gregorian; Gregorian only derives the Hijri (if the record has the twin); if both are sent the changed one wins, Gregorian when both changed.
 * Mutates `$set` in place and returns what it derived. Never throws; an unreadable date is left for validation to reject.
 */
const SUFFIX = 'Hijri';
const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const sameDay = (a, b) => {
  const x = asDate(a); const y = asDate(b);
  if (!x && !y) return true;
  if (!x || !y) return false;
  return x.toISOString().slice(0, 10) === y.toISOString().slice(0, 10);
};
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// Dates that have a stored Hijri twin in the vehicle record (models/VehicleMaster): registration licence and periodic inspection. Others (GPS subscription, insurance) are Gregorian only, so no Hijri field is invented.
const VEHICLE_PAIRS = ['vehicleLicense.expiryDate', 'inspection.expiryDate'];

function fillHijriPairs($set, before = {}, known = VEHICLE_PAIRS) {
  const derived = {};
  if (!$set || typeof $set !== 'object') return derived;
  const bases = new Set();
  for (const k of Object.keys($set)) {
    if (k.endsWith(SUFFIX)) bases.add(k.slice(0, -SUFFIX.length));
    // Gregorian with no twin sent: it has a twin if the field is known or already in the record.
    else if (known.includes(k) || getPath(before, `${k}${SUFFIX}`) !== undefined) bases.add(k);
  }
  for (const base of bases) {
    const hk = `${base}${SUFFIX}`;
    const hasG = Object.prototype.hasOwnProperty.call($set, base);
    const hasH = Object.prototype.hasOwnProperty.call($set, hk);
    const gChanged = hasG && !sameDay($set[base], getPath(before, base));
    const hChanged = hasH && hKey($set[hk]) !== hKey(getPath(before, hk));
    try {
      if (hasH && !isBlank($set[hk]) && (!hasG || (hChanged && !gChanged))) {
        // Hijri was written: derive its Gregorian.
        const g = fromHijriString(String($set[hk]).trim());
        if (g) { $set[base] = g; derived[base] = g; }
      } else if (hasG) {
        // Gregorian was written (or cleared): its twin follows.
        const h = isBlank($set[base]) ? '' : toHijri($set[base]);
        if (h !== undefined && h !== null && (!hasH || hKey($set[hk]) !== hKey(h))) { $set[hk] = h; derived[hk] = h; }
      }
    } catch (e) { /* Left for validation to handle */ }
  }
  return derived;
}

module.exports = { toHijri, fromHijri, fromHijriString, hKey, HIJRI_MONTHS_AR, fillHijriPairs };
