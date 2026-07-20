/**
 * /api/performance — تقييم الأداء (KPI evaluations).
 *
 * Reads are open to any authenticated staff member, but every handler scopes the
 * data to the caller's team. The grading RULES (templates, weights, bands, bonus
 * tiers) are super-admin only — enforced inside the controller so the check
 * lives next to the thing it protects.
 */
const express = require('express');
const router = express.Router();
const perf = require('../controllers/performanceController');
const authenticate = require('../middleware/auth');

router.use(authenticate);

// Company-wide rules
router.get('/settings', perf.getSettings);
router.put('/settings', perf.updateSettings);            // super_admin only (in controller)

// Evaluation forms
router.get('/templates', perf.listTemplates);
router.post('/templates', perf.createTemplate);          // super_admin only
router.get('/templates/:id', perf.getTemplate);
router.put('/templates/:id', perf.updateTemplate);       // super_admin only
router.delete('/templates/:id', perf.deleteTemplate);    // super_admin only

// The manager's board + the company roll-up.
// Declared before /evaluations/:id so the literal paths aren't swallowed.
router.get('/team', perf.getTeam);
router.get('/overview', perf.getOverview);

router.get('/evaluations', perf.listEvaluations);
router.post('/evaluations', perf.saveEvaluation);        // upsert (employee × period × template)
router.get('/evaluations/form/:employeeId', perf.getEvaluationForm);
router.get('/evaluations/:id', perf.getEvaluation);
router.delete('/evaluations/:id', perf.deleteEvaluation);

module.exports = router;
