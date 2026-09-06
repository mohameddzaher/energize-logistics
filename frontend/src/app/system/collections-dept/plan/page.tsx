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
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { canEditCollections, money, type CollectionTask } from '@/lib/collections';
import SearchSelect from '@/components/system/SearchSelect';
import { Loader2, Plus, Check, Trash2, CalendarDays, X, MessageSquarePlus } from 'lucide-react';

const REQUEST_TYPES: { v: string; ar: string; en: string }[] = [
  { v: 'Visit', ar: 'زيارة', en: 'Visit' },
  { v: 'Office', ar: 'زيارة مكتب', en: 'Office' },
  { v: 'Call', ar: 'اتصال', en: 'Call' },
  { v: 'Email', ar: 'بريد', en: 'Email' },
  { v: 'Delivery', ar: 'تسليم فاتورة', en: 'Delivery' },
];
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);

/**
 * ── والمدى يُختار بكلمةٍ لا بتاريخين ──────────────────────────────────────
 * «أرِني اليوم» و«أرِني هذا الشهر» سؤالان يُطرحان كلَّ يوم، وكان جوابُهما
 * حسابَ تاريخين وكتابتَهما في خانتين. فصارت أزرارًا، والتاريخان يبقيان لمن
 * يريد فترةً بعينها.
 */
const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const PRESETS: { key: string; ar: string; en: string; range: () => [string, string] }[] = [
  { key: 'today', ar: 'اليوم', en: 'Today', range: () => [today(), today()] },
  { key: 'yesterday', ar: 'أمس', en: 'Yesterday', range: () => [addDays(today(), -1), addDays(today(), -1)] },
  { key: 'week', ar: 'هذا الأسبوع', en: 'This week', range: () => {
    const n = new Date(); const back = (n.getDay() + 1) % 7;           // الأسبوعُ يبدأ السبت
    return [ymd(new Date(n.getTime() - back * 86400000)), today()];
  } },
  { key: 'month', ar: 'هذا الشهر', en: 'This month', range: () => {
    const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), today()];
  } },
  { key: 'lastMonth', ar: 'الشهر الماضي', en: 'Last month', range: () => {
    const n = new Date();
    return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))];
  } },
];

export default function CollectionsPlanPage() {
  const router = useRouter();
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
  // ── والموظّفُ هو مَن فتح الشاشة ────────────────────────────────────────
  // كان يُكتب بالإيد في كلّ مهمّة، وهو في تسعٍ من كلّ عشرٍ صاحبُ الحساب نفسُه
  // الذي يكتبها. فيُملأ باسم الداخل، ويُغيَّر لمن يكتب خطّةَ غيره.
  const myName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  const blankForm = () => ({
    party: '', partyName: '', date: today(), requestType: 'Visit',
    officerName: myName, action: '', notes: '',
  });
  const [form, setForm] = useState(blankForm);
  const [err, setErr] = useState('');
  const [preset, setPreset] = useState('week');

  // ── وما حدث يُكتب بعد الفعل ────────────────────────────────────────────
  // «كلّمتُه فقال إنّه يسدّد الخميس» هو ثمرةُ الزيارة، وكانت الشاشةُ تعرف
  // «تمّت» ولا تعرف ماذا قيل. فبعدها يُفتَح هذا: ما حدث، وكم قُبض.
  const [logging, setLogging] = useState<CollectionTask | null>(null);
  const [logForm, setLogForm] = useState({ action: '', collected: '', notes: '' });

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
      setAdding(false); setForm(blankForm()); setQ(''); setHits([]);
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const mark = async (t: CollectionTask, patch: any) => {
    try { await api.put(`/api/collections-dept/ledger/tasks/${t._id}`, patch); load(); } catch (e: any) { setErr(e.message); }
  };
  const openLog = (t: CollectionTask) => {
    setLogging(t);
    setLogForm({ action: t.action || '', collected: t.collected ? String(t.collected) : '', notes: (t as any).notes || '' });
  };
  const saveLog = async () => {
    if (!logging) return;
    try {
      await api.put(`/api/collections-dept/ledger/tasks/${logging._id}`, {
        action: logForm.action,
        notes: logForm.notes,
        collected: Number(logForm.collected) || 0,
        // كتابةُ ما حدث تعني أنّها تمّت — ولا يُطلَب ضغطُ زرٍّ ثانٍ لقول ذلك.
        status: 'Done',
      });
      setLogging(null); load();
    } catch (e: any) { setErr(e.message); }
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

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
        {/* المدى بكلمة — واليومان يبقيان لمن يريد فترةً بعينها. */}
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          {PRESETS.map((ps) => (
            <button key={ps.key} type="button"
              onClick={() => { const [f, t2] = ps.range(); setFrom(f); setTo(t2); setPreset(ps.key); }}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                preset === ps.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
              {ar ? ps.ar : ps.en}
            </button>
          ))}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          <input type="date" title={ar ? 'من' : 'From'} value={from}
            onChange={(e) => { setFrom(e.target.value); setPreset(''); }}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" title={ar ? 'إلى' : 'To'} value={to}
            onChange={(e) => { setTo(e.target.value); setPreset(''); }}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <SearchSelect ar={ar} value={officer} onChange={setOfficer}
              allLabel={ar ? 'كل الفريق' : 'Whole team'}
              options={officers.map((o) => ({ value: o, label: o }))} />
          </div>
          <div className="flex-1" />
          <span className="text-sm text-slate-600">
            {ar ? 'مهام:' : 'Tasks:'} <b className="text-slate-900">{rows.length}</b>
            <span className="text-slate-300 mx-2">·</span>
            {ar ? 'تمّت:' : 'Done:'} <b className="text-slate-900">{rows.filter((r) => r.status === 'Done').length}</b>
            <span className="text-slate-300 mx-2">·</span>
            {ar ? 'حُصِّل:' : 'Collected:'} <b className="text-emerald-700">{money(collected)}</b>
          </span>
        </div>
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
              <SearchSelect ar={ar} value={form.requestType}
                onChange={(v) => setForm((f) => ({ ...f, requestType: v }))}
                options={REQUEST_TYPES.map((t) => ({ value: t.v, label: ar ? t.ar : t.en }))} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{ar ? 'الموظف' : 'Officer'}</label>
              {/* يبدأ باسم الداخل — ويُغيَّر لمن يكتب خطّةَ غيره. */}
              <SearchSelect ar={ar} value={form.officerName}
                onChange={(v) => setForm((f) => ({ ...f, officerName: v }))}
                placeholder={ar ? 'مسؤول الحساب' : 'account owner'}
                options={[...new Set([myName, ...officers].filter(Boolean))].map((o) => ({ value: o, label: o }))} />
            </div>
          </div>

          {/* ── والملاحظةُ تُكتب مع الخطّة أو بعدها ────────────────────────
              «قال إنّه يسدّد بعد الجرد» يُكتب قبل الزيارة توجيهًا، وبعدها
              نتيجةً. فهي هنا اختياريّةٌ، وتُملأ بعد الفعل من زرّ «ما حدث». */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">{ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}</label>
            <textarea rows={2} value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={ar ? 'ما المطلوب في هذه الزيارة؟ أو ما اتُّفق عليه سابقًا…' : 'What is this visit for? What was agreed before?…'}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
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
              <div key={t._id} className={`px-4 py-3 hover:bg-slate-50 ${t.status === 'Done' ? '' : 'border-s-2 border-s-[#f37121]/40'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${t.status === 'Done' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {REQUEST_TYPES.find((x) => x.v === t.requestType)
                      ? (ar ? REQUEST_TYPES.find((x) => x.v === t.requestType)!.ar : t.requestType)
                      : (t.requestType || (ar ? 'مهمة' : 'task'))}
                  </span>
                  {/* واسمُ العميل بابُ ملفّه. */}
                  <span className="text-sm font-medium flex-1 min-w-[180px]">
                    <span className="font-mono text-[11px] text-slate-400 me-1">{t.partyCode}</span>
                    {t.party ? (
                      <button type="button"
                        onClick={() => router.push(`/system/collections-dept/parties/${typeof t.party === 'string' ? t.party : (t.party as any)?._id}`)}
                        className="text-[#f37121] hover:underline">{t.partyName}</button>
                    ) : <span className="text-slate-900">{t.partyName}</span>}
                  </span>
                  <span className="text-xs text-slate-500 min-w-[70px]">{t.officerName || '—'}</span>
                  {!!t.collected && <span className="text-xs text-emerald-700 font-semibold">{money(t.collected)}</span>}
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openLog(t)}
                        title={ar ? 'سجّل ما حدث' : 'Log what happened'}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-semibold hover:bg-[#f37121]/20">
                        <MessageSquarePlus className="w-3.5 h-3.5" />{ar ? 'ما حدث' : 'Log'}
                      </button>
                      {t.status !== 'Done' && (
                        <button type="button" onClick={() => mark(t, { status: 'Done' })} title={ar ? 'تم' : 'Mark done'}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50"><Check className="w-4 h-4" /></button>
                      )}
                      <button type="button" onClick={() => remove(t)} title={ar ? 'حذف' : 'Delete'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
                {/* ما حدث والملاحظةُ تحت السطر: نصٌّ يُقرأ لا خانةٌ في جدول. */}
                {(t.action || (t as any).notes) && (
                  <div className="mt-1.5 ms-1 ps-2 border-s-2 border-slate-100 space-y-0.5">
                    {t.action && <p className="text-[13px] text-slate-700">{t.action}</p>}
                    {(t as any).notes && <p className="text-[12px] text-slate-500">{(t as any).notes}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ── ما حدث ──────────────────────────────────────────────────────────
          الزيارةُ ثمرتُها ما قيل فيها. وكانت الشاشةُ تعرف «تمّت» ولا تعرف
          ماذا قيل، فيبقى ما اتُّفق عليه في رأس من زار وحدَه. */}
      {logging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setLogging(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()} dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {ar ? 'ما حدث مع ' : 'What happened — '}{logging.partyName}
              </h3>
              <button type="button" onClick={() => setLogging(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{ar ? 'ماذا حدث؟' : 'What happened?'}</label>
              <textarea rows={3} autoFocus value={logForm.action}
                onChange={(e) => setLogForm((f) => ({ ...f, action: e.target.value }))}
                placeholder={ar ? 'كلّمتُ المحاسب، قال يسدّد الخميس بعد الجرد…' : 'Spoke to their accountant — paying Thursday after stocktake…'}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{ar ? 'المبلغ المحصَّل' : 'Amount collected'}</label>
                <input type="number" value={logForm.collected}
                  onChange={(e) => setLogForm((f) => ({ ...f, collected: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{ar ? 'ملاحظة' : 'Note'}</label>
                <input value={logForm.notes}
                  onChange={(e) => setLogForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
            </div>
            <p className="text-[12px] text-slate-500">
              {ar ? 'الحفظ يُعلّم المهمّة «تمّت» — كتابةُ ما حدث تعني أنّها حدثت.'
                  : 'Saving marks the task done — writing what happened says it happened.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLogging(null)} className="px-3 py-2 text-sm text-slate-500">{ar ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" onClick={saveLog}
                className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium">{ar ? 'حفظ' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
