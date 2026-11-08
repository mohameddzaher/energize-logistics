/**
 * /api/business-review: business review meetings.
 * Every logged-in staff member may reach this router because the last routes (`/my-tasks`) belong to ordinary employees receiving delegated work; everything above checks its own tier in the controller (manager board, minutes, follow-up register).
 * Route order matters: literal paths (`/meetings/actions`, `/my-actions`) are declared before `/meetings/:id`, or "actions" would be read as a meeting id.
 */
const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('assignmentId', objectIdParam());
router.param('actionId', objectIdParam());
const br = require('../controllers/businessReviewController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
// An outside partner has the portal and nothing here.
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/meta', br.getMeta);
router.get('/dashboard', br.getDashboard);

// Department board and recurring meetings (the daily meeting).
const board = require('../controllers/businessReviewBoardController');
router.get('/board', board.getBoard);
router.get('/daily', board.getDaily);
router.get('/series', board.listSeries);
router.post('/series', board.createSeries);
router.put('/series/:id', board.updateSeries);
router.delete('/series/:id', board.deleteSeries);
router.post('/series/:id/day', board.seriesDay);

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
router.post('/actions/:actionId/share', br.shareAction);

// ── Meetings ───────────────────────────────────────────────────────────────
router.get('/meetings', br.listMeetings);
router.post('/meetings', br.createMeeting);
router.get('/meetings/:id', br.getMeeting);
router.get('/meetings/:id/departments', board.getMeetingDepartments);
router.put('/meetings/:id', br.updateMeeting);
// Closing has its own route because it checks that all meeting work is done before marking it complete.
router.post('/meetings/:id/complete', br.completeMeeting);
router.post('/meetings/:id/reopen', br.reopenMeeting);
router.put('/meetings/:id/minutes', br.saveMinutes);
router.post('/meetings/:id/actions', br.createAction);
router.delete('/meetings/:id', br.deleteMeeting);

module.exports = router;
