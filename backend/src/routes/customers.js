/** Customer list, read from the collections section register, not `Customer`. `Customer` belonged to the removed customers-and-finance workflow and is empty, but this endpoint is still read by the users screen (linking a partner account to its customers) and the app, so it reads `CollectionsParty` instead, the live party register built from operations statements and other company records. The response shape is unchanged (`companyName`) so readers need no rewrite. */
const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
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

    // `companyName` is what existing screens read; it is sent alongside `name` so nothing breaks and new code is not forced onto a name from a removed table.
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
