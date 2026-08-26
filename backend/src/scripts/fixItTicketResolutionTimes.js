/* eslint-disable no-console */
/**
 * fixItTicketResolutionTimes — إعادة حساب زمن حل بلاغات الدعم الفني.
 *
 *   node src/scripts/fixItTicketResolutionTimes.js --dry
 *   node src/scripts/fixItTicketResolutionTimes.js
 *
 * ما كان يظهر على الشاشة: «١٠ س ٣٢ د» لبلاغ حُلّ في يومه، و«١ يوم» لبلاغ ظلّ
 * مفتوحاً أسبوعين. السبب أن زمن الحل كان يُحسب بطرح منتصف ليل يوم البلاغ
 * بتوقيت UTC من لحظة حفظ السجل:
 *
 *   • منتصف ليل UTC يسبق بداية دوام الرياض بثلاث ساعات، فبلاغ يُسجَّل الظهيرة
 *     ويُغلق فوراً يخرج بتسع ساعات ونصف لم تمرّ على أحد.
 *   • ولحظة الحفظ ليست لحظة الإصلاح: البلاغات أُدخلت دفعةً واحدة يوم
 *     ٢٦-٠٧-٢٠٢٦ وهي مغلقة أصلاً، فقاس الحساب تأخّر إدخال البيانات لا زمن
 *     العمل — بلاغ ٠٧-٠٧ خرج بـ ٢٧٩١٠ دقيقة، أي المسافة إلى يوم الإدخال.
 *   • وتاريخ البلاغ نفسه بلا وقت، فأي رقم بالدقائق دقّة لا يملكها المصدر.
 *
 * الإصلاح: `resolvedDate` يصير يوم الحل المعلن، ويُشتق لما مضى من `resolvedAt`
 * بتوقيت الرياض، ثم يُعاد حساب المدة بالأيام الكاملة (مخزَّنة بالدقائق ×١٤٤٠
 * حتى لا تتغيّر حسابات المتوسط في اللوحة والتقارير).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const CLOSED = ['resolved', 'closed'];

const dateInRiyadh = (t) => new Date(new Date(t).getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);

const daysBetween = (a, b) => {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return Math.max(0, Math.round((y - x) / 86400000));
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const ItTicket = require('../models/ItTicket');

  const rows = await ItTicket.find({})
    .select('ticketNumber status reportedAt resolvedAt resolvedDate resolutionMinutes createdAt')
    .lean();

  const ops = [];
  let cleared = 0;

  rows.forEach((t) => {
    const isClosed = CLOSED.includes(t.status);

    // بلاغ مفتوح لا زمن حل له. بعض الصفوف تحمل قيمة قديمة من إغلاق أُلغي.
    if (!isClosed) {
      if (t.resolutionMinutes !== undefined || t.resolvedAt || t.resolvedDate) {
        cleared += 1;
        ops.push({ updateOne: { filter: { _id: t._id }, update: { $unset: { resolutionMinutes: '', resolvedAt: '', resolvedDate: '' } } } });
      }
      return;
    }

    // يوم الحل: المعلن إن وُجد، وإلا يوم الختم بتوقيت الرياض، وإلا يوم البلاغ.
    const resolvedDate = t.resolvedDate
      || (t.resolvedAt ? dateInRiyadh(t.resolvedAt) : null)
      || t.reportedAt;
    if (!resolvedDate || !t.reportedAt) return;

    const days = daysBetween(t.reportedAt, resolvedDate);
    if (days === undefined) return;
    const minutes = days * 1440;

    if (t.resolvedDate === resolvedDate && t.resolutionMinutes === minutes) return;

    ops.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { resolvedDate, resolvedAt: new Date(`${resolvedDate}T00:00:00Z`), resolutionMinutes: minutes } },
      },
    });
  });

  console.log(`${rows.length} بلاغ · ${ops.length} يحتاج تصحيحاً (منها ${cleared} بلاغ مفتوح يحمل زمن حل)${DRY ? '   (تجربة)' : ''}`);

  rows.slice(0, 10).forEach((t) => {
    if (!CLOSED.includes(t.status)) return;
    const rd = t.resolvedDate || (t.resolvedAt ? dateInRiyadh(t.resolvedAt) : t.reportedAt);
    const d = daysBetween(t.reportedAt, rd);
    console.log(`  ${t.ticketNumber}  ${t.reportedAt} → ${rd}   ${t.resolutionMinutes} د  ⇒  ${d} يوم`);
  });

  if (ops.length && !DRY) {
    const r = await ItTicket.bulkWrite(ops, { ordered: false });
    console.log(`\nصُحّح ${r.modifiedCount} بلاغ.`);
  }
  if (DRY) console.log('\nلم يُكتب شيء. أعد التشغيل بدون --dry للتنفيذ.');
  await mongoose.disconnect();
})().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
