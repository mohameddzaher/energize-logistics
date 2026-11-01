/**
 * An amount in Saudi riyals written out in Arabic for printed documents, with the
 * counted noun in its correct form: ثلاثة آلاف وأربعمائة ريال، خمسة عشر ريالًا.
 */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** 1..999 as words. */
function below1000(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest > 0 && rest <= 10) parts.push(ONES[rest]);
  else if (rest > 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else if (rest >= 20) {
    const o = rest % 10;
    parts.push(o ? `${ONES[o]} و${TENS[Math.floor(rest / 10)]}` : TENS[Math.floor(rest / 10)]);
  }
  return parts.join(' و');
}

/** A count of a noun with its correct form. forms: [one, two, few, many]. */
function counted(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  const last = n % 100;
  if (last >= 3 && last <= 10) return `${below1000(n)} ${few}`;
  if (last === 0 || last === 1 || last === 2) return `${below1000(n)} ${one}`;
  return `${below1000(n)} ${many}`;
}

const THOUSAND = ['ألف', 'ألفان', 'آلاف', 'ألفًا'];
const MILLION = ['مليون', 'مليونان', 'ملايين', 'مليونًا'];
const RIYAL = ['ريال', 'ريالان', 'ريالات', 'ريالًا'];

function integerWords(n) {
  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (millions) parts.push(counted(millions, MILLION));
  if (thousands) parts.push(counted(thousands, THOUSAND));
  if (rest) parts.push(below1000(rest));
  return parts.join(' و');
}

/** A number read straight onto «ريال» drops its ending: ألفا، مائتا، أحد عشر ألف. */
function joined(n) {
  const words = integerWords(n);
  if (n % 1000 === 200) return words.replace(/مائتان$/, 'مائتا');
  if (n % 1000 !== 0) return words;
  return words.replace(/ألفان$/, 'ألفا').replace(/ألفًا$/, 'ألف').replace(/مليونان$/, 'مليونا').replace(/مليونًا$/, 'مليون');
}

/** Noun for a total: the last two digits decide, a round thousand takes «ريال». */
function riyalNoun(n) {
  if (n === 1) return 'ريال واحد';
  if (n === 2) return 'ريالان';
  const last = n % 100;
  if (last >= 3 && last <= 10) return RIYAL[2];
  if (last >= 11) return RIYAL[3];
  return RIYAL[0];
}

function amountInArabic(value) {
  const v = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(v) || v <= 0) return '';
  const whole = Math.floor(v);
  const halalas = Math.round((v - whole) * 100);
  let text = '';
  if (whole === 1 || whole === 2) text = riyalNoun(whole);
  else if (whole) text = `${joined(whole)} ${riyalNoun(whole)}`;
  if (halalas) text += `${text ? ' و' : ''}${below1000(halalas)} هللة`;
  return text;
}

module.exports = { amountInArabic };
