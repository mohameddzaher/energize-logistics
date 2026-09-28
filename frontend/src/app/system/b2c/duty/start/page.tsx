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
  CheckCircle2, Clock, UserX, Ban, Camera, Loader2, MapPin, ShieldAlert, ClipboardList, User, Bike, Package,
  Megaphone, Images, X,
} from 'lucide-react';
import LiveCamera, { type Shot } from '@/components/b2c/LiveCamera';

// ── ثلاثٌ تُطلَب، ورابعةٌ يومَ الخميس ────────────────────────────────────────
// صورُ المندوب والدبّاب والبوكس شرطُ بدء الدوام. و«المحتوى الإعلاني» لقطةُ
// الملصق على الدبّاب: تُطلَب أسبوعيًّا يوم الخميس، فلا تظهر في غيره ولا تمنع
// بدءَ الدوام، وتقبل أكثرَ من صورة. والخادمُ يردّها في غير يومها كذلك.
type PhotoKind = 'rep' | 'vehicle' | 'box' | 'ad';
type KindShot = Shot & { kind: PhotoKind };
const REQUIRED_KINDS: { key: PhotoKind; ar: string; en: string; Icon: any }[] = [
  { key: 'rep', ar: 'صورة المندوب', en: 'Rider photo', Icon: User },
  { key: 'vehicle', ar: 'صورة الدبّاب', en: 'Bike photo', Icon: Bike },
  { key: 'box', ar: 'صورة البوكس', en: 'Box photo', Icon: Package },
];
const AD_KIND = { key: 'ad' as PhotoKind, ar: 'المحتوى الإعلاني', en: 'Ad content', Icon: Megaphone };
/** الخميس = ٤ (الأحد صفر) — بتوقيت الجهاز، وهو يومُ المشرف. */
const isThursday = (d = new Date()) => d.getDay() === 4;

type Outcome = 'started' | 'absent' | 'blocked';

interface Check {
  _id: string; outcome: Outcome; checkedAt?: string; conditionAr?: string;
  hasDamage?: boolean; damageNotes?: string; notes?: string; vehicleType?: string;
  vehiclePlate?: string; photos?: { fileUrl: string; kind?: PhotoKind }[];
}
interface Rep {
  _id: string; englishName: string; arabicName?: string; repId?: string; phone?: string;
  branch?: { name?: string }; project?: { name?: string }; check: Check | null;
  /**
   * مركبتُه من سجلّ النقل الخفيف — المندوبُ قائدُ مركبةٍ بعينها، فلوحتُها
   * تُقرأ ولا تُكتب. راجع `myReps` في الخادم.
   */
  vehicle?: { plate: string; typeAr: string; typeKey: string } | null;
  /**
   * `ownerName` = **مشرف التفقّد** المسؤول عنه — وبه تنقسم هذه الشاشة.
   * `opsSupervisorName` = المشرف التشغيليّ، يُعرَض للعلم لا للقسمة.
   */
  ownerName?: string;
  opsSupervisorName?: string;
  hasDutySupervisor?: boolean;
  mine?: boolean;
  /** رقمُ هويّته/إقامته من سجلّ النقل الخفيف — يُبحَث به. */
  idNumber?: string;
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

  const [data, setData] = useState<{
    reps: Rep[]; dateKey: string; done: number; total: number;
    mineDone?: number; mineTotal?: number; carsExcluded?: number; unassigned?: number;
    /** دبّاباتُ القسم — تُختار منها اللوحةُ لمن لا صلةَ لصفّه بالسجلّ. */
    vehicleOptions?: { plate: string; typeAr: string; rider: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Rep | null>(null);
  /**
   * ── «مناديبي» أو «الكلّ» ────────────────────────────────────────────────
   * الإسنادُ باقٍ: لكلّ مندوبٍ مشرفُه، وهو ما يُسأل عنه. لكنّ أيَّ مشرفٍ يتفقّد
   * أيَّ مندوب — يغيب زميلٌ، أو يقف على محطّةٍ فيها رجالُ غيره. فالشاشةُ تفتح
   * على رجاله (عملُه اليوميّ) وتُفتَح على الكلّ بضغطة، ومن ليس من رجاله يُعلَّم
   * باسم مشرفه كي يُعرَف أنّه ينوب عنه.
   */
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get('/api/b2c/duty/my-reps')); } catch { setData(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('b2c:duty', useCallback(() => load(), [load]));

  const all = data?.reps || [];
  const fold = (v: string) => v.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  const reps = useMemo(() => {
    const term = fold(q.trim());
    return all.filter((r) => {
      if (scope === 'mine' && !r.mine) return false;
      if (!term) return true;
      // ── ويُبحَث بأيّ رقمٍ في يد السائل ───────────────────────────────────
      // مَن يقف عند المحطّة يحمل ما وقع في يده: اسمَه، أو رقمَ هويّته أو
      // إقامته، أو لوحةَ دبّابه، أو رقمَ حسابه على التطبيق. فالبحثُ يقبلها كلَّها
      // — والرقمُ يُقارَن مجرَّدًا من الفواصل، فـ«2570614806» تجد «2570614806».
      const digits = term.replace(/\D/g, '');
      const hay = [r.englishName, r.arabicName, r.repId, r.idNumber,
        r.vehicle?.plate, r.vehicle?.typeAr, r.ownerName, r.branch?.name, r.project?.name];
      if (hay.some((x) => fold(String(x || '')).includes(term))) return true;
      if (digits.length >= 3) {
        return hay.some((x) => String(x || '').replace(/\D/g, '').includes(digits));
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, scope, q]);
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
            {t('لا يخرج المندوب إلا بثلاث صور: المندوب والدبّاب والبوكس — تُلتقط الآن ولا تُرفع من الجهاز.',
               'A rider only goes out after three photos: rider, bike and box — captured live, never uploaded.')}
          </p>
          {/* ولماذا لا يظهر بعضُهم — يُقال، فلا يُحسَب نقصًا في البيانات. */}
          {!!data?.unassigned && (
            <p className="mt-0.5 text-[11px] text-amber-700">
              {t(`${data.unassigned} مندوبًا بلا مشرف تفقّد — لا يظهرون في قائمة أحد. أُسندهم من «موظفون النقل الخفيف».`,
                 `${data.unassigned} riders have no duty supervisor — they are in nobody's list. Assign them on the light-transport page.`)}
            </p>
          )}
          {!!data?.carsExcluded && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {t(`التفقّد للدبّابات — استُثني ${data.carsExcluded} من قائدي السيارات والفان.`,
                 `Bikes only — ${data.carsExcluded} car and van drivers are excluded.`)}
            </p>
          )}
        </div>
        <Link href="/system/b2c/duty"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:text-[#f37121]">
          <ClipboardList className="h-3.5 w-3.5" />{t('السجلّ والتحليل', 'Register & analysis')}
        </Link>
      </div>

      {/* نطاقُ العرض: رجالي أوّلًا — والعدّادان يخصّان المعروضَ لا السجلَّ كلَّه. */}
      <div className="flex flex-wrap items-center gap-2">
        {([['mine', t(`تفقّدي أنا (${data?.mineTotal ?? 0})`, `My duty riders (${data?.mineTotal ?? 0})`)],
          ['all', t(`كل المناديب (${data?.total ?? 0})`, `All riders (${data?.total ?? 0})`)]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setScope(k as 'mine' | 'all')}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${scope === k
              ? 'border-[#f37121] bg-orange-50 text-[#f37121]' : 'border-slate-200 bg-white text-slate-600'}`}>
            {label}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t('ابحث بالاسم أو الهوية أو الإقامة أو اللوحة أو المشرف…', 'Search name, ID, iqama, plate or supervisor…')}
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px]" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label={scope === 'mine' ? t('مندوبوك', 'Your riders') : t('المعروضون', 'Shown')} value={reps.length} />
        <Stat label={t('تمّ تفقّدهم', 'Checked')} value={done.length} tone="text-emerald-600" />
        <Stat label={t('بقي', 'Remaining')} value={pending.length} tone={pending.length ? 'text-amber-600' : 'text-slate-400'} />
      </div>

      {!reps.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">
            {scope === 'mine' ? t('لا مندوبين في تفقّدك', 'No riders in your duty list') : t('لا نتائج', 'No results')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {scope === 'mine'
              ? t('مشرف التفقّد يُسنَد من صفحة «موظفون النقل الخفيف»: علِّم المناديب واختر «إسناد مشرف». ويمكنك تفقّد أيّ مندوب من «كل المناديب».',
                  'The duty supervisor is assigned on the light-transport page: tick riders and choose “Assign supervisor”. You can also check any rider from “All riders”.')
              : t('جرّب اسمًا آخر أو امسح البحث.', 'Try another name or clear the search.')}
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

      {open && <CheckModal rep={open} ar={ar} plates={data?.vehicleOptions || []} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); notify(t('سُجّل التفقّد', 'Check recorded'), 'success'); }} />}
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
          {[rep.repId, rep.branch?.name, rep.project?.name, rep.vehicle?.plate].filter(Boolean).join(' · ') || '—'}
        </span>
        {/* ── ومن ليس من رجالي يُعلَّم باسم مشرفه ──────────────────────────────
            أتفقّده جائزٌ، لكنّه نيابةٌ لا أصل — فيُقال قبل الضغط لا بعده. */}
        {!rep.mine && (
          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">
            {rep.ownerName
              ? (ar ? `مشرف تفقّده: ${rep.ownerName}` : `Duty supervisor: ${rep.ownerName}`)
              : (ar ? 'بلا مشرف تفقّد' : 'No duty supervisor')}
          </span>
        )}
      </span>
      {m
        ? <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${m.cls}`}>{ar ? m.ar : m.en}</span>
        : <span className="shrink-0 rounded-md bg-[#f37121] px-3 py-1.5 text-[11px] font-bold text-white">{ar ? 'تفقّد' : 'Check'}</span>}
    </button>
  );
}

/**
 * الصورةُ بحجم الشاشة — تُفتَح من شريط المراجعة قبل الحفظ.
 *
 * مكوّنٌ على مستوى الملفّ لا داخلَ جسم الرسم: المعرَّفُ في الرسم يُبنى من جديدٍ
 * عند كلّ حالةٍ تتغيّر. راجع قاعدةَ «المكوّنات المضمَّنة».
 *
 * وطبقةٌ فوق النافذة لا نافذةٌ ثانية: التفقّدُ لم يُحفَظ بعد، فلا يُغلَق ما هو
 * فيه لتُرى صورة. والضغطُ في أيّ موضعٍ يغلق — واللمسُ على الهاتف لا يعرف زرًّا
 * صغيرًا في زاوية.
 */
function PhotoViewer({ shot, ar, onClose }: { shot: { dataUrl: string; label: string }; ar: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 p-3"
      onClick={onClose} role="presentation">
      {!!shot.label && (
        <p className="mb-2 text-[12.5px] font-bold text-white">{shot.label}</p>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.dataUrl} alt={shot.label}
        className="max-h-[80vh] max-w-full rounded-xl object-contain" />
      <button type="button" onClick={onClose}
        className="mt-3 rounded-lg bg-white/15 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-white/25">
        {ar ? 'إغلاق' : 'Close'}
      </button>
    </div>
  );
}

function CheckModal({ rep, ar, plates, onClose, onSaved }: {
  rep: Rep; ar: boolean;
  /** دبّاباتُ القسم بلوحاتها وراكبها في السجلّ. */
  plates: { plate: string; typeAr: string; rider: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [outcome, setOutcome] = useState<Outcome>(rep.check?.outcome || 'started');
  const [shots, setShots] = useState<KindShot[]>([]);
  const [kind, setKind] = useState<PhotoKind>('rep');
  // المحفوظُ أوّلًا (تفقّدٌ يُعدَّل)، ثمّ سجلُّ القسم، ثمّ الافتراضُ الشائع.
  const [vehicleType, setVehicleType] = useState(
    rep.check?.vehicleType || rep.vehicle?.typeKey || 'motorcycle');
  const [plate, setPlate] = useState(rep.check?.vehiclePlate || rep.vehicle?.plate || '');
  // ولوحةٌ جاءت من السجلّ تُعرَض مقروءةً، وتُفتَح للكتابة بضغطةٍ لمن خرج على
  // مركبةٍ بديلة — فلا تُكتب كلَّ صباحٍ ولا تُحبَس حين تتغيّر.
  const fromRegister = !!rep.vehicle?.plate && !rep.check?.vehiclePlate;
  const [plateLocked, setPlateLocked] = useState(fromRegister);
  const [notes, setNotes] = useState(rep.check?.notes || '');
  const [saving, setSaving] = useState(false);
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  // الصورةُ المفتوحةُ بحجمها — تُفتَح بالضغط على مُصغَّرها في شريط المراجعة.
  const [preview, setPreview] = useState<{ dataUrl: string; label: string } | null>(null);

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
  // كلُّ نوعٍ له صورتُه: المحفوظُ سابقًا يُحسب، والجديدُ يُضاف إليه.
  const countOf = (k: PhotoKind) => shots.filter((s) => s.kind === k).length
    + (rep.check?.photos || []).filter((p) => (p.kind || 'vehicle') === k).length;
  const adDay = isThursday();
  const PHOTO_KINDS = adDay ? [...REQUIRED_KINDS, AD_KIND] : REQUIRED_KINDS;
  // المطلوبُ للحفظ هو الثلاثةُ وحدَها — والإعلانيّ زيادةٌ لا شرط.
  const lacking = REQUIRED_KINDS.filter((k) => !countOf(k.key));
  /**
   * ── ومَن لم يخرج يُسأل: لماذا ─────────────────────────────────────────────
   * «بدأ الدوام» تشهد له ثلاثُ صور. و«لم يحضر»/«مُنع من الخروج» ليس لهما شاهدٌ
   * إلّا كلمةُ المشرف — ويومُ دخلٍ كاملٌ يسقط بضغطةٍ لا يُعرَف سببُها، ثمّ يُسأل
   * عنه بعد أسبوعٍ فلا جواب. فالسببُ شرطٌ لهما.
   * والخادمُ يردّ كذلك (`NOTE_REQUIRED`) — وهذا منعٌ قبل الرحلة لا بدلٌ عنه.
   */
  const needsNote = outcome !== 'started';
  const noteMissing = needsNote && !notes.trim();
  const canSave = (needsPhoto ? !lacking.length : true) && !noteMissing;

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/b2c/duty', {
        // الموضوعُ صفُّ سجلّ النقل الخفيف — كشفُ مناديبنا. راجع `myReps`.
        ltEmployee: rep._id, outcome, vehicleType, vehiclePlate: plate,
        notes,
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
            <div className={`mb-2 grid gap-2 ${adDay ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {PHOTO_KINDS.map((k) => {
                const n = countOf(k.key);
                const on = kind === k.key;
                return (
                  <button key={k.key} type="button" onClick={() => setKind(k.key)}
                    className={`relative rounded-lg border px-2 py-2 text-[11.5px] font-semibold ${on ? 'border-[#f37121] bg-orange-50 text-[#f37121]' : 'border-slate-200 bg-white text-slate-600'}`}>
                    <k.Icon className="mx-auto mb-1 h-4 w-4" />{ar ? k.ar : k.en}
                    {n > 0 && <CheckCircle2 className="absolute top-1 end-1 h-3.5 w-3.5 text-emerald-600" />}
                  </button>
                );
              })}
            </div>
            {kind === 'ad' && (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                {t('صور المحتوى الإعلاني متاحة اليوم (الخميس) فقط، ويمكن إضافة أكثر من صورة.',
                   'Ad-content photos are available today (Thursday) only, and you may add more than one.')}
              </p>
            )}
            {/* ── صورةٌ واحدةٌ لكلّ نوع ─────────────────────────────────────
                كان الحدُّ صورتين لكلّ نوع، فيُصوَّر البوكسُ مرّتين وثلاثًا ولا
                معنى لذلك: التفقّدُ يقول «هذا هو، وهذا دبّابُه، وهذا بوكسُه» —
                ثلاثُ صورٍ لا أكثر. ومن أراد إعادةَ واحدةٍ يمسحها من شريط
                المراجعة فيُفتَح التصويرُ لها وحدَها.
                والإعلانيُّ يبقى متعدّدًا: الملصقُ يُصوَّر من أوجهٍ عدّة. */}
            <LiveCamera ar={ar} max={kind === 'ad' ? 6 : 1}
              label={t(`التقاط ${PHOTO_KINDS.find((k) => k.key === kind)!.ar}`, `Capture ${PHOTO_KINDS.find((k) => k.key === kind)!.en}`)}
              shots={shots.filter((s) => s.kind === kind)}
              onShot={(s) => {
                setShots((p) => [...p, { ...s, kind }]);
                // بعد الالتقاط ينتقل إلى أوّل نوعٍ لم يُصوَّر بعد.
                // الإعلانيُّ يتكرّر، فلا يُقفَز عنه بعد أوّل لقطة.
                const next = kind === 'ad' ? null : REQUIRED_KINDS.find((k) => k.key !== kind && !countOf(k.key));
                if (next) setKind(next.key);
              }}
              onOpen={(sh) => setPreview({
                dataUrl: sh.dataUrl,
                label: (() => { const m = [...REQUIRED_KINDS, AD_KIND].find((k) => k.key === kind); return m ? (ar ? m.ar : m.en) : ''; })(),
              })}
              onRemove={(i) => setShots((p) => {
                const mine = p.filter((s) => s.kind === kind);
                const target = mine[i];
                return p.filter((s) => s !== target);
              })} disabled={saving} />
            {!!already && (
              <p className="mt-1 text-[11px] text-slate-500">
                {t(`محفوظ سابقًا: ${already} صورة — الجديدة تُضاف ولا تستبدلها.`,
                   `${already} photo(s) already saved — new ones are added, not replaced.`)}
              </p>
            )}

            {/* ── ويراها الثلاثةَ قبل أن يحفظ ────────────────────────────────
                كانت الشاشةُ تعرض صورَ النوع المختار وحدَه: يُصوّر المندوبَ ثمّ
                الدبّابَ ثمّ البوكسَ، وكلُّ لقطةٍ تُخفي ما قبلها. فيحفظ وهو لم
                يرَ الثلاثةَ معًا — وإن كانت إحداها مهزوزةً أو لغير صاحبها لم
                يُعلَم إلّا بعد الحفظ.

                فصارت كلُّها معروضةً في شريطٍ واحدٍ قبل الحفظ، مسمّاةً بنوعها،
                وعلى كلٍّ منها زرُّ حذفٍ يعيد التقاطَها وحدَها. */}
            {!!shots.length && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold text-slate-700">
                  <Images className="h-3.5 w-3.5 text-[#f37121]" />
                  {t(`راجع الصور قبل الحفظ (${shots.length})`, `Review the photos before saving (${shots.length})`)}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {shots.map((sh, i) => {
                    const meta = [...REQUIRED_KINDS, AD_KIND].find((k) => k.key === sh.kind);
                    return (
                      <div key={`${sh.fileName}-${i}`} className="relative shrink-0">
                        {/* ── والمُصغَّرُ يُفتَح ──────────────────────────────
                            مراجعةٌ على صورةٍ بعرض عشرين بكسلًا ليست مراجعة: لا
                            يُعرَف منها أمهزوزةٌ هي أم واضحة، ولا أهذا دبّابُه.
                            فالضغطُ يفتحها بحجم الشاشة. */}
                        <button type="button"
                          onClick={() => setPreview({ dataUrl: sh.dataUrl, label: meta ? (ar ? meta.ar : meta.en) : '' })}
                          title={t('اضغط لعرض الصورة', 'Tap to view')}
                          className="block overflow-hidden rounded-lg border border-slate-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={sh.dataUrl} alt={meta ? (ar ? meta.ar : meta.en) : ''}
                            className="h-24 w-20 object-cover" />
                        </button>
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-black/55 px-1 py-0.5 text-center text-[9.5px] font-semibold text-white">
                          {meta ? (ar ? meta.ar : meta.en) : ''}
                        </span>
                        <button type="button" disabled={saving}
                          onClick={() => setShots((p) => p.filter((x) => x !== sh))}
                          title={t('حذف وإعادة التصوير', 'Delete and retake')}
                          className="absolute -top-1.5 -end-1.5 rounded-full bg-red-600 p-1 text-white shadow disabled:opacity-50">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10.5px] text-slate-400">
                  {t('اضغط أيّ صورة لعرضها بحجمها · ✕ لمسحها وإعادة تصويرها',
                     'Tap a photo to view it full size · ✕ to delete and retake')}
                </p>
                {/* وما لم يُصوَّر بعد يُقال بالاسم، فلا يُبحَث عنه في الشرائح. */}
                {!!lacking.length && (
                  <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
                    {t(`ناقص: ${lacking.map((k) => k.ar).join(' · ')}`,
                       `Missing: ${lacking.map((k) => k.en).join(' · ')}`)}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600">
            {t('لا صورة مطلوبة — لم تخرج مركبة.', 'No photo needed — no vehicle went out.')}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Field label={t('نوع المركبة', 'Vehicle')}>
            {/* ── والتفقّدُ للدبّابات ─────────────────────────────────────────
                «سيّارة» لا تُختار هنا: الشاشةُ تسأل عن دبّابٍ وبوكسٍ، ومن مركبتُه
                سيّارةٌ لا يظهر في القائمة أصلًا. وتبقى «أخرى» لمن لا مركبةَ
                مسجَّلةً له فيُكتب وصفُها. */}
            <select className={inp} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}
              disabled={plateLocked}>
              <option value="motorcycle">{t('دراجة نارية', 'Motorcycle')}</option>
              <option value="other">{t('أخرى', 'Other')}</option>
            </select>
          </Field>
          {/* ── واللوحةُ تُختار لا تُكتب ─────────────────────────────────────
              مركبتُه مكتوبةٌ في السجلّ فتُعرَض مملوءة. ومن لا صلةَ لصفّه بالسجلّ
              (اسمٌ التبس على المطابقة) كان يكتبها بيده كلَّ صباحٍ — فتُكتب ناقصةً
              أو بصيغةٍ أخرى. فصارت قائمةَ دبّابات القسم مع اسم راكبها في السجلّ:
              يُختار مرّةً، ويحفظ الخادمُ الصلةَ فيجدها الغدُ مملوءة. */}
          <Field label={t('اللوحة', 'Plate')}>
            {plateLocked ? (
              <input className={`${inp} bg-slate-50 font-mono`} value={plate} readOnly />
            ) : (
              <select className={`${inp} font-mono`} value={plate} onChange={(e) => setPlate(e.target.value)}>
                <option value="">{t('— اختر اللوحة —', '— pick the plate —')}</option>
                {plates.map((v) => (
                  <option key={v.plate} value={v.plate}>
                    {v.plate}{v.rider ? ` — ${v.rider.slice(0, 26)}` : ''}
                  </option>
                ))}
                {/* لوحةٌ محفوظةٌ سابقًا وليست في القائمة تبقى مختارةً لا تُمحى. */}
                {!!plate && !plates.some((v) => v.plate === plate) && (
                  <option value={plate}>{plate}</option>
                )}
              </select>
            )}
          </Field>
        </div>
        {/* من أين جاءت اللوحة، وكيف تُغيَّر — يُقال صراحةً لا يُخمَّن. */}
        {rep.vehicle?.plate && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <Bike className="h-3 w-3" />
            {plateLocked
              ? t(`مركبته في سجلّ النقل الخفيف${rep.vehicle.typeAr ? ` — ${rep.vehicle.typeAr}` : ''}`,
                  `His vehicle in the light-transport register${rep.vehicle.typeAr ? ` — ${rep.vehicle.typeAr}` : ''}`)
              : t('عُدِّلت يدويًّا — خرج على مركبةٍ غير مركبته.', 'Edited by hand — he went out on another vehicle.')}
            <button type="button" onClick={() => setPlateLocked((v) => {
              if (v) return false;                       // فُتحت للكتابة
              setPlate(rep.vehicle?.plate || '');        // رجعت إلى مركبته
              setVehicleType(rep.vehicle?.typeKey || vehicleType);
              return true;
            })}
              className="font-semibold text-[#f37121] underline">
              {plateLocked ? t('تغيير', 'change') : t('رجوع لمركبته', 'back to his vehicle')}
            </button>
          </p>
        )}
        {!rep.vehicle?.plate && (
          <p className="mt-1 text-[11px] text-amber-700">
            {t('لا صلةَ لحسابه بصفٍّ في سجلّ النقل الخفيف — اختر لوحته من القائمة مرّةً واحدة، وستُحفَظ فتجدها مملوءةً غدًا.',
               'His account is not linked to a register row — pick his plate once and it will be remembered for tomorrow.')}
          </p>
        )}
        <textarea
          className={`${inp} mt-2 ${noteMissing ? 'border-amber-400 bg-amber-50/60' : ''}`}
          rows={needsNote ? 3 : 2}
          placeholder={needsNote
            ? (outcome === 'absent'
              ? t('سبب عدم الحضور — مطلوب', 'Reason for the absence — required')
              : t('سبب المنع من الخروج — مطلوب', 'Reason he was blocked — required'))
            : t('ملاحظات (اختياري)', 'Notes (optional)')}
          value={notes} onChange={(e) => setNotes(e.target.value)} />
        {noteMissing && (
          <p className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-amber-700">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            {outcome === 'absent'
              ? t('اكتب سبب عدم الحضور — يُقرأ في المراجعة بعد أسبوع.', 'Write why he was absent — it is read back on review.')
              : t('اكتب سبب المنع من الخروج — يُقرأ في المراجعة بعد أسبوع.', 'Write why he was blocked — it is read back on review.')}
          </p>
        )}

        {preview && <PhotoViewer shot={preview} ar={ar} onClose={() => setPreview(null)} />}

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
        {/* وسببُ المنعِ من الحفظ يُقال باسمه: «ناقص: صورة البوكس» أو «ناقص:
            السبب» — لا زرٌّ باهتٌ بلا تفسير. */}
        {!canSave && (
          <p className="mt-1 text-end text-[11px] text-red-600">
            {t(`ناقص: ${[...(needsPhoto ? lacking.map((k) => k.ar) : []), ...(noteMissing ? ['السبب'] : [])].join('، ')}`,
               `Missing: ${[...(needsPhoto ? lacking.map((k) => k.en) : []), ...(noteMissing ? ['the reason'] : [])].join(', ')}`)}
          </p>
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
