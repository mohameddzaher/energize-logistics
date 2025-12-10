'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Booking } from '../types';
import { bookingsAPI } from '../utils/api';
import LoginForm from '../components/LoginForm';
import TimeSlotPicker from '../components/TimeSlotPicker';
import ScheduleGrid from '../components/ScheduleGrid';
import DateSelector from '../components/DateSelector';

export default function MeetingRoomPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedRoomType, setSelectedRoomType] = useState<'small' | 'large' | 'both'>('both');

  useEffect(() => {
    checkAuth();
    loadInitialBookings();
    
    // Set up interval to refresh bookings every 30 seconds
    const interval = setInterval(() => {
      if (isLoggedIn) {
        refreshBookings();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const checkAuth = () => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      setIsLoggedIn(true);
      setUser(JSON.parse(userData));
    }
  };

  const loadInitialBookings = async () => {
    try {
      const result = await bookingsAPI.getAll();
      if (result.status === 'success') {
        setBookings(result.data.bookings);
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshBookings = async () => {
    try {
      const result = await bookingsAPI.getAll();
      if (result.status === 'success') {
        setBookings(result.data.bookings);
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsLoggedIn(false);
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f37121] mx-auto mb-4"></div>
          <p className="text-gray-400">Loading Meeting Room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      {/* Background Effects */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />
      
      <div className="max-w-7xl mx-auto relative z-10">
        {/* Header */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6 mb-6 border border-gray-700">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
                Meeting Room Booking
              </h1>
              <p className="text-gray-400 mt-2">View and book available time slots</p>
              <p className="text-xs text-gray-500 mt-1">
                Last updated: {lastUpdate.toLocaleTimeString()}
              </p>
            </div>
            
            {isLoggedIn && user && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <span className="text-gray-300 bg-gray-700/50 px-3 py-1 rounded-lg border border-gray-600">
                  Welcome, {user.fullName}
                </span>
                
                {user.role === 'admin' && (
                  <Link 
                    href="/admin-dashboard"
                    className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-purple-500/50"
                  >
                    Admin Dashboard
                  </Link>
                )}
                
                <button
                  onClick={handleLogout}
                  className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-red-500/50"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Login Section */}
        {!isLoggedIn && (
          <LoginForm onLogin={() => {
            setIsLoggedIn(true);
            const userData = localStorage.getItem('user');
            if (userData) setUser(JSON.parse(userData));
            refreshBookings();
          }} />
        )}

        

        {/* Booking Controls */}
        {isLoggedIn && (
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6 mb-6 border border-gray-700">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h2 className="text-xl font-semibold text-[#f37121]">
                Meeting Room Schedule
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={refreshBookings}
                  className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-gray-500/50"
                >
                  Refresh
                </button>
                <button
                  onClick={() => setShowBookingForm(true)}
                  className="bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 border border-orange-400/50"
                >
                  Book Meeting Room
                </button>
              </div>
            </div>
          </div>
        )}

{/* Date Selector */}
        {isLoggedIn && (
          <DateSelector 
            selectedDate={selectedDate} 
            onDateChange={setSelectedDate}
          />
        )}


        {/* Time Slot Picker Modal */}
        {showBookingForm && (
          <TimeSlotPicker 
            onClose={() => setShowBookingForm(false)}
            onBookingSuccess={() => {
              setShowBookingForm(false);
              refreshBookings();
            }}
            selectedDate={selectedDate}
          />
        )}

        {/* Schedule Grid مع أزرار الغرف */}
        {isLoggedIn && (
          <ScheduleGrid 
            bookings={bookings} 
            selectedDate={selectedDate}
            selectedRoomType={selectedRoomType}
            onRoomTypeChange={setSelectedRoomType}
            showRoomButtons={true}
          />
        )}
      </div>
    </div>
  );
}