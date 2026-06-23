'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { Megaphone, Plus, X, Trash2, RefreshCw } from 'lucide-react';
import { isRemoteStaff, fmtDateTime } from '@/lib/remote';
import { getRemoteAnnouncementsTranslations } from '@/lib/translations';

interface Announcement {
  _id: string;
  author?: { firstName: string; lastName: string; role: string };
  title: string;
  body: string;
  createdAt: string;
}

export default function RemoteAnnouncementsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getRemoteAnnouncementsTranslations(lang);
  const staff = isRemoteStaff(user?.role);

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ announcements: Announcement[] }>('/api/remote/announcements');
      setItems(data.announcements || []);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!title.trim() || !body.trim()) { setErr(tx.titleBodyRequired); return; }
    setSubmitting(true);
    try {
      await api.post('/api/remote/announcements', { title, body });
      setShowForm(false); setTitle(''); setBody('');
      load();
    } catch (e: any) { setErr(e.message || tx.failed); } finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((x) => x._id !== id));
    try { await api.delete(`/api/remote/announcements/${id}`); } catch { load(); }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Megaphone className="w-6 h-6 text-[#f37121]" />{tx.announcements}</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title={tx.refresh}><RefreshCw className="w-4 h-4" /></button>
          {staff && (
            <button type="button" onClick={() => { setShowForm(true); setErr(''); }} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" />{tx.newAnnouncement}</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-slate-500 text-center py-10">{tx.noAnnouncements}</p>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a._id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{a.title}</h3>
                  <p className="text-slate-700 text-sm mt-1 whitespace-pre-wrap">{a.body}</p>
                  <p className="text-slate-500 text-xs mt-2">
                    {a.author ? `${a.author.firstName} ${a.author.lastName} · ` : ''}{fmtDateTime(a.createdAt)}
                  </p>
                </div>
                {staff && (
                  <button type="button" onClick={() => remove(a._id)} className="text-slate-500 hover:text-red-600 p-1 shrink-0" title={tx.delete}><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowForm(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{tx.newAnnouncement}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-900" title={tx.close}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{err}</div>}
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{tx.title}</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" required />
              </div>
              <div>
                <label className="block text-slate-700 text-sm mb-1.5">{tx.body}</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm" required />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                  {submitting && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {tx.publish}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
