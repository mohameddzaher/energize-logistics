import { useState } from 'react';

interface DateSelectorProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  selectedRoomType?: 'small' | 'large' | 'both';
  onRoomTypeChange?: (roomType: 'small' | 'large' | 'both') => void;
  showRoomSelector?: boolean;
}

export default function DateSelector({ 
  selectedDate, 
  onDateChange, 
  selectedRoomType = 'both',
  onRoomTypeChange,
  showRoomSelector = false 
}: DateSelectorProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onDateChange(new Date(e.target.value));
    setShowDatePicker(false);
  };

  const goToToday = () => {
    onDateChange(new Date());
  };

  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    onDateChange(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    onDateChange(newDate);
  };

  const handleRoomTypeChange = (roomType: 'small' | 'large' | 'both') => {
    if (onRoomTypeChange) {
      onRoomTypeChange(roomType);
    }
  };

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6 border border-gray-700 mb-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[#f37121]">Select Date & Room</h2>
        
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
          {/* Room Type Selector */}
          {showRoomSelector && onRoomTypeChange && (
            <div className="flex gap-2 bg-gray-700 p-1 rounded-lg border border-gray-600">
              <button
                onClick={() => handleRoomTypeChange('both')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedRoomType === 'both'
                    ? 'bg-[#f37121] text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-600'
                }`}
              >
                Both Rooms
              </button>
              <button
                onClick={() => handleRoomTypeChange('small')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedRoomType === 'small'
                    ? 'bg-green-500 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-600'
                }`}
              >
                Small Room
              </button>
              <button
                onClick={() => handleRoomTypeChange('large')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedRoomType === 'large'
                    ? 'bg-blue-500 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-600'
                }`}
              >
                Large Room
              </button>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center gap-3">
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
                className="bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium"
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

            {/* Date Display & Picker */}
            <div className="relative">
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-all duration-200 border border-gray-600 min-w-[180px] text-center"
              >
                {selectedDate.toLocaleDateString('en-US', { 
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </button>
              
              {showDatePicker && (
                <div className="absolute top-full left-0 mt-2 z-10">
                  <input
                    type="date"
                    value={selectedDate.toISOString().split('T')[0]}
                    onChange={handleDateChange}
                    className="bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121]"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Room Type Info */}
      {showRoomSelector && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
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
              <span className="text-gray-300">Showing: Small Room Only (up to 10 people)</span>
            </div>
          )}
          {selectedRoomType === 'large' && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded"></div>
              <span className="text-gray-300">Showing: Large Room Only (up to 30 people)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}