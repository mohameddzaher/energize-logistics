
import { Booking, BookingFormData, AuthResponse, AdminBooking, AvailableRoom } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://energize-backend.onrender.com/api';
// Auth API
export const authAPI = {
  login: async (username: string, password: string): Promise<AuthResponse> => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });
    return response.json();
  },
};

// Bookings API
export const bookingsAPI = {
  getAll: async (roomType?: string): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const token = localStorage.getItem('token');
    const url = roomType 
      ? `${API_BASE_URL}/bookings?roomType=${roomType}`
      : `${API_BASE_URL}/bookings`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },

  create: async (bookingData: BookingFormData): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(bookingData),
    });
    return response.json();
  },

  getAvailable: async (date: string, roomType?: string): Promise<any> => {
    const token = localStorage.getItem('token');
    const url = roomType 
      ? `${API_BASE_URL}/bookings/available?date=${date}&roomType=${roomType}`
      : `${API_BASE_URL}/bookings/available?date=${date}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },

  getAvailableRooms: async (): Promise<{ status: string; data: { availableRooms: AvailableRoom[] } }> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/bookings/available-rooms`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },
};

// Admin API
export const adminAPI = {
  getAllBookings: async (): Promise<{ status: string; data: { bookings: AdminBooking[] } }> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/bookings`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },

  updateBooking: async (id: string, bookingData: any): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/bookings/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(bookingData),
    });
    return response.json();
  },

  deleteBooking: async (id: string): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/bookings/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 204) {
      return { status: 'success', data: null };
    }
    
    try {
      return await response.json();
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to delete booking'
      };
    }
  },

  getAllUsers: async (): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/users`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },

  createUser: async (userData: any): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(userData),
    });
    return response.json();
  },

  updateUser: async (id: string, userData: any): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/users/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(userData),
    });
    return response.json();
  },

  updateUserPermissions: async (id: string, permissions: { smallRoom: boolean; largeRoom: boolean }): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/users/${id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(permissions),
    });
    return response.json();
  },

  deleteUser: async (id: string): Promise<any> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/users/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 204) {
      return { status: 'success', data: null };
    }
    
    try {
      return await response.json();
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to delete user'
      };
    }
  },
};

// Display API للعرض المنفصل على الشاشات
export const displayAPI = {
  getRoomBookings: async (roomType: 'small' | 'large'): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/bookings?roomType=${roomType}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },

  // دالة خاصة للعرض العام بدون الحاجة لتسجيل الدخول (إذا أردت)
  getPublicRoomBookings: async (roomType: 'small' | 'large'): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const response = await fetch(`${API_BASE_URL}/bookings/public?roomType=${roomType}`);
    return response.json();
  },

  // دالة للحصول على حجوزات يوم محدد لغرفة محددة
  getRoomBookingsByDate: async (roomType: 'small' | 'large', date: string): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/bookings?roomType=${roomType}&date=${date}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.json();
  },
};

// Public API للعرض على الشاشات بدون مصادقة (إذا أردت عمل endpoint خاص)
export const publicAPI = {
  getSmallRoomBookings: async (): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const response = await fetch(`${API_BASE_URL}/public/small-room-bookings`);
    return response.json();
  },

  getLargeRoomBookings: async (): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const response = await fetch(`${API_BASE_URL}/public/large-room-bookings`);
    return response.json();
  },

  getRoomBookingsByDate: async (roomType: 'small' | 'large', date: string): Promise<{ status: string; data: { bookings: Booking[] } }> => {
    const response = await fetch(`${API_BASE_URL}/public/room-bookings/${roomType}?date=${date}`);
    return response.json();
  },
};