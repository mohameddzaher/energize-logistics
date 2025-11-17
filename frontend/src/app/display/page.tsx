// // app/display/page.tsx
// "use client";

// import { useState, useEffect } from 'react';
// import Link from 'next/link';
// import { Booking } from '../../types';
// import { bookingsAPI } from '../../utils/api';
// import FullScreenScheduleGrid from '../../components/FullScreenScheduleGrid';
// import { Calendar, Clock, LogIn, Monitor, RefreshCw } from 'lucide-react';

// export default function MeetingRoomDisplay() {
//   const [bookings, setBookings] = useState<Booking[]>([]);
//   const [selectedDate, setSelectedDate] = useState<Date>(new Date());
//   const [selectedRoomType, setSelectedRoomType] = useState<'small' | 'large' | 'both'>('both');
//   const [loading, setLoading] = useState(true);
//   const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

//   useEffect(() => {
//     loadBookings();
    
//     // تحديث البيانات كل 30 ثانية
//     const interval = setInterval(() => {
//       loadBookings();
//     }, 30000);

//     return () => clearInterval(interval);
//   }, []);

//   const loadBookings = async () => {
//     try {
//       const result = await bookingsAPI.getAll();
//       if (result.status === 'success') {
//         setBookings(result.data.bookings);
//         setLastUpdate(new Date());
//       }
//     } catch (error) {
//       console.error('Error fetching bookings:', error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleRefresh = () => {
//     setLoading(true);
//     loadBookings();
//   };

//   const formatDateForInput = (date: Date) => {
//     return date.toISOString().split('T')[0];
//   };

//   const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
//     setSelectedDate(new Date(e.target.value));
//   };

//   const goToPreviousDay = () => {
//     const newDate = new Date(selectedDate);
//     newDate.setDate(newDate.getDate() - 1);
//     setSelectedDate(newDate);
//   };

//   const goToNextDay = () => {
//     const newDate = new Date(selectedDate);
//     newDate.setDate(newDate.getDate() + 1);
//     setSelectedDate(newDate);
//   };

//   const goToToday = () => {
//     setSelectedDate(new Date());
//   };

//   if (loading) {
//     return (
//       <div className="min-h-screen bg-gray-900 flex items-center justify-center">
//         <div className="text-center">
//           <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f37121] mx-auto mb-4"></div>
//           <p className="text-gray-400">Loading Meeting Room Schedule...</p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-gray-900 text-white flex flex-col">
//       {/* Header Compact */}
//       <div className="bg-gradient-to-br from-gray-800 to-gray-900 border-b border-gray-700 py-3">
//         <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
//           <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
//             <div className="flex items-center gap-3">
//               <div className="p-2 bg-[#f37121] rounded-lg">
//                 <Calendar className="w-5 h-5 text-white" />
//               </div>
//               <div>
//                 <h1 className="text-lg sm:text-xl font-bold text-white">
//                   Meeting Room Schedule
//                 </h1>
//                 <p className="text-gray-400 text-xs">
//                   EnergiZe Logistics - Conference Room
//                 </p>
//               </div>
//             </div>
            
//             <div className="flex items-center gap-3">
//               <div className="flex items-center gap-2 text-sm text-gray-400">
//                 <Clock className="w-4 h-4" />
//                 <span className="hidden sm:inline">Updated: {lastUpdate.toLocaleTimeString()}</span>
//               </div>
              
//               <button
//                 onClick={handleRefresh}
//                 className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-all duration-200 border border-gray-600"
//                 title="Refresh"
//               >
//                 <RefreshCw className="w-4 h-4" />
//               </button>
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* Control Bar - Compact */}
//       <div className="bg-gray-800 border-b border-gray-700 py-3">
//         <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
//           <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
//             {/* Date Selector Compact */}
//             <div className="flex items-center gap-3">
//               {/* Navigation Buttons */}
//               <div className="flex gap-2">
//                 <button
//                   onClick={goToPreviousDay}
//                   className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-all duration-200 border border-gray-600"
//                   title="Previous Day"
//                 >
//                   ←
//                 </button>
//                 <button
//                   onClick={goToToday}
//                   className="bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium"
//                 >
//                   Today
//                 </button>
//                 <button
//                   onClick={goToNextDay}
//                   className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-all duration-200 border border-gray-600"
//                   title="Next Day"
//                 >
//                   →
//                 </button>
//               </div>

//               {/* Date Picker */}
//               <div className="relative">
//                 <input
//                   type="date"
//                   value={formatDateForInput(selectedDate)}
//                   onChange={handleDateChange}
//                   className="bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] min-w-[140px]"
//                   min={formatDateForInput(new Date())}
//                 />
//               </div>
//             </div>
            
//             {/* Book Meeting Button - في اليمين */}
//             <div className="flex justify-end">
//               <Link 
//                 href="/meeting-room"
//                 className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium rounded-lg transition-all duration-200 text-sm whitespace-nowrap flex-shrink-0"
//               >
//                 <LogIn className="w-4 h-4" />
//                 <span>Book Meeting</span>
//               </Link>
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* FullScreen Schedule Grid */}
//       <div className="flex-1 min-h-0 p-4">
//         <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 overflow-hidden h-full">
//           <FullScreenScheduleGrid 
//             bookings={bookings} 
//             selectedDate={selectedDate}
//             selectedRoomType={selectedRoomType}
//             onRoomTypeChange={setSelectedRoomType}
//           />
//         </div>
//       </div>

//       {/* Legend Compact */}
//       <div className="bg-gray-800 border-t border-gray-700 py-3">
//         <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
//           <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
//             <div className="flex flex-wrap items-center gap-3">
//               <span className="text-xs text-gray-300 font-medium">Legend:</span>
//               <div className="flex items-center gap-1">
//                 <div className="w-2 h-2 bg-green-500/20 border border-green-500 rounded"></div>
//                 <span className="text-xs text-gray-300">Available</span>
//               </div>
//               <div className="flex items-center gap-1">
//                 <div className="w-2 h-2 bg-green-500/80 border border-green-400 rounded"></div>
//                 <span className="text-xs text-gray-300">Small Booked</span>
//               </div>
//               <div className="flex items-center gap-1">
//                 <div className="w-2 h-2 bg-blue-500/80 border border-blue-400 rounded"></div>
//                 <span className="text-xs text-gray-300">Large Booked</span>
//               </div>
//               <div className="flex items-center gap-1">
//                 <div className="w-2 h-2 bg-gray-600 border border-gray-500 rounded"></div>
//                 <span className="text-xs text-gray-300">Outside Hours</span>
//               </div>
//             </div>
            
//             <div className="flex items-center gap-2 text-xs text-gray-400">
//               <Monitor className="w-3 h-3" />
//               <span>Auto updates every 30 seconds</span>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// app/display/page.tsx
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Booking } from '../../types';
import { bookingsAPI } from '../../utils/api';
import FullScreenScheduleGrid from '../../components/FullScreenScheduleGrid';
import { Calendar, Clock, LogIn, Monitor, RefreshCw } from 'lucide-react';

export default function MeetingRoomDisplay() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedRoomType, setSelectedRoomType] = useState<'small' | 'large' | 'both'>('both');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadBookings();
    
    // تحديث البيانات كل 30 ثانية
    const interval = setInterval(() => {
      loadBookings();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const loadBookings = async () => {
    try {
      const result = await bookingsAPI.getAll();
      if (result.status === 'success') {
        setBookings(result.data.bookings);
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    loadBookings();
  };

  const formatDateForInput = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(new Date(e.target.value));
  };

  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  return (
    <div className="relative min-h-screen bg-gray-900 text-white flex flex-col">

      {/* 🔥🔥🔥 Loading Overlay بدل الشاشة السودة */}
      {loading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f37121] mx-auto mb-4"></div>
            <p className="text-gray-300">Loading Meeting Room Schedule...</p>
          </div>
        </div>
      )}

      {/* Header Compact */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 border-b border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#f37121] rounded-lg">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  Meeting Room Schedule
                </h1>
                <p className="text-gray-400 text-xs">
                  EnergiZe Logistics - Conference Room
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Updated: {lastUpdate.toLocaleTimeString()}</span>
              </div>
              
              <button
                onClick={handleRefresh}
                className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-all duration-200 border border-gray-600"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Control Bar - Compact */}
      <div className="bg-gray-800 border-b border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">

            {/* Date Selector Compact */}
            <div className="flex items-center gap-3">
              {/* Navigation Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={goToPreviousDay}
                  className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-all duration-200 border border-gray-600"
                  title="Previous Day"
                >
                  ←
                </button>
                <button
                  onClick={goToToday}
                  className="bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium"
                >
                  Today
                </button>
                <button
                  onClick={goToNextDay}
                  className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-all duration-200 border border-gray-600"
                  title="Next Day"
                >
                  →
                </button>
              </div>

              {/* Date Picker */}
              <div className="relative">
                <input
                  type="date"
                  value={formatDateForInput(selectedDate)}
                  onChange={handleDateChange}
                  className="bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] min-w-[140px]"
                  min={formatDateForInput(new Date())}
                />
              </div>
            </div>
            
            {/* Book Meeting Button */}
            <div className="flex justify-end">
              <Link 
                href="/meeting-room"
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium rounded-lg transition-all duration-200 text-sm whitespace-nowrap"
              >
                <LogIn className="w-4 h-4" />
                <span>Book Meeting</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* FullScreen Schedule Grid */}
      <div className="flex-1 min-h-0 p-4">
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 overflow-hidden h-full">
          <FullScreenScheduleGrid 
            bookings={bookings} 
            selectedDate={selectedDate}
            selectedRoomType={selectedRoomType}
            onRoomTypeChange={setSelectedRoomType}
          />
        </div>
      </div>

      {/* Legend Compact */}
      <div className="bg-gray-800 border-t border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-300 font-medium">Legend:</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500/20 border border-green-500 rounded"></div>
                <span className="text-xs text-gray-300">Available</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500/80 border border-green-400 rounded"></div>
                <span className="text-xs text-gray-300">Small Booked</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-blue-500/80 border border-blue-400 rounded"></div>
                <span className="text-xs text-gray-300">Large Booked</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-600 border border-gray-500 rounded"></div>
                <span className="text-xs text-gray-300">Outside Hours</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Monitor className="w-3 h-3" />
              <span>Auto updates every 30 seconds</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}