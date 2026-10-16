/**
 * /api/ls2/custody — عهدةُ النقل الثقيل. راجع controllers/htCustodyController.
 *
 * مركَّبٌ قبل `/api/ls2` في server.js وبحارسه الخاصّ: موجّهُ القسم يحصر كلَّ
 * نقاطه في أدوار القسم، وأهلُ المال ليسوا منها — والعهدةُ مالٌ يفتحها أهلُه.
 * فقائمتُها وحدَها تقرّر (`strict`)، ومنحُ القسم لا يفتحها لموظّفيه.
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
const authorize = require('../middleware/rbac');
const custody = require('../controllers/htCustodyController');

const CUSTODY = authorize.strict(...custody.CUSTODY_ROLES);
router.get('/', CUSTODY, custody.list);
router.get('/rep', CUSTODY, custody.lookupRep);
router.get('/vehicles', CUSTODY, custody.listVehicles);
router.post('/', CUSTODY, custody.create);
router.put('/:id', CUSTODY, custody.update);      // والمتحكِّمُ يحصره في مدير النظام وأهل المال
router.delete('/:id', CUSTODY, custody.remove);

module.exports = router;
