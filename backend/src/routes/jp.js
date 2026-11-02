/**
 * /api/jp: work plan with section tasks and projects, plus the top-management plan.
 * No role list here: manager vs member is computed per request in the controller from config/jpSections (see `who`), since the answer depends on the requested section.
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('attId', objectIdParam());
const authenticate = require('../middleware/auth');
const c = require('../controllers/jpController');

router.use(authenticate);
// An external partner is not on anyone's team.
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/me', c.me);
router.get('/link-options', c.linkOptions);
router.get('/home', c.home);
router.get('/dashboard', c.dashboard);
router.get('/daily', c.daily);

router.get('/tasks', c.listTasks);
router.post('/tasks', c.createTask);
router.patch('/tasks/:id', c.updateTask);
router.delete('/tasks/:id', c.deleteTask);
router.post('/tasks/:id/done', c.setDone);
// Timer, time correction and daily log.
router.post('/tasks/:id/progress', c.progress);
router.post('/tasks/:id/time', c.adjustTime);
router.post('/tasks/:id/hand-down', c.handDown);
router.post('/tasks/:id/attachments', c.addAttachment);
router.post('/tasks/:id/comments', c.addComment);
router.delete('/tasks/:id/attachments/:attId', c.removeAttachment);

router.get('/projects', c.listProjects);
router.post('/projects', c.createProject);
router.patch('/projects/:id', c.updateProject);
router.delete('/projects/:id', c.deleteProject);
router.post('/projects/:id/hand-down', c.handDownProject);

module.exports = router;
