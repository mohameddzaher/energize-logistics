/**
 * /api/business-review — اجتماعات مراجعة الأعمال.
 *
 * Every logged-in staff member may reach this router, because the LAST two
 * routes (`/my-tasks`) belong to ordinary employees receiving delegated work.
 * Everything above them checks its own tier inside the controller — a manager's
 * board, the minutes, the follow-up register.
 *
 * Route order matters: the literal paths (`/meetings/actions`, `/my-actions`)
 * are declared before `/meetings/:id`, or "actions" would be read as a meeting id.
 */
const express = require('express');
const router = express.Router();
const br = require('../controllers/businessReviewController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
// An outside partner has the portal and nothing here.
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/meta', br.getMeta);
router.get('/dashboard', br.getDashboard);

// ── My work ────────────────────────────────────────────────────────────────
router.get('/my-actions', br.myActions);        // manager: actions I own
router.get('/my-tasks', br.myAssignments);      // employee: work delegated to me
router.patch('/assignments/:assignmentId', br.updateAssignment);
router.delete('/assignments/:assignmentId', br.deleteAssignment);

// ── The follow-up register (board + secretariat) ───────────────────────────
router.get('/actions', br.allActions);
router.patch('/actions/:actionId', br.updateAction);
router.delete('/actions/:actionId', br.deleteAction);
router.post('/actions/:actionId/delegate', br.delegate);

// ── Meetings ───────────────────────────────────────────────────────────────
router.get('/meetings', br.listMeetings);
router.post('/meetings', br.createMeeting);
router.get('/meetings/:id', br.getMeeting);
router.put('/meetings/:id', br.updateMeeting);
router.put('/meetings/:id/minutes', br.saveMinutes);
router.post('/meetings/:id/actions', br.createAction);
router.delete('/meetings/:id', br.deleteMeeting);

module.exports = router;
