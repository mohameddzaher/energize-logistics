import { useState } from 'react';
import { BookingFormData } from '../types';
import { bookingsAPI } from '../utils/api';

interface DateTimePickerProps {
  onClose: () => void;
  onBookingSuccess: () => void;
}

export default function DateTimePicker({ onClose, onBookingSuccess }: DateTimePickerProps) {
  const [step, setStep] = useState<'datetime' | 'details'>('datetime');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const handleDateTimeSelect = () => {
    if (!formData.startTime || !formData.endTime) {
      setError('Please select both start and end time');
      return;
    }

    const start = new Date(formData.startTime);
    const end = new Date(formData.endTime);

    if (end <= start) {
      setError('End time must be after start time');
      return;
    }

    setStep('details');
    setError('');
  };

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

  // Get minimum datetime (current time)
  const now = new Date();
  const minDateTime = now.toISOString().slice(0, 16);

  if (step === 'datetime') {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-gray-700">
            <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
              Select Date & Time
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

          {/* Date & Time Selection */}
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Start Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.startTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                  min={minDateTime}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  End Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.endTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                  min={formData.startTime || minDateTime}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleDateTimeSelect}
                className="flex-1 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
              >
                Continue to Details
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Details Step
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
              Booking Details
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {formData.startTime && new Date(formData.startTime).toLocaleString()} - {' '}
              {formData.endTime && new Date(formData.endTime).toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => setStep('datetime')}
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
                'Confirm Booking'
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep('datetime')}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 border border-gray-600 hover:border-gray-500"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}