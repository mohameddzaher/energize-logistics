/**
 * /api/partners — العملاء والموردون كقائمة واحدة + حسابات دخولهم.
 *
 * Reads are open to any staff role (the users page and every customer profile
 * page needs them); creating or changing an outside login is limited to the
 * account-admin tier inside the controller.
 */
const express = require('express');
const router = express.Router();
const partners = require('../controllers/partnerController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
// A partner must never be able to enumerate other partners.
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/registers', partners.getRegisters);
router.get('/accounts', partners.listAccounts);
router.get('/account', partners.getAccount);          // ?source=&refId=
router.post('/account', partners.createAccount);
router.patch('/account/:id', partners.updateAccount);
router.delete('/account/:id', partners.deleteAccount);
router.get('/', partners.listPartners);               // ?kind=&q=&source=&limit=

module.exports = router;
