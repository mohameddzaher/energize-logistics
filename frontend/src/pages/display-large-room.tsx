// app/display-large-room/page.tsx
"use client";

import { useState, useEffect } from 'react';
import { Booking } from '../../types';
import { bookingsAPI } from '../utils/api';
import ScheduleGrid from '../components/ScheduleGrid';
import DateSelector from '../components/DateSelector';
import { Calendar, Clock, Monitor } from 'lucide-react';

export default function LargeRoomDisplay() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadBookings();
    
    // تحديث البيانات كل 30 ثانية
    const interval = setInterval(() => {
      loadBookings();
    }, 30000);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading Large Room Schedule...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* FullScreen Schedule Grid */}
      <div className="flex-1 min-h-0 p-4">
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 overflow-hidden h-full">
          <ScheduleGrid 
            bookings={bookings} 
            selectedDate={selectedDate}
            selectedRoomType="large"
          />
        </div>
      </div>

      {/* Header */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 border-b border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  Large Room Schedule
                </h1>
                <p className="text-gray-400 text-xs">
                  EnergiZe Logistics - Large Conference Room (up to 30 people)
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Clock className="w-4 h-4" />
                <span>Updated: {lastUpdate.toLocaleTimeString()}</span>
              </div>
              
              <button
                onClick={handleRefresh}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-all duration-200 border border-gray-600"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Date Selector */}
      <div className="bg-gray-800 border-b border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <DateSelector 
            selectedDate={selectedDate} 
            onDateChange={setSelectedDate}
            selectedRoomType="large"
            showRoomSelector={false}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="bg-gray-800 border-t border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm text-gray-300 font-medium">Legend:</span>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500/20 border border-blue-500 rounded"></div>
                <span className="text-xs text-gray-300">Available</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500/80 border border-blue-400 rounded"></div>
                <span className="text-xs text-gray-300">Booked - Large Room</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gray-600 border border-gray-500 rounded"></div>
                <span className="text-xs text-gray-300">Outside Hours</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Monitor className="w-4 h-4" />
              <span>Large Room Display - Auto updates every 30 seconds</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}