'use client';
/**
 * تفقُّد بداية الدوام — شاشةُ المشرف.
 *
 * قائمةُ مندوبيه هو، وأمام كلٍّ زرٌّ واحد. ولا يُفتَح غيرُ مندوبيه: الخادمُ
 * يبني القائمةَ من `B2CRep.supervisor` ويردّ من حاول غيرَها.
 *
 * والصورةُ تُلتقَط من الكاميرا ولا تُرفَع — راجع `components/b2c/LiveCamera`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import Link from 'next/link';
import {
  CheckCircle2, Clock, UserX, Ban, Camera, Loader2, MapPin, ShieldAlert, ClipboardList,
} from 'lucide-react';
import LiveCamera, { type Shot } from '@/components/b2c/LiveCamera';
import ManagedSelect from '@/components/system/ManagedSelect';

type Outcome = 'started' | 'absent' | 'blocked';

interface Check {
  _id: string; outcome: Outcome; checkedAt?: string; conditionAr?: string;
  hasDamage?: boolean; damageNotes?: string; notes?: string; vehicleType?: string;
  vehiclePlate?: string; photos?: { fileUrl: string }[];
}
interface Rep {
  _id: string; englishName: string; arabicName?: string; repId?: string; phone?: string;
  branch?: { name?: string }; project?: { name?: string }; check: Check | null;
}

const OUTCOME_META: Record<Outcome, { ar: string; en: string; cls: string; Icon: any }> = {
  started: { ar: 'بدأ الدوام', en: 'Started', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', Icon: CheckCircle2 },
  absent: { ar: 'لم يحضر', en: 'Absent', cls: 'bg-slate-200 text-slate-700 border-slate-300', Icon: UserX },
  blocked: { ar: 'مُنع من الخروج', en: 'Blocked', cls: 'bg-red-100 text-red-700 border-red-300', Icon: Ban },
};

export default function DutyStartPage() {
  const { notify } = useDialog();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);

  const [data, setData] = useState<{ reps: Rep[]; dateKey: string; done: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Rep | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.get('/api/b2c/duty/my-reps')); } catch { setData(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('b2c:duty', useCallback(() => load(), [load]));

  const reps = data?.reps || [];
  const pending = useMemo(() => reps.filter((r) => !r.check), [reps]);
  const done = useMemo(() => reps.filter((r) => r.check), [reps]);

  if (loading) return <div className="p-10 text-center text-slate-500">{t('جارٍ التحميل…', 'Loading…')}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Camera className="h-5 w-5 text-[#f37121]" />
            {t('تفقّد بداية الدوام', 'Duty start check')}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {t('لا يخرج المندوب إلا بعد تصوير مركبته — الصورة تُلتقط الآن ولا تُرفع من الجهاز.',
               'A rider only goes out after his vehicle is photographed — captured live, never uploaded.')}
          </p>
        </div>
        <Link href="/system/b2c/duty"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:text-[#f37121]">
          <ClipboardList className="h-3.5 w-3.5" />{t('السجلّ والتحليل', 'Register & analysis')}
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('مندوبوك', 'Your riders')} value={data?.total ?? 0} />
        <Stat label={t('تمّ تفقّدهم', 'Checked')} value={data?.done ?? 0} tone="text-emerald-600" />
        <Stat label={t('بقي', 'Remaining')} value={pending.length} tone={pending.length ? 'text-amber-600' : 'text-slate-400'} />
      </div>

      {!reps.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">{t('لا مندوبين مُسندين إليك', 'No riders assigned to you')}</p>
          <p className="mt-1 text-xs text-slate-500">
            {t('تُسنَد المندوبون للمشرفين من صفحة المندوبين. اطلب من مدير القسم إسنادهم.',
               'Riders are assigned to supervisors on the riders page. Ask your section manager to assign them.')}
          </p>
        </div>
      )}

      {!!pending.length && (
        <Section title={t('بانتظار التفقّد', 'Awaiting check')} count={pending.length}>
          {pending.map((r) => (
            <RepRow key={r._id} rep={r} ar={ar} onClick={() => setOpen(r)} />
          ))}
        </Section>
      )}

      {!!done.length && (
        <Section title={t('تمّ اليوم', 'Done today')} count={done.length}>
          {done.map((r) => <RepRow key={r._id} rep={r} ar={ar} onClick={() => setOpen(r)} />)}
        </Section>
      )}

      {open && <CheckModal rep={open} ar={ar} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); notify(t('سُجّل التفقّد', 'Check recorded'), 'success'); }} />}
    </div>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
    <p className={`text-xl font-extrabold ${tone || 'text-slate-900'}`}>{value}</p>
    <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
  </div>
);

const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
  <div>
    <p className="mb-2 text-xs font-bold text-slate-600">{title} <span className="text-slate-400">({count})</span></p>
    <div className="space-y-2">{children}</div>
  </div>
);

function RepRow({ rep, ar, onClick }: { rep: Rep; ar: boolean; onClick: () => void }) {
  const m = rep.check ? OUTCOME_META[rep.check.outcome] : null;
  const name = ar ? (rep.arabicName || rep.englishName) : rep.englishName;
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-start shadow-sm hover:border-[#f37121]/50">
      {rep.check?.photos?.[0]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={rep.check.photos[0].fileUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><Clock className="h-4 w-4" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-slate-900">{name}</span>
        <span className="block truncate text-[11px] text-slate-500">
          {[rep.repId, rep.branch?.name, rep.project?.name].filter(Boolean).join(' · ') || '—'}
        </span>
      </span>
      {m
        ? <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${m.cls}`}>{ar ? m.ar : m.en}</span>
        : <span className="shrink-0 rounded-md bg-[#f37121] px-3 py-1.5 text-[11px] font-bold text-white">{ar ? 'تفقّد' : 'Check'}</span>}
    </button>
  );
}

function CheckModal({ rep, ar, onClose, onSaved }: { rep: Rep; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [outcome, setOutcome] = useState<Outcome>(rep.check?.outcome || 'started');
  const [shots, setShots] = useState<Shot[]>([]);
  const [condition, setCondition] = useState(rep.check?.conditionAr || '');
  const [hasDamage, setHasDamage] = useState(!!rep.check?.hasDamage);
  const [damageNotes, setDamageNotes] = useState(rep.check?.damageNotes || '');
  const [vehicleType, setVehicleType] = useState(rep.check?.vehicleType || 'motorcycle');
  const [plate, setPlate] = useState(rep.check?.vehiclePlate || '');
  const [notes, setNotes] = useState(rep.check?.notes || '');
  const [saving, setSaving] = useState(false);
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);

  // الموضعُ يُطلَب بلا إلحاح: رفضُ الإذن لا يمنع التفقّد، لكنّه حين يوجد يجيب
  // عن السؤال الذي لا تجيب عنه الصورةُ وحدَها — أكان المشرفُ هناك حقًّا؟
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {}, { timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  const needsPhoto = outcome === 'started';
  const already = (rep.check?.photos || []).length;
  const canSave = !needsPhoto || shots.length > 0 || already > 0;

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/b2c/duty', {
        rep: rep._id, outcome, vehicleType, vehiclePlate: plate,
        conditionAr: condition, hasDamage, damageNotes, notes,
        photos: shots, location: loc || undefined,
      });
      onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-sm font-bold text-slate-900">{ar ? (rep.arabicName || rep.englishName) : rep.englishName}</p>
        <p className="mb-3 text-[11px] text-slate-500">{[rep.repId, rep.branch?.name].filter(Boolean).join(' · ')}</p>

        <div className="mb-3 grid grid-cols-3 gap-2">
          {(Object.keys(OUTCOME_META) as Outcome[]).map((k) => {
            const m = OUTCOME_META[k];
            const on = outcome === k;
            return (
              <button key={k} type="button" onClick={() => setOutcome(k)}
                className={`rounded-lg border px-2 py-2 text-[11.5px] font-semibold ${on ? m.cls : 'border-slate-200 bg-white text-slate-500'}`}>
                <m.Icon className="mx-auto mb-1 h-4 w-4" />{ar ? m.ar : m.en}
              </button>
            );
          })}
        </div>

        {needsPhoto ? (
          <>
            <LiveCamera ar={ar} shots={shots} onShot={(s) => setShots((p) => [...p, s])}
              onRemove={(i) => setShots((p) => p.filter((_, x) => x !== i))} disabled={saving} />
            {!!already && (
              <p className="mt-1 text-[11px] text-slate-500">
                {t(`محفوظ سابقًا: ${already} صورة — الجديدة تُضاف ولا تستبدلها.`,
                   `${already} photo(s) already saved — new ones are added, not replaced.`)}
              </p>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600">
            {t('لا صورة مطلوبة — لم تخرج مركبة.', 'No photo needed — no vehicle went out.')}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Field label={t('نوع المركبة', 'Vehicle')}>
            <select className={inp} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
              <option value="motorcycle">{t('دراجة نارية', 'Motorcycle')}</option>
              <option value="car">{t('سيارة', 'Car')}</option>
              <option value="other">{t('أخرى', 'Other')}</option>
            </select>
          </Field>
          <Field label={t('اللوحة', 'Plate')}>
            <input className={inp} value={plate} onChange={(e) => setPlate(e.target.value)} />
          </Field>
          <Field label={t('حالة المركبة', 'Condition')} span2>
            <ManagedSelect storeLabel type="b2c_vehicle_condition" value={condition} onChange={setCondition} />
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-red-600" checked={hasDamage} onChange={(e) => setHasDamage(e.target.checked)} />
          {t('بها تلف يستحقّ المتابعة', 'Has damage worth following up')}
        </label>
        {hasDamage && (
          <textarea className={`${inp} mt-2`} rows={2} placeholder={t('صف التلف…', 'Describe the damage…')}
            value={damageNotes} onChange={(e) => setDamageNotes(e.target.value)} />
        )}
        <textarea className={`${inp} mt-2`} rows={2} placeholder={t('ملاحظات (اختياري)', 'Notes (optional)')}
          value={notes} onChange={(e) => setNotes(e.target.value)} />

        <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
          <MapPin className="h-3 w-3" />
          {loc ? t(`سُجّل موقعك (±${Math.round(loc.accuracy || 0)}م)`, `Location captured (±${Math.round(loc.accuracy || 0)}m)`)
               : t('الموقع غير متاح — لا يمنع الحفظ', 'Location unavailable — does not block saving')}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">{t('إلغاء', 'Cancel')}</button>
          <button type="button" onClick={save} disabled={saving || !canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-[#f37121] px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t('حفظ التفقّد', 'Save check')}
          </button>
        </div>
        {!canSave && (
          <p className="mt-1 text-end text-[11px] text-red-600">{t('التقط صورة المركبة أولًا', 'Capture the vehicle photo first')}</p>
        )}
      </div>
    </div>
  );
}

const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
const Field = ({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) => (
  <div className={span2 ? 'col-span-2' : ''}>
    <label className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</label>
    {children}
  </div>
);
