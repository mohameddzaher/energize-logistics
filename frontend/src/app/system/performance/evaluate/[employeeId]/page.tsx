'use client';
// The evaluation form (تقييم موظف).
//
// Left: one block per criterion — its weight, what it means, and the 1..5 cards
// the manager clicks. Right (sticky): the score, the gauge and the radar, all
// recomputed locally on every click so the manager sees the consequence of an
// answer immediately, including the bonus it earns. The server recomputes on
// save and its numbers are the ones stored.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarRadiusAxis, Tooltip,
} from 'recharts';
import { ArrowLeft, ArrowRight, Save, Send, FileDown, Trash2, Loader2, AlertTriangle, CheckCircle2, Lock, Unlock } from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import { downloadReport, type Block } from '@/lib/reportPdf';
import {
  isPerfStaff, computeScore, bandStyle, bandLabel, bonusLabel, pct, score5,
  SCORE_COLORS, periodLabel, type Lang, type Period, type Template, type Settings,
  type Evaluation, type Tier,
} from '@/lib/performance';

interface EditRequest {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  reason: string; requestedByName: string; requestedAt: string | null;
  decidedByName: string; decidedAt: string | null; decisionNote: string;
}
interface FormResponse {
  employee: { _id: string; name: string; jobTitle: string; department: string; employeeNumber: string };
  template: Template | null;
  tier: Tier | null;
  evaluation: Evaluation | null;
  period: Period; periodKey: string; periodLabel: string;
  settings: Settings;
  // Whether this user may write to this evaluation right now, and why not.
  permissions: {
    canEdit: boolean; locked: boolean; reason: string;
    canOverride: boolean; canRequestEdit: boolean;
    editRequest: EditRequest | null;
  };
  alternatives: { _id: string; nameAr: string }[];
}

export default function EvaluatePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const ar = lang === 'ar';
  const employeeId = String(params?.employeeId || '');
  const periodParam = search?.get('period') || '';

  const [data, setData] = useState<FormResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState('');
  const [salary, setSalary] = useState<string>('');
  const [evalDate, setEvalDate] = useState('');
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [templateId, setTemplateId] = useState<string>('');
  const [reqOpen, setReqOpen] = useState(false);
  const [reqReason, setReqReason] = useState('');
  const [reqBusy, setReqBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (periodParam) qs.set('period', periodParam);
      if (templateId) qs.set('template', templateId);
      const d = await api.get<FormResponse>(`/api/performance/evaluations/form/${employeeId}?${qs.toString()}`);
      setData(d);
      const a: Record<string, number | null> = {};
      (d.template?.criteria || []).forEach((c) => { a[c.key] = null; });
      (d.evaluation?.answers || []).forEach((x) => { a[x.criterionKey] = x.score; });
      setAnswers(a);
      setNotes(d.evaluation?.notes || '');
      setSalary(d.evaluation?.monthlySalary != null ? String(d.evaluation.monthlySalary) : '');
      setEvalDate(d.evaluation?.evaluationDate || new Date().toISOString().slice(0, 10));
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Failed to load' });
    }
    setLoading(false);
  }, [employeeId, periodParam, templateId]);
  useEffect(() => { load(); }, [load]);

  const criteria = useMemo(
    () => [...(data?.template?.criteria || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [data]
  );
  // The live result — this is what drives every number and both charts.
  const result = useMemo(
    () => computeScore(criteria, answers, data?.settings?.bands || [], data?.tier),
    [criteria, answers, data]
  );
  const st = bandStyle(result.band);

  const radarData = useMemo(() => criteria.map((c, i) => ({
    subject: `${i + 1}`,
    fullName: c.titleAr || c.title,
    score: answers[c.key] ?? 0,
    weight: c.weight,
  })), [criteria, answers]);

  const save = async (status: 'draft' | 'submitted') => {
    if (!data?.template) return;
    setSaving(status === 'draft' ? 'draft' : 'submit');
    setMsg(null);
    try {
      await api.post('/api/performance/evaluations', {
        employee: employeeId,
        template: data.template._id,
        period: data.period,
        evaluationDate: evalDate,
        answers: criteria.map((c) => ({ criterionKey: c.key, score: answers[c.key], note: '' })),
        notes,
        monthlySalary: salary === '' ? null : Number(salary),
        status,
      });
      setMsg({ kind: 'ok', text: status === 'submitted' ? (ar ? 'تم إرسال التقييم' : 'Evaluation submitted') : (ar ? 'تم حفظ المسودة' : 'Draft saved') });
      await load();
      if (status === 'submitted') setTimeout(() => router.push('/system/performance'), 900);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || (ar ? 'فشل الحفظ' : 'Save failed') });
    }
    setSaving(null);
  };

  const clearAll = () => {
    const a: Record<string, number | null> = {};
    criteria.forEach((c) => { a[c.key] = null; });
    setAnswers(a);
  };

  const sendEditRequest = async () => {
    if (!data?.evaluation || !reqReason.trim()) return;
    setReqBusy(true);
    try {
      await api.post(`/api/performance/evaluations/${data.evaluation._id}/request-edit`, { reason: reqReason.trim() });
      setMsg({ kind: 'ok', text: ar ? 'تم إرسال طلب التعديل للمدير العام' : 'Edit request sent to the super admin' });
      setReqOpen(false); setReqReason('');
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || (ar ? 'فشل إرسال الطلب' : 'Could not send the request') });
    }
    setReqBusy(false);
  };

  const exportPdf = async () => {
    if (!data) return;
    const blocks: Block[] = [
      { kind: 'title', text: ar ? 'تقييم أداء موظف' : 'Employee Performance Evaluation', sub: `${data.employee.name} — ${data.periodLabel}` },
      { kind: 'kv', items: [
        [ar ? 'الموظف' : 'Employee', data.employee.name],
        [ar ? 'المسمى الوظيفي' : 'Job title', data.employee.jobTitle || '—'],
        [ar ? 'القسم' : 'Department', data.employee.department || '—'],
        [ar ? 'النموذج' : 'Template', data.template?.nameAr || '—'],
        [ar ? 'الفترة' : 'Period', data.periodLabel],
        [ar ? 'المُقيِّم' : 'Evaluator', `${user?.firstName || ''} ${user?.lastName || ''}`.trim()],
        [ar ? 'التاريخ' : 'Date', evalDate || '—'],
      ] },
      { kind: 'section', text: ar ? 'المؤشرات' : 'Criteria' },
      { kind: 'table',
        head: [ar ? '#' : '#', ar ? 'المؤشر' : 'Criterion', ar ? 'الوزن' : 'Weight', ar ? 'الدرجة' : 'Score'],
        align: ['center', 'start', 'center', 'center'],
        rows: criteria.map((c, i) => [
          String(i + 1), c.titleAr || c.title, `${c.weight}%`,
          answers[c.key] != null ? `${answers[c.key]} / 5` : '—',
        ]),
      },
      { kind: 'section', text: ar ? 'النتيجة' : 'Result' },
      { kind: 'stats', items: [
        { label: ar ? 'الدرجة المرجّحة' : 'Weighted score', value: `${score5(result.weightedScore)} / 5` },
        { label: ar ? 'النسبة المئوية' : 'Percentage', value: pct(result.percentage), accent: true },
        { label: ar ? 'الشريحة' : 'Band', value: bandLabel(result.band, lang as Lang) },
        { label: ar ? 'البونص' : 'Bonus', value: bonusLabel(result.bonusMultiplier, lang as Lang) },
      ] },
      ...(notes ? [{ kind: 'note', text: `${ar ? 'ملاحظات المُقيِّم: ' : 'Evaluator notes: '}${notes}` } as Block] : []),
    ];
    await downloadReport({
      fileName: `evaluation-${data.employee.name}-${data.periodKey}`,
      lang: lang as 'ar' | 'en',
      blocks,
      footerNote: ar ? 'البونص محسوب بعدد الرواتب الشهرية وفق طبقة الفريق' : 'Bonus expressed in monthly salaries per team tier',
    });
  };

  if (!isPerfStaff(user?.role)) {
    return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية لهذا القسم' : 'You do not have access to this section'}</div>;
  }
  if (loading) return <Spinner />;
  if (!data) return <div className="p-8 text-slate-500">{ar ? 'تعذّر تحميل التقييم' : 'Could not load the evaluation'}</div>;

  const Back = isRTL ? ArrowRight : ArrowLeft;
  const submitted = data.evaluation?.status === 'submitted';
  // A locked evaluation is shown in full, but read-only.
  const perms = data.permissions || { canEdit: true, locked: false, reason: '', canOverride: false, canRequestEdit: false, editRequest: null };
  const readOnly = !perms.canEdit;
  const req = perms.editRequest;

  if (!data.template) {
    return (
      <div className="space-y-4 p-2" dir={isRTL ? 'rtl' : 'ltr'}>
        <button type="button" onClick={() => router.push('/system/performance')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#f37121]">
          <Back className="w-4 h-4" /> {ar ? 'رجوع' : 'Back'}
        </button>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{ar ? 'لا يوجد نموذج تقييم لهذا القسم' : 'No evaluation template for this department'}</p>
            <p className="text-sm mt-1">
              {ar
                ? `قسم "${data.employee.department || '—'}" ليس له نموذج مؤشرات بعد. المدير العام يقدر يضيفه من صفحة إعداد المؤشرات.`
                : `The "${data.employee.department || '—'}" department has no criteria template yet. A super-admin can add one from the Configure page.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => router.push('/system/performance')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#f37121] mb-2">
            <Back className="w-4 h-4" /> {ar ? 'رجوع للوحة' : 'Back to board'}
          </button>
          <h1 className="text-2xl font-bold text-slate-900">{data.employee.name}</h1>
          <p className="text-sm text-slate-500">
            {[data.employee.jobTitle, data.employee.department, data.template.nameAr].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.alternatives.length > 1 && (
            <select
              value={templateId || data.template._id}
              onChange={(e) => setTemplateId(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-[#f37121]"
              title={ar ? 'نموذج التقييم' : 'Evaluation template'}
            >
              {data.alternatives.map((t) => <option key={t._id} value={t._id}>{t.nameAr}</option>)}
            </select>
          )}
          <input
            type="date" value={evalDate} onChange={(e) => setEvalDate(e.target.value)} disabled={readOnly}
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-[#f37121]"
            title={ar ? 'تاريخ التقييم' : 'Evaluation date'}
          />
          <button type="button" onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}
      {/* Lock / edit-request state */}
      {submitted && perms.locked && (
        <div className="rounded-lg px-4 py-3 bg-slate-100 border border-slate-200 flex flex-wrap items-center gap-3">
          <Lock className="w-4 h-4 text-slate-500 shrink-0" />
          <div className="text-sm text-slate-700 min-w-0 flex-1">
            <p className="font-medium">
              {req?.status === 'pending'
                ? (ar ? 'طلب التعديل قيد مراجعة المدير العام' : 'Your edit request is awaiting super-admin approval')
                : req?.status === 'rejected'
                  ? (ar ? 'تم رفض طلب التعديل — التقييم مقفول' : 'Edit request rejected — the evaluation stays locked')
                  : (ar ? 'هذا التقييم مُرسل ومقفول — لا يمكن تعديله' : 'This evaluation is submitted and locked')}
            </p>
            {req?.status === 'rejected' && req.decisionNote && (
              <p className="text-xs text-slate-500 mt-0.5">{ar ? 'سبب الرفض: ' : 'Reason: '}{req.decisionNote}</p>
            )}
            {req?.status === 'pending' && req.reason && (
              <p className="text-xs text-slate-500 mt-0.5">{ar ? 'سببك: ' : 'Your reason: '}{req.reason}</p>
            )}
          </div>
          {perms.canRequestEdit && (
            <button
              type="button" onClick={() => setReqOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-xs font-semibold shrink-0"
            >
              {ar ? 'طلب تعديل' : 'Request edit'}
            </button>
          )}
        </div>
      )}
      {submitted && !perms.locked && req?.status === 'approved' && (
        <div className="rounded-lg px-4 py-2.5 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-2">
          <Unlock className="w-4 h-4" />
          {ar
            ? 'تمت الموافقة على التعديل — يمكنك التعديل وإعادة الإرسال مرة واحدة.'
            : 'Edit approved — you may correct and resubmit once.'}
        </div>
      )}
      {submitted && !perms.locked && req?.status !== 'approved' && perms.canOverride && (
        <div className="rounded-lg px-4 py-2.5 text-sm bg-blue-50 text-blue-700 border border-blue-200">
          {ar
            ? 'تقييم مُرسل — بصفتك المدير العام يمكنك تعديله مباشرة، وسيُسجَّل التعديل في السجل.'
            : 'Submitted evaluation — as super admin you can edit it directly; the change is recorded in its history.'}
        </div>
      )}

      {/* Request-edit dialog */}
      {reqOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReqOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800">{ar ? 'طلب تعديل التقييم' : 'Request an edit'}</h3>
            <p className="text-xs text-slate-500">
              {ar
                ? 'اكتب سبب التعديل. المدير العام هو من يوافق أو يرفض، ولو وافق هتقدر تعدّل مرة واحدة.'
                : 'Explain why. The super admin approves or rejects; an approval lets you correct it once.'}
            </p>
            <textarea
              value={reqReason} onChange={(e) => setReqReason(e.target.value)} rows={4}
              placeholder={ar ? 'مثال: تم إدخال درجة خاطئة في المؤشر الثالث' : 'e.g. wrong score entered on criterion 3'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
            />
            <div className="flex gap-2">
              <button
                type="button" disabled={reqBusy || !reqReason.trim()} onClick={sendEditRequest}
                className="flex-1 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold disabled:opacity-40"
              >
                {reqBusy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : (ar ? 'إرسال الطلب' : 'Send request')}
              </button>
              <button type="button" onClick={() => setReqOpen(false)} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* ---- Criteria ---- */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {criteria.length} {ar ? 'مؤشرات · المجموع' : 'criteria · total'} {criteria.reduce((s, c) => s + c.weight, 0)}%
            </p>
            {!readOnly && (
              <button type="button" onClick={clearAll} className="text-xs text-slate-400 hover:text-red-600 flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> {ar ? 'تفريغ التقييم' : 'Clear'}
              </button>
            )}
          </div>

          {criteria.map((c, i) => {
            const chosen = answers[c.key];
            return (
              <div key={c.key} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-slate-900">{ar ? (c.titleAr || c.title) : (c.title || c.titleAr)}</p>
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#f37121]/10 text-[#f37121] text-xs font-bold tabular-nums">{c.weight}%</span>
                    </div>
                    {(c.descriptionAr || c.description) && (
                      <p className="text-xs text-slate-500 mt-1">{ar ? (c.descriptionAr || c.description) : (c.description || c.descriptionAr)}</p>
                    )}
                    {(c.dataSourceAr || c.dataSource) && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        {ar ? 'مصدر البيانات: ' : 'Data source: '}{ar ? (c.dataSourceAr || c.dataSource) : (c.dataSource || c.dataSourceAr)}
                      </p>
                    )}
                  </div>
                </div>

                {/* The 1..5 answer cards, all on one row */}
                <div className="grid grid-cols-5 gap-2 mt-3">
                  {[...(c.scale || [])].sort((a, b) => a.score - b.score).map((s) => {
                    const active = chosen === s.score;
                    return (
                      <button
                        key={s.score} type="button" disabled={readOnly}
                        onClick={() => setAnswers((p) => ({ ...p, [c.key]: active ? null : s.score }))}
                        className={`rounded-lg border-2 py-2 px-1 text-center transition disabled:cursor-not-allowed ${active ? 'text-white shadow-sm' : `bg-white text-slate-600 border-slate-200 ${readOnly ? 'opacity-60' : 'hover:border-slate-300'}`}`}
                        style={active ? { backgroundColor: SCORE_COLORS[s.score], borderColor: SCORE_COLORS[s.score] } : undefined}
                      >
                        <span className="block text-lg font-bold tabular-nums leading-none">{s.score}</span>
                        <span className={`block text-[10px] mt-1 leading-tight ${active ? 'text-white/90' : 'text-slate-500'}`}>
                          {ar ? (s.labelAr || s.label) : (s.label || s.labelAr)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Notes */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800 mb-2">{ar ? 'ملاحظات المُقيِّم' : 'Evaluator notes'}</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} readOnly={readOnly}
              placeholder={ar ? 'ملاحظات داعمة للتقييم (اختياري)' : 'Supporting notes (optional)'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#f37121]"
            />
          </div>
        </div>

        {/* ---- Live result ---- */}
        <div className="lg:sticky lg:top-4 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            {/* Gauge */}
            <div className="h-44 relative">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="72%" outerRadius="100%" startAngle={210} endAngle={-30}
                  data={[{ name: 'score', value: result.percentage ?? 0, fill: result.band ? st.hex : '#cbd5e1' }]}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar background={{ fill: '#f1f5f9' }} dataKey="value" cornerRadius={12} angleAxisId={0} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold text-slate-900 tabular-nums leading-none">{pct(result.percentage)}</span>
                <span className="text-xs text-slate-500 mt-1">{score5(result.weightedScore)} {ar ? 'من ٥' : '/ 5'}</span>
              </div>
            </div>

            <div className="text-center -mt-2">
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${st.bg} ${st.text}`}>
                {bandLabel(result.band, lang as Lang)}
              </span>
            </div>

            {/* Progress toward completion */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                <span>{ar ? 'اكتمال التقييم' : 'Completion'}</span>
                <span className="tabular-nums">{Math.round(result.answeredWeight)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-[#f37121] transition-all" style={{ width: `${Math.min(100, result.answeredWeight)}%` }} />
              </div>
              {!result.complete && (
                <p className="text-[11px] text-slate-400 mt-1.5">
                  {ar ? 'النسبة محسوبة على المؤشرات المُجابة فقط' : 'Score reflects answered criteria only'}
                </p>
              )}
            </div>

            {/* Bonus */}
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{ar ? 'البونص المستحق' : 'Bonus earned'}</span>
                <span className="font-bold text-slate-900">{bonusLabel(result.bonusMultiplier, lang as Lang)}</span>
              </div>
              {data.tier && (
                <p className="text-[11px] text-slate-400">
                  {ar ? `${data.tier.ar} — سقف ${data.tier.cap} راتب` : `${data.tier.en} — cap ${data.tier.cap} salary`}
                </p>
              )}
              {result.percentage != null && result.bonusMultiplier === 0 && (
                <p className="text-[11px] text-red-500">
                  {ar ? `أقل من حد الاستحقاق ${data.settings.eligibilityThreshold}%` : `Below the ${data.settings.eligibilityThreshold}% threshold`}
                </p>
              )}
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'الراتب الشهري (ريال) — اختياري' : 'Monthly salary (SAR) — optional'}</label>
                <input
                  type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} readOnly={readOnly}
                  placeholder={ar ? 'مثال: ٨٠٠٠' : 'e.g. 8000'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:border-[#f37121]"
                />
                {salary !== '' && result.bonusMultiplier != null && (
                  <p className="text-xs text-emerald-700 mt-1 font-medium tabular-nums">
                    {ar ? 'قيمة البونص: ' : 'Bonus value: '}
                    {(Number(salary) * result.bonusMultiplier).toLocaleString('en-US', { maximumFractionDigits: 0 })} {ar ? 'ريال' : 'SAR'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Radar — performance spread across the criteria */}
          {criteria.length >= 3 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 mb-2">{ar ? 'توزيع الأداء على المؤشرات' : 'Performance across criteria'}</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ fontSize: 9, fill: '#cbd5e1' }} axisLine={false} />
                    <Radar dataKey="score" stroke={result.band ? st.hex : '#f37121'} fill={result.band ? st.hex : '#f37121'} fillOpacity={0.35} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }}
                      formatter={(v: any) => [`${v} / 5`, ar ? 'الدرجة' : 'Score']}
                      labelFormatter={(l: any) => {
                        const row = radarData.find((r) => r.subject === String(l));
                        return row ? `${l}. ${row.fullName} (${row.weight}%)` : String(l);
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {readOnly ? (
              <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-3 text-center">
                <Lock className="w-4 h-4 text-slate-400 mx-auto mb-1" />
                <p className="text-xs text-slate-500">{perms.reason || (ar ? 'التقييم مقفول' : 'This evaluation is locked')}</p>
                {perms.canRequestEdit && (
                  <button type="button" onClick={() => setReqOpen(true)} className="mt-2 px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-xs font-semibold">
                    {ar ? 'طلب تعديل' : 'Request edit'}
                  </button>
                )}
              </div>
            ) : (
            <>
            <button
              type="button" disabled={!!saving} onClick={() => save('submitted')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving === 'submit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {ar ? 'إرسال التقييم' : 'Submit evaluation'}
            </button>
            <button
              type="button" disabled={!!saving} onClick={() => save('draft')}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium disabled:opacity-50"
            >
              {saving === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {ar ? 'حفظ كمسودة' : 'Save draft'}
            </button>
            {!result.complete && (
              <p className="text-[11px] text-slate-400 text-center">
                {ar ? 'لا يمكن الإرسال قبل الإجابة على كل المؤشرات' : 'All criteria must be answered before submitting'}
              </p>
            )}
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
