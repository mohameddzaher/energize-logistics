// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
// }

// export default function ScheduleGrid({ bookings }: ScheduleGridProps) {
//   const hours = Array.from({ length: 12 }, (_, i) => i + 8); // 8 AM to 7 PM

//   const getBookingsForHour = (hour: number) => {
//     return bookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-white rounded-lg shadow-md overflow-hidden">
//       <div className="grid grid-cols-[120px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-200 bg-gray-50">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-24 border-b border-gray-200 flex items-center justify-center text-sm font-medium text-gray-700"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div>
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-24 border-b border-gray-200 p-2">
//                 {hourBookings.map(booking => (
//                   <BookingCard key={booking._id} booking={booking} />
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-400 text-sm">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }
 

// ---------


// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
// }

// export default function ScheduleGrid({ bookings }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   const getBookingsForHour = (hour: number) => {
//     return bookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-white rounded-lg shadow-md overflow-hidden">
//       <div className="grid grid-cols-[80px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-200 bg-gray-50">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-16 border-b border-gray-200 flex items-center justify-center text-xs font-medium text-gray-700 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div>
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-16 border-b border-gray-200 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={booking._id} className="mb-1 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-300 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// --------


// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
// }

// export default function ScheduleGrid({ bookings }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   const getBookingsForHour = (hour: number) => {
//     return bookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={booking._id} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }


// ---------

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // Filter bookings for the selected date
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime).toDateString();
//     const selectedDateStr = selectedDate.toDateString();
//     return bookingDate === selectedDateStr;
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={booking._id} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // Filter bookings for the selected date
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime).toDateString();
//     const selectedDateStr = selectedDate.toDateString();
//     return bookingDate === selectedDateStr;
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={booking._id} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// --------

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // Filter bookings for the selected date
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime).toDateString();
//     const selectedDateStr = selectedDate.toDateString();
//     return bookingDate === selectedDateStr;
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={booking._id} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// ------

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // Filter bookings for the selected date
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime).toDateString();
//     const selectedDateStr = selectedDate.toDateString();
//     return bookingDate === selectedDateStr;
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const startMinutes = new Date(booking.startTime).getMinutes();
//       const endHour = new Date(booking.endTime).getHours();
      
//       // الحجز يظهر في الساعة إذا بدأ فيها أو إذا استمر خلالها
//       return (hour === startHour) || 
//              (hour > startHour && hour < endHour) ||
//              (hour === endHour && startHour !== endHour);
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1 relative">
//                 {hourBookings.map(booking => {
//                   const startTime = new Date(booking.startTime);
//                   const endTime = new Date(booking.endTime);
//                   const startHour = startTime.getHours();
//                   const startMinutes = startTime.getMinutes();
//                   const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60); // duration in hours
                  
//                   // إذا بدأ الحجز في هذه الساعة بالضبط
//                   const startsThisHour = startHour === hour;
                  
//                   return (
//                     <div 
//                       key={booking._id} 
//                       className={`mb-0.5 last:mb-0 ${startsThisHour ? '' : 'opacity-90'}`}
//                     >
//                       <BookingCard booking={booking} compact={true} />
//                     </div>
//                   );
//                 })}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }



// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // ✅ دالة مقارنة التاريخ بدون تأثر بالـ timezone
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

//   // ✅ فلترة الحجوزات بناءً على اليوم فقط
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime);
//     return isSameDay(bookingDate, selectedDate);
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startHour = new Date(booking.startTime).getHours();
//       const endHour = new Date(booking.endTime).getHours();
//       return hour >= startHour && hour < endHour;
//     });
//   };

// //   const formatHour = (hour: number) => {
// //     const period = hour >= 12 ? 'PM' : 'AM';
// //     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
// //     return ${displayHour} ${period};
// //   };

// const formatHour = (hour: number) => {
//   const period = hour >= 12 ? 'PM' : 'AM';
//   const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//   return `${displayHour} ${period}`;
// };


//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={booking._id} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // ✅ دالة مقارنة التاريخ بدون تأثر بالـ timezone
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

//   // ✅ فلترة الحجوزات بناءً على اليوم فقط
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime);
//     return isSameDay(bookingDate, selectedDate);
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startTime = new Date(booking.startTime);
//       const endTime = new Date(booking.endTime);
      
//       const startHour = startTime.getHours();
//       const startMinutes = startTime.getMinutes();
//       const endHour = endTime.getHours();
//       const endMinutes = endTime.getMinutes();

//       // إذا بدأ الحجز في هذه الساعة بالضبط
//       if (hour === startHour) {
//         return true;
//       }
      
//       // إذا استمر الحجز خلال هذه الساعة
//       if (hour > startHour && hour < endHour) {
//         return true;
//       }
      
//       // إذا انتهى الحجز في هذه الساعة (ولكن بدأ في ساعة سابقة)
//       if (hour === endHour && endMinutes > 0 && startHour !== endHour) {
//         return true;
//       }

//       return false;
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   // دالة لمعرفة إذا كان الحجز يبدأ في هذه الساعة بالضبط
//   const doesBookingStartInHour = (booking: Booking, hour: number) => {
//     const startTime = new Date(booking.startTime);
//     return startTime.getHours() === hour;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
            
//             // فلترة الحجوزات التي تبدأ في هذه الساعة فقط لعرضها
//             const bookingsStartingThisHour = hourBookings.filter(booking => 
//               doesBookingStartInHour(booking, hour)
//             );

//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {bookingsStartingThisHour.map(booking => (
//                   <div key={booking._id} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {bookingsStartingThisHour.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// ----------------

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function ScheduleGrid({ bookings, selectedDate }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // ✅ دالة مقارنة التاريخ بدون تأثر بالـ timezone
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

//   // ✅ فلترة الحجوزات بناءً على اليوم فقط
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime);
//     return isSameDay(bookingDate, selectedDate);
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startTime = new Date(booking.startTime);
//       const endTime = new Date(booking.endTime);
      
//       const startHour = startTime.getHours();
//       const endHour = endTime.getHours();
//       const endMinutes = endTime.getMinutes();

//       // إذا بدأ الحجز في هذه الساعة أو استمر خلالها
//       return (hour >= startHour && hour < endHour) || 
//              (hour === endHour && endMinutes > 0);
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <h3 className="text-lg font-semibold text-[#f37121]">
//           Schedule for {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </h3>
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
            
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={`${booking._id}-${hour}`} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }

// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
//   selectedRoomType: 'small' | 'large' | 'both';
//   onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
//   showRoomButtons?: boolean;
// }

// export default function ScheduleGrid({ 
//   bookings, 
//   selectedDate, 
//   selectedRoomType = 'both',
//   onRoomTypeChange,
//   showRoomButtons = false 
// }: ScheduleGridProps) {
//   const hours = Array.from({ length: 24 }, (_, i) => i); // 0 to 23 (24 hours)

//   // ✅ دالة مقارنة التاريخ بدون تأثر بالـ timezone
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

//   // ✅ فلترة الحجوزات بناءً على اليوم ونوع الغرفة
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime);
//     const sameDay = isSameDay(bookingDate, selectedDate);
    
//     if (selectedRoomType === 'both') {
//       return sameDay;
//     } else {
//       return sameDay && booking.roomType === selectedRoomType;
//     }
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startTime = new Date(booking.startTime);
//       const endTime = new Date(booking.endTime);
      
//       const startHour = startTime.getHours();
//       const endHour = endTime.getHours();
//       const endMinutes = endTime.getMinutes();

//       // إذا بدأ الحجز في هذه الساعة أو استمر خلالها
//       return (hour >= startHour && hour < endHour) || 
//              (hour === endHour && endMinutes > 0);
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   const getGridTitle = () => {
//     if (selectedRoomType === 'small') {
//       return 'Small Room Schedule';
//     } else if (selectedRoomType === 'large') {
//       return 'Large Room Schedule';
//     } else {
//       return 'Meeting Rooms Schedule';
//     }
//   };

//   const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
//     if (onRoomTypeChange) {
//       onRoomTypeChange(roomType);
//     }
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Header مع أزرار الغرف */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
//           <div className="flex items-center gap-4">
//             <h3 className="text-lg font-semibold text-[#f37121]">
//               {getGridTitle()}
//             </h3>
            
//             {/* Room Type Badge */}
//             {selectedRoomType !== 'both' && (
//               <div className={`px-3 py-1 rounded-full text-sm font-medium ${
//                 selectedRoomType === 'small' 
//                   ? 'bg-green-900/50 text-green-300 border border-green-700/50'
//                   : 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
//               }`}>
//                 {selectedRoomType === 'small' ? 'Small Room' : 'Large Room'}
//               </div>
//             )}
//           </div>
          
//           {/* Room Selection Buttons */}
//           {showRoomButtons && onRoomTypeChange && (
//             <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
//               <button
//                 onClick={() => handleRoomTypeChange('both')}
//                 className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
//                   selectedRoomType === 'both'
//                     ? 'bg-[#f37121] text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Both Rooms
//               </button>
//               <button
//                 onClick={() => handleRoomTypeChange('small')}
//                 className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
//                   selectedRoomType === 'small'
//                     ? 'bg-green-500 text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Small Room
//               </button>
//               <button
//                 onClick={() => handleRoomTypeChange('large')}
//                 className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
//                   selectedRoomType === 'large'
//                     ? 'bg-blue-500 text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Large Room
//               </button>
//             </div>
//           )}
//         </div>
        
//         {/* التاريخ */}
//         <p className="text-gray-400 text-sm mt-2">
//           {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </p>

//         {/* Room Info */}
//         {showRoomButtons && (
//           <div className="flex flex-wrap gap-4 text-xs mt-3">
//             {selectedRoomType === 'both' && (
//               <>
//                 <div className="flex items-center gap-2">
//                   <div className="w-3 h-3 bg-green-500 rounded"></div>
//                   <span className="text-gray-300">Small Room (up to 10 people)</span>
//                 </div>
//                 <div className="flex items-center gap-2">
//                   <div className="w-3 h-3 bg-blue-500 rounded"></div>
//                   <span className="text-gray-300">Large Room (up to 30 people)</span>
//                 </div>
//               </>
//             )}
//             {selectedRoomType === 'small' && (
//               <div className="flex items-center gap-2">
//                 <div className="w-3 h-3 bg-green-500 rounded"></div>
//                 <span className="text-gray-300">Small Room - Up to 10 people</span>
//               </div>
//             )}
//             {selectedRoomType === 'large' && (
//               <div className="flex items-center gap-2">
//                 <div className="w-3 h-3 bg-blue-500 rounded"></div>
//                 <span className="text-gray-300">Large Room - Up to 30 people</span>
//               </div>
//             )}
//           </div>
//         )}
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
            
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={`${booking._id}-${hour}`} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>

//       {/* Legend */}
//       {showRoomButtons && (
//         <div className="bg-gray-900 px-6 py-3 border-t border-gray-700">
//           <div className="flex flex-wrap items-center gap-4 text-xs">
//             <span className="text-gray-300 font-medium">Legend:</span>
//             <div className="flex items-center gap-2">
//               <div className="w-3 h-3 bg-green-500/20 border border-green-500 rounded"></div>
//               <span className="text-gray-300">Available</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <div className="w-3 h-3 bg-green-500/80 border border-green-400 rounded"></div>
//               <span className="text-gray-300">Small Room Booked</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <div className="w-3 h-3 bg-blue-500/80 border border-blue-400 rounded"></div>
//               <span className="text-gray-300">Large Room Booked</span>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }
// import { Booking } from '../types';
// import BookingCard from './BookingCard';

// interface ScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
//   selectedRoomType: 'small' | 'large' | 'both';
//   onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
//   showRoomButtons?: boolean;
// }

// export default function ScheduleGrid({ 
//   bookings, 
//   selectedDate, 
//   selectedRoomType = 'both',
//   onRoomTypeChange,
//   showRoomButtons = false 
// }: ScheduleGridProps) {
//   // من 7 صباحاً إلى 9 مساءً (15 ساعة)
//   const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7 to 21 (7 AM to 9 PM)

//   // ✅ دالة مقارنة التاريخ بدون تأثر بالـ timezone
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

//   // ✅ فلترة الحجوزات بناءً على اليوم ونوع الغرفة
//   const filteredBookings = bookings.filter(booking => {
//     const bookingDate = new Date(booking.startTime);
//     const sameDay = isSameDay(bookingDate, selectedDate);
    
//     if (selectedRoomType === 'both') {
//       return sameDay;
//     } else {
//       return sameDay && booking.roomType === selectedRoomType;
//     }
//   });

//   const getBookingsForHour = (hour: number) => {
//     return filteredBookings.filter(booking => {
//       const startTime = new Date(booking.startTime);
//       const endTime = new Date(booking.endTime);
      
//       const startHour = startTime.getHours();
//       const endHour = endTime.getHours();
//       const endMinutes = endTime.getMinutes();

//       // إذا بدأ الحجز في هذه الساعة أو استمر خلالها
//       return (hour >= startHour && hour < endHour) || 
//              (hour === endHour && endMinutes > 0);
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   const getGridTitle = () => {
//     if (selectedRoomType === 'small') {
//       return 'Small Room Schedule';
//     } else if (selectedRoomType === 'large') {
//       return 'Large Room Schedule';
//     } else {
//       return 'Meeting Rooms Schedule';
//     }
//   };

//   const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
//     if (onRoomTypeChange) {
//       onRoomTypeChange(roomType);
//     }
//   };

//   return (
//     <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
//       {/* Header مع أزرار الغرف */}
//       <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
//         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
//           <div className="flex items-center gap-4">
//             <h3 className="text-lg font-semibold text-[#f37121]">
//               {getGridTitle()}
//             </h3>
            
//             {/* Room Type Badge */}
//             {selectedRoomType !== 'both' && (
//               <div className={`px-3 py-1 rounded-full text-sm font-medium ${
//                 selectedRoomType === 'small' 
//                   ? 'bg-green-900/50 text-green-300 border border-green-700/50'
//                   : 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
//               }`}>
//                 {selectedRoomType === 'small' ? 'Small Room' : 'Large Room'}
//               </div>
//             )}
//           </div>
          
//           {/* Room Selection Buttons */}
//           {showRoomButtons && onRoomTypeChange && (
//             <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
//               <button
//                 onClick={() => handleRoomTypeChange('both')}
//                 className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
//                   selectedRoomType === 'both'
//                     ? 'bg-[#f37121] text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Both Rooms
//               </button>
//               <button
//                 onClick={() => handleRoomTypeChange('small')}
//                 className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
//                   selectedRoomType === 'small'
//                     ? 'bg-green-500 text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Small Room
//               </button>
//               <button
//                 onClick={() => handleRoomTypeChange('large')}
//                 className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
//                   selectedRoomType === 'large'
//                     ? 'bg-blue-500 text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Large Room
//               </button>
//             </div>
//           )}
//         </div>
        
//         {/* التاريخ */}
//         <p className="text-gray-400 text-sm mt-2">
//           {selectedDate.toLocaleDateString('en-US', { 
//             weekday: 'long', 
//             year: 'numeric', 
//             month: 'long', 
//             day: 'numeric' 
//           })}
//         </p>

//         {/* Room Info */}
//         {showRoomButtons && (
//           <div className="flex flex-wrap gap-4 text-xs mt-3">
//             {selectedRoomType === 'both' && (
//               <>
//                 <div className="flex items-center gap-2">
//                   <div className="w-3 h-3 bg-green-500 rounded"></div>
//                   <span className="text-gray-300">Small Room (up to 10 people)</span>
//                 </div>
//                 <div className="flex items-center gap-2">
//                   <div className="w-3 h-3 bg-blue-500 rounded"></div>
//                   <span className="text-gray-300">Large Room (up to 30 people)</span>
//                 </div>
//               </>
//             )}
//             {selectedRoomType === 'small' && (
//               <div className="flex items-center gap-2">
//                 <div className="w-3 h-3 bg-green-500 rounded"></div>
//                 <span className="text-gray-300">Small Room - Up to 10 people</span>
//               </div>
//             )}
//             {selectedRoomType === 'large' && (
//               <div className="flex items-center gap-2">
//                 <div className="w-3 h-3 bg-blue-500 rounded"></div>
//                 <span className="text-gray-300">Large Room - Up to 30 people</span>
//               </div>
//             )}
//           </div>
//         )}
//       </div>

//       <div className="grid grid-cols-[70px_1fr]">
//         {/* Time labels */}
//         <div className="border-r border-gray-700 bg-gray-900">
//           {hours.map(hour => (
//             <div 
//               key={hour} 
//               className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
//             >
//               {formatHour(hour)}
//             </div>
//           ))}
//         </div>
        
//         {/* Booking slots */}
//         <div className="bg-gray-800">
//           {hours.map(hour => {
//             const hourBookings = getBookingsForHour(hour);
            
//             return (
//               <div key={hour} className="h-12 border-b border-gray-700 p-1">
//                 {hourBookings.map(booking => (
//                   <div key={`${booking._id}-${hour}`} className="mb-0.5 last:mb-0">
//                     <BookingCard booking={booking} compact={true} />
//                   </div>
//                 ))}
//                 {hourBookings.length === 0 && (
//                   <div className="h-full flex items-center justify-center text-gray-600 text-xs">
//                     Available
//                   </div>
//                 )}
//               </div>
//             );
//           })}
//         </div>
//       </div>

//       {/* Legend */}
//       {showRoomButtons && (
//         <div className="bg-gray-900 px-6 py-3 border-t border-gray-700">
//           <div className="flex flex-wrap items-center gap-4 text-xs">
//             <span className="text-gray-300 font-medium">Legend:</span>
//             <div className="flex items-center gap-2">
//               <div className="w-3 h-3 bg-green-500/20 border border-green-500 rounded"></div>
//               <span className="text-gray-300">Available</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <div className="w-3 h-3 bg-green-500/80 border border-green-400 rounded"></div>
//               <span className="text-gray-300">Small Room Booked</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <div className="w-3 h-3 bg-blue-500/80 border border-blue-400 rounded"></div>
//               <span className="text-gray-300">Large Room Booked</span>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

import { Booking } from '../types';
import BookingCard from './BookingCard';

interface ScheduleGridProps {
  bookings: Booking[];
  selectedDate: Date;
  selectedRoomType: 'small' | 'large' | 'both';
  onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
  showRoomButtons?: boolean;
}

export default function ScheduleGrid({ 
  bookings, 
  selectedDate, 
  selectedRoomType = 'both',
  onRoomTypeChange,
  showRoomButtons = false 
}: ScheduleGridProps) {
  // من 7 صباحاً إلى 10 مساءً (16 ساعة)
  const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7 to 22 (7 AM to 10 PM)

  // ✅ دالة مقارنة التاريخ بدون تأثر بالـ timezone
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  // ✅ فلترة الحجوزات بناءً على اليوم ونوع الغرفة
  const filteredBookings = bookings.filter(booking => {
    const bookingDate = new Date(booking.startTime);
    const sameDay = isSameDay(bookingDate, selectedDate);
    
    if (selectedRoomType === 'both') {
      return sameDay;
    } else {
      return sameDay && booking.roomType === selectedRoomType;
    }
  });

  const getBookingsForHour = (hour: number) => {
    return filteredBookings.filter(booking => {
      const startTime = new Date(booking.startTime);
      const endTime = new Date(booking.endTime);
      
      const startHour = startTime.getHours();
      const endHour = endTime.getHours();
      const endMinutes = endTime.getMinutes();

      // إذا بدأ الحجز في هذه الساعة أو استمر خلالها
      return (hour >= startHour && hour < endHour) || 
             (hour === endHour && endMinutes > 0);
    });
  };

  const formatHour = (hour: number) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour} ${period}`;
  };

  const getGridTitle = () => {
    if (selectedRoomType === 'small') {
      return 'Small Room Schedule';
    } else if (selectedRoomType === 'large') {
      return 'Large Room Schedule';
    } else {
      return 'Meeting Rooms Schedule';
    }
  };

  const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
    if (onRoomTypeChange) {
      onRoomTypeChange(roomType);
    }
  };

  return (
    <div className="bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700">
      {/* Header مع أزرار الغرف */}
      <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold text-[#f37121]">
              {getGridTitle()}
            </h3>
            
            {/* Room Type Badge */}
            {selectedRoomType !== 'both' && (
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                selectedRoomType === 'small' 
                  ? 'bg-green-900/50 text-green-300 border border-green-700/50'
                  : 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
              }`}>
                {selectedRoomType === 'small' ? 'Small Room' : 'Large Room'}
              </div>
            )}
          </div>
          
          {/* Room Selection Buttons */}
          {showRoomButtons && onRoomTypeChange && (
            <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
              <button
                onClick={() => handleRoomTypeChange('both')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedRoomType === 'both'
                    ? 'bg-[#f37121] text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                Both Rooms
              </button>
              <button
                onClick={() => handleRoomTypeChange('small')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedRoomType === 'small'
                    ? 'bg-green-500 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                Small Room
              </button>
              <button
                onClick={() => handleRoomTypeChange('large')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedRoomType === 'large'
                    ? 'bg-blue-500 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                Large Room
              </button>
            </div>
          )}
        </div>
        
        {/* التاريخ */}
        <p className="text-gray-400 text-sm mt-2">
          {selectedDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </p>

        {/* Room Info */}
        {showRoomButtons && (
          <div className="flex flex-wrap gap-4 text-xs mt-3">
            {selectedRoomType === 'both' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded"></div>
                  <span className="text-gray-300">Small Room (up to 10 people)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded"></div>
                  <span className="text-gray-300">Large Room (up to 30 people)</span>
                </div>
              </>
            )}
            {selectedRoomType === 'small' && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded"></div>
                <span className="text-gray-300">Small Room - Up to 10 people</span>
              </div>
            )}
            {selectedRoomType === 'large' && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded"></div>
                <span className="text-gray-300">Large Room - Up to 30 people</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[70px_1fr]">
        {/* Time labels */}
        <div className="border-r border-gray-700 bg-gray-900">
          {hours.map(hour => (
            <div 
              key={hour} 
              className="h-12 border-b border-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 px-1"
            >
              {formatHour(hour)}
            </div>
          ))}
        </div>
        
        {/* Booking slots */}
        <div className="bg-gray-800">
          {hours.map(hour => {
            const hourBookings = getBookingsForHour(hour);
            
            return (
              <div key={hour} className="h-12 border-b border-gray-700 p-1">
                {hourBookings.map(booking => (
                  <div key={`${booking._id}-${hour}`} className="mb-0.5 last:mb-0">
                    <BookingCard booking={booking} compact={true} />
                  </div>
                ))}
                {hourBookings.length === 0 && (
                  <div className="h-full flex items-center justify-center text-gray-600 text-xs">
                    Available
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      {showRoomButtons && (
        <div className="bg-gray-900 px-6 py-3 border-t border-gray-700">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-gray-300 font-medium">Legend:</span>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500/20 border border-green-500 rounded"></div>
              <span className="text-gray-300">Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500/80 border border-green-400 rounded"></div>
              <span className="text-gray-300">Small Room Booked</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500/80 border border-blue-400 rounded"></div>
              <span className="text-gray-300">Large Room Booked</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}