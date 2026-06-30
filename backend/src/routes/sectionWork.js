/**
 * /api/section-work — per-section Tasks + Complaints.
 * Any internal (non-client) staff member can use it; the controller enforces the
 * strict assignee/creator/super_admin visibility on every record.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const c = require('../controllers/sectionWorkController');

router.use(authenticate);
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/assignees', c.assignees);

router.get('/tasks', c.tasks.list);
router.post('/tasks', c.tasks.create);
router.patch('/tasks/:id', c.tasks.update);
router.delete('/tasks/:id', c.tasks.remove);

router.get('/complaints', c.complaints.list);
router.post('/complaints', c.complaints.create);
router.patch('/complaints/:id', c.complaints.update);
router.delete('/complaints/:id', c.complaints.remove);

module.exports = router;
