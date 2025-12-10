
export interface User {
  id: string;
  username: string;
  fullName: string;
  role: 'user' | 'admin';
}

export interface ContactPerson {
  name: string;
  phone: string;
  company: string;
}

export interface Booking {
  _id: string;
  startTime: string;
  endTime: string;
  numberOfAttendees: number;
  contactPerson: ContactPerson;
  user: User;
  status: 'confirmed' | 'cancelled';
}

export interface AdminBooking extends Booking {
  user: User & { role: string };
}

export interface AuthResponse {
  status: string;
  token: string;
  data: {
    user: User;
  };
}

export interface BookingFormData {
  startTime: string;
  endTime: string;
  numberOfAttendees: number;
  contactPerson: ContactPerson;
}

// ---------------------

