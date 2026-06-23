'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { CalendarCheck, Plus, Check, X, RefreshCw } from 'lucide-react';
import { isRemoteStaff, LEAVE_TYPES, leaveTypeLabel, STATUS_STYLES, cairoToday } from '@/lib/remote';
import { getRemoteLeaveTranslations } from '@/lib/translations';

interface Leave {
  _id: string;
  user?: { _id: string; firstName: string; lastName: string };
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: { firstName: string; lastName: string };
  reviewNote?: string;
  createdAt: string;
}
interface EmployeeOpt { _id: string; firstName: string; lastName: string }

export default function RemoteLeavePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getRemoteLeaveTranslations(lang);
  const staff = isRemoteStaff(user?.role);

  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [userId, setUserId] = useState('');

  // request form
  const [type, setType] = useState('annual');
  const [startDate, setStartDate] = useState(cairoToday());
  const [endDate, setEndDate] = useState(cairoToday());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (userId) qs.set('userId', userId);
      const data = await api.get<{ leaves: Leave[] }>(`/api/remote/leave?${qs.toString()}`);
      setLeaves(data.leaves || []);
    } catch {} finally { setLoading(false); }
  }, [statusFilter, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (staff) api.get<{ employees: EmployeeOpt[] }>('/api/remote/employees').then((d) => setEmployees(d.employees || [])).catch(() => {});
  }, [staff]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (endDate < startDate) { setErr(tx.endBeforeStart); return; }
    setSubmitting(true);
    try {
      await api.post('/api/remote/leave', { type, startDate, endDate, reason });
      setShowForm(false);
      setReason('');
      load();
    } catch (e: any) { setErr(e.message || tx.failed); } finally { setSubmitting(false); }
  };

  const review = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/api/remote/leave/${id}`, { status });
    } catch {}
    load();
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><CalendarCheck className="w-6 h-6 text-[#f37121]" />{tx.pageTitle}</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title={tx.refresh}><RefreshCw className="w-4 h-4" /></button>
          {!staff && (
            <button type="button" onClick={() => { setShowForm(true); setErr(''); }} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium">
              <Plus className="w-4 h-4" />{tx.requestLeave}
            </button>
          )}
        </div>
      </div>

      {/* Filters (staff) */}
      {staff && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 shadow-sm">
          <div>
            <label className="block text-slate-500 text-xs mb-1">{tx.employee}</label>
            <select aria-label={tx.employee} value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
              <option value="">{tx.all}</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 text-xs mb-1">{tx.status}</label>
            <select aria-label={tx.status} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
              <option value="">{tx.all}</option>
              <option value="pending">{STATUS_STYLES.pending[ar ? 'ar' : 'en']}</option>
              <option value="approved">{STATUS_STYLES.approved[ar ? 'ar' : 'en']}</option>
              <option value="rejected">{STATUS_STYLES.rejected[ar ? 'ar' : 'en']}</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : leaves.length === 0 ? (
        <p className="text-slate-500 text-center py-10">{tx.noRequests}</p>
      ) : (
        <div className="space-y-3">
          {leaves.map((l) => {
            const s = STATUS_STYLES[l.status];
            return (
              <div key={l._id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {staff && l.user && <span className="text-slate-900 font-medium">{l.user.firstName} {l.user.lastName}</span>}
                    <span className="text-slate-700 text-sm">{leaveTypeLabel(l.type, ar ? 'ar' : 'en')}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${s.bg} ${s.text}`}>{s[ar ? 'ar' : 'en']}</span>
                  </div>
                  <p className="text-slate-500 text-sm">{l.startDate} → {l.endDate} · {l.days} {tx.days}</p>
                  {l.reason && <p className="text-slate-500 text-sm">{l.reason}</p>}
                  {l.status !== 'pending' && l.reviewedBy && (
                    <p className="text-slate-500 text-xs">{tx.by} {l.reviewedBy.firstName} {l.reviewedBy.lastName}</p>
                  )}
                </div>
                {staff && l.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => review(l._id, 'approved')} className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm"><Check className="w-4 h-4" />{tx.approve}</button>
                    <button type="button" onClick={() => review(l._id, 'rejected')} className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm"><X className="w-4 h-4" />{tx.reject}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Request modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowForm(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{tx.requestLeave}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-900" title={tx.close}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{err}</div>}
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{tx.leaveType}</label>
                <select aria-label={tx.leaveType} value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                  {LEAVE_TYPES.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 text-sm mb-1.5">{tx.from}</label>
                  <input aria-label={tx.from} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" required />
                </div>
                <div>
                  <label className="block text-slate-700 text-sm mb-1.5">{tx.to}</label>
                  <input aria-label={tx.to} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" required />
                </div>
              </div>
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{tx.reasonOptional}</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" placeholder={tx.reasonPlaceholder} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                  {submitting && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {tx.submit}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
