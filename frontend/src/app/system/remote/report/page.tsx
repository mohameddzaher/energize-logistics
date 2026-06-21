'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { FileText, Send, RefreshCw } from 'lucide-react';
import { isRemoteStaff } from '@/lib/remote';

interface Report {
  _id: string;
  user?: { _id: string; firstName: string; lastName: string };
  date: string;
  body: string;
  createdAt: string;
}
interface EmployeeOpt { _id: string; firstName: string; lastName: string }

export default function RemoteReportPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = isRemoteStaff(user?.role);

  if (staff) return <StaffReports ar={ar} isRTL={isRTL} />;
  return <EmployeeReport ar={ar} isRTL={isRTL} />;
}

function EmployeeReport({ ar, isRTL }: { ar: boolean; isRTL: boolean }) {
  const [body, setBody] = useState('');
  const [today, setToday] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, list] = await Promise.all([
        api.get<{ report: Report | null; today: string }>('/api/remote/reports/today'),
        api.get<{ reports: Report[] }>('/api/remote/reports'),
      ]);
      setToday(t.today);
      if (t.report) setBody(t.report.body);
      setReports(list.reports || []);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    setSavedMsg('');
    try {
      await api.post('/api/remote/reports', { body });
      setSavedMsg(ar ? 'تم حفظ تقريرك ✓' : 'Report saved ✓');
      load();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileText className="w-6 h-6 text-[#f37121]" />{ar ? 'التقرير اليومي' : 'Daily Report'}</h1>
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
        <p className="text-slate-500 text-sm">{ar ? `تقرير اليوم (${today})` : `Today's report (${today})`}</p>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder={ar ? 'اكتب ماذا عملت اليوم...' : 'Write what you did today...'} className="w-full px-3 py-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        <div className="flex items-center justify-between">
          {savedMsg ? <span className="text-green-600 text-sm">{savedMsg}</span> : <span />}
          <button type="submit" disabled={saving || !body.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
            {ar ? 'حفظ / إرسال' : 'Save / Submit'}
          </button>
        </div>
      </form>

      <div>
        <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-2">{ar ? 'تقاريري السابقة' : 'My Previous Reports'}</h2>
        {loading ? (
          <div className="flex items-center justify-center h-24"><div className="w-7 h-7 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
        ) : reports.length === 0 ? (
          <p className="text-slate-500 text-sm py-4">{ar ? 'لا توجد تقارير بعد' : 'No reports yet'}</p>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <p className="text-slate-500 text-xs mb-1">{r.date}</p>
                <p className="text-slate-800 text-sm whitespace-pre-wrap">{r.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StaffReports({ ar, isRTL }: { ar: boolean; isRTL: boolean }) {
  const [reports, setReports] = useState<Report[]>([]);
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
      const data = await api.get<{ reports: Report[] }>(`/api/remote/reports?${qs.toString()}`);
      setReports(data.reports || []);
    } catch {} finally { setLoading(false); }
  }, [userId, from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ employees: EmployeeOpt[] }>('/api/remote/employees').then((d) => setEmployees(d.employees || [])).catch(() => {}); }, []);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileText className="w-6 h-6 text-[#f37121]" />{ar ? 'تقارير الفريق اليومية' : 'Team Daily Reports'}</h1>
        <button type="button" onClick={load} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>
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
          <input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
        </div>
        <div>
          <label className="block text-slate-500 text-xs mb-1">{ar ? 'إلى' : 'To'}</label>
          <input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" />
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : reports.length === 0 ? (
        <p className="text-slate-500 text-center py-10">{ar ? 'لا توجد تقارير' : 'No reports'}</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-900 font-medium text-sm">{r.user ? `${r.user.firstName} ${r.user.lastName}` : '—'}</span>
                <span className="text-slate-500 text-xs">{r.date}</span>
              </div>
              <p className="text-slate-800 text-sm whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
