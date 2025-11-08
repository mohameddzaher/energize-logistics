// import User from '../models/User.js';
// import bcrypt from 'bcryptjs';

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

// // Create new user (admin only)
// export const createUser = async (req, res) => {
//   try {
//     const { username, password, fullName, role } = req.body;

//     // Check if user already exists
//     const existingUser = await User.findOne({ username });
//     if (existingUser) {
//       return res.status(400).json({
//         status: 'fail',
//         message: 'User with this username already exists'
//       });
//     }

//     // Create new user
//     const newUser = await User.create({
//       username,
//       password,
//       fullName,
//       role: role || 'user'
//     });

//     // Return user without password
//     const userResponse = await User.findById(newUser._id).select('-password');

//     res.status(201).json({
//       status: 'success',
//       data: {
//         user: userResponse
//       }
//     });
//   } catch (err) {
//     res.status(500).json({
//       status: 'error',
//       message: err.message
//     });
//   }
// };

// // Update user (admin only)
// export const updateUser = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { username, fullName, role, password } = req.body;

//     const updateData = { username, fullName, role };
    
//     // If password is provided, hash it
//     if (password) {
//       updateData.password = await bcrypt.hash(password, 12);
//     }

//     const user = await User.findByIdAndUpdate(
//       id,
//       updateData,
//       { new: true, runValidators: true }
//     ).select('-password');

//     if (!user) {
//       return res.status(404).json({
//         status: 'fail',
//         message: 'User not found'
//       });
//     }

//     res.status(200).json({
//       status: 'success',
//       data: {
//         user
//       }
//     });
//   } catch (err) {
//     res.status(500).json({
//       status: 'error',
//       message: err.message
//     });
//   }
// };

// // Delete user (admin only)
// export const deleteUser = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const user = await User.findByIdAndDelete(id);

//     if (!user) {
//       return res.status(404).json({
//         status: 'fail',
//         message: 'User not found'
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

import User from '../models/User.js';
import bcrypt from 'bcryptjs';

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

// Create new user (admin only)
export const createUser = async (req, res) => {
  try {
    const { username, password, fullName, role, bookingPermissions } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({
        status: 'fail',
        message: 'User with this username already exists'
      });
    }

    // Create new user
    const newUser = await User.create({
      username,
      password,
      fullName,
      role: role || 'user',
      bookingPermissions: bookingPermissions || {
        smallRoom: true,
        largeRoom: false
      }
    });

    // Return user without password
    const userResponse = await User.findById(newUser._id).select('-password');

    res.status(201).json({
      status: 'success',
      data: {
        user: userResponse
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Update user (admin only) - التعديل الرئيسي هنا
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, fullName, role, password, bookingPermissions } = req.body;

    const updateData = { 
      username, 
      fullName, 
      role,
      ...(bookingPermissions && { bookingPermissions })
    };
    
    // If password is provided, hash it
    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

// Delete user (admin only)
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found'
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

// دالة جديدة لتحديث صلاحيات الحجز للمستخدم
export const updateUserBookingPermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { smallRoom, largeRoom } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      {
        bookingPermissions: {
          smallRoom: smallRoom !== undefined ? smallRoom : true,
          largeRoom: largeRoom !== undefined ? largeRoom : false
        }
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};