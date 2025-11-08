// import express from 'express';
// import { protect, restrictTo } from '../middleware/auth.js';
// import { 
//   getAllUsers, 
//   createUser, 
//   updateUser, 
//   deleteUser 
// } from '../controllers/userController.js';

// const router = express.Router();

// // All routes require admin privileges
// router.use(protect);
// router.use(restrictTo('admin'));

// router.get('/', getAllUsers);
// router.post('/', createUser);
// router.patch('/:id', updateUser); // ✅ استخدام PATCH بدل PUT
// router.delete('/:id', deleteUser);

// export default router;

import express from 'express';
import { protect, restrictTo } from '../middleware/auth.js';
import { 
  getAllUsers, 
  createUser, 
  updateUser, 
  deleteUser,
  updateUserBookingPermissions  // إضافة الدالة الجديدة
} from '../controllers/userController.js';

const router = express.Router();

// All routes require admin privileges
router.use(protect);
router.use(restrictTo('admin'));

router.get('/', getAllUsers);
router.post('/', createUser);
router.patch('/:id', updateUser);
router.patch('/:id/permissions', updateUserBookingPermissions); // Route جديد للصلاحيات
router.delete('/:id', deleteUser);

export default router;