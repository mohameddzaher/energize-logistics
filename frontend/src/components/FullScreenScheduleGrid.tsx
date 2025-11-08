// import { useRef } from 'react';
// import { Booking } from '../types';
// import BookingCard from './BookingCard';
// import { Maximize2, Minimize2 } from 'lucide-react'; // icons من lucide-react

// interface FullScreenScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function FullScreenScheduleGrid({ bookings, selectedDate }: FullScreenScheduleGridProps) {
//   const gridRef = useRef<HTMLDivElement>(null);
//   const isFullScreen = document.fullscreenElement !== null;

//   // 🧠 دالة الدخول في وضع ملء الشاشة
//   const toggleFullScreen = async () => {
//     if (!document.fullscreenElement) {
//       await gridRef.current?.requestFullscreen();
//     } else {
//       await document.exitFullscreen();
//     }
//   };

//   const hours = Array.from({ length: 24 }, (_, i) => i);
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

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
//       return (hour >= startHour && hour < endHour) || (hour === endHour && endMinutes > 0);
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   const rows = [];
//   for (let i = 0; i < hours.length; i += 6) {
//     rows.push(hours.slice(i, i + 6));
//   }

//   return (
//     <div
//       ref={gridRef}
//       className="relative bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700 h-full flex flex-col"
//     >
//       {/* زرار التكبير */}
//       <button
//         onClick={toggleFullScreen}
//         className="absolute top-3 right-3 z-10 hover:bg-[#f37121]/80 text-white p-2 rounded-full shadow-md transition"
//         title="Toggle Fullscreen"
//       >
//         {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
//       </button>

//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-3 border-b border-gray-700 shrink-0">
//         <h3 className="text-md font-semibold text-[#f37121]">
//           Schedule for{' '}
//           {selectedDate.toLocaleDateString('en-US', {
//             weekday: 'long',
//             year: 'numeric',
//             month: 'long',
//             day: 'numeric',
//           })}
//         </h3>
//       </div>

//       {/* Grid */}
//       <div className="flex-1 min-h-0 p-3">
//         <div className="h-full grid grid-rows-4 gap-2">
//           {rows.map((rowHours, rowIndex) => (
//             <div key={rowIndex} className="grid grid-cols-6 gap-2 h-full">
//               {rowHours.map(hour => {
//                 const hourBookings = getBookingsForHour(hour);
//                 return (
//                   <div
//                     key={hour}
//                     className="bg-gray-700 rounded border border-gray-600 p-1 flex flex-col h-full"
//                   >
//                     <div className="text-center mb-1 mt-2 shrink-0">
//                       <div className="text-sm font-bold text-white">{formatHour(hour)}</div>
//                     </div>

//                     <div className="flex-1 min-h-0 overflow-y-auto mt-1">
//                       {hourBookings.map(booking => (
//                         <div key={`${booking._id}-${hour}`} className="mb-1 last:mb-0">
//                           <BookingCard
//                             booking={booking}
//                             compact={true}
//                             showTime={false}
//                             extraCompact={true}
//                           />
//                         </div>
//                       ))}
//                       {hourBookings.length === 0 && (
//                         <div className="h-full flex items-center justify-center text-gray-500 text-xs border border-gray-600 rounded px-1 py-3">
//                           Available
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// }



// import { useEffect, useRef, useState } from 'react';
// import { Booking } from '../types';
// import BookingCard from './BookingCard';
// import { Maximize2, Minimize2 } from 'lucide-react';

// interface FullScreenScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
// }

// export default function FullScreenScheduleGrid({ bookings, selectedDate }: FullScreenScheduleGridProps) {
//   const gridRef = useRef<HTMLDivElement>(null);
//   const [isFullScreen, setIsFullScreen] = useState(false);

//   useEffect(() => {
//     const handleChange = () => setIsFullScreen(!!document.fullscreenElement);
//     document.addEventListener('fullscreenchange', handleChange);
//     return () => document.removeEventListener('fullscreenchange', handleChange);
//   }, []);

//   const toggleFullScreen = async () => {
//     if (!document.fullscreenElement) {
//       await gridRef.current?.requestFullscreen();
//     } else {
//       await document.exitFullscreen();
//     }
//   };

//   const hours = Array.from({ length: 24 }, (_, i) => i);
//   const isSameDay = (d1: Date, d2: Date) =>
//     d1.getFullYear() === d2.getFullYear() &&
//     d1.getMonth() === d2.getMonth() &&
//     d1.getDate() === d2.getDate();

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
//       return (hour >= startHour && hour < endHour) || (hour === endHour && endMinutes > 0);
//     });
//   };

//   const formatHour = (hour: number) => {
//     const period = hour >= 12 ? 'PM' : 'AM';
//     const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
//     return `${displayHour} ${period}`;
//   };

//   const rows = [];
//   for (let i = 0; i < hours.length; i += 6) {
//     rows.push(hours.slice(i, i + 6));
//   }

//   return (
//     <div
//       ref={gridRef}
//       className={`relative bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700 h-full flex flex-col transition-all duration-500 ${
//         isFullScreen ? 'p-2' : ''
//       }`}
//     >
//       {/* زرار التكبير */}
//       <button
//         onClick={toggleFullScreen}
//         className="absolute top-3 right-3 z-10 hover:bg-[#f37121]/80 text-white p-2 rounded-full shadow-md transition"
//         title="Toggle Fullscreen"
//       >
//         {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
//       </button>

//       {/* Date Header */}
//       <div className="bg-gray-900 px-6 py-3 border-b border-gray-700 shrink-0">
//         <h3 className="text-md font-semibold text-[#f37121]">
//           Schedule for{' '}
//           {selectedDate.toLocaleDateString('en-US', {
//             weekday: 'long',
//             year: 'numeric',
//             month: 'long',
//             day: 'numeric',
//           })}
//         </h3>
//       </div>

//       {/* Grid */}
//       <div className="flex-1 min-h-0 p-3">
//         <div className="h-full grid grid-rows-4 gap-2">
//           {rows.map((rowHours, rowIndex) => (
//             <div key={rowIndex} className="grid grid-cols-6 gap-2 h-full">
//               {rowHours.map(hour => {
//                 const hourBookings = getBookingsForHour(hour);
//                 return (
//                   <div
//                     key={hour}
//                     className="bg-gray-700 rounded border border-gray-600 p-1 flex flex-col h-full"
//                   >
//                     <div className="text-center mb-1 pb-5 mt-4 shrink-0">
//                       <div className="text-md font-bold text-white">{formatHour(hour)}</div>
//                     </div>

//                     <div className="flex-1 min-h-0 overflow-y-auto mt-1 space-y-1">
//                       {hourBookings.map(booking => (
//                         <div
//                           key={`${booking._id}-${hour}`}
//                           className="mb-1 last:mb-0 "
//                         >
//                           <BookingCard
//                             booking={booking}
//                             compact={!isFullScreen}
//                           />
//                         </div>
//                       ))}

//                       {hourBookings.length === 0 && (
//                         <div className="h-full flex items-center justify-center text-gray-500 text-xs border border-gray-600 rounded px-1 py-3">
//                           Available
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// }
// import { useEffect, useRef, useState } from 'react';
// import { Booking } from '../types';
// import BookingCard from './BookingCard';
// import { Maximize2, Minimize2 } from 'lucide-react';

// interface FullScreenScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
//   selectedRoomType?: 'small' | 'large' | 'both';
//   onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
// }

// export default function FullScreenScheduleGrid({ 
//   bookings, 
//   selectedDate, 
//   selectedRoomType = 'both',
//   onRoomTypeChange 
// }: FullScreenScheduleGridProps) {
//   const gridRef = useRef<HTMLDivElement>(null);
//   const [isFullScreen, setIsFullScreen] = useState(false);

//   useEffect(() => {
//     const handleChange = () => setIsFullScreen(!!document.fullscreenElement);
//     document.addEventListener('fullscreenchange', handleChange);
//     return () => document.removeEventListener('fullscreenchange', handleChange);
//   }, []);

//   const toggleFullScreen = async () => {
//     if (!document.fullscreenElement) {
//       await gridRef.current?.requestFullscreen();
//     } else {
//       await document.exitFullscreen();
//     }
//   };

//   const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
//     if (onRoomTypeChange) {
//       onRoomTypeChange(roomType);
//     }
//   };

//   const hours = Array.from({ length: 24 }, (_, i) => i);
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
//       return (hour >= startHour && hour < endHour) || (hour === endHour && endMinutes > 0);
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

//   const getRoomInfoText = () => {
//     if (selectedRoomType === 'small') {
//       return 'Up to 10 people';
//     } else if (selectedRoomType === 'large') {
//       return 'Up to 30 people';
//     } else {
//       return 'Small (10) & Large (30) Rooms';
//     }
//   };

//   const rows = [];
//   for (let i = 0; i < hours.length; i += 6) {
//     rows.push(hours.slice(i, i + 6));
//   }

//   return (
//     <div
//       ref={gridRef}
//       className={`relative bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700 h-full flex flex-col transition-all duration-500 ${
//         isFullScreen ? 'p-2' : ''
//       }`}
//     >
//       {/* Header مع أزرار الغرف - تصميم مدمج */}
//       <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 shrink-0 pr-16">
//         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
//           {/* العنوان وتفاصيل الغرفة */}
//           <div className="flex items-center gap-3 flex-1 min-w-0">
//             <div className="flex-shrink-0">
//               <h3 className="text-md font-semibold text-[#f37121] leading-tight">
//                 {getGridTitle()}
//               </h3>
//               <p className="text-gray-400 text-sm leading-tight">
//                 {selectedDate.toLocaleDateString('en-US', {
//                   weekday: 'long',
//                   year: 'numeric',
//                   month: 'long',
//                   day: 'numeric',
//                 })}
//               </p>
//             </div>
            
//             {/* معلومات الغرفة في نفس السطر */}
//             <div className="hidden sm:flex items-center gap-2 ml-2 pl-2 border-l border-gray-600">
//               <div className={`w-2 h-2 rounded-full ${
//                 selectedRoomType === 'small' ? 'bg-green-500' : 
//                 selectedRoomType === 'large' ? 'bg-blue-500' : 'bg-[#f37121]'
//               }`}></div>
//               <span className="text-xs text-gray-300 whitespace-nowrap">
//                 {getRoomInfoText()}
//               </span>
//             </div>
//           </div>
          
//           {/* Room Selection Buttons */}
//           {onRoomTypeChange && (
//             <div className="flex gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700">
//               <button
//                 onClick={() => handleRoomTypeChange('both')}
//                 className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
//                   selectedRoomType === 'both'
//                     ? 'bg-[#f37121] text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Both
//               </button>
//               <button
//                 onClick={() => handleRoomTypeChange('small')}
//                 className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
//                   selectedRoomType === 'small'
//                     ? 'bg-green-500 text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Small
//               </button>
//               <button
//                 onClick={() => handleRoomTypeChange('large')}
//                 className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
//                   selectedRoomType === 'large'
//                     ? 'bg-blue-500 text-white shadow-lg'
//                     : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                 }`}
//               >
//                 Large
//               </button>
//             </div>
//           )}
//         </div>

//         {/* معلومات الغرفة للشاشات الصغيرة */}
//         <div className="sm:hidden flex items-center gap-2 mt-2">
//           <div className={`w-2 h-2 rounded-full ${
//             selectedRoomType === 'small' ? 'bg-green-500' : 
//             selectedRoomType === 'large' ? 'bg-blue-500' : 'bg-[#f37121]'
//           }`}></div>
//           <span className="text-xs text-gray-300">
//             {getRoomInfoText()}
//           </span>
//         </div>
//       </div>

//       {/* Grid */}
//       <div className="flex-1 min-h-0 p-3">
//         <div className="h-full grid grid-rows-4 gap-2">
//           {rows.map((rowHours, rowIndex) => (
//             <div key={rowIndex} className="grid grid-cols-6 gap-2 h-full">
//               {rowHours.map(hour => {
//                 const hourBookings = getBookingsForHour(hour);
//                 const hasBookings = hourBookings.length > 0;
                
//                 return (
//                   <div
//                     key={hour}
//                     className="bg-gray-700 rounded border border-gray-600 p-1 flex flex-col h-full"
//                   >
//                     {/* Time Header */}
//                     <div className="text-center mb-1 shrink-0">
//                       <div className="text-sm font-bold text-white mt-1">{formatHour(hour)}</div>
//                     </div>

//                     {/* Bookings Container */}
//                     <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
//                       {hasBookings ? (
//                         hourBookings.map(booking => (
//                           <div
//                             key={`${booking._id}-${hour}`}
//                             className="mb-1 last:mb-0"
//                           >
//                             <BookingCard
//                               booking={booking}
//                               compact={!isFullScreen}
//                             />
//                           </div>
//                         ))
//                       ) : (
//                         // Available State - تأكد من ظهوره دائماً
//                         <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs border border-gray-600 rounded px-1 py-2 min-h-[60px]">
//                           <div className="text-center">
//                             <div className="mb-1">Available</div>
//                             <div className="text-[10px] text-gray-500">
//                               {selectedRoomType === 'both' ? 'Both Rooms' : 
//                                selectedRoomType === 'small' ? 'Small Room' : 'Large Room'}
//                             </div>
//                           </div>
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>
//           ))}
//         </div>
//       </div>

//       {/* زرار التكبير */}
//       <button
//         onClick={toggleFullScreen}
//         className="absolute top-3 right-3 z-10 bg-gray-700 hover:bg-[#f37121] text-white p-2 rounded-full shadow-md transition-all duration-200 border border-gray-600"
//         title="Toggle Fullscreen"
//       >
//         {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
//       </button>

//       {/* Legend */}
//       {onRoomTypeChange && (
//         <div className="bg-gray-900 px-4 py-2 border-t border-gray-700 shrink-0">
//           <div className="flex flex-wrap items-center gap-3 text-xs">
//             <span className="text-gray-300 font-medium">Legend:</span>
//             <div className="flex items-center gap-1">
//               <div className="w-2 h-2 bg-green-500/20 border border-green-500 rounded"></div>
//               <span className="text-gray-300">Available</span>
//             </div>
//             <div className="flex items-center gap-1">
//               <div className="w-2 h-2 bg-green-500/80 border border-green-400 rounded"></div>
//               <span className="text-gray-300">Small</span>
//             </div>
//             <div className="flex items-center gap-1">
//               <div className="w-2 h-2 bg-blue-500/80 border border-blue-400 rounded"></div>
//               <span className="text-gray-300">Large</span>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }
//-------------

// import { useEffect, useRef, useState } from 'react';
// import { Booking } from '../types';
// import BookingCard from './BookingCard';
// import { Maximize2, Minimize2 } from 'lucide-react';

// interface FullScreenScheduleGridProps {
//   bookings: Booking[];
//   selectedDate: Date;
//   selectedRoomType?: 'small' | 'large' | 'both';
//   onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
// }

// export default function FullScreenScheduleGrid({ 
//   bookings, 
//   selectedDate, 
//   selectedRoomType = 'both',
//   onRoomTypeChange 
// }: FullScreenScheduleGridProps) {
//   const gridRef = useRef<HTMLDivElement>(null);
//   const [isFullScreen, setIsFullScreen] = useState(false);

//   useEffect(() => {
//     const handleChange = () => setIsFullScreen(!!document.fullscreenElement);
//     document.addEventListener('fullscreenchange', handleChange);
//     return () => document.removeEventListener('fullscreenchange', handleChange);
//   }, []);

//   const toggleFullScreen = async () => {
//     if (!document.fullscreenElement) {
//       await gridRef.current?.requestFullscreen();
//     } else {
//       await document.exitFullscreen();
//     }
//   };

//   const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
//     if (onRoomTypeChange) {
//       onRoomTypeChange(roomType);
//     }
//   };

//   // من 7 صباحاً إلى 10 مساءً (16 ساعة)
//   const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7 to 22 (7 AM to 10 PM)
  
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
//       return (hour >= startHour && hour < endHour) || (hour === endHour && endMinutes > 0);
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

//   const getRoomInfoText = () => {
//     if (selectedRoomType === 'small') {
//       return 'Up to 10 people';
//     } else if (selectedRoomType === 'large') {
//       return 'Up to 30 people';
//     } else {
//       return 'Small (10) & Large (30) Rooms';
//     }
//   };

//   // تقسيم 16 ساعة إلى 4 صفوف (4 ساعات في كل صف)
//   const rows = [];
//   for (let i = 0; i < hours.length; i += 4) {
//     rows.push(hours.slice(i, i + 4));
//   }

//   return (
//     <div
//       ref={gridRef}
//       className={`relative bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700 h-full flex flex-col transition-all duration-500 ${
//         isFullScreen ? 'p-2' : ''
//       }`}
//     >
//       {/* Header مع أزرار الغرف على الشمال */}
//       <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 shrink-0">
//         <div className="flex items-center justify-between gap-4">
//           {/* الجزء الأيسر: العنوان وأزرار الغرف */}
//           <div className="flex items-center gap-4 flex-1 min-w-0">
//             {/* العنوان */}
//             <div className="flex-shrink-0">
//               <h3 className="text-md font-semibold text-[#f37121] leading-tight">
//                 {getGridTitle()}
//               </h3>
//               <p className="text-gray-400 text-sm leading-tight">
//                 {selectedDate.toLocaleDateString('en-US', {
//                   weekday: 'long',
//                   year: 'numeric',
//                   month: 'long',
//                   day: 'numeric',
//                 })}
//               </p>
//             </div>
            
//             {/* فاصل ومعلومات الغرفة */}
//             <div className="hidden sm:flex items-center gap-2">
//               <div className="w-px h-6 bg-gray-600"></div>
//               <div className="flex items-center gap-2">
//                 <div className={`w-2 h-2 rounded-full ${
//                   selectedRoomType === 'small' ? 'bg-green-500' : 
//                   selectedRoomType === 'large' ? 'bg-blue-500' : 'bg-[#f37121]'
//                 }`}></div>
//                 <span className="text-xs text-gray-300 whitespace-nowrap">
//                   {getRoomInfoText()}
//                 </span>
//               </div>
//             </div>

//             {/* Room Selection Buttons على الشمال */}
//             {onRoomTypeChange && (
//               <div className="flex gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700 ml-2">
//                 <button
//                   onClick={() => handleRoomTypeChange('both')}
//                   className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
//                     selectedRoomType === 'both'
//                       ? 'bg-[#f37121] text-white shadow-lg'
//                       : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                   }`}
//                 >
//                   Both
//                 </button>
//                 <button
//                   onClick={() => handleRoomTypeChange('small')}
//                   className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
//                     selectedRoomType === 'small'
//                       ? 'bg-green-500 text-white shadow-lg'
//                       : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                   }`}
//                 >
//                   Small
//                 </button>
//                 <button
//                   onClick={() => handleRoomTypeChange('large')}
//                   className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
//                     selectedRoomType === 'large'
//                       ? 'bg-blue-500 text-white shadow-lg'
//                       : 'text-gray-300 hover:text-white hover:bg-gray-700'
//                   }`}
//                 >
//                   Large
//                 </button>
//               </div>
//             )}
//           </div>

//           {/* زرار التكبير على اليمين بعيد عن الأزرار */}
//           <button
//             onClick={toggleFullScreen}
//             className="flex-shrink-0 bg-gray-700 hover:bg-[#f37121] text-white p-2 rounded-lg shadow-md transition-all duration-200 border border-gray-600 flex items-center gap-2"
//             title="Toggle Fullscreen"
//           >
//             {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
//             <span className="text-xs hidden sm:inline">
//               {isFullScreen ? 'Exit' : 'Fullscreen'}
//             </span>
//           </button>
//         </div>

//         {/* معلومات الغرفة للشاشات الصغيرة */}
//         <div className="sm:hidden flex items-center gap-2 mt-2">
//           <div className={`w-2 h-2 rounded-full ${
//             selectedRoomType === 'small' ? 'bg-green-500' : 
//             selectedRoomType === 'large' ? 'bg-blue-500' : 'bg-[#f37121]'
//           }`}></div>
//           <span className="text-xs text-gray-300">
//             {getRoomInfoText()}
//           </span>
//         </div>
//       </div>

//       {/* Grid */}
//       <div className="flex-1 min-h-0 p-3">
//         <div className="h-full grid grid-rows-4 gap-2"> {/* 4 rows */}
//           {rows.map((rowHours, rowIndex) => (
//             <div key={rowIndex} className="grid grid-cols-4 gap-2 h-full"> {/* 4 columns */}
//               {rowHours.map(hour => {
//                 const hourBookings = getBookingsForHour(hour);
//                 const hasBookings = hourBookings.length > 0;
                
//                 return (
//                   <div
//                     key={hour}
//                     className="bg-gray-700 rounded border border-gray-600 p-1 flex flex-col h-full"
//                   >
//                     {/* Time Header */}
//                     <div className="text-center mb-1 shrink-0">
//                       <div className="text-sm font-bold text-white mt-1">{formatHour(hour)}</div>
//                     </div>

//                     {/* Bookings Container */}
//                     <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
//                       {hasBookings ? (
//                         hourBookings.map(booking => (
//                           <div
//                             key={`${booking._id}-${hour}`}
//                             className="mb-1 last:mb-0"
//                           >
//                             <BookingCard
//                               booking={booking}
//                               compact={!isFullScreen}
//                             />
//                           </div>
//                         ))
//                       ) : (
//                         // Available State - تأكد من ظهوره دائماً
//                         <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs border border-gray-600 rounded px-1 py-2 min-h-[60px]">
//                           <div className="text-center">
//                             <div className="mb-1">Available</div>
//                             <div className="text-[10px] text-gray-500">
//                               {selectedRoomType === 'both' ? 'Both Rooms' : 
//                                selectedRoomType === 'small' ? 'Small Room' : 'Large Room'}
//                             </div>
//                           </div>
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>
//           ))}
//         </div>
//       </div>

//       {/* Legend */}
//       {onRoomTypeChange && (
//         <div className="bg-gray-900 px-4 py-2 border-t border-gray-700 shrink-0">
//           <div className="flex flex-wrap items-center gap-3 text-xs">
//             <span className="text-gray-300 font-medium">Legend:</span>
//             <div className="flex items-center gap-1">
//               <div className="w-2 h-2 bg-green-500/20 border border-green-500 rounded"></div>
//               <span className="text-gray-300">Available</span>
//             </div>
//             <div className="flex items-center gap-1">
//               <div className="w-2 h-2 bg-green-500/80 border border-green-400 rounded"></div>
//               <span className="text-gray-300">Small</span>
//             </div>
//             <div className="flex items-center gap-1">
//               <div className="w-2 h-2 bg-blue-500/80 border border-blue-400 rounded"></div>
//               <span className="text-gray-300">Large</span>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

// ------- gooooooood

import { useEffect, useRef, useState } from 'react';
import { Booking } from '../types';
import BookingCard from './BookingCard';
import { Maximize2, Minimize2 } from 'lucide-react';

interface FullScreenScheduleGridProps {
  bookings: Booking[];
  selectedDate: Date;
  selectedRoomType?: 'small' | 'large' | 'both';
  onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
}

export default function FullScreenScheduleGrid({ 
  bookings, 
  selectedDate, 
  selectedRoomType = 'both',
  onRoomTypeChange 
}: FullScreenScheduleGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const handleChange = () => setIsFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullScreen = async () => {
    if (!document.fullscreenElement) {
      await gridRef.current?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  };

  const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
    if (onRoomTypeChange) {
      onRoomTypeChange(roomType);
    }
  };

  // من 7 صباحاً إلى 10 مساءً (16 ساعة)
  const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7 to 22 (7 AM to 10 PM)
  
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
      return (hour >= startHour && hour < endHour) || (hour === endHour && endMinutes > 0);
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

  const getRoomInfoText = () => {
    if (selectedRoomType === 'small') {
      return 'Up to 10 people';
    } else if (selectedRoomType === 'large') {
      return 'Up to 30 people';
    } else {
      return 'Small (10) & Large (30) Rooms';
    }
  };

  // تقسيم 16 ساعة إلى 4 صفوف (4 ساعات في كل صف)
  const rows = [];
  for (let i = 0; i < hours.length; i += 4) {
    rows.push(hours.slice(i, i + 4));
  }

  return (
    <div
      ref={gridRef}
      className={`relative bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-700 h-full flex flex-col transition-all duration-500 ${
        isFullScreen ? 'p-2' : ''
      }`}
    >
      {/* Header مع أزرار الغرف على الشمال */}
      <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center justify-between gap-4">
          {/* الجزء الأيسر: العنوان وأزرار الغرف */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* العنوان */}
            <div className="flex-shrink-0">
              <h3 className="text-md font-semibold text-[#f37121] leading-tight">
                {getGridTitle()}
              </h3>
              <p className="text-gray-400 text-sm leading-tight">
                {selectedDate.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            
            {/* فاصل ومعلومات الغرفة */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-px h-6 bg-gray-600"></div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  selectedRoomType === 'small' ? 'bg-green-500' : 
                  selectedRoomType === 'large' ? 'bg-blue-500' : 'bg-[#f37121]'
                }`}></div>
                <span className="text-xs text-gray-300 whitespace-nowrap">
                  {getRoomInfoText()}
                </span>
              </div>
            </div>

            {/* Room Selection Buttons على الشمال */}
            {onRoomTypeChange && (
              <div className="flex gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700 ml-2">
                <button
                  onClick={() => handleRoomTypeChange('both')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    selectedRoomType === 'both'
                      ? 'bg-[#f37121] text-white shadow-lg'
                      : 'text-gray-300 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  Both
                </button>
                <button
                  onClick={() => handleRoomTypeChange('small')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    selectedRoomType === 'small'
                      ? 'bg-green-500 text-white shadow-lg'
                      : 'text-gray-300 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  Small
                </button>
                <button
                  onClick={() => handleRoomTypeChange('large')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    selectedRoomType === 'large'
                      ? 'bg-blue-500 text-white shadow-lg'
                      : 'text-gray-300 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  Large
                </button>
              </div>
            )}
          </div>

          {/* زرار التكبير على اليمين بعيد عن الأزرار */}
          <button
            onClick={toggleFullScreen}
            className="flex-shrink-0 bg-gray-700 hover:bg-[#f37121] text-white p-2 rounded-lg shadow-md transition-all duration-200 border border-gray-600 flex items-center gap-2"
            title="Toggle Fullscreen"
          >
            {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span className="text-xs hidden sm:inline">
              {isFullScreen ? 'Exit' : 'Fullscreen'}
            </span>
          </button>
        </div>

        {/* معلومات الغرفة للشاشات الصغيرة */}
        <div className="sm:hidden flex items-center gap-2 mt-2">
          <div className={`w-2 h-2 rounded-full ${
            selectedRoomType === 'small' ? 'bg-green-500' : 
            selectedRoomType === 'large' ? 'bg-blue-500' : 'bg-[#f37121]'
          }`}></div>
          <span className="text-xs text-gray-300">
            {getRoomInfoText()}
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 p-3">
        <div className="h-full grid grid-rows-4 gap-2"> {/* 4 rows */}
          {rows.map((rowHours, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-4 gap-2 h-full"> {/* 4 columns */}
              {rowHours.map(hour => {
                const hourBookings = getBookingsForHour(hour);
                const hasBookings = hourBookings.length > 0;
                
                return (
                  <div
                    key={hour}
                    className="bg-gray-700 rounded border border-gray-600 p-1 flex flex-col h-full relative"
                  >
                    {/* Time Header */}
                    <div className="text-center mb-1 shrink-0 z-10">
                      <div className="text-sm font-bold text-white mt-1 bg-gray-700 px-2 py-1 rounded">
                        {formatHour(hour)}
                      </div>
                    </div>

                    {/* Bookings Container */}
                    <div className="flex-1 min-h-0 overflow-y-auto space-y-1 relative">
                      {hasBookings ? (
                        <div className="space-y-1">
                          {hourBookings.map(booking => (
                            <div
                              key={`${booking._id}-${hour}`}
                              className="transform  transition-transform duration-200"
                            >
                              <BookingCard
                                booking={booking}
                                compact={true}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        // Available State - تأكد من ظهوره دائماً
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs border-2 border-dashed border-gray-600 rounded px-1 py-4 min-h-[80px] bg-gray-600/20">
                          <div className="text-center">
                            <div className="mb-1 font-medium">Available</div>
                            <div className="text-[10px] text-gray-500">
                              {selectedRoomType === 'both' ? 'Both Rooms' : 
                               selectedRoomType === 'small' ? 'Small Room' : 'Large Room'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hour Separator */}
                    {hour < 22 && (
                      <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-600"></div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      {onRoomTypeChange && (
        <div className="bg-gray-900 px-4 py-2 border-t border-gray-700 shrink-0">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-gray-300 font-medium">Legend:</span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500/20 border border-green-500 rounded"></div>
              <span className="text-gray-300">Available</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500/80 border border-green-400 rounded"></div>
              <span className="text-gray-300">Small</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500/80 border border-blue-400 rounded"></div>
              <span className="text-gray-300">Large</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}