/** /api/customer-hub: where this customer exists across company sections (services/customerHub). Each customer file reads it to show "same customer in: ..." with links. Read-only for company staff. */
const express = require('express');
const authenticate = require('../middleware/auth');
const hub = require('../services/customerHub');

const router = express.Router();
router.use(authenticate);
router.get('/presence/:reg/:id', async (req, res) => {
  try {
    if (req.user.role === 'client' || req.user.accountType === 'customer' || req.user.accountType === 'vendor') return res.status(403).json({ message: 'Forbidden' });
    const out = await hub.presence(String(req.params.reg), String(req.params.id));
    if (!out) return res.status(404).json({ message: 'غير موجود' });
    res.json(out);
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// The complete customer file (services/customerFile): every section's data for one customer, top management only.
const file = require('../services/customerFile');
const fullOnly = (req, res, next) => (file.canSeeFullFile(req.user) ? next() : res.status(403).json({ message: 'الملف الشامل للإدارة العليا فقط' }));
router.get('/files', fullOnly, async (req, res) => {
  try { res.json({ rows: await file.list(req.query.q) }); } catch (e) { res.status(500).json({ message: e.message }); }
});
router.get('/file/:id', fullOnly, async (req, res) => {
  try {
    const masterId = await file.masterOf(String(req.query.reg || 'crm'), String(req.params.id));
    const out = masterId ? await file.build(masterId) : null;
    if (!out) return res.status(404).json({ message: 'العميل غير موجود' });
    res.json(out);
  } catch (e) { console.error('[customer-file]', e); res.status(500).json({ message: e.message }); }
});
/** Whether this user may open the complete file (the section pages show the link only then). */
router.get('/file-access', (req, res) => res.json({ allowed: file.canSeeFullFile(req.user) }));
module.exports = router;
