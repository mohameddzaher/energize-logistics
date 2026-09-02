/**
 * قائمةُ العملاء — من سجلّ قسم التحصيل، لا من `Customer`.
 *
 * ── لماذا بقيت هذه البادئة ─────────────────────────────────────────────────
 * `Customer` جدولُ ورك فلو «العملاء والمالية» الذي زال، وصار فارغًا. وهذه
 * النقطةُ يقرؤها موضعان: شاشةُ المستخدمين (لربط حسابِ شريكٍ بعملائه) والتطبيق.
 * فلو تُركت تقرأ من الجدول القديم لعرضت قائمةً فارغةً في الاثنين.
 *
 * فصارت تقرأ من `CollectionsParty` — سجلُّ الأطراف الحيّ الذي بُني من كشوف
 * التشغيل وبقيّة سجلّات الشركة. وشكلُ الردّ كما كان (`companyName`) فلا تُعاد
 * كتابةُ ما يقرؤه.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const CollectionsParty = require('../models/CollectionsParty');
const { flexSpaceRegex } = require('../utils/plateKey');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const filter = { kind: 'customer' };
    if (req.query.active !== 'false') filter.isActive = true;
    const q = String(req.query.q || req.query.search || '').trim();
    if (q) {
      const rx = flexSpaceRegex(q);
      filter.$or = [{ name: rx }, { nameKey: rx }, { phone: rx }, { commercialRegister: rx }];
    }
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 1000));
    const rows = await CollectionsParty.find(filter)
      .select('name phone email city status paymentTerms creditLimit')
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    // `companyName` هو ما تقرؤه الشاشاتُ القائمة — يُرسَل بجانب `name` فلا
    // يُكسر ما يعمل، ولا يُجبَر الجديدُ على اسمٍ من جدولٍ زال.
    res.json({
      customers: rows.map((r) => ({ ...r, companyName: r.name })),
      total: rows.length,
    });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ message: 'تعذّر تحميل العملاء' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await CollectionsParty.findOne({ _id: req.params.id, kind: 'customer' }).lean();
    if (!c) return res.status(404).json({ message: 'العميل غير موجود' });
    res.json({ customer: { ...c, companyName: c.name } });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر تحميل العميل' });
  }
});

module.exports = router;
