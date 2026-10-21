'use client';
/**
 * طلباتُ الموارد البشريّة إلى الإدارة الماليّة — شاشةٌ واحدةٌ من طرفين.
 *
 *   · الموارد البشريّة (`side='hr'`): تختار موظّفًا أو أكثر، وتكتب أمام كلٍّ منهم
 *     ما تحتاجه له في خانةٍ واحدة، وترفق ما يلزم — فيصل الطلبُ إلى الماليّة.
 *   · الإدارة الماليّة (`side='finance'`): تقرأ الطلبَ وموظّفيه ومرفقاتِه، وتجيب
 *     «تمّ» أو «لم يتمّ» بملاحظةٍ ومرفقاتٍ إن شاءت.
 *
 * ويصل كلَّ طرفٍ إشعارٌ بما فعله الآخر، وتتحدّث الشاشتان حيًّا (`hr-finance:changed`).
 * ونقاطُ الـ API تُمرَّر من الصفحة — فتُنسب إليها في خريطة الصلاحيّات.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Plus, Send, Search, X, Paperclip, Users, CheckCircle2, XCircle, Clock, MessageSquareReply } from 'lucide-react';
import { Spinner, Modal, Field, TextArea, PrimaryButton, SearchableSelect } from '@/components/hr/HRKit';
import FilePicker, { type PickedFile } from '@/components/system/FilePicker';
import { hijriDay, hijriLong } from '@/lib/hrDates';
import { REQ_STATUS, fmtStamp, type HrFile, type HrFinanceRequest } from '@/lib/hrFinance';

interface EmpOption { _id: string; arabicName?: string; firstName?: string; lastName?: string; employeeNumber?: string; iqamaNumber?: string; nationalId?: string; department?: string; employmentStatus?: string }
const empName = (e: EmpOption) => e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || '—';

function FileLinks({ files, ar }: { files: HrFile[]; ar: boolean }) {
  if (!files?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <a key={i} href={f.fileUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 hover:border-[#f37121] hover:text-[#f37121]">
          <Paperclip className="w-3.5 h-3.5" />{f.fileName || (ar ? 'مرفق' : 'File')}
        </a>
      ))}
    </div>
  );
}

export default function HrFinanceRequests({ side, listUrl, createUrl, answerUrl, employeeSearchUrl }: {
  side: 'hr' | 'finance';
  listUrl: string;
  createUrl?: string;
  answerUrl?: string;
  employeeSearchUrl?: string;
}) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const sp = useSearchParams();
  const focusId = sp?.get('id') || '';

  const [status, setStatus] = useState(side === 'finance' ? 'pending' : '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [qDeb, setQDeb] = useState('');
  const [mine, setMine] = useState(false);
  useEffect(() => { const h = setTimeout(() => setQDeb(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const [list, setList] = useState<HrFinanceRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [can, setCan] = useState<{ answer: boolean; create: boolean }>({ answer: false, create: false });
  const [loading, setLoading] = useState(true);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const my = guard.begin();
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (qDeb) p.set('q', qDeb);
      if (mine) p.set('mine', '1');
      const d = await api.get<{ requests: HrFinanceRequest[]; counts: Record<string, number>; can: { answer: boolean; create: boolean } }>(
        `${listUrl}${p.toString() ? `?${p}` : ''}`);
      if (!guard.isCurrent(my)) return;
      setList(d.requests || []); setCounts(d.counts || {}); setCan(d.can || { answer: false, create: false });
    } catch (e: any) { if (guard.isCurrent(my)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    if (guard.isCurrent(my)) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUrl, status, from, to, qDeb, mine, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr-finance:changed', useCallback(() => { load(); }, [load]));

  // ── رابطُ الإشعار يفتح الطلبَ نفسَه: يُرفع فلترُ الحالة ويُمرَّر إليه ──
  useEffect(() => {
    if (!focusId || loading) return;
    const el = document.getElementById(`hrfr-${focusId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (status) setStatus('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, list.length]);

  // ── الإنشاء (الموارد البشريّة) ──
  const [open, setOpen] = useState(false);
  const [emps, setEmps] = useState<EmpOption[]>([]);
  const [empState, setEmpState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [picked, setPicked] = useState<{ emp: EmpOption; note: string }[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [saving, setSaving] = useState(false);

  const loadEmps = useCallback(async () => {
    if (!employeeSearchUrl || emps.length || empState === 'loading') return;
    setEmpState('loading');
    try {
      const d = await api.get<{ employees: EmpOption[] }>(`${employeeSearchUrl}?limit=2000`);
      setEmps(d.employees || []); setEmpState('ready');
    } catch (e: any) {
      setEmpState('error'); notify(e?.message || t('تعذّر تحميل قائمة الموظفين', 'Could not load employees'), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeSearchUrl, emps.length, empState]);

  const empOptions = useMemo(() => emps
    .filter((e) => !picked.some((p) => p.emp._id === e._id))
    .map((e) => ({
      value: e._id,
      label: [empName(e), e.employeeNumber ? `#${e.employeeNumber}` : '', e.iqamaNumber || e.nationalId || '', e.department || '']
        .filter(Boolean).join(' · '),
    })), [emps, picked]);

  const send = async () => {
    if (!createUrl) return;
    if (!picked.length) { notify(t('اختر موظّفًا واحدًا على الأقلّ', 'Pick at least one employee'), 'error'); return; }
    const blank = picked.find((p) => !p.note.trim());
    if (blank) { notify(t(`اكتب ما تحتاجه لـ«${empName(blank.emp)}»`, `Write what is needed for “${empName(blank.emp)}”`), 'error'); return; }
    setSaving(true);
    try {
      await api.post(createUrl, {
        items: picked.map((p) => ({ employee: p.emp._id, note: p.note.trim() })),
        files: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      notify(t('أُرسل الطلبُ إلى الإدارة المالية', 'Sent to Finance'), 'success');
      setOpen(false); setPicked([]); setFiles([]); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الإرسال', 'Could not send'), 'error'); }
    setSaving(false);
  };

  // ── الجواب (الماليّة) ──
  const [answering, setAnswering] = useState<HrFinanceRequest | null>(null);
  const [ansStatus, setAnsStatus] = useState<'done' | 'not_done'>('done');
  const [ansNote, setAnsNote] = useState('');
  const [ansFiles, setAnsFiles] = useState<PickedFile[]>([]);
  const startAnswer = (r: HrFinanceRequest, s: 'done' | 'not_done') => {
    setAnswering(r); setAnsStatus(s); setAnsNote(r.status !== 'pending' ? r.answerNote : ''); setAnsFiles([]);
  };
  const submitAnswer = async () => {
    if (!answering || !answerUrl) return;
    setSaving(true);
    try {
      await api.patch(`${answerUrl}/${answering._id}`, {
        status: ansStatus, note: ansNote.trim(),
        files: ansFiles.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      notify(t('حُفظ الجواب', 'Answer saved'), 'success');
      setAnswering(null); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  if (loading) return <Spinner />;

  const tabs = [
    { key: '', label: t('الكل', 'All'), n: counts.all || 0 },
    { key: 'pending', label: t('قيد الانتظار', 'Pending'), n: counts.pending || 0 },
    { key: 'done', label: t('تمّ', 'Done'), n: counts.done || 0 },
    { key: 'not_done', label: t('لم يتمّ', 'Not done'), n: counts.not_done || 0 },
  ];

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((x) => (
            <button key={x.key || 'all'} type="button" onClick={() => setStatus(x.key)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-bold transition ${status === x.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]/60'}`}>
              {x.label}
              <span className={`min-w-[1.75rem] rounded-full px-2 py-0.5 text-center text-[12px] tabular-nums ${status === x.key ? 'bg-white/20' : x.key === 'pending' && x.n ? 'bg-[#f37121] text-white' : 'bg-slate-100'}`}>{x.n}</span>
            </button>
          ))}
          {can.create && createUrl && (
            <div className="ms-auto">
              <PrimaryButton onClick={() => { setPicked([]); setFiles([]); setOpen(true); loadEmps(); }}>
                <Plus className="w-4 h-4" /> {t('طلب جديد للمالية', 'New request to Finance')}
              </PrimaryButton>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('ابحث برقم الطلب أو اسم موظف أو رقم إقامته', 'Request no., employee or iqama')}
              className="w-72 max-w-full rounded-lg border border-slate-200 py-2 pe-3 ps-8 text-sm focus:border-[#f37121] focus:outline-none" />
          </div>
          <label className="text-[12px] text-slate-500">{t('من', 'From')}</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} dir="ltr"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px]" />
          <label className="text-[12px] text-slate-500">{t('إلى', 'To')}</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} dir="ltr"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px]" />
          {side === 'hr' && (
            <label className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[#f37121]" />
              {t('طلباتي فقط', 'Mine only')}
            </label>
          )}
          {(q || from || to || mine) && (
            <button type="button" onClick={() => { setQ(''); setFrom(''); setTo(''); setMine(false); }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">
              <X className="h-3.5 w-3.5" />{t('مسح', 'Clear')}
            </button>
          )}
        </div>
      </div>

      {!list.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {t('لا طلباتَ هنا', 'No requests here')}
        </div>
      )}

      <div className="space-y-3">
        {list.map((r) => {
          const st = REQ_STATUS[r.status] || REQ_STATUS.pending;
          const Icon = r.status === 'done' ? CheckCircle2 : r.status === 'not_done' ? XCircle : Clock;
          return (
            <div key={r._id} id={`hrfr-${r._id}`}
              className={`overflow-hidden rounded-xl border bg-white shadow-sm ${focusId === r._id ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">#{r.number}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${st.cls}`}>
                      <Icon className="w-3.5 h-3.5" />{ar ? st.ar : st.en}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-600">
                      <Users className="w-3 h-3" />{r.items.length} {t('موظف', 'employees')}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-slate-400">
                    {t('من', 'From')} {r.createdByName || '—'} · {fmtStamp(r.createdAt, ar)}
                    {hijriDay(r.createdAt) ? ` · ${hijriLong(r.createdAt, ar)} ${t('هـ', 'AH')}` : ''}
                  </p>
                </div>
                {side === 'finance' && can.answer && answerUrl && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => startAnswer(r, 'done')}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-bold text-emerald-700 hover:bg-emerald-100">
                      <CheckCircle2 className="w-4 h-4" />{t('تمّ', 'Done')}
                    </button>
                    <button type="button" onClick={() => startAnswer(r, 'not_done')}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] font-bold text-red-700 hover:bg-red-100">
                      <XCircle className="w-4 h-4" />{t('لم يتمّ', 'Not done')}
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-[11.5px] text-slate-500">
                        <th className="px-2 py-1 text-start font-semibold">{t('الموظف', 'Employee')}</th>
                        <th className="px-2 py-1 text-start font-semibold">{t('رقم الإقامة', 'Iqama no.')}</th>
                        <th className="px-2 py-1 text-start font-semibold">{t('القسم', 'Department')}</th>
                        <th className="px-2 py-1 text-start font-semibold">{t('المطلوب', 'Needed')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.items.map((it) => (
                        <tr key={it._id}>
                          <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-slate-800">
                            {it.name}{it.employeeNumber ? <span className="ms-1 text-[11px] text-slate-400">#{it.employeeNumber}</span> : null}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-slate-600">{it.idNumber || '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{it.department || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-800 whitespace-pre-wrap">{it.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.files?.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11.5px] font-semibold text-slate-500">{t('مرفقات الموارد البشرية', 'HR attachments')}</p>
                    <FileLinks files={r.files} ar={ar} />
                  </div>
                )}
              </div>

              {r.status !== 'pending' && (
                <div className={`border-t px-4 py-3 ${r.status === 'done' ? 'border-emerald-100 bg-emerald-50/50' : 'border-red-100 bg-red-50/50'}`}>
                  <p className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
                    <MessageSquareReply className="w-4 h-4" />
                    {t('ردّ الإدارة المالية', 'Finance reply')} · {r.answeredByName || '—'} · {fmtStamp(r.answeredAt, ar)}
                  </p>
                  {r.answerNote && <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-800">{r.answerNote}</p>}
                  {r.answerFiles?.length > 0 && <div className="mt-2"><FileLinks files={r.answerFiles} ar={ar} /></div>}
                  {r.history?.length > 1 && (
                    <details className="mt-2 text-[12px] text-slate-500">
                      <summary className="cursor-pointer">{t(`سجلّ الردود (${r.history.length})`, `Reply history (${r.history.length})`)}</summary>
                      <ul className="mt-1 space-y-1">
                        {r.history.map((h, i) => (
                          <li key={i}>{fmtStamp(h.at, ar)} · {h.byName} · {(REQ_STATUS[h.status] || REQ_STATUS.pending)[ar ? 'ar' : 'en']}{h.note ? ` — ${h.note}` : ''}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── طلبٌ جديد: موظّفون، وخانةٌ واحدةٌ لكلٍّ منهم، ومرفقات ── */}
      <Modal open={open} onClose={() => setOpen(false)} wide title={t('طلب جديد إلى الإدارة المالية', 'New request to Finance')}
        footer={<>
          <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={send} disabled={saving}><Send className="w-4 h-4" /> {t('إرسال', 'Send')}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={t('الموظفون', 'Employees')}>
            <SearchableSelect value="" options={empOptions}
              onChange={(v) => { const e = emps.find((x) => x._id === v); if (e) setPicked((p) => [...p, { emp: e, note: '' }]); }}
              placeholder={t('أضِف موظفًا…', 'Add an employee…')}
              searchPlaceholder={t('ابحث بالاسم أو الإقامة أو الرقم الوظيفي…', 'name, iqama or number…')}
              emptyLabel={empState === 'loading' ? t('جارٍ التحميل…', 'Loading…') : empState === 'error' ? t('لم تُحمَّل القائمة', 'List did not load') : undefined} />
          </Field>
          {picked.length > 0 && (
            <div className="space-y-2">
              {picked.map((p, i) => (
                <div key={p.emp._id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex-1 text-[13px] font-bold text-slate-800">
                      {empName(p.emp)}{p.emp.employeeNumber ? <span className="ms-1 text-[11px] text-slate-400">#{p.emp.employeeNumber}</span> : null}
                      {(p.emp.iqamaNumber || p.emp.nationalId) ? <span className="ms-2 text-[11.5px] font-normal tabular-nums text-slate-500">{p.emp.iqamaNumber || p.emp.nationalId}</span> : null}
                    </span>
                    <button type="button" onClick={() => setPicked((x) => x.filter((_, j) => j !== i))}
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-red-600" title={t('إزالة', 'Remove')}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <TextArea rows={2} value={p.note}
                    onChange={(e: any) => { const v = e.target.value; setPicked((x) => x.map((y, j) => (j === i ? { ...y, note: v } : y))); }}
                    placeholder={t('ما المطلوب له من المالية؟', 'What is needed for him from Finance?')} />
                </div>
              ))}
            </div>
          )}
          <Field label={t('مرفقات (اختياري)', 'Attachments (optional)')}>
            <FilePicker files={files} onChange={setFiles} />
          </Field>
        </div>
      </Modal>

      {/* ── جوابُ الماليّة ── */}
      <Modal open={!!answering} onClose={() => setAnswering(null)}
        title={answering ? t(`الرد على الطلب #${answering.number}`, `Answer request #${answering.number}`) : ''}
        footer={<>
          <button type="button" onClick={() => setAnswering(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={submitAnswer} disabled={saving}>{t('حفظ الرد', 'Save answer')}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['done', 'not_done'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setAnsStatus(s)}
                className={`flex-1 rounded-xl border px-4 py-3 text-[14px] font-bold transition ${ansStatus === s
                  ? (s === 'done' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-red-600 bg-red-600 text-white')
                  : 'border-slate-200 bg-white text-slate-700'}`}>
                {s === 'done' ? t('تمّ', 'Done') : t('لم يتمّ', 'Not done')}
              </button>
            ))}
          </div>
          <Field label={t('ملاحظة (اختياري)', 'Note (optional)')}>
            <TextArea rows={3} value={ansNote} onChange={(e: any) => setAnsNote(e.target.value)} />
          </Field>
          <Field label={t('مرفقات (اختياري)', 'Attachments (optional)')}>
            <FilePicker files={ansFiles} onChange={setAnsFiles} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
