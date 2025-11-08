// import Booking from '../models/Booking.js';
// import User from '../models/User.js';

// // Get all bookings (admin can see all)
// export const getAllBookingsAdmin = async (req, res) => {
//   try {
//     const bookings = await Booking.find()
//       .populate('user', 'username fullName role')
//       .sort({ startTime: -1 });

//     res.status(200).json({
//       status: 'success',
//       results: bookings.length,
//       data: {
//         bookings
//       }
//     });
//   } catch (err) {
//     res.status(500).json({
//       status: 'error',
//       message: err.message
//     });
//   }
// };

// // Update booking (admin can edit any booking)
// export const updateBooking = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { startTime, endTime, numberOfAttendees, contactPerson, status } = req.body;

//     // Check for overlapping bookings (excluding the current booking)
//     if (startTime && endTime) {
//       const overlappingBooking = await Booking.findOne({
//         _id: { $ne: id },
//         $or: [
//           {
//             startTime: { $lt: new Date(endTime) },
//             endTime: { $gt: new Date(startTime) }
//           }
//         ],
//         status: 'confirmed'
//       });

//       if (overlappingBooking) {
//         return res.status(400).json({
//           status: 'fail',
//           message: 'This time slot is already booked by another user'
//         });
//       }
//     }

//     const booking = await Booking.findByIdAndUpdate(
//       id,
//       {
//         ...(startTime && { startTime: new Date(startTime) }),
//         ...(endTime && { endTime: new Date(endTime) }),
//         ...(numberOfAttendees && { numberOfAttendees }),
//         ...(contactPerson && { contactPerson }),
//         ...(status && { status })
//       },
//       { new: true, runValidators: true }
//     ).populate('user', 'username fullName role');

//     if (!booking) {
//       return res.status(404).json({
//         status: 'fail',
//         message: 'Booking not found'
//       });
//     }

//     res.status(200).json({
//       status: 'success',
//       data: {
//         booking
//       }
//     });
//   } catch (err) {
//     res.status(500).json({
//       status: 'error',
//       message: err.message
//     });
//   }
// };

// // Delete booking (admin can delete any booking)
// export const deleteBooking = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const booking = await Booking.findByIdAndDelete(id);

//     if (!booking) {
//       return res.status(404).json({
//         status: 'fail',
//         message: 'Booking not found'
//       });
//     }

//     res.status(204).json({
//       status: 'success',
//       data: null
//     });
//   } catch (err) {
//     res.status(500).json({
//       status: 'error',
//       message: err.message
//     });
//   }
// };

// // Get all users (admin only)
// export const getAllUsers = async (req, res) => {
//   try {
//     const users = await User.find().select('-password');

//     res.status(200).json({
//       status: 'success',
//       results: users.length,
//       data: {
//         users
//       }
//     });
//   } catch (err) {
//     res.status(500).json({
//       status: 'error',
//       message: err.message
//     });
//   }
// };

import Booking from '../models/Booking.js';
import User from '../models/User.js';

// Get all bookings (admin can see all)
export const getAllBookingsAdmin = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('user', 'username fullName role')
      .sort({ startTime: -1 });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: {
        bookings
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Update booking (admin can edit any booking)
export const updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { startTime, endTime, numberOfAttendees, contactPerson, status, roomType } = req.body;

    // Check for overlapping bookings (excluding the current booking)
    if (startTime && endTime && roomType) {
      const overlappingBooking = await Booking.findOne({
        _id: { $ne: id },
        roomType: roomType,
        $or: [
          {
            startTime: { $lt: new Date(endTime) },
            endTime: { $gt: new Date(startTime) }
          }
        ],
        status: 'confirmed'
      });

      if (overlappingBooking) {
        return res.status(400).json({
          status: 'fail',
          message: `This time slot is already booked in the ${roomType === 'small' ? 'small room' : 'large room'}`
        });
      }
    }

    const booking = await Booking.findByIdAndUpdate(
      id,
      {
        ...(startTime && { startTime: new Date(startTime) }),
        ...(endTime && { endTime: new Date(endTime) }),
        ...(numberOfAttendees && { numberOfAttendees }),
        ...(contactPerson && { contactPerson }),
        ...(status && { status }),
        ...(roomType && { roomType })
      },
      { new: true, runValidators: true }
    ).populate('user', 'username fullName role');

    if (!booking) {
      return res.status(404).json({
        status: 'fail',
        message: 'Booking not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        booking
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Delete booking (admin can delete any booking)
export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findByIdAndDelete(id);

    if (!booking) {
      return res.status(404).json({
        status: 'fail',
        message: 'Booking not found'
      });
    }

    res.status(204).json({
      status: 'success',
      data: null
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Get all users (admin only)
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');

    res.status(200).json({
      status: 'success',
      results: users.length,
      data: {
        users
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};