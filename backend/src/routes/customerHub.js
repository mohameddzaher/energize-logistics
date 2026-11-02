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
module.exports = router;
