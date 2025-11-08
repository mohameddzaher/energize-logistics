// import express from 'express';
// import { 
//   getAllBookings, 
//   createBooking, 
//   getAvailableSlots 
// } from '../controllers/bookingController.js';
// import { protect } from '../middleware/auth.js';

// const router = express.Router();

// router.use(protect); // All booking routes require authentication

// router.get('/', getAllBookings);
// router.post('/', createBooking);
// router.get('/available', getAvailableSlots);

// export default router;

import express from 'express';
import { 
  getAllBookings, 
  createBooking, 
  getAvailableSlots,
  getAvailableRoomTypes  // إضافة الدالة الجديدة
} from '../controllers/bookingController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect); // All booking routes require authentication

router.get('/', getAllBookings);
router.post('/', createBooking);
router.get('/available', getAvailableSlots);
router.get('/available-rooms', getAvailableRoomTypes); // Route جديد

export default router;