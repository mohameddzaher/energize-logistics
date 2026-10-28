/**
 * /api/portal — بوابة العميل والمورد.
 *
 * Every route here is scoped to the caller's OWN partner identity inside the
 * controller; none of them take a customer id from the request. `client` is the
 * external-user role — staff have their own pages and don't come through here.
 */
const express = require('express');
const router = express.Router();
const portal = require('../controllers/portalController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);
router.use(authorize('client'));

router.get('/me', portal.me);
router.get('/overview', portal.overview);
router.get('/shipments', portal.shipments);                 // ?type=heavy|orders|vendor
router.get('/shipments/:type/:id', portal.shipmentDetail);
router.get('/waybill/:type/:id', portal.waybill);            // بوليصة PDF
router.get('/customs', portal.customs);
router.get('/finance', portal.finance);
router.get('/invoices', portal.invoices);
// Requests the customer sends us (answered in «التواصل مع العملاء»).
const requests = require('../controllers/customerRequestsController');
router.get('/requests', requests.myList);
router.get('/requests/options', requests.myOptions);
router.post('/requests', requests.create);
router.get('/requests/:id', requests.myOne);
router.post('/requests/:id/reply', requests.myReply);

module.exports = router;
