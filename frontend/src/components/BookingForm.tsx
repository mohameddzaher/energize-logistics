// import { useState } from 'react';
// import { BookingFormData } from '../types';
// import { bookingsAPI } from '../utils/api';

// interface BookingFormProps {
//   onClose: () => void;
//   onBookingSuccess: () => void;
// }

// export default function BookingForm({ onClose, onBookingSuccess }: BookingFormProps) {
//   const [formData, setFormData] = useState<BookingFormData>({
//     startTime: '',
//     endTime: '',
//     numberOfAttendees: 1,
//     contactPerson: {
//       name: '',
//       phone: '',
//       company: ''
//     }
//   });
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();
//     setLoading(true);
//     setError('');

//     try {
//       const result = await bookingsAPI.create(formData);
      
//       if (result.status === 'success') {
//         onBookingSuccess();
//       } else {
//         setError(result.message);
//       }
//     } catch (err) {
//       setError('Booking failed. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleContactPersonChange = (field: keyof typeof formData.contactPerson, value: string) => {
//     setFormData(prev => ({
//       ...prev,
//       contactPerson: {
//         ...prev.contactPerson,
//         [field]: value
//       }
//     }));
//   };

//   return (
//     <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
//       <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
//         <div className="flex justify-between items-center mb-4">
//           <h2 className="text-xl font-semibold text-gray-800">Book Meeting Room</h2>
//           <button
//             onClick={onClose}
//             className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
//           >
//             ×
//           </button>
//         </div>

//         {error && (
//           <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
//             {error}
//           </div>
//         )}

//         <form onSubmit={handleSubmit} className="space-y-4">
//           <div className="grid grid-cols-2 gap-4">
//             <div>
//               <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
//               <input
//                 type="datetime-local"
//                 value={formData.startTime}
//                 onChange={(e) => setFormData({...formData, startTime: e.target.value})}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//                 required
//               />
//             </div>
//             <div>
//               <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
//               <input
//                 type="datetime-local"
//                 value={formData.endTime}
//                 onChange={(e) => setFormData({...formData, endTime: e.target.value})}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//                 required
//               />
//             </div>
//           </div>
          
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Number of Attendees</label>
//             <input
//               type="number"
//               value={formData.numberOfAttendees}
//               onChange={(e) => setFormData({...formData, numberOfAttendees: parseInt(e.target.value)})}
//               min="1"
//               max="50"
//               className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//               required
//             />
//           </div>

//           <div className="border-t pt-4">
//             <h3 className="text-lg font-medium text-gray-800 mb-3">Contact Person</h3>
            
//             <div className="space-y-3">
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
//                 <input
//                   type="text"
//                   value={formData.contactPerson.name}
//                   onChange={(e) => handleContactPersonChange('name', e.target.value)}
//                   className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//                   required
//                   placeholder="Enter full name"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
//                 <input
//                   type="tel"
//                   value={formData.contactPerson.phone}
//                   onChange={(e) => handleContactPersonChange('phone', e.target.value)}
//                   className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//                   required
//                   placeholder="Enter phone number"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
//                 <input
//                   type="text"
//                   value={formData.contactPerson.company}
//                   onChange={(e) => handleContactPersonChange('company', e.target.value)}
//                   className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//                   required
//                   placeholder="Enter company name"
//                 />
//               </div>
//             </div>
//           </div>

//           <div className="flex gap-3 pt-4">
//             <button
//               type="submit"
//               disabled={loading}
//               className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-200 disabled:opacity-50"
//             >
//               {loading ? 'Booking...' : 'Book Meeting'}
//             </button>
//             <button
//               type="button"
//               onClick={onClose}
//               className="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-md transition duration-200"
//             >
//               Cancel
//             </button>
//           </div>
//         </form>
//       </div>
//     </div>
//   );
// }


import { useState } from 'react';
import { BookingFormData } from '../types';
import { bookingsAPI } from '../utils/api';

interface BookingFormProps {
  onClose: () => void;
  onBookingSuccess: () => void;
}

export default function BookingForm({ onClose, onBookingSuccess }: BookingFormProps) {
  const [formData, setFormData] = useState<BookingFormData>({
    startTime: '',
    endTime: '',
    numberOfAttendees: 1,
    contactPerson: {
      name: '',
      phone: '',
      company: ''
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await bookingsAPI.create(formData);
      
      if (result.status === 'success') {
        onBookingSuccess();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Booking failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleContactPersonChange = (field: keyof typeof formData.contactPerson, value: string) => {
    setFormData(prev => ({
      ...prev,
      contactPerson: {
        ...prev.contactPerson,
        [field]: value
      }
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
            Book Meeting Room
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-[#f37121] text-2xl font-bold transition-colors duration-200"
          >
            ×
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-6 mt-4 bg-red-900/50 border border-red-700/50 text-red-200 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Time Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Start Time</label>
              <input
                type="datetime-local"
                value={formData.startTime}
                onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">End Time</label>
              <input
                type="datetime-local"
                value={formData.endTime}
                onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
                required
              />
            </div>
          </div>
          
          {/* Attendees */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Number of Attendees</label>
            <input
              type="number"
              value={formData.numberOfAttendees}
              onChange={(e) => setFormData({...formData, numberOfAttendees: parseInt(e.target.value)})}
              min="1"
              max="50"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
              required
            />
          </div>

          {/* Contact Person Section */}
          <div className="border-t border-gray-700 pt-6">
            <h3 className="text-lg font-semibold text-[#f37121] mb-4">Contact Person</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                <input
                  type="text"
                  value={formData.contactPerson.name}
                  onChange={(e) => handleContactPersonChange('name', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
                  required
                  placeholder="Enter full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                <input
                  type="tel"
                  value={formData.contactPerson.phone}
                  onChange={(e) => handleContactPersonChange('phone', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
                  required
                  placeholder="Enter phone number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Company</label>
                <input
                  type="text"
                  value={formData.contactPerson.company}
                  onChange={(e) => handleContactPersonChange('company', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
                  required
                  placeholder="Enter company name"
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Booking...
                </span>
              ) : (
                'Book Meeting'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 border border-gray-600 hover:border-gray-500"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}