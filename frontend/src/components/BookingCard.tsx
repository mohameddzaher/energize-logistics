// import { Booking } from '../types';

// interface BookingCardProps {
//   booking: Booking;
//   compact?: boolean;
// }

// export default function BookingCard({ booking, compact = false }: BookingCardProps) {
//   const formatTime = (dateString: string) => {
//     return new Date(dateString).toLocaleTimeString('en-US', {
//       hour: '2-digit',
//       minute: '2-digit',
//       hour12: true
//     });
//   };

//   if (compact) {
//     return (
//       <div className="bg-gradient-to-br from-[#f37121]/20 to-orange-500/20 border border-[#f37121]/30 rounded-lg p-2 text-xs backdrop-blur-sm hover:from-[#f37121]/30 hover:to-orange-500/30 transition-all duration-300 shadow-sm">
//         <div className="flex items-start justify-between gap-1">
//           <div className="flex-1 min-w-0">
//             <div className="text-gray-200 truncate text-[9px] leading-tight">
//               {booking.contactPerson.name}
//             </div>
//             <div className="font-semibold text-[#f37121] text-[10px] leading-tight 
//   overflow-hidden text-ellipsis whitespace-nowrap block max-w-[95%]">
//   {booking.contactPerson.company}
// </div>
            
//           </div>
//           <div className="text-gray-300 text-[9px] leading-tight whitespace-nowrap">
//             {formatTime(booking.startTime)}-{formatTime(booking.endTime)}
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="bg-gradient-to-br from-gray-800 to-[#2d2d2d] border border-gray-700 rounded-xl p-3 mb-2 shadow-md hover:shadow-lg transition-all duration-300">
//       <div className="flex justify-between items-start mb-2">
//         <div>
//           <h4 className="font-semibold text-[#f37121] text-sm">{booking.contactPerson.company}</h4>
//           <p className="text-gray-300 text-xs">{booking.contactPerson.name}</p>
//         </div>
//         <span className={`px-2 py-1 rounded-full text-xs font-medium ${
//           booking.status === 'confirmed' 
//             ? 'bg-green-900/50 text-green-300 border border-green-700/50' 
//             : 'bg-red-900/50 text-red-300 border border-red-700/50'
//         }`}>
//           {booking.status}
//         </span>
//       </div>
      
//       <div className="text-xs text-gray-400 space-y-1">
//         <div className="flex justify-between">
//           <span>Time:</span>
//           <span className="text-gray-300">{formatTime(booking.startTime)} - {formatTime(booking.endTime)}</span>
//         </div>
//         <div className="flex justify-between">
//           <span>Attendees:</span>
//           <span className="text-gray-300">{booking.numberOfAttendees} people</span>
//         </div>
//         <div className="flex justify-between">
//           <span>Booked by:</span>
//           <span className="text-gray-300">{booking.user.fullName}</span>
//         </div>
//       </div>
//     </div>
//   );
// }

import { Booking } from '../types';

interface BookingCardProps {
  booking: Booking;
  compact?: boolean;
}

export default function BookingCard({ booking, compact = false }: BookingCardProps) {
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const getRoomTypeColor = (roomType: string) => {
    return roomType === 'large' ? 'from-blue-500/20 to-blue-600/20 border-blue-400/30' : 'from-green-500/20 to-green-600/20 border-green-400/30';
  };

  const getRoomTypeText = (roomType: string) => {
    return roomType === 'large' ? 'text-blue-300' : 'text-green-300';
  };

  if (compact) {
    return (
      <div className={`bg-gradient-to-br ${getRoomTypeColor(booking.roomType)} border rounded-lg p-1 text-xs backdrop-blur-sm hover:opacity-90 transition-all duration-300 shadow-sm`}>
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <div className="text-gray-200 truncate text-[10px] leading-tight font-medium">
              {booking.contactPerson.company}
            </div>
            <div className="text-gray-300 truncate text-[9px] leading-tight">
              {booking.contactPerson.name}
            </div>
            <div className={`text-[8px] ${getRoomTypeText(booking.roomType)} mt-0.5 font-medium`}>
              {booking.roomName || (booking.roomType === 'small' ? 'Small' : 'Large')}
            </div>
          </div>
          <div className="text-gray-300 text-[9px] leading-tight whitespace-nowrap flex flex-col items-end">
            <span>{formatTime(booking.startTime)}</span>
            <span>{formatTime(booking.endTime)}</span>
          </div>
        </div>
        
        {/* Attendees Info */}
        <div className="flex justify-between items-center mt-1 pt-1 border-t border-gray-400/20">
          <span className="text-[8px] text-gray-300">
            {booking.numberOfAttendees} people
          </span>
          <span className={`text-[8px] px-1 rounded ${
            booking.status === 'confirmed' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
          }`}>
            {booking.status}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-gray-800 to-[#2d2d2d] border border-gray-700 rounded-xl p-3 mb-2 shadow-md hover:shadow-lg transition-all duration-300">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-semibold text-[#f37121] text-sm">{booking.contactPerson.company}</h4>
          <p className="text-gray-300 text-xs">{booking.contactPerson.name}</p>
          <p className={`text-xs font-medium ${getRoomTypeText(booking.roomType)}`}>
            {booking.roomName || (booking.roomType === 'small' ? 'Small Room' : 'Large Room')}
          </p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          booking.status === 'confirmed' 
            ? 'bg-green-900/50 text-green-300 border border-green-700/50' 
            : 'bg-red-900/50 text-red-300 border border-red-700/50'
        }`}>
          {booking.status}
        </span>
      </div>
      
      <div className="text-xs text-gray-400 space-y-1">
        <div className="flex justify-between">
          <span>Time:</span>
          <span className="text-gray-300">{formatTime(booking.startTime)} - {formatTime(booking.endTime)}</span>
        </div>
        <div className="flex justify-between">
          <span>Attendees:</span>
          <span className="text-gray-300">{booking.numberOfAttendees} people</span>
        </div>
        <div className="flex justify-between">
          <span>Booked by:</span>
          <span className="text-gray-300">{booking.user.fullName}</span>
        </div>
      </div>
    </div>
  );
}