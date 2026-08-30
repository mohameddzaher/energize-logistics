/**
 * يومُ الشركة — حدُّ اليوم يُحسب بتوقيت الرياض لا بتوقيت غرينتش.
 *
 * ── لماذا هذا الملفّ ────────────────────────────────────────────────────────
 * كان كلُّ فلترِ فترةٍ في النظام يبني حدَّه هكذا:
 *
 *     $gte: new Date(`${from}T00:00:00.000Z`)
 *     $lte: new Date(`${to}T23:59:59.999Z`)
 *
 * وهو منتصفُ ليلٍ **بغرينتش** = الثالثةَ فجرًا بالرياض. فمَن فلتر «من ١ يناير»
 * كان يفقد كلَّ ما جرى بين منتصف الليل والثالثة فجرًا من ذلك اليوم، ويكسب —
 * بلا أن يدري — أوّلَ ثلاثِ ساعاتٍ من اليوم التالي لآخر يومٍ اختاره. النافذةُ
 * كلُّها مزاحةٌ ثلاثَ ساعات.
 *
 * وليس رقمًا نظريًّا: في سير عمل التشغيل وحدَه ٢١٢١ كشفًا من ٣٣٩١٧ مؤرَّخةٌ في
 * تلك الساعات الثلاث — كلُّها على الجانب الخطأ من الحدّ.
 *
 * وبعضُ المواضع كانت أسوأ: `new Date('2026-01-01T00:00:00')` بلا `Z` تُقرأ
 * بتوقيت **الخادم**، فتعطي نتيجةً على جهاز المطوّر وأخرى على الخادم.
 *
 * ── ولماذا `Intl` لا `+03:00` مكتوبةً ───────────────────────────────────────
 * السعوديّةُ لا تغيّر ساعتَها، فـ«+03:00» صحيحةٌ اليوم. لكنّ الثابتَ المكتوبَ
 * يديًا يصمت حين يتغيّر ما تحته: فرعٌ في بلدٍ يوقّت صيفًا، أو `COMPANY_TZ`
 * تُضبط لغير الرياض. فيُسأل النظامُ عن الإزاحة وقتَ الحساب بدل أن تُفترض.
 */

const COMPANY_TZ = process.env.COMPANY_TZ || 'Asia/Riyadh';
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** إزاحةُ المنطقة بالدقائق عند لحظةٍ بعينها (موجبةٌ شرقَ غرينتش). */
function offsetMinutesAt(instant, tz = COMPANY_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return (asIfUTC - instant.getTime()) / 60000;
}

/** أوّلُ لحظةٍ من يومٍ بتوقيت الشركة، كتاريخٍ مطلق. */
function startOfDay(ymd, tz = COMPANY_TZ) {
  const key = String(ymd || '').slice(0, 10);
  if (!YMD.test(key)) return null;
  const naive = new Date(`${key}T00:00:00.000Z`);
  // تقديرٌ ثمّ تصحيح: الإزاحةُ تُقاس عند اللحظة الناتجة نفسِها، فلو وقع التقديرُ
  // على الجانب الآخر من تغييرِ ساعةٍ صيفيّةٍ صُحّح بإزاحتها هي.
  const first = new Date(naive.getTime() - offsetMinutesAt(naive, tz) * 60000);
  const second = new Date(naive.getTime() - offsetMinutesAt(first, tz) * 60000);
  return second;
}

/** آخرُ لحظةٍ من يومٍ بتوقيت الشركة (٢٣:٥٩:٥٩٫٩٩٩ عندهم). */
function endOfDay(ymd, tz = COMPANY_TZ) {
  const s = startOfDay(ymd, tz);
  return s ? new Date(s.getTime() + DAY_MS - 1) : null;
}

/**
 * مدًى جاهزٌ لمنغو من تاريخَي واجهةٍ (YYYY-MM-DD)، شاملًا الطرفين.
 *
 * و«إلى» فارغةً تعني «حتى الآن» لا «بلا نهاية»: المدى المفتوح يُدخل صفوفًا
 * مؤرَّخةً في المستقبل — تُكتب بالخطأ أو تأتي بتاريخٍ مقلوب — فيقرأ المستخدم
 * عددًا أكبرَ ممّا حدث. يُعطَّل بـ`openEnd: true` حيث يكون المستقبلُ مقصودًا
 * (موعدٌ قادم، وثيقةٌ تنتهي لاحقًا).
 */
function dayRange(from, to, { openEnd = false } = {}) {
  const gte = startOfDay(from);
  const lte = to ? endOfDay(to) : (openEnd ? null : new Date());
  if (!gte && !lte) return null;
  const r = {};
  if (gte) r.$gte = gte;
  if (lte) r.$lte = lte;
  return r;
}

/** يومُ تاريخٍ ما بتوقيت الشركة، YYYY-MM-DD. */
function dayKeyOf(date, tz = COMPANY_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d);
}

/**
 * عددُ الأيّام بين تاريخين، محسوبًا على تقويم الشركة لا على الساعات.
 *
 * الفرقُ بالمللي ثانية يقسم على ٨٦٤٠٠٠٠٠ فيعطي «صفرًا» لما بين الحادية عشرة
 * مساءً والواحدة صباحًا — وهما يومان. تُقارَن الأيّامُ لا اللحظات.
 */
function daysBetween(fromDate, toDate) {
  const a = startOfDay(dayKeyOf(fromDate));
  const b = startOfDay(dayKeyOf(toDate));
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

/** الأيّامُ حتى تاريخٍ بتقويم الشركة — سالبةٌ لما مضى، صفرٌ لليوم نفسِه. */
function daysUntil(date) {
  return daysBetween(new Date(), date);
}

/** اليومُ الحاليّ بتوقيت الشركة، YYYY-MM-DD. */
function todayKey(tz = COMPANY_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

module.exports = {
  COMPANY_TZ, DAY_MS,
  startOfDay, endOfDay, dayRange,
  dayKeyOf, daysBetween, daysUntil, todayKey,
  offsetMinutesAt,
};
