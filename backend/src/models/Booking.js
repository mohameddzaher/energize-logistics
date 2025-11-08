// import mongoose from 'mongoose';

// const bookingSchema = new mongoose.Schema({
//   user: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   startTime: {
//     type: Date,
//     required: true
//   },
//   endTime: {
//     type: Date,
//     required: true
//   },
//   numberOfAttendees: {
//     type: Number,
//     required: true
//   },
//   contactPerson: {
//     name: { type: String, required: true },
//     phone: { type: String, required: true },
//     company: { type: String, required: true }
//   },
//   status: {
//     type: String,
//     enum: ['confirmed', 'cancelled'],
//     default: 'confirmed'
//   }
// }, {
//   timestamps: true
// });

// export default mongoose.model('Booking', bookingSchema);

import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  numberOfAttendees: {
    type: Number,
    required: true
  },
  contactPerson: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    company: { type: String, required: true }
  },
  status: {
    type: String,
    enum: ['confirmed', 'cancelled'],
    default: 'confirmed'
  },
  // إضافة نوع الغرفة
  roomType: {
    type: String,
    enum: ['small', 'large'],
    required: true
  },
  // إضافة اسم الغرفة بشكل تلقائي
  roomName: {
    type: String
  }
}, {
  timestamps: true
});

// middleware لتحديد اسم الغرفة تلقائياً
bookingSchema.pre('save', function(next) {
  if (this.roomType === 'small') {
    this.roomName = 'Small Room';
  } else if (this.roomType === 'large') {
    this.roomName = 'Big Room';
  }
  next();
});

export default mongoose.model('Booking', bookingSchema);