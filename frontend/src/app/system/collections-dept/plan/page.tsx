'use client';
/**
 * الخطّةُ اليوميّة — «مَن أزور اليوم، وماذا حدث».
 *
 * ── لماذا صفٌّ ليومٍ وعميل ─────────────────────────────────────────────────
 * في ورقتهم عمودٌ لكلّ يومٍ تحت كلّ عميل. والوحدةُ الحقيقيّة (عميلٌ × يوم):
 * يكتب المديرُ خطّةَ الغد لموظّفيه، أو يكتب الموظّفُ خطّتَه بنفسه، فيأتي الصباحُ
 * ويعرف كلٌّ ما أمامه بلا سؤال. وبعد الفعل يُكتب ما حدث وكم حُصِّل — وهو الأثرُ
 * الذي يُقرأ في التقييم وفي ملفّ العميل.
 */
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { canEditCollections, money, type CollectionTask } from '@/lib/collections';
import { Loader2, Plus, Check, Trash2, CalendarDays, X } from 'lucide-react';

const REQUEST_TYPES = ['Visit', 'Office', 'Call', 'Email', 'Delivery'];
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);

export default function CollectionsPlanPage() {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const ar = lang === 'ar';
  const canEdit = canEditCollections(user);

  const [rows, setRows] = useState<CollectionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(addDays(today(), -7));
  const [to, setTo] = useState(addDays(today(), 7));
  const [officer, setOfficer] = useState('');
  const [officers, setOfficers] = useState<string[]>([]);
  const [collected, setCollected] = useState(0);

  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [form, setForm] = useState({ party: '', partyName: '', date: today(), requestType: 'Visit', officerName: '', action: '' });
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const p = new URLSearchParams();
      if (from) p.append('from', from);
      if (to) p.append('to', to);
      if (officer) p.append('officer', officer);
      p.append('limit', '500');
      const d = await api.get<any>(`/api/collections-dept/ledger/tasks?${p.toString()}`);
      setRows(d.rows || []); setCollected(d.collected || 0);
    } catch { /* keep */ } finally { setBusy(false); setLoading(false); }
  }, [from, to, officer]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<any>('/api/collections-dept/ledger/team').then((d) => setOfficers((d.officers || []).map((o: any) => o.officer).filter(Boolean))).catch(() => {}); }, []);

  // البحثُ عن العميل عند الإضافة — يُمهَل حتى يتوقّف الكتابة.
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const d = await api.get<any>(`/api/collections-dept/ledger/aging?search=${encodeURIComponent(q)}&limit=8`);
        setHits(d.rows || []);
      } catch { setHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const save = async () => {
    if (!form.party || !form.date) return;
    setErr('');
    try {
      await api.post('/api/collections-dept/ledger/tasks', form);
      setAdding(false); setForm({ party: '', partyName: '', date: today(), requestType: 'Visit', officerName: '', action: '' }); setQ(''); setHits([]);
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const mark = async (t: CollectionTask, patch: any) => {
    try { await api.put(`/api/collections-dept/ledger/tasks/${t._id}`, patch); load(); } catch (e: any) { setErr(e.message); }
  };
  const remove = async (t: CollectionTask) => {
    try { await api.delete(`/api/collections-dept/ledger/tasks/${t._id}`); load(); } catch (e: any) { setErr(e.message); }
  };

  // تُجمَع باليوم: الشاشةُ تُقرأ يومًا يومًا كما يُقرأ التقويم.
  const byDay = rows.reduce((m: Record<string, CollectionTask[]>, t) => {
    (m[t.date] = m[t.date] || []).push(t); return m;
  }, {});
  const days = Object.keys(byDay).sort().reverse();

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>;

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{ar ? 'الخطة اليومية' : 'Daily plan'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {ar ? 'مَن يُزار اليوم ومَن يُتَّصل به — وما الذي حدث فعلًا.' : 'Who gets visited or called today — and what actually happened.'}
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)}
            className="px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium flex items-center gap-1.5">
            <Plus className="w-4 h-4" />{ar ? 'مهمة جديدة' : 'New task'}
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-2">
        <CalendarDays className="w-4 h-4 text-slate-400" />
        <input type="date" title={ar ? 'من' : 'From'} value={from} onChange={(e) => setFrom(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        <input type="date" title={ar ? 'إلى' : 'To'} value={to} onChange={(e) => setTo(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        <select title={ar ? 'الموظف' : 'Officer'} value={officer} onChange={(e) => setOfficer(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
          <option value="">{ar ? 'كل الفريق' : 'Whole team'}</option>
          {officers.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-sm text-slate-600">{ar ? 'حُصِّل في الفترة:' : 'Collected in range:'} <b className="text-emerald-700">{money(collected)}</b></span>
      </div>

      {err && <p className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{err}</p>}

      {adding && (
        <div className="bg-white border border-[#f37121]/30 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{ar ? 'مهمة جديدة' : 'New task'}</h3>
            <button type="button" onClick={() => setAdding(false)} title={ar ? 'إغلاق' : 'Close'} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <label className="block text-xs text-slate-500 mb-1">{ar ? 'العميل' : 'Customer'}</label>
              <input value={form.party ? form.partyName : q} onChange={(e) => { setQ(e.target.value); setForm((f) => ({ ...f, party: '', partyName: '' })); }}
                placeholder={ar ? 'ابحث بالاسم أو الكود…' : 'Search name or code…'}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              {hits.length > 0 && !form.party && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {hits.map((h) => (
                    <button key={h._id} type="button"
                      onClick={() => { setForm((f) => ({ ...f, party: h._id, partyName: h.name, officerName: f.officerName || h.collectionOfficer || '' })); setHits([]); }}
                      className="w-full text-start px-3 py-2 text-sm hover:bg-slate-50">
                      <span className="font-mono text-[11px] text-slate-400 me-1">{h.code}</span>{h.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{ar ? 'التاريخ' : 'Date'}</label>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{ar ? 'نوع التواصل' : 'Type'}</label>
              <select value={form.requestType} onChange={(e) => setForm((f) => ({ ...f, requestType: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{ar ? 'الموظف' : 'Officer'}</label>
              <input list="plan-officers" value={form.officerName} onChange={(e) => setForm((f) => ({ ...f, officerName: e.target.value }))}
                placeholder={ar ? 'مسؤول الحساب' : 'account owner'}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              <datalist id="plan-officers">{officers.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-sm text-slate-500">{ar ? 'إلغاء' : 'Cancel'}</button>
            <button type="button" onClick={save} disabled={!form.party}
              className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-50">{ar ? 'حفظ' : 'Save'}</button>
          </div>
        </div>
      )}

      {busy && <div className="refresh-bar" aria-hidden="true" />}
      {days.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 text-sm">{ar ? 'لا مهام في هذه الفترة' : 'No tasks in this range'}</div>
      ) : days.map((day) => (
        <div key={day} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{new Date(day).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
            <span className="text-xs text-slate-500">{byDay[day].length} {ar ? 'مهمة' : 'tasks'}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {byDay[day].map((t) => (
              <div key={t._id} className="px-4 py-2.5 flex flex-wrap items-center gap-3 hover:bg-slate-50">
                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${t.status === 'Done' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {t.requestType || (ar ? 'مهمة' : 'task')}
                </span>
                <span className="text-sm text-slate-900 font-medium flex-1 min-w-[180px]">
                  <span className="font-mono text-[11px] text-slate-400 me-1">{t.partyCode}</span>{t.partyName}
                </span>
                <span className="text-xs text-slate-500 min-w-[70px]">{t.officerName || '—'}</span>
                {t.action && <span className="text-xs text-slate-600 flex-1 min-w-[140px]">{t.action}</span>}
                {!!t.collected && <span className="text-xs text-emerald-700 font-semibold">{money(t.collected)}</span>}
                {canEdit && (
                  <div className="flex items-center gap-1">
                    {t.status !== 'Done' && (
                      <button type="button" onClick={() => mark(t, { status: 'Done' })} title={ar ? 'تم' : 'Mark done'}
                        className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50"><Check className="w-4 h-4" /></button>
                    )}
                    <button type="button" onClick={() => remove(t)} title={ar ? 'حذف' : 'Delete'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
