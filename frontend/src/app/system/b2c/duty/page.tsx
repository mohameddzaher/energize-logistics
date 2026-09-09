'use client';
/**
 * سجلُّ تفقّد بداية الدوام وتحليلُه — شاشةُ الإدارة.
 *
 * ── ما تجيب عنه ولا يجيب عنه تحليلُ الطلبات ──────────────────────────────
 * تحليلُ الطلبات يقيس ما أنتجه المندوب. وهذه تقيس شيئًا آخر: هل وقف المشرفُ
 * على رجاله قبل أن يخرجوا؟ والمقياسُ ليس عددَ التفقّدات بل نسبتَها إلى مَن كان
 * يجب أن يُفقَّد — عشرةٌ من عشرةٍ التزام، وعشرةٌ من ثلاثين تقصير. والمقامُ لا
 * يُقرأ من جدول التفقّد نفسِه لأنّ الصفَّ لا يُكتب أصلًا لمن أُهمل، فيُقرأ من
 * سجلّ المندوبين.
 *
 * ولذلك تبويبُ «لم يُفقَّدوا» أهمُّ ما يُفتَح صباحًا: هو وحدَه يُري الغائبَ عن
 * السجلّ، والسجلُّ لا يعرضه لأنّه ليس فيه.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import Link from 'next/link';
import {
  ClipboardList, Camera, AlertTriangle, Ban, UserX, CheckCircle2, Flag, X,
  Users, TrendingUp, Image as ImageIcon, Clock, MapPin, Loader2,
} from 'lucide-react';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';

const todayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

interface Row {
  _id: string; dateKey: string; checkedAt?: string; outcome: 'started' | 'absent' | 'blocked';
  supervisorName?: string; supervisor?: { _id: string; firstName?: string; lastName?: string };
  rep?: { _id: string; englishName?: string; arabicName?: string; repId?: string };
  branch?: { name?: string }; project?: { name?: string };
  conditionAr?: string; hasDamage?: boolean; damageNotes?: string; notes?: string;
  vehicleType?: string; vehiclePlate?: string;
  photos?: { fileUrl: string; takenAt?: string }[];
  location?: { lat?: number; lng?: number; accuracy?: number };
  review?: { verdict?: string; note?: string; at?: string; by?: { firstName?: string; lastName?: string } };
}

const OUT: Record<string, { ar: string; en: string; cls: string }> = {
  started: { ar: 'بدأ الدوام', en: 'Started', cls: 'bg-emerald-100 text-emerald-700' },
  absent: { ar: 'لم يحضر', en: 'Absent', cls: 'bg-slate-200 text-slate-700' },
  blocked: { ar: 'مُنع', en: 'Blocked', cls: 'bg-red-100 text-red-700' },
};

export default function DutyRegisterPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);

  const [tab, setTab] = useState<'log' | 'gallery' | 'missing' | 'analysis'>('log');
  const [from, setFrom] = useState(todayKey());
  const [to, setTo] = useState(todayKey());
  const [supervisor, setSupervisor] = useState('');
  const [outcome, setOutcome] = useState('');
  const [damage, setDamage] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [sups, setSups] = useState<{ _id: string; name: string; reps: number }[]>([]);
  const [missing, setMissing] = useState<any>(null);
  const [an, setAn] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Row | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ from, to, limit: '500' });
    if (supervisor) p.set('supervisor', supervisor);
    if (outcome) p.set('outcome', outcome);
    if (damage) p.set('damage', '1');
    return p.toString();
  }, [from, to, supervisor, outcome, damage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, a, m] = await Promise.all([
        api.get<{ rows: Row[] }>(`/api/b2c/duty?${qs}`),
        api.get<any>(`/api/b2c/duty/analytics?from=${from}&to=${to}${supervisor ? `&supervisor=${supervisor}` : ''}`),
        api.get<any>(`/api/b2c/duty/missing?date=${to}${supervisor ? `&supervisor=${supervisor}` : ''}`).catch(() => null),
      ]);
      setRows(l.rows || []); setAn(a); setMissing(m);
    } catch { setRows([]); }
    setLoading(false);
  }, [qs, from, to, supervisor]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<any>('/api/b2c/duty/supervisors').then((d) => setSups(d.supervisors || [])).catch(() => {}); }, []);
  useSocket('b2c:duty', useCallback(() => load(), [load]));

  const photos = useMemo(
    () => rows.flatMap((r) => (r.photos || []).map((p) => ({ ...p, row: r }))),
    [rows],
  );

  const cols: ExportColumn[] = [
    { header: t('اليوم', 'Day'), key: 'dateKey' },
    { header: t('المندوب', 'Rider'), key: 'rep', transform: (v: any) => v?.englishName || '' },
    { header: t('المشرف', 'Supervisor'), key: 'supervisorName' },
    { header: t('الحالة', 'Outcome'), key: 'outcome', transform: (v: any) => (ar ? OUT[v]?.ar : OUT[v]?.en) || v },
    { header: t('حالة المركبة', 'Condition'), key: 'conditionAr' },
    { header: t('تلف', 'Damage'), key: 'hasDamage', transform: (v: any) => (v ? t('نعم', 'Yes') : '') },
    { header: t('ملاحظة التلف', 'Damage note'), key: 'damageNotes' },
    { header: t('الفرع', 'Branch'), key: 'branch', transform: (v: any) => v?.name || '' },
    { header: t('عدد الصور', 'Photos'), key: 'photos', transform: (v: any) => (v || []).length },
    { header: t('وقت التفقّد', 'Checked at'), key: 'checkedAt', transform: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : '') },
  ];

  const T = an?.totals || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <ClipboardList className="h-5 w-5 text-[#f37121]" />
            {t('تفقّد بداية الدوام', 'Duty start register')}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {t('مَن أخرج مَن، ومتى، وبأيّ حال كانت مركبته.', 'Who sent whom out, when, and in what condition.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu fileName="b2c-duty" lang={ar ? 'ar' : 'en'} variant="subtle"
            label={t('تصدير Excel', 'Export Excel')}
            options={[{
              key: 'rows', label: t('السجلّ', 'Register'),
              sheets: [{ name: t('تفقّد بداية الدوام', 'Duty checks'), rows, columns: cols }],
            }]} />
          <Link href="/system/b2c/duty/start"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-2 text-xs font-bold text-white">
            <Camera className="h-3.5 w-3.5" />{t('شاشة المشرف', 'Supervisor screen')}
          </Link>
        </div>
      </div>

      {/* الفلاتر */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <F label={t('من', 'From')}><input type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} /></F>
        <F label={t('إلى', 'To')}><input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} /></F>
        <F label={t('المشرف', 'Supervisor')}>
          <select className={inp} value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
            <option value="">{t('الكل', 'All')}</option>
            {sups.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.reps})</option>)}
          </select>
        </F>
        <F label={t('الحالة', 'Outcome')}>
          <select className={inp} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">{t('الكل', 'All')}</option>
            {Object.entries(OUT).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </select>
        </F>
        <label className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" className="h-4 w-4 accent-red-600" checked={damage} onChange={(e) => setDamage(e.target.checked)} />
          {t('بها تلف فقط', 'Damaged only')}
        </label>
        <button type="button" onClick={() => { const d = todayKey(); setFrom(d); setTo(d); setSupervisor(''); setOutcome(''); setDamage(false); }}
          className="pb-2 text-xs font-semibold text-slate-400 hover:text-[#f37121]">{t('اليوم', 'Today')}</button>
      </div>

      {/* الأرقام */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <K label={t('نسبة الالتزام', 'Compliance')} value={T.compliance != null ? `${T.compliance}%` : '—'}
          hint={t(`${T.checks || 0} من ${T.expected || 0}`, `${T.checks || 0} of ${T.expected || 0}`)}
          tone={T.compliance == null ? '' : T.compliance >= 95 ? 'text-emerald-600' : T.compliance >= 80 ? 'text-amber-600' : 'text-red-600'} Icon={TrendingUp} />
        <K label={t('بدأ الدوام', 'Started')} value={T.started ?? 0} tone="text-emerald-600" Icon={CheckCircle2} />
        <K label={t('لم يحضر', 'Absent')} value={T.absent ?? 0} Icon={UserX} />
        <K label={t('مُنع من الخروج', 'Blocked')} value={T.blocked ?? 0} tone="text-red-600" Icon={Ban} />
        <K label={t('مركبات بها تلف', 'Damaged')} value={T.damaged ?? 0} tone="text-orange-600" Icon={AlertTriangle} />
        <K label={t('بانتظار مراجعتك', 'Unreviewed')} value={(T.checks || 0) - (T.reviewed || 0)} Icon={Flag} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([
          ['log', t('السجلّ', 'Register'), rows.length],
          ['gallery', t('الصور', 'Photos'), photos.length],
          ['missing', t('لم يُفقَّدوا', 'Not checked'), missing?.missing?.length ?? 0],
          ['analysis', t('التحليل', 'Analysis'), null],
        ] as const).map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setTab(k as any)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
            {label}{n != null && <span className="ms-1 opacity-70">({n})</span>}
          </button>
        ))}
      </div>

      {loading && <div className="py-8 text-center text-sm text-slate-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}

      {!loading && tab === 'log' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                {[t('اليوم', 'Day'), t('المندوب', 'Rider'), t('المشرف', 'Supervisor'), t('الحالة', 'Outcome'),
                  t('المركبة', 'Vehicle'), t('صور', 'Photos'), t('الوقت', 'Time'), t('المراجعة', 'Review')].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} onClick={() => setOpen(r)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{r.dateKey}</td>
                  <td className="px-3 py-2 text-[13px] font-semibold text-slate-900">{ar ? (r.rep?.arabicName || r.rep?.englishName) : r.rep?.englishName}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.supervisorName || '—'}</td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${OUT[r.outcome]?.cls}`}>{ar ? OUT[r.outcome]?.ar : OUT[r.outcome]?.en}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.conditionAr || '—'}
                    {r.hasDamage && <AlertTriangle className="ms-1 inline h-3.5 w-3.5 text-orange-500" />}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{(r.photos || []).length}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-500">{r.checkedAt ? new Date(r.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td className="px-3 py-2">
                    {r.review?.verdict === 'flagged' ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">{t('عليها ملاحظة', 'Flagged')}</span>
                      : r.review?.verdict === 'ok' ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">{t('سليم', 'OK')}</span>
                      : <span className="text-[11px] text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">{t('لا صفوف في هذا المدى', 'Nothing in this range')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'gallery' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {photos.map((p, i) => (
            <button key={i} type="button" onClick={() => setOpen(p.row)} className="group text-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.fileUrl} alt="" className="aspect-square w-full rounded-lg border border-slate-200 object-cover group-hover:border-[#f37121]" />
              <p className="mt-1 truncate text-[11px] font-semibold text-slate-700">{p.row.rep?.englishName}</p>
              <p className="truncate text-[10.5px] text-slate-400">{p.row.dateKey} · {p.row.supervisorName}</p>
            </button>
          ))}
          {!photos.length && <p className="col-span-full py-10 text-center text-sm text-slate-500">{t('لا صور في هذا المدى', 'No photos in this range')}</p>}
        </div>
      )}

      {!loading && tab === 'missing' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs text-slate-500">
            {t(`مندوبون نشطون لم يُسجَّل لهم تفقّد يوم ${missing?.dateKey || to}.`,
               `Active riders with no check recorded on ${missing?.dateKey || to}.`)}
          </p>
          <div className="space-y-1.5">
            {(missing?.missing || []).map((m: any) => (
              <div key={m._id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-[13px] font-semibold text-slate-800">{ar ? (m.arabicName || m.englishName) : m.englishName}</span>
                <span className="text-[11px] text-slate-500">
                  {m.supervisor ? `${m.supervisor.firstName || ''} ${m.supervisor.lastName || ''}`.trim() : t('بلا مشرف', 'No supervisor')}
                  {m.branch?.name ? ` · ${m.branch.name}` : ''}
                </span>
              </div>
            ))}
            {!(missing?.missing || []).length && (
              <p className="py-8 text-center text-sm text-emerald-600">{t('لا أحد — الجميع فُقِّدوا ✓', 'Nobody — everyone was checked ✓')}</p>
            )}
          </div>
        </div>
      )}

      {!loading && tab === 'analysis' && an && (
        <div className="space-y-4">
          <Panel title={t('التزام المشرفين', 'Supervisor compliance')} hint={t('نُفِّذ ÷ المطلوب خلال المدى', 'done ÷ due over the range')}>
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>{[t('المشرف', 'Supervisor'), t('مندوبوه', 'Riders'), t('المطلوب', 'Due'), t('نُفِّذ', 'Done'),
                     t('الالتزام', 'Compliance'), t('مُنع', 'Blocked'), t('تلف', 'Damage'), t('ملاحظات', 'Flags'), t('متوسط الساعة', 'Avg hour')].map((h) => (
                  <th key={h} className="px-3 py-2 text-start text-[11.5px] font-semibold">{h}</th>))}</tr>
              </thead>
              <tbody>
                {(an.supervisors || []).map((s: any) => (
                  <tr key={s._id} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-[13px] font-semibold text-slate-800">{s.name}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{s.reps}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{s.due}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{s.checks}</td>
                    <td className="px-3 py-2">
                      <span className={`font-bold tabular-nums ${s.compliance == null ? 'text-slate-400' : s.compliance >= 95 ? 'text-emerald-600' : s.compliance >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                        {s.compliance == null ? '—' : `${s.compliance}%`}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-red-600">{s.blocked || ''}</td>
                    <td className="px-3 py-2 tabular-nums text-orange-600">{s.damaged || ''}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{s.flagged || ''}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{s.avgHour != null ? `${s.avgHour}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('حالة المركبات', 'Vehicle condition')}>
              {(an.byCondition || []).map((c: any) => (
                <Bar key={c._id} label={c._id} value={c.count} max={Math.max(...(an.byCondition || []).map((x: any) => x.count), 1)} />
              ))}
              {!(an.byCondition || []).length && <Empty t={t} />}
            </Panel>
            <Panel title={t('الأكثر تكرارًا للتلف', 'Most damaged riders')} hint={t('الرجل لا اليوم', 'the rider, not the day')}>
              {(an.topDamage || []).map((c: any) => (
                <Bar key={c._id} label={c.name} value={c.times} max={Math.max(...(an.topDamage || []).map((x: any) => x.times), 1)} tone="bg-orange-500" />
              ))}
              {!(an.topDamage || []).length && <Empty t={t} />}
            </Panel>
            <Panel title={t('حسب الفرع', 'By branch')}>
              {(an.byBranch || []).map((c: any) => (
                <Bar key={String(c._id)} label={c.name} value={c.checks} max={Math.max(...(an.byBranch || []).map((x: any) => x.checks), 1)} />
              ))}
              {!(an.byBranch || []).length && <Empty t={t} />}
            </Panel>
            <Panel title={t('يومًا بيوم', 'Day by day')}>
              {(an.byDay || []).map((d: any) => (
                <Bar key={d._id} label={d._id} value={d.checks} max={Math.max(...(an.byDay || []).map((x: any) => x.checks), 1)} />
              ))}
              {!(an.byDay || []).length && <Empty t={t} />}
            </Panel>
          </div>
        </div>
      )}

      {open && <DetailModal row={open} ar={ar} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
    </div>
  );
}

const inp = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm';
const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><label className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</label>{children}</div>
);
const K = ({ label, value, hint, tone, Icon }: { label: string; value: any; hint?: string; tone?: string; Icon: any }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="mb-1 flex items-center justify-between">
      <span className="text-[11px] text-slate-500">{label}</span>
      <Icon className="h-3.5 w-3.5 text-slate-300" />
    </div>
    <p className={`text-xl font-extrabold ${tone || 'text-slate-900'}`}>{value}</p>
    {hint && <p className="mt-0.5 text-[10.5px] text-slate-400">{hint}</p>}
  </div>
);
const Panel = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="border-b border-slate-100 px-4 py-2.5">
      <p className="text-[13px] font-bold text-slate-800">{title}</p>
      {hint && <p className="text-[10.5px] text-slate-400">{hint}</p>}
    </header>
    <div className="space-y-1.5 p-4">{children}</div>
  </section>
);
const Bar = ({ label, value, max, tone }: { label: string; value: number; max: number; tone?: string }) => (
  <div className="flex items-center gap-2">
    <span className="w-32 shrink-0 truncate text-[11.5px] text-slate-600" title={label}>{label}</span>
    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
      <span className={`block h-full rounded-full ${tone || 'bg-[#f37121]'}`} style={{ width: `${Math.round((value / max) * 100)}%` }} />
    </span>
    <span className="w-8 shrink-0 text-end text-[11.5px] font-bold tabular-nums text-slate-700">{value}</span>
  </div>
);
const Empty = ({ t }: { t: (a: string, e: string) => string }) => (
  <p className="py-4 text-center text-xs text-slate-400">{t('لا بيانات', 'No data')}</p>
);

function DetailModal({ row, ar, onClose, onSaved }: { row: Row; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [note, setNote] = useState(row.review?.note || '');
  const [busy, setBusy] = useState(false);
  const decide = async (verdict: 'ok' | 'flagged') => {
    setBusy(true);
    try { await api.patch(`/api/b2c/duty/${row._id}/review`, { verdict, note }); onSaved(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">{ar ? (row.rep?.arabicName || row.rep?.englishName) : row.rep?.englishName}</p>
            <p className="text-[11.5px] text-slate-500">
              {row.dateKey} · {row.supervisorName} · <span className={`rounded px-1.5 py-0.5 ${OUT[row.outcome]?.cls}`}>{ar ? OUT[row.outcome]?.ar : OUT[row.outcome]?.en}</span>
            </p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button>
        </div>

        {!!(row.photos || []).length && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(row.photos || []).map((p, i) => (
              <a key={i} href={p.fileUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.fileUrl} alt="" className="aspect-square w-full rounded-lg border border-slate-200 object-cover hover:opacity-90" />
              </a>
            ))}
          </div>
        )}

        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
          <Row k={t('المركبة', 'Vehicle')} v={[row.vehicleType, row.vehiclePlate].filter(Boolean).join(' · ')} />
          <Row k={t('الحالة', 'Condition')} v={row.conditionAr} />
          <Row k={t('وقت التفقّد', 'Checked at')} v={row.checkedAt ? new Date(row.checkedAt).toLocaleString('en-GB') : ''} />
          <Row k={t('الفرع', 'Branch')} v={row.branch?.name} />
          {row.hasDamage && <Row k={t('التلف', 'Damage')} v={row.damageNotes || t('نعم', 'Yes')} danger />}
          {row.notes && <Row k={t('ملاحظات', 'Notes')} v={row.notes} />}
          {row.location?.lat != null && (
            <div className="col-span-2">
              <a className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 hover:underline"
                href={`https://maps.google.com/?q=${row.location.lat},${row.location.lng}`} target="_blank" rel="noreferrer">
                <MapPin className="h-3.5 w-3.5" />{t('موقع المشرف وقت التفقّد', 'Supervisor location at check')}
              </a>
            </div>
          )}
        </dl>

        <div className="border-t border-slate-200 pt-3">
          <label className="mb-1 block text-[11px] font-semibold text-slate-600">{t('ملاحظة الإدارة', 'Management note')}</label>
          <textarea rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => decide('flagged')} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50">
              <Flag className="h-4 w-4" />{t('تسجيل ملاحظة', 'Flag')}
            </button>
            <button type="button" onClick={() => decide('ok')} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{t('سليم', 'OK')}
            </button>
          </div>
          {row.review?.at && (
            <p className="mt-2 text-[11px] text-slate-400">
              {t('راجعها', 'Reviewed by')} {row.review.by?.firstName} {row.review.by?.lastName} — {new Date(row.review.at).toLocaleString('en-GB')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v, danger }: { k: string; v?: string; danger?: boolean }) => (
  <div><dt className="inline text-slate-500">{k}: </dt><dd className={`inline font-semibold ${danger ? 'text-red-600' : 'text-slate-800'}`}>{v || '—'}</dd></div>
);
