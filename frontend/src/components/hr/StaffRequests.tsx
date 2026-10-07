'use client';
/**
 * طلباتُ الأقسام إلى الموارد البشريّة — شاشةٌ واحدةٌ من طرفين.
 *
 * ── ولماذا مُكوَّنٌ واحدٌ لا صفحتان ──────────────────────────────────────────
 * القسمُ يرسل ويتابع، والموارد البشريّة تستلم وتجيب. وهما **نفسُ الطلب**
 * مقروءًا من جهتين: لو كُتبت الشاشتان مرّتين لافترقت الكلماتُ والحالاتُ، فيقرأ
 * المرسِلُ «قيد التنفيذ» ويقرأ المستقبِلُ «منتهي» في اللحظة نفسِها.
 *
 * فالفارقُ `side`: جانبُ القسم يُنشئ، وجانبُ الموارد البشريّة يجيب — وبجانب
 * كلّ اسمٍ زرٌّ يفتح ملفَّ الموظّف ليُعدَّل من هناك فورًا.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Inbox, Send, Plus, Check, X, UserCog, Clock, CheckCircle2, XCircle, Search, ExternalLink, Users,
} from 'lucide-react';
import {
  Spinner, PageHeader, Modal, Field, TextInput, TextArea, PrimaryButton, SearchableSelect, Tabs,
} from '@/components/hr/HRKit';

export interface Subject {
  _id: string; employee: string | null; name: string; employeeNumber: string; note: string;
  decision: 'pending' | 'done' | 'rejected'; decisionNote: string; decidedAt: string | null;
}
export interface StaffRequest {
  _id: string; number: number; section: string; kind: string; title: string; body: string;
  subjects: Subject[]; status: 'new' | 'received' | 'done' | 'rejected'; decisionNote: string;
  createdByName: string; createdAt: string;
  receivedByName?: string; receivedAt?: string | null;
  decidedByName?: string; decidedAt?: string | null;
}

export const KINDS: { key: string; ar: string; en: string }[] = [
  { key: 'back_to_work', ar: 'عاد على رأس العمل', en: 'Back to work' },
  { key: 'service_ended', ar: 'لم يعد / أُنهيت خدمته', en: 'Service ended' },
  { key: 'on_leave', ar: 'في إجازة', en: 'On leave' },
  { key: 'data_fix', ar: 'تصحيح بيانات', en: 'Data correction' },
  { key: 'other', ar: 'طلب آخر', en: 'Other' },
];

const STATUS: Record<string, { ar: string; en: string; bg: string; text: string; Icon: any }> = {
  new: { ar: 'جديد', en: 'New', bg: 'bg-sky-50', text: 'text-sky-700', Icon: Inbox },
  received: { ar: 'تم الاستلام', en: 'Received', bg: 'bg-amber-50', text: 'text-amber-700', Icon: Clock },
  done: { ar: 'تم التنفيذ', en: 'Done', bg: 'bg-emerald-50', text: 'text-emerald-700', Icon: CheckCircle2 },
  rejected: { ar: 'مرفوض', en: 'Rejected', bg: 'bg-red-50', text: 'text-red-700', Icon: XCircle },
};

interface EmpOption { _id: string; arabicName?: string; firstName?: string; lastName?: string; employeeNumber?: string; iqamaNumber?: string; nationalId?: string; department?: string; employmentStatus?: string }

export default function StaffRequests({ side, section = 'B2C' }: { side: 'section' | 'hr'; section?: string }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const router = useRouter();

  const [list, setList] = useState<StaffRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(side === 'hr' ? 'open' : 'all');
  const [q, setQ] = useState('');

  // الإنشاء
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'back_to_work', title: '', body: '' });
  const [picked, setPicked] = useState<EmpOption[]>([]);
  const [emps, setEmps] = useState<EmpOption[]>([]);
  const [empState, setEmpState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (side === 'section') p.set('scope', section);
      if (tab === 'open') p.set('status', 'new,received');
      if (tab === 'closed') p.set('status', 'done,rejected');
      const d = await api.get<{ requests: StaffRequest[]; counts: Record<string, number> }>(
        `/api/staff-requests${p.toString() ? `?${p}` : ''}`);
      setList(d.requests || []);
      setCounts(d.counts || {});
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, section, tab]);

  useEffect(() => { load(); }, [load]);
  useSocket('staff-requests:changed', useCallback(() => { load(); }, [load]));

  // قائمةُ الموظفين تُجلب عند أوّل فتحٍ للنموذج لا مع كلّ زيارة. والمسارُ
  // `employees-search` بشَرطةٍ — راجع صفحة الإجازات.
  const loadEmps = useCallback(async () => {
    if (emps.length || empState === 'loading') return;
    setEmpState('loading');
    try {
      const d = await api.get<{ employees: EmpOption[] }>('/api/hr/employees-search?limit=2000');
      setEmps(d.employees || []);
      setEmpState('ready');
    } catch (e: any) {
      setEmpState('error');
      notify(e?.message || t('تعذّر تحميل قائمة الموظفين', 'Could not load employees'), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emps.length, empState]);

  const startNew = () => {
    setForm({ kind: 'back_to_work', title: '', body: '' });
    setPicked([]); setOpen(true); loadEmps();
  };

  const send = async () => {
    if (!form.title.trim() && !form.body.trim()) {
      notify(t('اكتب الطلب', 'Write the request'), 'error'); return;
    }
    setSaving(true);
    try {
      await api.post('/api/staff-requests', {
        section, kind: form.kind, title: form.title, body: form.body,
        employees: picked.map((e) => ({ employee: e._id })),
      });
      notify(t('أُرسل الطلبُ إلى الموارد البشرية', 'Sent to HR'), 'success');
      setOpen(false); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الإرسال', 'Could not send'), 'error'); }
    setSaving(false);
  };

  const decide = async (r: StaffRequest, status: 'received' | 'done' | 'rejected') => {
    let note = '';
    if (status === 'rejected') {
      // ── والرفضُ لا يمضي بلا سبب ────────────────────────────────────────
      // رفضٌ صامتٌ يُعاد إرسالُه غدًا كما هو. والخادمُ يرفضه أيضًا، فالسؤالُ
      // هنا ليُكتَب السببُ قبل أن تُردّ المحاولة.
      const reason = window.prompt(t('سببُ الرفض — يُقرأ في القسم الطالب:', 'Reason for rejection — the requesting section reads it:'));
      if (!reason || !reason.trim()) return;
      note = reason.trim();
    } else if (status === 'done') {
      if (!(await confirm(t(`تأكيدُ تنفيذ الطلب رقم ${r.number}؟`, `Mark request ${r.number} as done?`)))) return;
    }
    try {
      await api.patch(`/api/staff-requests/${r._id}`, { status, decisionNote: note });
      notify(t('حُفظ', 'Saved'), 'success'); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };

  const decideSubject = async (r: StaffRequest, s: Subject, decision: 'done' | 'rejected') => {
    let note = '';
    if (decision === 'rejected') {
      const reason = window.prompt(t(`سببُ الرفض لـ«${s.name}»:`, `Reason for “${s.name}”:`));
      if (!reason || !reason.trim()) return;
      note = reason.trim();
    }
    try {
      await api.patch(`/api/staff-requests/${r._id}/subjects/${s._id}`, { decision, decisionNote: note });
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((r) => [r.title, r.body, r.createdByName, String(r.number), ...r.subjects.map((s) => s.name)]
      .some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [list, q]);

  const kindLabel = (k: string) => {
    const x = KINDS.find((y) => y.key === k);
    return x ? (ar ? x.ar : x.en) : k;
  };

  if (loading) return <Spinner />;

  const openCount = (counts.new || 0) + (counts.received || 0);

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={side === 'hr' ? <Inbox className="w-5 h-5" /> : <Send className="w-5 h-5" />}
        title={side === 'hr' ? t('طلبات الأقسام', 'Section requests') : t('طلبات الموارد البشرية', 'HR requests')}
        subtitle={side === 'hr'
          ? t('تُستلَم ثمّ تُنفَّذ أو تُرفَض بسببٍ مكتوب — وبجانب كلّ اسمٍ زرٌّ يفتح ملفَّه',
              'Receive, then execute or reject with a written reason — each name links to its profile')
          : t('بلّغ الموارد البشرية بما رأيتَه في الميدان — ولا يلزمك تسميةُ أحد',
              'Tell HR what you saw in the field — naming people is optional')}>
        {side === 'section' && (
          <PrimaryButton onClick={startNew}><Plus className="w-4 h-4" /> {t('طلب جديد', 'New request')}</PrimaryButton>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={side === 'hr'
            ? [{ key: 'open', label: t('المفتوحة', 'Open'), badge: openCount }, { key: 'closed', label: t('المنتهية', 'Closed') }, { key: 'all', label: t('الكل', 'All') }]
            : [{ key: 'all', label: t('الكل', 'All') }, { key: 'open', label: t('المفتوحة', 'Open'), badge: openCount }, { key: 'closed', label: t('المنتهية', 'Closed') }]}
          active={tab} onChange={setTab} />
        <div className="relative ms-auto min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('ابحث برقم الطلب أو اسم موظف…', 'Search by number or employee…')}
            className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#f37121]" />
          {q && <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {!rows.length && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
          {side === 'hr' ? t('لا طلباتَ هنا', 'No requests here') : t('لم تُرسِل طلبًا بعد', 'You have not sent a request yet')}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const st = STATUS[r.status] || STATUS.new;
          const pending = r.subjects.filter((s) => s.decision === 'pending').length;
          return (
            <div key={r._id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-slate-400">#{r.number}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${st.bg} ${st.text}`}>
                      <st.Icon className="w-3 h-3" /> {ar ? st.ar : st.en}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600">{kindLabel(r.kind)}</span>
                    {side === 'hr' && <span className="px-2 py-0.5 rounded-full text-[11px] bg-[#f37121]/10 text-[#f37121]">{r.section}</span>}
                  </div>
                  <p className="font-semibold text-slate-800 mt-1.5">{r.title || kindLabel(r.kind)}</p>
                  {r.body ? <p className="text-sm text-slate-600 whitespace-pre-wrap mt-0.5">{r.body}</p> : null}
                  <p className="text-[11px] text-slate-400 mt-1">
                    {t('من', 'From')} {r.createdByName || '—'} · {new Date(r.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
                    {r.receivedByName ? ` · ${t('استلمها', 'received by')} ${r.receivedByName}` : ''}
                    {r.decidedByName ? ` · ${t('أجابها', 'answered by')} ${r.decidedByName}` : ''}
                  </p>
                  {r.decisionNote ? (
                    <p className={`text-xs mt-1.5 px-2.5 py-1.5 rounded-lg ${r.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
                      {t('الرد: ', 'Reply: ')}{r.decisionNote}
                    </p>
                  ) : null}
                </div>
                {side === 'hr' && r.status !== 'done' && r.status !== 'rejected' && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {r.status === 'new' && (
                      <button type="button" onClick={() => decide(r, 'received')}
                        className="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100">
                        <Clock className="w-3.5 h-3.5 inline -mt-0.5 me-1" />{t('تم الاستلام', 'Received')}
                      </button>
                    )}
                    <button type="button" onClick={() => decide(r, 'done')}
                      className="px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100">
                      <Check className="w-3.5 h-3.5 inline -mt-0.5 me-1" />{t('تم التنفيذ', 'Done')}
                    </button>
                    <button type="button" onClick={() => decide(r, 'rejected')}
                      className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100">
                      <X className="w-3.5 h-3.5 inline -mt-0.5 me-1" />{t('رفض بسبب', 'Reject')}
                    </button>
                  </div>
                )}
              </div>

              {!!r.subjects.length && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                  <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {r.subjects.length} {t('موظفًا', 'employees')}
                    {pending ? ` · ${pending} ${t('بلا قرار', 'undecided')}` : ''}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {r.subjects.map((s) => {
                      const sd = s.decision === 'done'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : s.decision === 'rejected' ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-white text-slate-700 border-slate-200';
                      return (
                        <div key={s._id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] ${sd}`}>
                          <span className="flex-1 min-w-0 truncate" title={s.name}>
                            {s.name}{s.employeeNumber ? <span className="text-[10px] text-slate-400 ms-1">#{s.employeeNumber}</span> : null}
                            {s.decisionNote ? <span className="block text-[10px] opacity-80 truncate">{s.decisionNote}</span> : null}
                          </span>
                          {/* ── وزرٌّ يفتح ملفَّه ليُعدَّل من هناك ──────────────
                              الموارد البشريّة تقرأ الاسمَ ثمّ تحتاج أن تفتحه
                              وتغيّر حالتَه — فالرابطُ هنا بدل البحث عنه. */}
                          {s.employee && (
                            <button type="button" title={t('افتح ملفَّه', 'Open profile')}
                              onClick={() => router.push(`/system/hr/employees/${s.employee}`)}
                              className="shrink-0 px-1.5 py-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:border-[#f37121] hover:text-[#f37121]">
                              <UserCog className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {side === 'hr' && s.decision === 'pending' && (
                            <>
                              <button type="button" title={t('نُفِّذ', 'Done')} onClick={() => decideSubject(r, s, 'done')}
                                className="shrink-0 px-1.5 py-1 rounded-md border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title={t('رفض بسبب', 'Reject')} onClick={() => decideSubject(r, s, 'rejected')}
                                className="shrink-0 px-1.5 py-1 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} wide
        title={t('طلب جديد إلى الموارد البشرية', 'New request to HR')}
        footer={<>
          <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={send} disabled={saving}><Send className="w-4 h-4" /> {t('إرسال', 'Send')}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={t('نوع الطلب', 'Kind')}>
            <SearchableSelect value={form.kind} onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
              options={KINDS.map((k) => ({ value: k.key, label: ar ? k.ar : k.en }))}
              placeholder={t('— اختر —', '— pick —')} searchPlaceholder={t('ابحث…', 'search…')} />
          </Field>
          <Field label={t('عنوان مختصر', 'Short title')}>
            <TextInput value={form.title} onChange={(e: any) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t('مناديب عادوا على رأس العمل', 'Riders back to work')} />
          </Field>
          <Field label={t('التفاصيل', 'Details')}>
            <TextArea rows={3} value={form.body} onChange={(e: any) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={t('اكتب ما تريد من الموارد البشرية بالتفصيل…', 'What do you need HR to do…')} />
          </Field>
          <Field label={t('الموظفون (اختياري)', 'Employees (optional)')}>
            <div className="space-y-2">
              <SearchableSelect
                value=""
                onChange={(v) => {
                  const e = emps.find((x) => x._id === v);
                  if (e && !picked.some((p) => p._id === v)) setPicked((p) => [...p, e]);
                }}
                placeholder={t('أضِف موظفًا…', 'Add an employee…')}
                searchPlaceholder={t('ابحث بالاسم أو الإقامة أو الرقم الوظيفي…', 'name, ID or number…')}
                emptyLabel={empState === 'loading' ? t('جارٍ التحميل…', 'Loading…')
                  : empState === 'error' ? t('لم تُحمَّل القائمة — اضغط «إعادة المحاولة»', 'List did not load — press Retry')
                    : undefined}
                options={emps
                  .filter((e) => !picked.some((p) => p._id === e._id))
                  .map((e) => ({
                    value: e._id,
                    label: [
                      e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || '—',
                      e.employeeNumber ? `#${e.employeeNumber}` : '',
                      e.department || '',
                      e.employmentStatus && e.employmentStatus !== 'active' ? (ar ? '— ليس على رأس العمل' : '— not active') : '',
                    ].filter(Boolean).join(' · '),
                  }))}
              />
              {empState === 'error' && (
                <button type="button" onClick={() => { setEmps([]); setEmpState('idle'); loadEmps(); }}
                  className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium">
                  {t('إعادة المحاولة', 'Retry')}
                </button>
              )}
              {!!picked.length && (
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((e) => (
                    <span key={e._id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs">
                      {e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim()}
                      <button type="button" onClick={() => setPicked((p) => p.filter((x) => x._id !== e._id))}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                {t('غير مُلزِم — اكتب طلبَك بلا أسماءٍ إن شئت، والموارد البشرية تقرأ النصّ.',
                   'Optional — write the request without names if you prefer.')}
              </p>
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
