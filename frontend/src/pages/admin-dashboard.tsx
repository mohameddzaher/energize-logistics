
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminBooking, User, BookingFormData } from '../types';
import { adminAPI } from '../utils/api';

export default function AdminDashboard() {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<AdminBooking | null>(null);
  const [editFormData, setEditFormData] = useState<BookingFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    try {
      const [bookingsRes, usersRes] = await Promise.all([
        adminAPI.getAllBookings(),
        adminAPI.getAllUsers()
      ]);

      if (bookingsRes.status === 'success') {
        setBookings(bookingsRes.data.bookings);
      }

      if (usersRes.status === 'success') {
        setUsers(usersRes.data.users);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBooking = async (id: string) => {
    if (confirm('Are you sure you want to delete this booking?')) {
      try {
        const result = await adminAPI.deleteBooking(id);
        if (result.status === 'success') {
          setBookings(bookings.filter(booking => booking._id !== id));
          setRefreshTrigger(prev => prev + 1);
        } else {
          alert(result.message || 'Failed to delete booking');
        }
      } catch (error) {
        console.error('Error deleting booking:', error);
        alert('Failed to delete booking');
      }
    }
  };

  const handleEditBooking = (booking: AdminBooking) => {
    setSelectedBooking(booking);
    
    const formatForDateTimeLocal = (dateString: string) => {
      const date = new Date(dateString);
      return date.toISOString().slice(0, 16);
    };

    setEditFormData({
      startTime: formatForDateTimeLocal(booking.startTime),
      endTime: formatForDateTimeLocal(booking.endTime),
      numberOfAttendees: booking.numberOfAttendees,
      contactPerson: booking.contactPerson,
      roomType: booking.roomType
    });
    setShowEditModal(true);
  };

  const handleUpdateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking || !editFormData) return;

    try {
      const updateData = {
        ...editFormData,
        startTime: new Date(editFormData.startTime).toISOString(),
        endTime: new Date(editFormData.endTime).toISOString()
      };

      const result = await adminAPI.updateBooking(selectedBooking._id, updateData);
      if (result.status === 'success') {
        setBookings(bookings.map(booking => 
          booking._id === selectedBooking._id ? result.data.booking : booking
        ));
        setShowEditModal(false);
        setSelectedBooking(null);
        setEditFormData(null);
        setRefreshTrigger(prev => prev + 1);
      } else {
        alert(result.message || 'Failed to update booking');
      }
    } catch (error) {
      console.error('Error updating booking:', error);
      alert('Failed to update booking');
    }
  };

  const handleContactPersonChange = (field: keyof typeof editFormData.contactPerson, value: string) => {
    if (editFormData) {
      setEditFormData(prev => ({
        ...prev!,
        contactPerson: {
          ...prev!.contactPerson,
          [field]: value
        }
      }));
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    setRefreshTrigger(prev => prev + 1);
  };

  const getRoomTypeColor = (roomType: string) => {
    return roomType === 'large' ? 'bg-blue-900/50 text-blue-300 border-blue-700/50' : 'bg-green-900/50 text-green-300 border-green-700/50';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f37121] mx-auto mb-4"></div>
          <p className="text-gray-400">Loading Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Background Effects */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />
      
      <div className="max-w-7xl mx-auto relative z-10">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleRefresh}
              className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-gray-500/50"
            >
              Refresh Data
            </button>
            <Link 
              href="/meeting-room"
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-blue-500/50 text-center"
            >
              Back to Meeting Room
            </Link>
            <Link 
              href="/user-management"
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-green-500/50"
            >
              Manage Users
            </Link>

{/* في قسم الأزرار في الـ Header */}
<Link 
  href="/analytics"
  className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-purple-500/50 text-center"
>
  View Analytics
</Link>

          </div>
        </div>
        
        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-gradient-to-br from-gray-800 to-[#2d2d2d] p-6 rounded-2xl shadow-lg border border-gray-700 hover:border-[#f37121]/40 transition-all duration-300">
            <h3 className="text-lg font-semibold text-gray-300 mb-2">Total Bookings</h3>
            <p className="text-3xl font-bold text-[#f37121]">{bookings.length}</p>
          </div>
          <div className="bg-gradient-to-br from-gray-800 to-[#2d2d2d] p-6 rounded-2xl shadow-lg border border-gray-700 hover:border-green-500/40 transition-all duration-300">
            <h3 className="text-lg font-semibold text-gray-300 mb-2">Total Users</h3>
            <p className="text-3xl font-bold text-green-400">{users.length}</p>
          </div>
          <div className="bg-gradient-to-br from-gray-800 to-[#2d2d2d] p-6 rounded-2xl shadow-lg border border-gray-700 hover:border-blue-500/40 transition-all duration-300">
            <h3 className="text-lg font-semibold text-gray-300 mb-2">Small Room Bookings</h3>
            <p className="text-3xl font-bold text-blue-400">
              {bookings.filter(b => b.roomType === 'small').length}
            </p>
          </div>
          <div className="bg-gradient-to-br from-gray-800 to-[#2d2d2d] p-6 rounded-2xl shadow-lg border border-gray-700 hover:border-orange-400/40 transition-all duration-300">
            <h3 className="text-lg font-semibold text-gray-300 mb-2">Large Room Bookings</h3>
            <p className="text-3xl font-bold text-orange-400">
              {bookings.filter(b => b.roomType === 'large').length}
            </p>
          </div>
        </div>

        {/* Bookings Table */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl overflow-hidden border border-gray-700 mb-8">
          <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/50">
            <h2 className="text-xl font-semibold text-[#f37121]">All Bookings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-800/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Company & Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Time & Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Room & Attendees
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Booked By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800/50 divide-y divide-gray-700">
                {bookings.map(booking => (
                  <tr key={booking._id} className="hover:bg-gray-700/50 transition-colors duration-200">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-white">
                        {booking.contactPerson.company}
                      </div>
                      <div className="text-sm text-gray-300">
                        {booking.contactPerson.name}
                      </div>
                      <div className="text-sm text-gray-400">
                        {booking.contactPerson.phone}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-white">
                        {new Date(booking.startTime).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-gray-300">
                        {new Date(booking.startTime).toLocaleTimeString()} - {new Date(booking.endTime).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getRoomTypeColor(booking.roomType)}`}>
                          {booking.roomName || (booking.roomType === 'small' ? 'Small Room' : 'Large Room')}
                        </span>
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-900/50 text-green-300 border border-green-700/50">
                          {booking.numberOfAttendees} people
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {/* <div className="text-sm text-white">{booking.user.fullName}</div>
                      <div className="text-sm text-gray-300">@{booking.user.username}</div>
                      <div className="text-sm text-gray-400 capitalize">{booking.user.role}</div> */}


<div className="text-sm text-white">
  {booking.user?.fullName || "Unknown User"}
</div>
<div className="text-sm text-gray-300">
  @{booking.user?.username || "unknown"}
</div>
<div className="text-sm text-gray-400 capitalize">
  {booking.user?.role || "unknown"}
</div>

                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        booking.status === 'confirmed' 
                          ? 'bg-green-900/50 text-green-300 border border-green-700/50' 
                          : 'bg-red-900/50 text-red-300 border border-red-700/50'
                      }`}>
                        {booking.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleEditBooking(booking)}
                        className="text-[#f37121] hover:text-orange-400 mr-4 transition-colors duration-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteBooking(booking._id)}
                        className="text-red-400 hover:text-red-300 transition-colors duration-200"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Edit Modal */}
        {showEditModal && selectedBooking && editFormData && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center p-6 border-b border-gray-700">
                <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
                  Edit Booking
                </h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-[#f37121] text-2xl font-bold transition-colors duration-200"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleUpdateBooking} className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Start Time</label>
                    <input
                      type="datetime-local"
                      value={editFormData.startTime}
                      onChange={(e) => setEditFormData({...editFormData, startTime: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">End Time</label>
                    <input
                      type="datetime-local"
                      value={editFormData.endTime}
                      onChange={(e) => setEditFormData({...editFormData, endTime: e.target.value})}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                      required
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Room Type</label>
                  <select
                    value={editFormData.roomType || 'small'}
                    onChange={(e) => setEditFormData({...editFormData, roomType: e.target.value as 'small' | 'large'})}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                  >
                    <option value="small">Small Room</option>
                    <option value="large">Large Room</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Number of Attendees</label>
                  <input
                    type="number"
                    value={editFormData.numberOfAttendees}
                    onChange={(e) => setEditFormData({...editFormData, numberOfAttendees: parseInt(e.target.value)})}
                    min="1"
                    max={editFormData.roomType === 'small' ? '10' : '30'}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                    required
                  />
                </div>

                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-semibold text-[#f37121] mb-4">Contact Person</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                      <input
                        type="text"
                        value={editFormData.contactPerson.name}
                        onChange={(e) => handleContactPersonChange('name', e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                      <input
                        type="tel"
                        value={editFormData.contactPerson.phone}
                        onChange={(e) => handleContactPersonChange('phone', e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Company</label>
                      <input
                        type="text"
                        value={editFormData.contactPerson.company}
                        onChange={(e) => handleContactPersonChange('company', e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white transition-all duration-200"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                  >
                    Update Booking
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 border border-gray-600 hover:border-gray-500"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}