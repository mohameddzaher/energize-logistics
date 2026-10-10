/**
 * /api/jp — خطّةُ العمل: مهامُّ الأقسام ومشروعاتُها، وخطّةُ الإدارة العليا.
 *
 * لا قائمةَ أدوارٍ هنا: من هو مديرٌ ومن هو عضوٌ يُحسَب لكلّ طلبٍ في المتحكِّم
 * من config/jpSections (راجع `who`)، لأنّ الجوابَ يختلف باختلاف القسم المطلوب.
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('attId', objectIdParam());
const authenticate = require('../middleware/auth');
const c = require('../controllers/jpController');

router.use(authenticate);
// الشريكُ الخارجيُّ ليس من فريق أحد.
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/me', c.me);
router.get('/home', c.home);
router.get('/dashboard', c.dashboard);

router.get('/tasks', c.listTasks);
router.post('/tasks', c.createTask);
router.patch('/tasks/:id', c.updateTask);
router.delete('/tasks/:id', c.deleteTask);
router.post('/tasks/:id/done', c.setDone);
router.post('/tasks/:id/hand-down', c.handDown);
router.post('/tasks/:id/attachments', c.addAttachment);
router.delete('/tasks/:id/attachments/:attId', c.removeAttachment);

router.get('/projects', c.listProjects);
router.post('/projects', c.createProject);
router.patch('/projects/:id', c.updateProject);
router.delete('/projects/:id', c.deleteProject);
router.post('/projects/:id/hand-down', c.handDownProject);

module.exports = router;
