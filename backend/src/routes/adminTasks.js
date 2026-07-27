/**
 * /api/admin-tasks — قسم الشؤون الإدارية (السكرتارية): the Trello-style board.
 * The whole section team works every card (create, move, comment) — the board
 * is shared office work, not per-person silos. Deleting is the only action
 * kept away from the secretaries themselves.
 */
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminTaskController');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'administrator', 'bd_manager', 'it_manager', 'it_specialist'];
const DELETE_ROLES = ['super_admin', 'admin', 'bd_manager', 'it_manager'];

// authenticate + sectionGate('Administration') are mounted in server.js.
router.get('/', ctrl.listTasks);
router.get('/assignees', ctrl.listAssignees);
router.post('/', authorize(...EDIT_ROLES), ctrl.createTask);
router.patch('/:id', authorize(...EDIT_ROLES), ctrl.updateTask);
router.post('/:id/comments', authorize(...EDIT_ROLES), ctrl.addComment);
router.delete('/:id', authorize(...DELETE_ROLES), ctrl.deleteTask);

module.exports = router;
