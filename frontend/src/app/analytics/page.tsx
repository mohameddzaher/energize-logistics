// // app/analytics/page.tsx
// "use client";

// import { useState, useEffect, useRef } from 'react';
// import Link from 'next/link';
// import { AdminBooking, User } from '../types';
// import {
//   BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
//   XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
//   AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
//   ScatterChart, Scatter, ComposedChart
// } from 'recharts';

// // ألوان محسنة للوضع الداكن
// const COLORS = [
//   '#FF6B35', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
//   '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
// ];

// const STATUS_COLORS = {
//   confirmed: '#10B981',
//   cancelled: '#EF4444',
//   pending: '#F59E0B'
// };

// const ROOM_COLORS = {
//   small: '#3B82F6',
//   large: '#8B5CF6'
// };

// // API service للاتصال بالباك إند
// const apiService = {
//   async getBookings(): Promise<AdminBooking[]> {
//     try {
//       const token = localStorage.getItem('token');
//       const response = await fetch('/api/admin/bookings', {
//         headers: {
//           'Authorization': `Bearer ${token}`,
//           'Content-Type': 'application/json'
//         }
//       });

//       if (!response.ok) {
//         throw new Error('Failed to fetch bookings');
//       }

//       const data = await response.json();
//       return data.data?.bookings || data.bookings || [];
//     } catch (error) {
//       console.error('Error fetching bookings:', error);
//       return [];
//     }
//   },

//   async getUsers(): Promise<User[]> {
//     try {
//       const token = localStorage.getItem('token');
//       const response = await fetch('/api/admin/users', {
//         headers: {
//           'Authorization': `Bearer ${token}`,
//           'Content-Type': 'application/json'
//         }
//       });

//       if (!response.ok) {
//         throw new Error('Failed to fetch users');
//       }

//       const data = await response.json();
//       return data.data?.users || data.users || [];
//     } catch (error) {
//       console.error('Error fetching users:', error);
//       return [];
//     }
//   }
// };

// // مكونات مساعدة
// const StatCard = ({ title, value, change, color, icon }: any) => (
//   <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700 shadow-lg">
//     <div className="flex justify-between items-start">
//       <div>
//         <p className="text-gray-400 text-sm">{title}</p>
//         <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
//         {change && (
//           <p className={`text-xs mt-1 ${change > 0 ? 'text-green-400' : 'text-red-400'}`}>
//             {change > 0 ? '↑' : '↓'} {Math.abs(change)}% from last period
//           </p>
//         )}
//       </div>
//       {icon && (
//         <div className="p-2 rounded-lg bg-gray-700/50">
//           {icon}
//         </div>
//       )}
//     </div>
//   </div>
// );

// const ChartContainer = ({ title, children, className = '' }: any) => (
//   <div className={`bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700 shadow-lg ${className}`}>
//     <h3 className="text-lg font-semibold text-[#FF6B35] mb-4">{title}</h3>
//     {children}
//   </div>
// );

// export default function AnalyticsDashboard() {
//   const [bookings, setBookings] = useState<AdminBooking[]>([]);
//   const [users, setUsers] = useState<User[]>([]);
//   const [loading, setLoading] = useState(true);
//   const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('month');
//   const [activeTab, setActiveTab] = useState('overview');
//   const chartRefs = useRef<(HTMLDivElement | null)[]>([]);

//   useEffect(() => {
//     loadData();

//     // Animation observer
//     const observer = new IntersectionObserver((entries) => {
//       entries.forEach(entry => {
//         if (entry.isIntersecting) {
//           entry.target.classList.add('animate-in');
//         }
//       });
//     }, { threshold: 0.1 });

//     chartRefs.current.forEach(ref => {
//       if (ref) observer.observe(ref);
//     });

//     return () => observer.disconnect();
//   }, []);

//   const loadData = async () => {
//     try {
//       setLoading(true);
//       const [bookingsData, usersData] = await Promise.all([
//         apiService.getBookings(),
//         apiService.getUsers()
//       ]);

//       if (bookingsData.length === 0 && usersData.length === 0) {
//         const mockData = generateRealisticMockData();
//         setBookings(mockData.bookings);
//         setUsers(mockData.users);
//       } else {
//         setBookings(bookingsData);
//         setUsers(usersData);
//       }
//     } catch (error) {
//       console.error('Error loading data:', error);
//       const mockData = generateRealisticMockData();
//       setBookings(mockData.bookings);
//       setUsers(mockData.users);
//     } finally {
//       setLoading(false);
//     }
//   };

//   // 📊 تحليل البيانات الأساسية
//   const totalBookings = bookings.length;
//   const totalUsers = users.length;
//   const smallRoomBookings = bookings.filter(b => b.roomType === 'small').length;
//   const largeRoomBookings = bookings.filter(b => b.roomType === 'large').length;
//   const confirmedBookings = bookings.filter(b => b.status === 'confirmed').length;
//   const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length;
//   const pendingBookings = bookings.filter(b => !b.status || b.status === 'pending').length;

//   // حساب الإيرادات
//   const calculateRevenue = () => {
//     const smallRoomRate = 50;
//     const largeRoomRate = 100;

//     return bookings
//       .filter(b => b.status === 'confirmed')
//       .reduce((total, booking) => {
//         const start = new Date(booking.startTime);
//         const end = new Date(booking.endTime);
//         const hours = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
//         const rate = booking.roomType === 'small' ? smallRoomRate : largeRoomRate;
//         return total + (hours * rate);
//       }, 0);
//   };

//   const totalRevenue = calculateRevenue();

//   // 📈 بيانات الشارت الشهري
//   const getMonthlyData = () => {
//     const monthlyData: { [key: string]: {
//       small: number; large: number; total: number; revenue: number;
//       confirmed: number; cancelled: number; occupancy: number;
//     } } = {};

//     const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
//     const currentYear = new Date().getFullYear();

//     for (let i = 5; i >= 0; i--) {
//       const date = new Date(currentYear, new Date().getMonth() - i, 1);
//       const monthName = `${months[date.getMonth()]} ${date.getFullYear()}`;
//       monthlyData[monthName] = {
//         small: 0, large: 0, total: 0, revenue: 0,
//         confirmed: 0, cancelled: 0, occupancy: 0
//       };
//     }

//     bookings.forEach(booking => {
//       const date = new Date(booking.startTime);
//       const monthName = `${months[date.getMonth()]} ${date.getFullYear()}`;

//       if (monthlyData[monthName]) {
//         const hours = Math.max(1, (new Date(booking.endTime).getTime() - date.getTime()) / (1000 * 60 * 60));
//         const rate = booking.roomType === 'small' ? 50 : 100;
//         const bookingRevenue = hours * rate;

//         monthlyData[monthName][booking.roomType]++;
//         monthlyData[monthName].total++;
//         monthlyData[monthName].revenue += bookingRevenue;
//         monthlyData[monthName].confirmed += booking.status === 'confirmed' ? 1 : 0;
//         monthlyData[monthName].cancelled += booking.status === 'cancelled' ? 1 : 0;
//         monthlyData[monthName].occupancy += hours / 24; // نسبة الإشغال اليومية
//       }
//     });

//     return Object.entries(monthlyData).map(([name, data]) => ({ name, ...data }));
//   };

//   // 📊 بيانات توزيع أيام الأسبوع
//   const getWeekdayData = () => {
//     const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
//     const data = weekdays.map(day => ({
//       name: day.substring(0, 3),
//       fullName: day,
//       bookings: 0,
//       small: 0,
//       large: 0,
//       revenue: 0,
//       confirmed: 0
//     }));

//     bookings.forEach(booking => {
//       const dayIndex = new Date(booking.startTime).getDay();
//       const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//       const rate = booking.roomType === 'small' ? 50 : 100;
//       const bookingRevenue = hours * rate;

//       data[dayIndex].bookings++;
//       data[dayIndex][booking.roomType]++;
//       data[dayIndex].revenue += bookingRevenue;
//       data[dayIndex].confirmed += booking.status === 'confirmed' ? 1 : 0;
//     });

//     return data;
//   };

//   // 📈 بيانات توزيع الساعات
//   const getHourlyData = () => {
//     const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7 AM to 8 PM
//     const data = hours.map(hour => ({
//       hour,
//       name: `${hour}:00`,
//       bookings: 0,
//       small: 0,
//       large: 0,
//       display: hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`,
//       revenue: 0
//     }));

//     bookings.forEach(booking => {
//       const hour = new Date(booking.startTime).getHours();
//       const index = hours.indexOf(hour);
//       if (index !== -1) {
//         const hoursDuration = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//         const rate = booking.roomType === 'small' ? 50 : 100;

//         data[index].bookings++;
//         data[index][booking.roomType]++;
//         data[index].revenue += hoursDuration * rate;
//       }
//     });

//     return data;
//   };

//   // 📊 بيانات توزيع عدد الحضور
//   const getAttendeesData = () => {
//     const ranges = [
//       { range: '1-3', min: 1, max: 3, count: 0, revenue: 0, avgDuration: 0 },
//       { range: '4-6', min: 4, max: 6, count: 0, revenue: 0, avgDuration: 0 },
//       { range: '7-10', min: 7, max: 10, count: 0, revenue: 0, avgDuration: 0 },
//       { range: '11-15', min: 11, max: 15, count: 0, revenue: 0, avgDuration: 0 },
//       { range: '16-20', min: 16, max: 20, count: 0, revenue: 0, avgDuration: 0 },
//       { range: '21-30', min: 21, max: 30, count: 0, revenue: 0, avgDuration: 0 }
//     ];

//     bookings.forEach(booking => {
//       if (booking.status === 'confirmed') {
//         const attendees = booking.numberOfAttendees;
//         const range = ranges.find(r => attendees >= r.min && attendees <= r.max);
//         if (range) {
//           const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//           const rate = booking.roomType === 'small' ? 50 : 100;
//           range.revenue += hours * rate;
//           range.avgDuration += hours;
//           range.count++;
//         }
//       }
//     });

//     ranges.forEach(range => {
//       if (range.count > 0) {
//         range.avgDuration = range.avgDuration / range.count;
//       }
//     });

//     return ranges.filter(r => r.count > 0);
//   };

//   // 📈 بيانات المستخدمين النشطين
//   const getTopUsers = () => {
//     const userBookings: { [key: string]: { user: User; count: number; revenue: number; totalHours: number } } = {};

//     bookings.forEach(booking => {
//       if (booking.user) {
//         const userId = booking.user.id;
//         if (!userBookings[userId]) {
//           userBookings[userId] = { user: booking.user, count: 0, revenue: 0, totalHours: 0 };
//         }
//         const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//         const rate = booking.roomType === 'small' ? 50 : 100;
//         userBookings[userId].revenue += hours * rate;
//         userBookings[userId].totalHours += hours;
//         userBookings[userId].count++;
//       }
//     });

//     return Object.values(userBookings)
//       .sort((a, b) => b.count - a.count)
//       .slice(0, 10);
//   };

//   // 📊 بيانات الشركات
//   const getTopCompanies = () => {
//     const companyStats: { [key: string]: {
//       bookings: number; revenue: number; attendees: number;
//       avgAttendees: number; totalHours: number
//     } } = {};

//     bookings.forEach(booking => {
//       const company = booking.contactPerson.company || 'Unknown';
//       if (!companyStats[company]) {
//         companyStats[company] = { bookings: 0, revenue: 0, attendees: 0, avgAttendees: 0, totalHours: 0 };
//       }
//       const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//       const rate = booking.roomType === 'small' ? 50 : 100;
//       companyStats[company].revenue += hours * rate;
//       companyStats[company].bookings++;
//       companyStats[company].attendees += booking.numberOfAttendees;
//       companyStats[company].totalHours += hours;
//     });

//     Object.keys(companyStats).forEach(company => {
//       companyStats[company].avgAttendees = companyStats[company].attendees / companyStats[company].bookings;
//     });

//     return Object.entries(companyStats)
//       .map(([name, data]) => ({ name, ...data }))
//       .sort((a, b) => b.bookings - a.bookings)
//       .slice(0, 10);
//   };

//   // 📈 بيانات مدة الحجوزات
//   const getBookingDurationData = () => {
//     const durations = bookings
//       .filter(b => b.status === 'confirmed')
//       .map(booking => {
//         const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//         return {
//           duration: Math.round(hours * 10) / 10,
//           attendees: booking.numberOfAttendees,
//           roomType: booking.roomType,
//           revenue: hours * (booking.roomType === 'small' ? 50 : 100),
//           company: booking.contactPerson.company,
//           hour: new Date(booking.startTime).getHours()
//         };
//       });

//     return durations;
//   };

//   // 📊 بيانات الأداء الشهري
//   const getPerformanceData = () => {
//     const monthly = getMonthlyData();
//     return monthly.map(month => ({
//       name: month.name,
//       occupancy: (month.total / 20) * 100, // نسبة الإشغال
//       revenue: month.revenue,
//       efficiency: (month.revenue / month.total) || 0,
//       successRate: (month.confirmed / month.total) * 100 || 0
//     }));
//   };

//   // 📈 بيانات المقارنة بين الغرف
//   const getRoomComparisonData = () => {
//     const smallRoomStats = bookings.filter(b => b.roomType === 'small' && b.status === 'confirmed');
//     const largeRoomStats = bookings.filter(b => b.roomType === 'large' && b.status === 'confirmed');

//     return [
//       {
//         subject: 'Bookings',
//         Small: smallRoomStats.length,
//         Large: largeRoomStats.length,
//         fullMark: Math.max(smallRoomStats.length, largeRoomStats.length) + 5
//       },
//       {
//         subject: 'Revenue',
//         Small: smallRoomStats.reduce((sum, b) => {
//           const hours = Math.max(1, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60 * 60));
//           return sum + (hours * 50);
//         }, 0),
//         Large: largeRoomStats.reduce((sum, b) => {
//           const hours = Math.max(1, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60 * 60));
//           return sum + (hours * 100);
//         }, 0),
//         fullMark: 10000
//       },
//       {
//         subject: 'Avg Attendees',
//         Small: smallRoomStats.length ? smallRoomStats.reduce((sum, b) => sum + b.numberOfAttendees, 0) / smallRoomStats.length : 0,
//         Large: largeRoomStats.length ? largeRoomStats.reduce((sum, b) => sum + b.numberOfAttendees, 0) / largeRoomStats.length : 0,
//         fullMark: 30
//       },
//       {
//         subject: 'Avg Duration',
//         Small: smallRoomStats.length ? smallRoomStats.reduce((sum, b) => {
//           const hours = Math.max(1, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60 * 60));
//           return sum + hours;
//         }, 0) / smallRoomStats.length : 0,
//         Large: largeRoomStats.length ? largeRoomStats.reduce((sum, b) => {
//           const hours = Math.max(1, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60 * 60));
//           return sum + hours;
//         }, 0) / largeRoomStats.length : 0,
//         fullMark: 8
//       },
//       {
//         subject: 'Utilization',
//         Small: (smallRoomStats.length / bookings.length) * 100 || 0,
//         Large: (largeRoomStats.length / bookings.length) * 100 || 0,
//         fullMark: 100
//       }
//     ];
//   };

//   // 📊 بيانات الحجوزات حسب الشركة
//   const getCompanyBookingData = () => {
//     const companyData = getTopCompanies();
//     return companyData.map(company => ({
//       name: company.name.length > 12 ? company.name.substring(0, 12) + '...' : company.name,
//       fullName: company.name,
//       bookings: company.bookings,
//       revenue: company.revenue,
//       avgAttendees: company.avgAttendees
//     }));
//   };

//   // 📈 بيانات الإيرادات اليومية
//   const getDailyRevenueData = () => {
//     const dailyData: { [key: string]: { revenue: number; bookings: number; date: string } } = {};
//     const last30Days = Array.from({ length: 30 }, (_, i) => {
//       const date = new Date();
//       date.setDate(date.getDate() - (29 - i));
//       return date.toISOString().split('T')[0];
//     });

//     last30Days.forEach(date => {
//       dailyData[date] = { revenue: 0, bookings: 0, date: date };
//     });

//     bookings.forEach(booking => {
//       if (booking.status === 'confirmed') {
//         const date = new Date(booking.startTime).toISOString().split('T')[0];
//         if (dailyData[date]) {
//           const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//           const rate = booking.roomType === 'small' ? 50 : 100;
//           dailyData[date].revenue += hours * rate;
//           dailyData[date].bookings++;
//         }
//       }
//     });

//     return Object.values(dailyData).map(day => ({
//       name: new Date(day.date).getDate().toString(),
//       revenue: day.revenue,
//       bookings: day.bookings,
//       fullDate: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
//     }));
//   };

//   // 📊 بيانات الإيرادات حسب الحالة
//   const getRevenueByStatus = () => {
//     const statusData = [
//       { name: 'Confirmed', value: 0, color: STATUS_COLORS.confirmed },
//       { name: 'Cancelled', value: 0, color: STATUS_COLORS.cancelled },
//       { name: 'Pending', value: 0, color: STATUS_COLORS.pending }
//     ];

//     bookings.forEach(booking => {
//       const hours = Math.max(1, (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60));
//       const rate = booking.roomType === 'small' ? 50 : 100;
//       const revenue = hours * rate;

//       if (booking.status === 'confirmed') {
//         statusData[0].value += revenue;
//       } else if (booking.status === 'cancelled') {
//         statusData[1].value += revenue;
//       } else {
//         statusData[2].value += revenue;
//       }
//     });

//     return statusData.filter(item => item.value > 0);
//   };

//   // 📈 بيانات النمو الشهري
//   const getGrowthData = () => {
//     const monthlyData = getMonthlyData();
//     return monthlyData.map((month, index, array) => {
//       const prevMonth = array[index - 1];
//       const growth = prevMonth ? ((month.revenue - prevMonth.revenue) / prevMonth.revenue) * 100 : 0;

//       return {
//         name: month.name,
//         revenue: month.revenue,
//         growth: Math.round(growth * 10) / 10,
//         bookings: month.total,
//         bookingsGrowth: prevMonth ? ((month.total - prevMonth.total) / prevMonth.total) * 100 : 0
//       };
//     });
//   };

//   const monthlyData = getMonthlyData();
//   const weekdayData = getWeekdayData();
//   const hourlyData = getHourlyData();
//   const attendeesData = getAttendeesData();
//   const topUsers = getTopUsers();
//   const topCompanies = getTopCompanies();
//   const durationData = getBookingDurationData();
//   const performanceData = getPerformanceData();
//   const roomComparisonData = getRoomComparisonData();
//   const companyBookingData = getCompanyBookingData();
//   const dailyRevenueData = getDailyRevenueData();
//   const revenueByStatus = getRevenueByStatus();
//   const growthData = getGrowthData();

//   // حساب الإحصائيات
//   const averageAttendees = bookings.length
//     ? (bookings.reduce((sum, b) => sum + b.numberOfAttendees, 0) / bookings.length).toFixed(1)
//     : '0';

//   const averageDuration = durationData.length
//     ? (durationData.reduce((sum, d) => sum + d.duration, 0) / durationData.length).toFixed(1)
//     : '0';

//   const totalHours = bookings.reduce((sum, b) => {
//     const hours = Math.max(1, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60 * 60));
//     return sum + hours;
//   }, 0);

//   const occupancyRate = ((totalHours / (bookings.length * 24)) * 100).toFixed(1);

//   // دالة لإنشاء بيانات تجريبية واقعية
//   function generateRealisticMockData() {
//     const mockBookings: AdminBooking[] = [];
//     const mockUsers: User[] = [];

//     const userNames = [
//       { fullName: 'John Smith', username: 'john.smith' },
//       { fullName: 'Sarah Johnson', username: 'sarah.j' },
//       { fullName: 'Mike Davis', username: 'mike.davis' },
//       { fullName: 'Emily Wilson', username: 'emily.w' },
//       { fullName: 'David Brown', username: 'david.b' },
//       { fullName: 'Lisa Anderson', username: 'lisa.a' },
//       { fullName: 'Chris Taylor', username: 'chris.t' },
//       { fullName: 'Amanda Clark', username: 'amanda.c' }
//     ];

//     userNames.forEach((user, index) => {
//       mockUsers.push({
//         id: `user${index + 1}`,
//         username: user.username,
//         fullName: user.fullName,
//         role: index === 0 ? 'admin' : 'user'
//       });
//     });

//     const companies = [
//       'Tech Corp', 'Business Solutions', 'Innovate Inc', 'Global Tech',
//       'Startup XYZ', 'Enterprise Ltd', 'Digital Solutions', 'Future Tech'
//     ];

//     const currentDate = new Date();

//     for (let i = 0; i < 120; i++) {
//       const randomMonth = Math.floor(Math.random() * 6);
//       const randomDay = Math.floor(Math.random() * 28) + 1;
//       const randomHour = Math.floor(Math.random() * 10) + 7;

//       const startTime = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonth, randomDay, randomHour);
//       const duration = 1 + Math.floor(Math.random() * 4);
//       const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);

//       const roomType = Math.random() > 0.4 ? 'small' : 'large';
//       const attendees = roomType === 'small' ?
//         Math.floor(Math.random() * 8) + 2 :
//         Math.floor(Math.random() * 15) + 10;

//       const status = Math.random() > 0.15 ? 'confirmed' : 'cancelled';

//       mockBookings.push({
//         _id: `booking${i}`,
//         startTime: startTime.toISOString(),
//         endTime: endTime.toISOString(),
//         numberOfAttendees: attendees,
//         contactPerson: {
//           name: `Contact ${i}`,
//           phone: `+1${Math.floor(Math.random() * 900000000) + 100000000}`,
//           company: companies[Math.floor(Math.random() * companies.length)]
//         },
//         user: mockUsers[Math.floor(Math.random() * mockUsers.length)],
//         status: status,
//         roomType: roomType
//       });
//     }

//     return { bookings: mockBookings, users: mockUsers };
//   }

//   if (loading) {
//     return (
//       <div className="min-h-screen bg-gray-900 flex items-center justify-center">
//         <div className="text-center">
//           <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FF6B35] mx-auto mb-4"></div>
//           <p className="text-gray-400">Loading Analytics Dashboard...</p>
//         </div>
//       </div>
//     );
//   }

//   // تنسيق الأرقام
//   const formatNumber = (num: number) => {
//     return new Intl.NumberFormat().format(num);
//   };

//   const formatCurrency = (num: number) => {
//     return new Intl.NumberFormat('en-US', {
//       style: 'currency',
//       currency: 'USD'
//     }).format(num);
//   };

//   return (
//     <div className="min-h-screen bg-gray-900 text-white p-4">
//       {/* Background Effects */}
//       <div className="fixed inset-0 bg-gradient-to-br from-[#FF6B35]/10 via-transparent to-[#FF6B35]/5 blur-3xl pointer-events-none" />

//       <div className="max-w-[2400px] mx-auto relative z-10">
//         {/* Header */}
//         <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
//           <div>
//             <h1 className="text-3xl font-bold bg-gradient-to-r from-[#FF6B35] to-orange-500 bg-clip-text text-transparent">
//               Advanced Analytics Dashboard
//             </h1>
//             <p className="text-gray-400 mt-1">Real-time booking insights and performance analytics</p>
//           </div>
//           <div className="flex flex-col sm:flex-row gap-2">
//             <select
//               value={timeRange}
//               onChange={(e) => setTimeRange(e.target.value as any)}
//               className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35] text-sm"
//             >
//               <option value="week">Last Week</option>
//               <option value="month">Last Month</option>
//               <option value="year">Last Year</option>
//             </select>
//             <button
//               onClick={loadData}
//               className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium py-2 px-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-gray-500/50 text-sm"
//             >
//               Refresh Data
//             </button>
//             <Link
//               href="/admin"
//               className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium py-2 px-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-purple-500/50 text-center text-sm"
//             >
//               Back to Admin
//             </Link>
//           </div>
//         </div>

//         {/* Tabs */}
//         <div className="flex space-x-1 mb-6 bg-gray-800 rounded-lg p-1 w-fit">
//           {['overview', 'revenue', 'users', 'rooms', 'companies'].map((tab) => (
//             <button
//               key={tab}
//               onClick={() => setActiveTab(tab)}
//               className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
//                 activeTab === tab
//                   ? 'bg-[#FF6B35] text-white shadow-lg'
//                   : 'text-gray-400 hover:text-white hover:bg-gray-700'
//               }`}
//             >
//               {tab.charAt(0).toUpperCase() + tab.slice(1)}
//             </button>
//           ))}
//         </div>

//         {/* Key Metrics */}
//         <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
//           <StatCard
//             title="Total Bookings"
//             value={formatNumber(totalBookings)}
//             color="text-[#FF6B35]"
//           />
//           <StatCard
//             title="Confirmed"
//             value={formatNumber(confirmedBookings)}
//             color="text-green-400"
//           />
//           <StatCard
//             title="Small Room"
//             value={formatNumber(smallRoomBookings)}
//             color="text-blue-400"
//           />
//           <StatCard
//             title="Large Room"
//             value={formatNumber(largeRoomBookings)}
//             color="text-purple-400"
//           />
//           <StatCard
//             title="Total Users"
//             value={formatNumber(totalUsers)}
//             color="text-cyan-400"
//           />
//           <StatCard
//             title="Cancelled"
//             value={formatNumber(cancelledBookings)}
//             color="text-red-400"
//           />
//           <StatCard
//             title="Revenue"
//             value={formatCurrency(totalRevenue)}
//             color="text-yellow-400"
//           />
//           <StatCard
//             title="Success Rate"
//             value={((confirmedBookings / totalBookings) * 100 || 0).toFixed(1) + '%'}
//             color="text-emerald-400"
//           />
//         </div>

//         {/* Overview Tab */}
//         {activeTab === 'overview' && (
//           <>
//             {/* First Row */}
//             <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
//               <ChartContainer
//                 title="Monthly Trends"
//                 className="xl:col-span-2"
//                 ref={el => chartRefs.current[0] = el}
//               >
//                 <div className="h-64">
//                   <ResponsiveContainer width="100%" height="100%">
//                     <ComposedChart data={monthlyData}>
//                       <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                       <XAxis dataKey="name" stroke="#9CA3AF" fontSize={12} />
//                       <YAxis yAxisId="left" stroke="#9CA3AF" fontSize={12} />
//                       <YAxis yAxisId="right" orientation="right" stroke="#FF6B35" fontSize={12} />
//                       <Tooltip
//                         contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                         formatter={(value: any, name: string) => {
//                           if (name === 'revenue') return [formatCurrency(value), 'Revenue'];
//                           return [value, name];
//                         }}
//                       />
//                       <Legend />
//                       <Bar yAxisId="left" dataKey="total" fill="#FF6B35" name="Bookings" radius={[2, 2, 0, 0]} />
//                       <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#4ECDC4" strokeWidth={2} name="Revenue" />
//                     </ComposedChart>
//                   </ResponsiveContainer>
//                 </div>
//               </ChartContainer>

//               <ChartContainer
//                 title="Room Performance"
//                 ref={el => chartRefs.current[1] = el}
//               >
//                 <div className="h-64">
//                   <ResponsiveContainer width="100%" height="100%">
//                     <RadarChart data={roomComparisonData}>
//                       <PolarGrid />
//                       <PolarAngleAxis dataKey="subject" stroke="#9CA3AF" fontSize={10} />
//                       <PolarRadiusAxis stroke="#9CA3AF" fontSize={10} />
//                       <Radar name="Small Room" dataKey="Small" stroke={ROOM_COLORS.small} fill={ROOM_COLORS.small} fillOpacity={0.6} />
//                       <Radar name="Large Room" dataKey="Large" stroke={ROOM_COLORS.large} fill={ROOM_COLORS.large} fillOpacity={0.6} />
//                       <Legend />
//                       <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }} />
//                     </RadarChart>
//                   </ResponsiveContainer>
//                 </div>
//               </ChartContainer>
//             </div>

//             {/* Second Row */}
//             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
//               <ChartContainer
//                 title="Weekday Distribution"
//                 ref={el => chartRefs.current[2] = el}
//               >
//                 <div className="h-56">
//                   <ResponsiveContainer width="100%" height="100%">
//                     <BarChart data={weekdayData}>
//                       <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                       <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
//                       <YAxis stroke="#9CA3AF" fontSize={11} />
//                       <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }} />
//                       <Bar dataKey="bookings" fill="#FF6B35" radius={[2, 2, 0, 0]} name="Bookings" />
//                     </BarChart>
//                   </ResponsiveContainer>
//                 </div>
//               </ChartContainer>

//               <ChartContainer
//                 title="Peak Hours"
//                 ref={el => chartRefs.current[3] = el}
//               >
//                 <div className="h-56">
//                   <ResponsiveContainer width="100%" height="100%">
//                     <LineChart data={hourlyData}>
//                       <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                       <XAxis dataKey="display" stroke="#9CA3AF" fontSize={10} />
//                       <YAxis stroke="#9CA3AF" fontSize={11} />
//                       <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }} />
//                       <Line type="monotone" dataKey="bookings" stroke="#FF6B35" strokeWidth={2} dot={false} name="Bookings" />
//                     </LineChart>
//                   </ResponsiveContainer>
//                 </div>
//               </ChartContainer>

//               <ChartContainer
//                 title="Room Distribution"
//                 ref={el => chartRefs.current[4] = el}
//               >
//                 <div className="h-56">
//                   <ResponsiveContainer width="100%" height="100%">
//                     <PieChart>
//                       <Pie
//                         data={[
//                           { name: 'Small Room', value: smallRoomBookings },
//                           { name: 'Large Room', value: largeRoomBookings }
//                         ]}
//                         cx="50%"
//                         cy="50%"
//                         innerRadius={35}
//                         outerRadius={60}
//                         paddingAngle={2}
//                         dataKey="value"
//                       >
//                         <Cell fill={ROOM_COLORS.small} />
//                         <Cell fill={ROOM_COLORS.large} />
//                       </Pie>
//                       <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }} />
//                       <Legend />
//                     </PieChart>
//                   </ResponsiveContainer>
//                 </div>
//               </ChartContainer>

//               <ChartContainer
//                 title="Daily Revenue"
//                 ref={el => chartRefs.current[5] = el}
//               >
//                 <div className="h-56">
//                   <ResponsiveContainer width="100%" height="100%">
//                     <AreaChart data={dailyRevenueData}>
//                       <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                       <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} />
//                       <YAxis stroke="#9CA3AF" fontSize={11} />
//                       <Tooltip
//                         contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                         formatter={(value: any) => [formatCurrency(value), 'Revenue']}
//                       />
//                       <Area type="monotone" dataKey="revenue" stroke="#4ECDC4" fill="#4ECDC4" fillOpacity={0.3} name="Revenue" />
//                     </AreaChart>
//                   </ResponsiveContainer>
//                 </div>
//               </ChartContainer>
//             </div>
//           </>
//         )}

//         {/* Revenue Tab */}
//         {activeTab === 'revenue' && (
//           <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
//             <ChartContainer title="Revenue Growth">
//               <div className="h-80">
//                 <ResponsiveContainer width="100%" height="100%">
//                   <ComposedChart data={growthData}>
//                     <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                     <XAxis dataKey="name" stroke="#9CA3AF" fontSize={12} />
//                     <YAxis yAxisId="left" stroke="#9CA3AF" fontSize={12} />
//                     <YAxis yAxisId="right" orientation="right" stroke="#FF6B35" fontSize={12} />
//                     <Tooltip
//                       contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                       formatter={(value: any, name: string) => {
//                         if (name === 'revenue') return [formatCurrency(value), 'Revenue'];
//                         if (name === 'growth') return [`${value}%`, 'Growth Rate'];
//                         return [value, name];
//                       }}
//                     />
//                     <Legend />
//                     <Bar yAxisId="left" dataKey="revenue" fill="#4ECDC4" name="Revenue" radius={[2, 2, 0, 0]} />
//                     <Line yAxisId="right" type="monotone" dataKey="growth" stroke="#FF6B35" strokeWidth={2} name="Growth %" />
//                   </ComposedChart>
//                 </ResponsiveContainer>
//               </div>
//             </ChartContainer>

//             <ChartContainer title="Revenue by Status">
//               <div className="h-80">
//                 <ResponsiveContainer width="100%" height="100%">
//                   <PieChart>
//                     <Pie
//                       data={revenueByStatus}
//                       cx="50%"
//                       cy="50%"
//                       innerRadius={60}
//                       outerRadius={100}
//                       paddingAngle={2}
//                       dataKey="value"
//                     >
//                       {revenueByStatus.map((entry, index) => (
//                         <Cell key={`cell-${index}`} fill={entry.color} />
//                       ))}
//                     </Pie>
//                     <Tooltip
//                       contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                       formatter={(value: any) => [formatCurrency(value), 'Revenue']}
//                     />
//                     <Legend />
//                   </PieChart>
//                 </ResponsiveContainer>
//               </div>
//             </ChartContainer>
//           </div>
//         )}

//         {/* Additional Analytics Sections */}
//         <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
//           <ChartContainer
//             title="Duration vs Attendees"
//             className="xl:col-span-2"
//             ref={el => chartRefs.current[6] = el}
//           >
//             <div className="h-64">
//               <ResponsiveContainer width="100%" height="100%">
//                 <ScatterChart data={durationData}>
//                   <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                   <XAxis type="number" dataKey="duration" name="Duration (hours)" stroke="#9CA3AF" fontSize={11} />
//                   <YAxis type="number" dataKey="attendees" name="Attendees" stroke="#9CA3AF" fontSize={11} />
//                   <Tooltip
//                     contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                     formatter={(value: any, name: string) => {
//                       if (name === 'revenue') return [formatCurrency(value), 'Revenue'];
//                       if (name === 'duration') return [`${value}h`, 'Duration'];
//                       return [value, name];
//                     }}
//                   />
//                   <Scatter name="Bookings" data={durationData} fill="#FF6B35">
//                     {durationData.map((entry, index) => (
//                       <Cell key={`cell-${index}`} fill={entry.roomType === 'small' ? ROOM_COLORS.small : ROOM_COLORS.large} />
//                     ))}
//                   </Scatter>
//                   <Legend />
//                 </ScatterChart>
//               </ResponsiveContainer>
//             </div>
//           </ChartContainer>

//           <ChartContainer
//             title="Group Size Analysis"
//             ref={el => chartRefs.current[7] = el}
//           >
//             <div className="h-64">
//               <ResponsiveContainer width="100%" height="100%">
//                 <BarChart data={attendeesData} layout="vertical">
//                   <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={true} vertical={false} />
//                   <XAxis type="number" stroke="#9CA3AF" fontSize={11} />
//                   <YAxis
//                     type="category"
//                     dataKey="range"
//                     stroke="#9CA3AF"
//                     width={45}
//                     fontSize={11}
//                   />
//                   <Tooltip
//                     contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                     formatter={(value: any, name: string) => {
//                       if (name === 'revenue') return [formatCurrency(value), 'Revenue'];
//                       return [value, 'Bookings'];
//                     }}
//                   />
//                   <Bar dataKey="count" name="Bookings" radius={[0, 2, 2, 0]}>
//                     {attendeesData.map((entry, index) => (
//                       <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
//                     ))}
//                   </Bar>
//                 </BarChart>
//               </ResponsiveContainer>
//             </div>
//           </ChartContainer>
//         </div>

//         {/* Top Performers */}
//         <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
//           <ChartContainer
//             title="Top Companies"
//             ref={el => chartRefs.current[8] = el}
//           >
//             <div className="h-72">
//               <ResponsiveContainer width="100%" height="100%">
//                 <BarChart
//                   data={companyBookingData}
//                   layout="vertical"
//                   margin={{ left: 80, right: 20 }}
//                 >
//                   <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={true} vertical={false} />
//                   <XAxis type="number" stroke="#9CA3AF" fontSize={11} />
//                   <YAxis
//                     type="category"
//                     dataKey="name"
//                     stroke="#9CA3AF"
//                     width={75}
//                     tick={{ fontSize: 11 }}
//                   />
//                   <Tooltip
//                     contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                     formatter={(value: any, name: string) => {
//                       if (name === 'revenue') return [formatCurrency(value), 'Revenue'];
//                       return [value, 'Bookings'];
//                     }}
//                   />
//                   <Bar dataKey="bookings" name="Bookings" radius={[0, 2, 2, 0]}>
//                     {companyBookingData.map((entry, index) => (
//                       <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
//                     ))}
//                   </Bar>
//                 </BarChart>
//               </ResponsiveContainer>
//             </div>
//           </ChartContainer>

//           <ChartContainer title="Top Users">
//             <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
//               {topUsers.map((userData, index) => (
//                 <div key={userData.user.id} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-[#FF6B35]/40 transition-all duration-200">
//                   <div className="flex items-center gap-2">
//                     <div className="w-6 h-6 bg-gradient-to-r from-[#FF6B35] to-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
//                       {index + 1}
//                     </div>
//                     <div>
//                       <div className="text-white font-medium text-sm">{userData.user.fullName}</div>
//                       <div className="text-gray-400 text-xs">@{userData.user.username}</div>
//                     </div>
//                   </div>
//                   <div className="text-right">
//                     <div className="text-[#FF6B35] font-bold text-sm">{userData.count} bookings</div>
//                     <div className="text-green-400 text-xs">{formatCurrency(userData.revenue)}</div>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           </ChartContainer>
//         </div>

//         {/* Performance Metrics */}
//         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
//           <ChartContainer title="Performance Metrics">
//             <div className="h-48">
//               <ResponsiveContainer width="100%" height="100%">
//                 <BarChart data={performanceData}>
//                   <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                   <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} angle={-45} textAnchor="end" height={40} />
//                   <YAxis stroke="#9CA3AF" fontSize={10} />
//                   <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }} />
//                   <Bar dataKey="occupancy" fill="#4ECDC4" name="Occupancy %" radius={[2, 2, 0, 0]} />
//                   <Bar dataKey="successRate" fill="#45B7D1" name="Success %" radius={[2, 2, 0, 0]} />
//                 </BarChart>
//               </ResponsiveContainer>
//             </div>
//           </ChartContainer>

//           <ChartContainer title="Revenue by Company">
//             <div className="h-48">
//               <ResponsiveContainer width="100%" height="100%">
//                 <BarChart data={topCompanies.slice(0, 5)}>
//                   <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
//                   <XAxis dataKey="name" stroke="#9CA3AF" fontSize={9} angle={-45} textAnchor="end" height={50} />
//                   <YAxis stroke="#9CA3AF" fontSize={10} />
//                   <Tooltip
//                     contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }}
//                     formatter={(value: any) => [formatCurrency(value), 'Revenue']}
//                   />
//                   <Bar dataKey="revenue" fill="#FF6B35" name="Revenue" radius={[2, 2, 0, 0]} />
//                 </BarChart>
//               </ResponsiveContainer>
//             </div>
//           </ChartContainer>

//           <ChartContainer title="Booking Status">
//             <div className="h-48">
//               <ResponsiveContainer width="100%" height="100%">
//                 <PieChart>
//                   <Pie
//                     data={[
//                       { name: 'Confirmed', value: confirmedBookings },
//                       { name: 'Cancelled', value: cancelledBookings },
//                       { name: 'Pending', value: pendingBookings }
//                     ]}
//                     cx="50%"
//                     cy="50%"
//                     innerRadius={30}
//                     outerRadius={50}
//                     paddingAngle={2}
//                     dataKey="value"
//                   >
//                     <Cell fill={STATUS_COLORS.confirmed} />
//                     <Cell fill={STATUS_COLORS.cancelled} />
//                     <Cell fill={STATUS_COLORS.pending} />
//                   </Pie>
//                   <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: 'white', fontSize: '12px' }} />
//                   <Legend />
//                 </PieChart>
//               </ResponsiveContainer>
//             </div>
//           </ChartContainer>

//           <ChartContainer title="Quick Stats">
//             <div className="space-y-3">
//               <div className="flex justify-between items-center">
//                 <span className="text-gray-300 text-sm">Avg Duration</span>
//                 <span className="text-white font-bold text-sm">{averageDuration}h</span>
//               </div>
//               <div className="flex justify-between items-center">
//                 <span className="text-gray-300 text-sm">Avg Attendees</span>
//                 <span className="text-white font-bold text-sm">{averageAttendees}</span>
//               </div>
//               <div className="flex justify-between items-center">
//                 <span className="text-gray-300 text-sm">Total Hours</span>
//                 <span className="text-white font-bold text-sm">{totalHours.toFixed(0)}h</span>
//               </div>
//               <div className="flex justify-between items-center">
//                 <span className="text-gray-300 text-sm">Avg Revenue/Hour</span>
//                 <span className="text-white font-bold text-sm">{formatCurrency(totalRevenue / totalHours || 0)}</span>
//               </div>
//               <div className="flex justify-between items-center">
//                 <span className="text-gray-300 text-sm">Peak Day</span>
//                 <span className="text-white font-bold text-sm">
//                   {weekdayData.reduce((max, day) => day.bookings > max.bookings ? day : max, weekdayData[0]).fullName}
//                 </span>
//               </div>
//               <div className="flex justify-between items-center">
//                 <span className="text-gray-300 text-sm">Peak Hour</span>
//                 <span className="text-white font-bold text-sm">
//                   {hourlyData.reduce((max, hour) => hour.bookings > max.bookings ? hour : max, hourlyData[0]).display}
//                 </span>
//               </div>
//             </div>
//           </ChartContainer>
//         </div>
//       </div>

//       <style jsx>{`
//         .animate-in {
//           opacity: 1 !important;
//           transform: translateY(0) !important;
//         }
//       `}</style>
//     </div>
//   );
// }

// app/analytics/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AdminBooking, User } from "../types";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  Scatter,
  ComposedChart,
} from "recharts";

// ألوان محسنة للوضع الداكن
const COLORS = [
  "#FF6B35",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
];

const STATUS_COLORS = {
  confirmed: "#10B981",
  cancelled: "#EF4444",
  pending: "#F59E0B",
};

const ROOM_COLORS = {
  small: "#3B82F6",
  large: "#8B5CF6",
};

// API service للاتصال بالباك إند
const apiService = {
  async getBookings(): Promise<AdminBooking[]> {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("/api/admin/bookings", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch bookings");
      }

      const data = await response.json();
      return data.data?.bookings || data.bookings || [];
    } catch (error) {
      console.error("Error fetching bookings:", error);
      return [];
    }
  },

  async getUsers(): Promise<User[]> {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();
      return data.data?.users || data.users || [];
    } catch (error) {
      console.error("Error fetching users:", error);
      return [];
    }
  },
};

// مكونات مساعدة
const StatCard = ({ title, value, change, color, icon }: any) => (
  <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-3 border border-gray-700 shadow-lg">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-gray-400 text-xs">{title}</p>
        <p className={`text-lg font-bold mt-1 ${color}`}>{value}</p>
        {change && (
          <p
            className={`text-xs mt-1 ${
              change > 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {change > 0 ? "↑" : "↓"} {Math.abs(change)}% from last period
          </p>
        )}
      </div>
      {icon && (
        <div className="p-1 rounded-lg bg-gray-700/50 text-sm">{icon}</div>
      )}
    </div>
  </div>
);

const ChartContainer = ({ title, children, className = "" }: any) => (
  <div
    className={`bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-3 border border-gray-700 shadow-lg ${className}`}
  >
    <h3 className="text-sm font-semibold text-[#FF6B35] mb-3">{title}</h3>
    {children}
  </div>
);

export default function AnalyticsDashboard() {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"week" | "month" | "year">(
    "month"
  );
  const [activeTab, setActiveTab] = useState("overview");
  const chartRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    loadData();

    // Animation observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in");
          }
        });
      },
      { threshold: 0.1 }
    );

    chartRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bookingsData, usersData] = await Promise.all([
        apiService.getBookings(),
        apiService.getUsers(),
      ]);

      if (bookingsData.length === 0 && usersData.length === 0) {
        const mockData = generateRealisticMockData();
        setBookings(mockData.bookings);
        setUsers(mockData.users);
      } else {
        setBookings(bookingsData);
        setUsers(usersData);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      const mockData = generateRealisticMockData();
      setBookings(mockData.bookings);
      setUsers(mockData.users);
    } finally {
      setLoading(false);
    }
  };

  // 📊 تحليل البيانات الأساسية
  const totalBookings = bookings.length;
  const totalUsers = users.length;
  const smallRoomBookings = bookings.filter(
    (b) => b.roomType === "small"
  ).length;
  const largeRoomBookings = bookings.filter(
    (b) => b.roomType === "large"
  ).length;
  const confirmedBookings = bookings.filter(
    (b) => b.status === "confirmed"
  ).length;
  const cancelledBookings = bookings.filter(
    (b) => b.status === "cancelled"
  ).length;
  const pendingBookings = bookings.filter(
    (b) => !b.status || b.status === "pending"
  ).length;

  // حساب الإيرادات
  const calculateRevenue = () => {
    const smallRoomRate = 50;
    const largeRoomRate = 100;

    return bookings
      .filter((b) => b.status === "confirmed")
      .reduce((total, booking) => {
        const start = new Date(booking.startTime);
        const end = new Date(booking.endTime);
        const hours = Math.max(
          1,
          (end.getTime() - start.getTime()) / (1000 * 60 * 60)
        );
        const rate =
          booking.roomType === "small" ? smallRoomRate : largeRoomRate;
        return total + hours * rate;
      }, 0);
  };

  const totalRevenue = calculateRevenue();

  // 📈 بيانات الشارت الشهري
  const getMonthlyData = () => {
    const monthlyData: {
      [key: string]: {
        small: number;
        large: number;
        total: number;
        revenue: number;
        confirmed: number;
        cancelled: number;
        occupancy: number;
      };
    } = {};

    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const currentYear = new Date().getFullYear();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(currentYear, new Date().getMonth() - i, 1);
      const monthName = `${months[date.getMonth()]} ${date.getFullYear()}`;
      monthlyData[monthName] = {
        small: 0,
        large: 0,
        total: 0,
        revenue: 0,
        confirmed: 0,
        cancelled: 0,
        occupancy: 0,
      };
    }

    bookings.forEach((booking) => {
      const date = new Date(booking.startTime);
      const monthName = `${months[date.getMonth()]} ${date.getFullYear()}`;

      if (monthlyData[monthName]) {
        const hours = Math.max(
          1,
          (new Date(booking.endTime).getTime() - date.getTime()) /
            (1000 * 60 * 60)
        );
        const rate = booking.roomType === "small" ? 50 : 100;
        const bookingRevenue = hours * rate;

        monthlyData[monthName][booking.roomType]++;
        monthlyData[monthName].total++;
        monthlyData[monthName].revenue += bookingRevenue;
        monthlyData[monthName].confirmed +=
          booking.status === "confirmed" ? 1 : 0;
        monthlyData[monthName].cancelled +=
          booking.status === "cancelled" ? 1 : 0;
        monthlyData[monthName].occupancy += hours / 24; // نسبة الإشغال اليومية
      }
    });

    return Object.entries(monthlyData).map(([name, data]) => ({
      name,
      ...data,
    }));
  };

  // 📊 بيانات توزيع أيام الأسبوع
  const getWeekdayData = () => {
    const weekdays = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const data = weekdays.map((day) => ({
      name: day.substring(0, 3),
      fullName: day,
      bookings: 0,
      small: 0,
      large: 0,
      revenue: 0,
      confirmed: 0,
    }));

    bookings.forEach((booking) => {
      const dayIndex = new Date(booking.startTime).getDay();
      const hours = Math.max(
        1,
        (new Date(booking.endTime).getTime() -
          new Date(booking.startTime).getTime()) /
          (1000 * 60 * 60)
      );
      const rate = booking.roomType === "small" ? 50 : 100;
      const bookingRevenue = hours * rate;

      data[dayIndex].bookings++;
      data[dayIndex][booking.roomType]++;
      data[dayIndex].revenue += bookingRevenue;
      data[dayIndex].confirmed += booking.status === "confirmed" ? 1 : 0;
    });

    return data;
  };

  // 📈 بيانات توزيع الساعات
  const getHourlyData = () => {
    const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7 AM to 8 PM
    const data = hours.map((hour) => ({
      hour,
      name: `${hour}:00`,
      bookings: 0,
      small: 0,
      large: 0,
      display:
        hour > 12 ? `${hour - 12} PM` : hour === 12 ? "12 PM" : `${hour} AM`,
      revenue: 0,
    }));

    bookings.forEach((booking) => {
      const hour = new Date(booking.startTime).getHours();
      const index = hours.indexOf(hour);
      if (index !== -1) {
        const hoursDuration = Math.max(
          1,
          (new Date(booking.endTime).getTime() -
            new Date(booking.startTime).getTime()) /
            (1000 * 60 * 60)
        );
        const rate = booking.roomType === "small" ? 50 : 100;

        data[index].bookings++;
        data[index][booking.roomType]++;
        data[index].revenue += hoursDuration * rate;
      }
    });

    return data;
  };

  // 📊 بيانات توزيع عدد الحضور
  const getAttendeesData = () => {
    const ranges = [
      { range: "1-3", min: 1, max: 3, count: 0, revenue: 0, avgDuration: 0 },
      { range: "4-6", min: 4, max: 6, count: 0, revenue: 0, avgDuration: 0 },
      { range: "7-10", min: 7, max: 10, count: 0, revenue: 0, avgDuration: 0 },
      {
        range: "11-15",
        min: 11,
        max: 15,
        count: 0,
        revenue: 0,
        avgDuration: 0,
      },
      {
        range: "16-20",
        min: 16,
        max: 20,
        count: 0,
        revenue: 0,
        avgDuration: 0,
      },
      {
        range: "21-30",
        min: 21,
        max: 30,
        count: 0,
        revenue: 0,
        avgDuration: 0,
      },
    ];

    bookings.forEach((booking) => {
      if (booking.status === "confirmed") {
        const attendees = booking.numberOfAttendees;
        const range = ranges.find(
          (r) => attendees >= r.min && attendees <= r.max
        );
        if (range) {
          const hours = Math.max(
            1,
            (new Date(booking.endTime).getTime() -
              new Date(booking.startTime).getTime()) /
              (1000 * 60 * 60)
          );
          const rate = booking.roomType === "small" ? 50 : 100;
          range.revenue += hours * rate;
          range.avgDuration += hours;
          range.count++;
        }
      }
    });

    ranges.forEach((range) => {
      if (range.count > 0) {
        range.avgDuration = range.avgDuration / range.count;
      }
    });

    return ranges.filter((r) => r.count > 0);
  };

  // 📈 بيانات المستخدمين النشطين
  const getTopUsers = () => {
    const userBookings: {
      [key: string]: {
        user: User;
        count: number;
        revenue: number;
        totalHours: number;
      };
    } = {};

    bookings.forEach((booking) => {
      if (booking.user) {
        const userId = booking.user.id;
        if (!userBookings[userId]) {
          userBookings[userId] = {
            user: booking.user,
            count: 0,
            revenue: 0,
            totalHours: 0,
          };
        }
        const hours = Math.max(
          1,
          (new Date(booking.endTime).getTime() -
            new Date(booking.startTime).getTime()) /
            (1000 * 60 * 60)
        );
        const rate = booking.roomType === "small" ? 50 : 100;
        userBookings[userId].revenue += hours * rate;
        userBookings[userId].totalHours += hours;
        userBookings[userId].count++;
      }
    });

    return Object.values(userBookings)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  };

  // 📊 بيانات الشركات
  const getTopCompanies = () => {
    const companyStats: {
      [key: string]: {
        bookings: number;
        revenue: number;
        attendees: number;
        avgAttendees: number;
        totalHours: number;
      };
    } = {};

    bookings.forEach((booking) => {
      const company = booking.contactPerson.company || "Unknown";
      if (!companyStats[company]) {
        companyStats[company] = {
          bookings: 0,
          revenue: 0,
          attendees: 0,
          avgAttendees: 0,
          totalHours: 0,
        };
      }
      const hours = Math.max(
        1,
        (new Date(booking.endTime).getTime() -
          new Date(booking.startTime).getTime()) /
          (1000 * 60 * 60)
      );
      const rate = booking.roomType === "small" ? 50 : 100;
      companyStats[company].revenue += hours * rate;
      companyStats[company].bookings++;
      companyStats[company].attendees += booking.numberOfAttendees;
      companyStats[company].totalHours += hours;
    });

    Object.keys(companyStats).forEach((company) => {
      companyStats[company].avgAttendees =
        companyStats[company].attendees / companyStats[company].bookings;
    });

    return Object.entries(companyStats)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 8);
  };

  // 📈 بيانات مدة الحجوزات
  const getBookingDurationData = () => {
    const durations = bookings
      .filter((b) => b.status === "confirmed")
      .map((booking) => {
        const hours = Math.max(
          1,
          (new Date(booking.endTime).getTime() -
            new Date(booking.startTime).getTime()) /
            (1000 * 60 * 60)
        );
        return {
          duration: Math.round(hours * 10) / 10,
          attendees: booking.numberOfAttendees,
          roomType: booking.roomType,
          revenue: hours * (booking.roomType === "small" ? 50 : 100),
          company: booking.contactPerson.company,
          hour: new Date(booking.startTime).getHours(),
        };
      });

    return durations;
  };

  // 📊 بيانات الأداء الشهري
  const getPerformanceData = () => {
    const monthly = getMonthlyData();
    return monthly.map((month) => ({
      name: month.name,
      occupancy: (month.total / 20) * 100, // نسبة الإشغال
      revenue: month.revenue,
      efficiency: month.revenue / month.total || 0,
      successRate: (month.confirmed / month.total) * 100 || 0,
    }));
  };

  // 📈 بيانات المقارنة بين الغرف
  const getRoomComparisonData = () => {
    const smallRoomStats = bookings.filter(
      (b) => b.roomType === "small" && b.status === "confirmed"
    );
    const largeRoomStats = bookings.filter(
      (b) => b.roomType === "large" && b.status === "confirmed"
    );

    return [
      {
        subject: "Bookings",
        Small: smallRoomStats.length,
        Large: largeRoomStats.length,
        fullMark: Math.max(smallRoomStats.length, largeRoomStats.length) + 5,
      },
      {
        subject: "Revenue",
        Small: smallRoomStats.reduce((sum, b) => {
          const hours = Math.max(
            1,
            (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) /
              (1000 * 60 * 60)
          );
          return sum + hours * 50;
        }, 0),
        Large: largeRoomStats.reduce((sum, b) => {
          const hours = Math.max(
            1,
            (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) /
              (1000 * 60 * 60)
          );
          return sum + hours * 100;
        }, 0),
        fullMark: 10000,
      },
      {
        subject: "Avg Attendees",
        Small: smallRoomStats.length
          ? smallRoomStats.reduce((sum, b) => sum + b.numberOfAttendees, 0) /
            smallRoomStats.length
          : 0,
        Large: largeRoomStats.length
          ? largeRoomStats.reduce((sum, b) => sum + b.numberOfAttendees, 0) /
            largeRoomStats.length
          : 0,
        fullMark: 30,
      },
      {
        subject: "Avg Duration",
        Small: smallRoomStats.length
          ? smallRoomStats.reduce((sum, b) => {
              const hours = Math.max(
                1,
                (new Date(b.endTime).getTime() -
                  new Date(b.startTime).getTime()) /
                  (1000 * 60 * 60)
              );
              return sum + hours;
            }, 0) / smallRoomStats.length
          : 0,
        Large: largeRoomStats.length
          ? largeRoomStats.reduce((sum, b) => {
              const hours = Math.max(
                1,
                (new Date(b.endTime).getTime() -
                  new Date(b.startTime).getTime()) /
                  (1000 * 60 * 60)
              );
              return sum + hours;
            }, 0) / largeRoomStats.length
          : 0,
        fullMark: 8,
      },
      {
        subject: "Utilization",
        Small: (smallRoomStats.length / bookings.length) * 100 || 0,
        Large: (largeRoomStats.length / bookings.length) * 100 || 0,
        fullMark: 100,
      },
    ];
  };

  // 📊 بيانات الحجوزات حسب الشركة
  const getCompanyBookingData = () => {
    const companyData = getTopCompanies();
    return companyData.map((company) => ({
      name:
        company.name.length > 10
          ? company.name.substring(0, 10) + "..."
          : company.name,
      fullName: company.name,
      bookings: company.bookings,
      revenue: company.revenue,
      avgAttendees: company.avgAttendees,
    }));
  };

  // 📈 بيانات الإيرادات اليومية
  const getDailyRevenueData = () => {
    const dailyData: {
      [key: string]: { revenue: number; bookings: number; date: string };
    } = {};
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split("T")[0];
    });

    last30Days.forEach((date) => {
      dailyData[date] = { revenue: 0, bookings: 0, date: date };
    });

    bookings.forEach((booking) => {
      if (booking.status === "confirmed") {
        const date = new Date(booking.startTime).toISOString().split("T")[0];
        if (dailyData[date]) {
          const hours = Math.max(
            1,
            (new Date(booking.endTime).getTime() -
              new Date(booking.startTime).getTime()) /
              (1000 * 60 * 60)
          );
          const rate = booking.roomType === "small" ? 50 : 100;
          dailyData[date].revenue += hours * rate;
          dailyData[date].bookings++;
        }
      }
    });

    return Object.values(dailyData).map((day) => ({
      name: new Date(day.date).getDate().toString(),
      revenue: day.revenue,
      bookings: day.bookings,
      fullDate: new Date(day.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));
  };

  // 📊 بيانات الإيرادات حسب الحالة
  const getRevenueByStatus = () => {
    const statusData = [
      { name: "Confirmed", value: 0, color: STATUS_COLORS.confirmed },
      { name: "Cancelled", value: 0, color: STATUS_COLORS.cancelled },
      { name: "Pending", value: 0, color: STATUS_COLORS.pending },
    ];

    bookings.forEach((booking) => {
      const hours = Math.max(
        1,
        (new Date(booking.endTime).getTime() -
          new Date(booking.startTime).getTime()) /
          (1000 * 60 * 60)
      );
      const rate = booking.roomType === "small" ? 50 : 100;
      const revenue = hours * rate;

      if (booking.status === "confirmed") {
        statusData[0].value += revenue;
      } else if (booking.status === "cancelled") {
        statusData[1].value += revenue;
      } else {
        statusData[2].value += revenue;
      }
    });

    return statusData.filter((item) => item.value > 0);
  };

  // 📈 بيانات النمو الشهري
  const getGrowthData = () => {
    const monthlyData = getMonthlyData();
    return monthlyData.map((month, index, array) => {
      const prevMonth = array[index - 1];
      const growth = prevMonth
        ? ((month.revenue - prevMonth.revenue) / prevMonth.revenue) * 100
        : 0;

      return {
        name: month.name,
        revenue: month.revenue,
        growth: Math.round(growth * 10) / 10,
        bookings: month.total,
        bookingsGrowth: prevMonth
          ? ((month.total - prevMonth.total) / prevMonth.total) * 100
          : 0,
      };
    });
  };

  const monthlyData = getMonthlyData();
  const weekdayData = getWeekdayData();
  const hourlyData = getHourlyData();
  const attendeesData = getAttendeesData();
  const topUsers = getTopUsers();
  const topCompanies = getTopCompanies();
  const durationData = getBookingDurationData();
  const performanceData = getPerformanceData();
  const roomComparisonData = getRoomComparisonData();
  const companyBookingData = getCompanyBookingData();
  const dailyRevenueData = getDailyRevenueData();
  const revenueByStatus = getRevenueByStatus();
  const growthData = getGrowthData();

  // حساب الإحصائيات
  const averageAttendees = bookings.length
    ? (
        bookings.reduce((sum, b) => sum + b.numberOfAttendees, 0) /
        bookings.length
      ).toFixed(1)
    : "0";

  const averageDuration = durationData.length
    ? (
        durationData.reduce((sum, d) => sum + d.duration, 0) /
        durationData.length
      ).toFixed(1)
    : "0";

  const totalHours = bookings.reduce((sum, b) => {
    const hours = Math.max(
      1,
      (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) /
        (1000 * 60 * 60)
    );
    return sum + hours;
  }, 0);

  const occupancyRate = ((totalHours / (bookings.length * 24)) * 100).toFixed(
    1
  );

  // دالة لإنشاء بيانات تجريبية واقعية
  function generateRealisticMockData() {
    const mockBookings: AdminBooking[] = [];
    const mockUsers: User[] = [];

    const userNames = [
      { fullName: "John Smith", username: "john.smith" },
      { fullName: "Sarah Johnson", username: "sarah.j" },
      { fullName: "Mike Davis", username: "mike.davis" },
      { fullName: "Emily Wilson", username: "emily.w" },
      { fullName: "David Brown", username: "david.b" },
      { fullName: "Lisa Anderson", username: "lisa.a" },
      { fullName: "Chris Taylor", username: "chris.t" },
      { fullName: "Amanda Clark", username: "amanda.c" },
    ];

    userNames.forEach((user, index) => {
      mockUsers.push({
        id: `user${index + 1}`,
        username: user.username,
        fullName: user.fullName,
        role: index === 0 ? "admin" : "user",
      });
    });

    const companies = [
      "Tech Corp",
      "Business Solutions",
      "Innovate Inc",
      "Global Tech",
      "Startup XYZ",
      "Enterprise Ltd",
      "Digital Solutions",
      "Future Tech",
    ];

    const currentDate = new Date();

    for (let i = 0; i < 120; i++) {
      const randomMonth = Math.floor(Math.random() * 6);
      const randomDay = Math.floor(Math.random() * 28) + 1;
      const randomHour = Math.floor(Math.random() * 10) + 7;

      const startTime = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - randomMonth,
        randomDay,
        randomHour
      );
      const duration = 1 + Math.floor(Math.random() * 4);
      const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);

      const roomType = Math.random() > 0.4 ? "small" : "large";
      const attendees =
        roomType === "small"
          ? Math.floor(Math.random() * 8) + 2
          : Math.floor(Math.random() * 15) + 10;

      const status = Math.random() > 0.15 ? "confirmed" : "cancelled";

      mockBookings.push({
        _id: `booking${i}`,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        numberOfAttendees: attendees,
        contactPerson: {
          name: `Contact ${i}`,
          phone: `+1${Math.floor(Math.random() * 900000000) + 100000000}`,
          company: companies[Math.floor(Math.random() * companies.length)],
        },
        user: mockUsers[Math.floor(Math.random() * mockUsers.length)],
        status: status,
        roomType: roomType,
      });
    }

    return { bookings: mockBookings, users: mockUsers };
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF6B35] mx-auto mb-2"></div>
          <p className="text-gray-400 text-sm">
            Loading Analytics Dashboard...
          </p>
        </div>
      </div>
    );
  }

  // تنسيق الأرقام
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-3">
      {/* Background Effects */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#FF6B35]/10 via-transparent to-[#FF6B35]/5 blur-3xl pointer-events-none" />

      <div className="max-w-[2400px] mx-auto relative z-10">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#FF6B35] to-orange-500 bg-clip-text text-transparent">
              Analytics Dashboard
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Real-time booking insights and performance analytics
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as any)}
              className="bg-gray-800 border border-gray-700 text-white px-3 py-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35] text-sm"
            >
              <option value="week">Last Week</option>
              <option value="month">Last Month</option>
              <option value="year">Last Year</option>
            </select>
            <button
              onClick={loadData}
              className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium py-1 px-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-gray-500/50 text-sm"
            >
              Refresh Data
            </button>
            <Link
              href="/admin"
              className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium py-1 px-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-purple-500/50 text-center text-sm"
            >
              Back to Admin
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-4 bg-gray-800 rounded-lg p-1 w-fit">
          {["overview", "revenue", "users", "rooms", "companies"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === tab
                  ? "bg-[#FF6B35] text-white shadow-lg"
                  : "text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
          <StatCard
            title="Total Bookings"
            value={formatNumber(totalBookings)}
            color="text-[#FF6B35]"
          />
          <StatCard
            title="Confirmed"
            value={formatNumber(confirmedBookings)}
            color="text-green-400"
          />
          <StatCard
            title="Small Room"
            value={formatNumber(smallRoomBookings)}
            color="text-blue-400"
          />
          <StatCard
            title="Large Room"
            value={formatNumber(largeRoomBookings)}
            color="text-purple-400"
          />
          <StatCard
            title="Total Users"
            value={formatNumber(totalUsers)}
            color="text-cyan-400"
          />
          <StatCard
            title="Cancelled"
            value={formatNumber(cancelledBookings)}
            color="text-red-400"
          />
          <StatCard
            title="Revenue"
            value={formatCurrency(totalRevenue)}
            color="text-yellow-400"
          />
          <StatCard
            title="Success Rate"
            value={
              ((confirmedBookings / totalBookings) * 100 || 0).toFixed(1) + "%"
            }
            color="text-emerald-400"
          />
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <>
            {/* First Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              <ChartContainer title="Weekday Distribution">
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekdayData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} />
                      <YAxis stroke="#9CA3AF" fontSize={10} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          borderColor: "#374151",
                          color: "white",
                          fontSize: "11px",
                        }}
                      />
                      <Bar
                        dataKey="bookings"
                        fill="#FF6B35"
                        radius={[2, 2, 0, 0]}
                        name="Bookings"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>

              <ChartContainer title="Peak Hours">
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hourlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="display" stroke="#9CA3AF" fontSize={9} />
                      <YAxis stroke="#9CA3AF" fontSize={10} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          borderColor: "#374151",
                          color: "white",
                          fontSize: "11px",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="bookings"
                        stroke="#FF6B35"
                        strokeWidth={2}
                        dot={false}
                        name="Bookings"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>

              <ChartContainer title="Room Distribution">
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Small Room", value: smallRoomBookings },
                          { name: "Large Room", value: largeRoomBookings },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={25}
                        outerRadius={45}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        <Cell fill={ROOM_COLORS.small} />
                        <Cell fill={ROOM_COLORS.large} />
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          borderColor: "#374151",
                          color: "white",
                          fontSize: "11px",
                        }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>

              <ChartContainer title="Daily Revenue">
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyRevenueData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={9} />
                      <YAxis stroke="#9CA3AF" fontSize={10} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          borderColor: "#374151",
                          color: "white",
                          fontSize: "11px",
                        }}
                        formatter={(value: any) => [
                          formatCurrency(value),
                          "Revenue",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#4ECDC4"
                        fill="#4ECDC4"
                        fillOpacity={0.3}
                        name="Revenue"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>
            </div>

            {/* Second Row */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
              <ChartContainer title="Monthly Trends" className="xl:col-span-2">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} />
                      <YAxis yAxisId="left" stroke="#9CA3AF" fontSize={10} />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#FF6B35"
                        fontSize={10}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          borderColor: "#374151",
                          color: "white",
                          fontSize: "11px",
                        }}
                        formatter={(value: any, name: string) => {
                          if (name === "revenue")
                            return [formatCurrency(value), "Revenue"];
                          return [value, name];
                        }}
                      />
                      <Legend />
                      <Bar
                        yAxisId="left"
                        dataKey="total"
                        fill="#FF6B35"
                        name="Bookings"
                        radius={[2, 2, 0, 0]}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="revenue"
                        stroke="#4ECDC4"
                        strokeWidth={2}
                        name="Revenue"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>

              <ChartContainer title="Room Performance">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={roomComparisonData}>
                      <PolarGrid />
                      <PolarAngleAxis
                        dataKey="subject"
                        stroke="#9CA3AF"
                        fontSize={9}
                      />
                      <PolarRadiusAxis stroke="#9CA3AF" fontSize={9} />
                      <Radar
                        name="Small Room"
                        dataKey="Small"
                        stroke={ROOM_COLORS.small}
                        fill={ROOM_COLORS.small}
                        fillOpacity={0.6}
                      />
                      <Radar
                        name="Large Room"
                        dataKey="Large"
                        stroke={ROOM_COLORS.large}
                        fill={ROOM_COLORS.large}
                        fillOpacity={0.6}
                      />
                      <Legend />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          borderColor: "#374151",
                          color: "white",
                          fontSize: "11px",
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>
            </div>
          </>
        )}

        {/* Revenue Tab */}
        {activeTab === "revenue" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <ChartContainer title="Revenue Growth">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={growthData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                    <YAxis yAxisId="left" stroke="#9CA3AF" fontSize={11} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#FF6B35"
                      fontSize={11}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1F2937",
                        borderColor: "#374151",
                        color: "white",
                        fontSize: "11px",
                      }}
                      formatter={(value: any, name: string) => {
                        if (name === "revenue")
                          return [formatCurrency(value), "Revenue"];
                        if (name === "growth")
                          return [`${value}%`, "Growth Rate"];
                        return [value, name];
                      }}
                    />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="revenue"
                      fill="#4ECDC4"
                      name="Revenue"
                      radius={[2, 2, 0, 0]}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="growth"
                      stroke="#FF6B35"
                      strokeWidth={2}
                      name="Growth %"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartContainer>

            <ChartContainer title="Revenue by Status">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={revenueByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {revenueByStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1F2937",
                        borderColor: "#374151",
                        color: "white",
                        fontSize: "11px",
                      }}
                      formatter={(value: any) => [
                        formatCurrency(value),
                        "Revenue",
                      ]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </ChartContainer>
          </div>
        )}

        {/* Additional Analytics Sections */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
          <ChartContainer
            title="Duration vs Attendees"
            className="xl:col-span-2"
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart data={durationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    type="number"
                    dataKey="duration"
                    name="Duration (hours)"
                    stroke="#9CA3AF"
                    fontSize={10}
                  />
                  <YAxis
                    type="number"
                    dataKey="attendees"
                    name="Attendees"
                    stroke="#9CA3AF"
                    fontSize={10}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      borderColor: "#374151",
                      color: "white",
                      fontSize: "11px",
                    }}
                    formatter={(value: any, name: string) => {
                      if (name === "revenue")
                        return [formatCurrency(value), "Revenue"];
                      if (name === "duration") return [`${value}h`, "Duration"];
                      return [value, name];
                    }}
                  />
                  <Scatter name="Bookings" data={durationData} fill="#FF6B35">
                    {durationData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.roomType === "small"
                            ? ROOM_COLORS.small
                            : ROOM_COLORS.large
                        }
                      />
                    ))}
                  </Scatter>
                  <Legend />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>

          <ChartContainer title="Group Size Analysis">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendeesData} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#374151"
                    horizontal={true}
                    vertical={false}
                  />
                  <XAxis type="number" stroke="#9CA3AF" fontSize={10} />
                  <YAxis
                    type="category"
                    dataKey="range"
                    stroke="#9CA3AF"
                    width={40}
                    fontSize={10}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      borderColor: "#374151",
                      color: "white",
                      fontSize: "11px",
                    }}
                    formatter={(value: any, name: string) => {
                      if (name === "revenue")
                        return [formatCurrency(value), "Revenue"];
                      return [value, "Bookings"];
                    }}
                  />
                  <Bar dataKey="count" name="Bookings" radius={[0, 2, 2, 0]}>
                    {attendeesData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>
        </div>

        {/* Top Performers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          <ChartContainer title="Top Companies">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={companyBookingData}
                  layout="vertical"
                  margin={{ left: 70, right: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#374151"
                    horizontal={true}
                    vertical={false}
                  />
                  <XAxis type="number" stroke="#9CA3AF" fontSize={10} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#9CA3AF"
                    width={65}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      borderColor: "#374151",
                      color: "white",
                      fontSize: "11px",
                    }}
                    formatter={(value: any, name: string) => {
                      if (name === "revenue")
                        return [formatCurrency(value), "Revenue"];
                      return [value, "Bookings"];
                    }}
                  />
                  <Bar dataKey="bookings" name="Bookings" radius={[0, 2, 2, 0]}>
                    {companyBookingData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>

          <ChartContainer title="Top Users">
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {topUsers.map((userData, index) => (
                <div
                  key={userData.user.id}
                  className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-[#FF6B35]/40 transition-all duration-200"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gradient-to-r from-[#FF6B35] to-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {index + 1}
                    </div>
                    <div>
                      <div className="text-white font-medium text-sm">
                        {userData.user.fullName}
                      </div>
                      <div className="text-gray-400 text-xs">
                        @{userData.user.username}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#FF6B35] font-bold text-sm">
                      {userData.count} bookings
                    </div>
                    <div className="text-green-400 text-xs">
                      {formatCurrency(userData.revenue)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ChartContainer>
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <ChartContainer title="Performance Metrics">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="name"
                    stroke="#9CA3AF"
                    fontSize={9}
                    angle={-45}
                    textAnchor="end"
                    height={35}
                  />
                  <YAxis stroke="#9CA3AF" fontSize={9} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      borderColor: "#374151",
                      color: "white",
                      fontSize: "11px",
                    }}
                  />
                  <Bar
                    dataKey="occupancy"
                    fill="#4ECDC4"
                    name="Occupancy %"
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="successRate"
                    fill="#45B7D1"
                    name="Success %"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>

          <ChartContainer title="Revenue by Company">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCompanies.slice(0, 5)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="name"
                    stroke="#9CA3AF"
                    fontSize={9}
                    angle={-45}
                    textAnchor="end"
                    height={40}
                  />
                  <YAxis stroke="#9CA3AF" fontSize={9} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      borderColor: "#374151",
                      color: "white",
                      fontSize: "11px",
                    }}
                    formatter={(value: any) => [
                      formatCurrency(value),
                      "Revenue",
                    ]}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#FF6B35"
                    name="Revenue"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>

          <ChartContainer title="Booking Status">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Confirmed", value: confirmedBookings },
                      { name: "Cancelled", value: cancelledBookings },
                      { name: "Pending", value: pendingBookings },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={40}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill={STATUS_COLORS.confirmed} />
                    <Cell fill={STATUS_COLORS.cancelled} />
                    <Cell fill={STATUS_COLORS.pending} />
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      borderColor: "#374151",
                      color: "white",
                      fontSize: "11px",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartContainer>

          <ChartContainer title="Quick Stats">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Avg Duration</span>
                <span className="text-white font-bold">{averageDuration}h</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Avg Attendees</span>
                <span className="text-white font-bold">{averageAttendees}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Total Hours</span>
                <span className="text-white font-bold">
                  {totalHours.toFixed(0)}h
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Avg Revenue/Hour</span>
                <span className="text-white font-bold">
                  {formatCurrency(totalRevenue / totalHours || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Peak Day</span>
                <span className="text-white font-bold">
                  {
                    weekdayData.reduce(
                      (max, day) => (day.bookings > max.bookings ? day : max),
                      weekdayData[0]
                    ).fullName
                  }
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Peak Hour</span>
                <span className="text-white font-bold">
                  {
                    hourlyData.reduce(
                      (max, hour) =>
                        hour.bookings > max.bookings ? hour : max,
                      hourlyData[0]
                    ).display
                  }
                </span>
              </div>
            </div>
          </ChartContainer>
        </div>
      </div>

      <style jsx>{`
        .animate-in {
          opacity: 1 !important;
          transform: translateY(0) !important;
        }
      `}</style>
    </div>
  );
} 
