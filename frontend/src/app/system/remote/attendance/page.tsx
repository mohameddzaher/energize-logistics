'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { Clock, LogIn, LogOut, CheckCircle2, RefreshCw } from 'lucide-react';
import { isRemoteStaff, fmtDuration, fmtTime } from '@/lib/remote';

interface AttRecord {
  _id: string;
  user?: { _id: string; firstName: string; lastName: string; email: string };
  date: string;
  checkIn?: string;
  checkOut?: string;
  durationMinutes: number;
  status: 'present' | 'incomplete';
}
interface EmployeeOpt { _id: string; firstName: string; lastName: string }

export default function RemoteAttendancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = isRemoteStaff(user?.role);

  if (staff) return <StaffAttendance ar={ar} isRTL={isRTL} />;
  return <EmployeeAttendance ar={ar} />;
}

// ── Employee: one big button ────────────────────────────────────────────────
function EmployeeAttendance({ ar }: { ar: boolean }) {
  const [record, setRecord] = useState<AttRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ record: AttRecord | null }>('/api/remote/attendance/today');
      setRecord(data.record);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    setBusy(true);
    try {
      const data = await api.post<{ record: AttRecord }>('/api/remote/attendance/toggle');
      setRecord(data.record);
    } catch {} finally { setBusy(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const notStarted = !record;
  const checkedIn = record && record.checkIn && !record.checkOut;
  const done = record && record.checkIn && record.checkOut;

  return (
    <div className="max-w-xl mx-auto space-y-8 py-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-900">{ar ? 'الحضور والانصراف' : 'Attendance'}</h1>
        <p className="text-slate-500 mt-1 text-lg">{new Date().toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* The big button */}
      {notStarted && (
        <BigButton color="green" onClick={toggle} busy={busy} icon={<LogIn className="w-14 h-14" />} label={ar ? 'تسجيل الحضور' : 'Check In'} />
      )}
      {checkedIn && (
        <div className="space-y-5">
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 text-center">
            <p className="text-green-600 text-lg font-medium">{ar ? 'أنت حاضر الآن' : 'You are checked in'}</p>
            <p className="text-slate-900 text-4xl font-bold mt-1">{fmtTime(record!.checkIn)}</p>
          </div>
          <BigButton color="red" onClick={toggle} busy={busy} icon={<LogOut className="w-14 h-14" />} label={ar ? 'تسجيل الانصراف' : 'Check Out'} />
        </div>
      )}
      {done && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto" />
          <p className="text-slate-900 text-2xl font-bold">{ar ? 'تم تسجيل يومك بالكامل' : 'Your day is recorded'}</p>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <Stat label={ar ? 'الحضور' : 'In'} value={fmtTime(record!.checkIn)} />
            <Stat label={ar ? 'الانصراف' : 'Out'} value={fmtTime(record!.checkOut)} />
            <Stat label={ar ? 'المدة' : 'Hours'} value={fmtDuration(record!.durationMinutes, ar ? 'ar' : 'en')} />
          </div>
        </div>
      )}
    </div>
  );
}

function BigButton({ color, onClick, busy, icon, label }: { color: 'green' | 'red'; onClick: () => void; busy: boolean; icon: React.ReactNode; label: string }) {
  const styles = color === 'green'
    ? 'bg-green-600 hover:bg-green-500 active:bg-green-700'
    : 'bg-red-600 hover:bg-red-500 active:bg-red-700';
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={busy}
      className={`w-full ${styles} disabled:opacity-60 text-white rounded-3xl py-14 flex flex-col items-center justify-center gap-4 shadow-2xl transition-colors`}
    >
      {busy ? <div className="w-14 h-14 border-4 border-white/40 border-t-white rounded-full animate-spin" /> : icon}
      <span className="text-3xl font-bold">{label}</span>
    </motion.button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-slate-900 text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

// ── Staff: monitor everyone's attendance ────────────────────────────────────
function StaffAttendance({ ar, isRTL }: { ar: boolean; isRTL: boolean }) {
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (userId) qs.set('userId', userId);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const data = await api.get<{ records: AttRecord[] }>(`/api/remote/attendance?${qs.toString()}`);
      setRecords(data.records || []);
    } catch {} finally { setLoading(false); }
  }, [userId, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<{ employees: EmployeeOpt[] }>('/api/remote/employees').then((d) => setEmployees(d.employees || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Clock className="w-6 h-6 text-[#f37121]" />{ar ? 'سجل حضور الفريق' : 'Team Attendance'}</h1>
        <button type="button" onClick={load} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 shadow-sm">
        <div>
          <label className="block text-slate-500 text-xs mb-1">{ar ? 'الموظف' : 'Employee'}</label>
          <select aria-label="Employee" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
            <option value="">{ar ? 'الكل' : 'All'}</option>
            {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-500 text-xs mb-1">{ar ? 'من' : 'From'}</label>
          <input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
        </div>
        <div>
          <label className="block text-slate-500 text-xs mb-1">{ar ? 'إلى' : 'To'}</label>
          <input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <p className="text-slate-500 text-center py-10">{ar ? 'لا توجد سجلات' : 'No records found'}</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs uppercase">
              <tr>
                <th className="text-start px-4 py-3">{ar ? 'الموظف' : 'Employee'}</th>
                <th className="text-start px-4 py-3">{ar ? 'اليوم' : 'Date'}</th>
                <th className="text-start px-4 py-3">{ar ? 'الحضور' : 'In'}</th>
                <th className="text-start px-4 py-3">{ar ? 'الانصراف' : 'Out'}</th>
                <th className="text-start px-4 py-3">{ar ? 'المدة' : 'Hours'}</th>
                <th className="text-start px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r._id} className="border-t border-slate-200/70">
                  <td className="px-4 py-3 text-slate-900">{r.user ? `${r.user.firstName} ${r.user.lastName}` : '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{r.date}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtTime(r.checkIn)}</td>
                  <td className="px-4 py-3 text-slate-700">{r.checkOut ? fmtTime(r.checkOut) : '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtDuration(r.durationMinutes, ar ? 'ar' : 'en')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${r.status === 'present' ? 'bg-green-500/20 text-green-600' : 'bg-amber-500/20 text-amber-700'}`}>
                      {r.status === 'present' ? (ar ? 'مكتمل' : 'Complete') : (ar ? 'لم ينصرف' : 'Open')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
