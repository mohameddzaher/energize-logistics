const express = require('express');
const router = express.Router();
const remote = require('../controllers/remoteController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// Everything in the Remote section requires auth + a remote-related role.
router.use(authenticate);
router.use(authorize('super_admin', 'admin', 'remote_manager', 'remote_employee'));

// Attendance
router.post('/attendance/toggle', remote.toggleAttendance);
router.get('/attendance/today', remote.getTodayAttendance);
router.get('/attendance', remote.listAttendance);

// Dashboard
router.get('/dashboard', remote.getDashboard);

// Leave
router.post('/leave', remote.createLeave);
router.get('/leave', remote.listLeaves);
router.patch('/leave/:id', remote.reviewLeave);

// Chat
router.get('/chat/threads', remote.listThreads);
router.get('/chat/:employeeId', remote.getMessages);
router.post('/chat/:employeeId', remote.sendMessage);
// Employee's own thread (no id needed)
router.get('/chat', remote.getMessages);
router.post('/chat', remote.sendMessage);

// Tasks
router.get('/tasks', remote.listTasks);
router.post('/tasks', remote.createTask);
router.patch('/tasks/:id', remote.updateTask);
router.delete('/tasks/:id', remote.deleteTask);

// Daily reports
router.get('/reports', remote.listReports);
router.get('/reports/today', remote.getTodayReport);
router.post('/reports', remote.submitReport);

// Announcements
router.get('/announcements', remote.listAnnouncements);
router.post('/announcements', remote.createAnnouncement);
router.delete('/announcements/:id', remote.deleteAnnouncement);

// Team directory
router.get('/employees', remote.listEmployees);

module.exports = router;
