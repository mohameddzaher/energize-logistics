/**
 * طلباتُ الأقسام إلى الموارد البشريّة.
 *
 * ── ولماذا مسارٌ خارجَ `/api/hr` ───────────────────────────────────────────
 * الطرفان قسمان: المرسِلُ من قسمه (الأفراد، النقلُ الخفيف…) والمستقبِلُ من
 * الموارد البشريّة. ولو عاش تحت `/api/hr` لحرسه `sectionGate('HR')` فما استطاع
 * مشرفُ المناديب أن يرسل طلبًا — وهو صاحبُ الطلب أصلًا.
 *
 * فالحراسةُ في المتحكّم: الإرسالُ لمن سجّل دخولَه، والقراءةُ محدودةٌ بقسم
 * القارئ أو بما أرسله، والجوابُ للموارد البشريّة وحدَها.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const c = require('../controllers/staffStatusRequestController');
const { objectIdParam } = require('../utils/idParam');

router.use(authenticate);
router.param('id', objectIdParam({ status: 400 }));
router.param('sid', objectIdParam({ status: 400 }));

router.get('/', c.list);
router.post('/', c.create);
router.patch('/:id', c.decide);
router.patch('/:id/subjects/:sid', c.decideSubject);

module.exports = router;
