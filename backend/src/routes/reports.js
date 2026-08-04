/**
 * /api/reports — مركز التقارير.
 *
 * Not section-gated: a report deliberately crosses sections (a vehicle report
 * reads telemetry AND loads AND the workshop). Access is decided per subject
 * inside the controller instead — see REPORT_ROLES / SUBJECT_ROLES there.
 */
const express = require('express');
const router = express.Router();
const reports = require('../controllers/reportController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
// A partner login has the portal; it must never reach the reporting engine.
router.use((req, res, next) => (req.user.role === 'client' ? res.status(403).json({ message: 'Not allowed' }) : next()));

router.get('/subjects', reports.getSubjects);
router.get('/:subject/options', reports.getOptions);          // ?q=
router.get('/:subject/:id', reports.getReport);               // ?from&to&lang&format=pdf

module.exports = router;
