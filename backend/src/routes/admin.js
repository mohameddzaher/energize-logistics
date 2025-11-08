import express from 'express';
import { protect, restrictTo } from '../middleware/auth.js';
import { 
  getAllBookingsAdmin, 
  updateBooking, 
  deleteBooking, 
  getAllUsers 
} from '../controllers/adminController.js';

const router = express.Router();

// كل ال routes دي للادمن فقط
router.use(protect);
router.use(restrictTo('admin'));

router.get('/bookings', getAllBookingsAdmin);
router.patch('/bookings/:id', updateBooking);
router.delete('/bookings/:id', deleteBooking);
router.get('/users', getAllUsers);

export default router;