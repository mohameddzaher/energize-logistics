'use client';
/**
 * Duty-start check: the supervisor's screen.
 * Two lists: reps (light-transport register) and motorbikes (vehicles register). A check applies to either and the server links them: a check on a motorbike with a rider (plate in the register or authorised to him) shows done for the rider, and a check on a rep shows on his motorbike.
 * The photo is captured from the camera and never uploaded; see `components/b2c/LiveCamera`.
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

// Three photos are required, a fourth on Thursday.
// The rep, motorbike and box photos are required to start duty. Advertising content is a photo of the sticker on the motorbike: requested weekly on Thursday only, it does not block starting duty and accepts several photos. The server rejects it on other days too.
type PhotoKind = 'rep' | 'vehicle' | 'box' | 'ad';
type KindShot = Shot & { kind: PhotoKind };
const REQUIRED_KINDS: { key: PhotoKind; ar: string; en: string; Icon: any }[] = [
  { key: 'rep', ar: 'صورة المندوب', en: 'Rider photo', Icon: User },
  { key: 'vehicle', ar: 'صورة الدبّاب', en: 'Bike photo', Icon: Bike },
  { key: 'box', ar: 'صورة البوكس', en: 'Box photo', Icon: Package },
];
const AD_KIND = { key: 'ad' as PhotoKind, ar: 'المحتوى الإعلاني', en: 'Ad content', Icon: Megaphone };
/** Thursday = 4 (Sunday is 0), in the device timezone, which is the supervisor's day. */
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
  /** His vehicle from the light-transport register: a rep drives a specific vehicle, so its plate is read and not typed. See `myReps` on the server. */
  vehicle?: { plate: string; typeAr: string; typeKey: string } | null;
  /** `ownerName` = the check supervisor responsible for him, which splits this screen. `opsSupervisorName` = the operations supervisor, shown for information and not for splitting. */
  ownerName?: string;
  opsSupervisorName?: string;
  hasDutySupervisor?: boolean;
  mine?: boolean;
  /** His ID/residence number from the light-transport register; searchable. */
  idNumber?: string;
}

/** A motorbike from the vehicles register, with its rider if known. See `myReps` on the server. */
interface BikeRowT {
  _id: string; plate: string; sectorAr?: string; cityAr?: string; departmentAr?: string;
  authorizedName?: string; rider: { _id: string; name: string; idNumber?: string } | null; check: Check | null;
}
type Opened = { rep: Rep; bikeId?: string; bikeOnly?: boolean };

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
    /** Department motorbikes: the plate is chosen from these for a row not linked to the register. */
    vehicleOptions?: { plate: string; typeAr: string; rider: string }[];
    bikes?: BikeRowT[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Opened | null>(null);
  // Check by rep or by motorbike; the two are linked on the server.
  const [mode, setMode] = useState<'reps' | 'bikes'>('reps');
  /**
   * My reps or All.
   * Assignment remains: each rep has a supervisor who is asked about him. But any supervisor can check any rep (a colleague is absent, or he stands at a station with others' men). The screen opens on his own reps (daily work) and switches to all in one click; a rep who is not his is labelled with his supervisor's name so it is clear he is covering.
   */
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const d: any = await api.get('/api/b2c/duty/my-reps');
      setData(d);
      // A supervisor with no assigned reps used to get an empty screen, so it opens on all.
      if (!d?.mineTotal) setScope('all');
    } catch { setData(null); }
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
      // Search by any number the asker has.
      // Someone at the station holds whatever came to hand: name, ID or residence number, motorbike plate or app account number. Search accepts all of them, and numbers are compared with separators stripped.
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
  const bikes = useMemo(() => {
    const term = fold(q.trim());
    const digits = term.replace(/\D/g, '');
    return (data?.bikes || []).filter((b) => {
      if (!term) return true;
      const hay = [b.plate, b.rider?.name, b.rider?.idNumber, b.authorizedName, b.cityAr, b.departmentAr];
      if (hay.some((x) => fold(String(x || '')).includes(term))) return true;
      return digits.length >= 3 && hay.some((x) => String(x || '').replace(/\D/g, '').includes(digits));
    });
  }, [data, q]);
  const bikesPending = useMemo(() => bikes.filter((b) => !b.check), [bikes]);
  const bikesDone = useMemo(() => bikes.filter((b) => b.check), [bikes]);
  // Opening a motorbike: with its rider if known (the check is written on him too), or alone.
  const openBike = (b: BikeRowT) => {
    const vehicle = { plate: b.plate, typeAr: 'دراجة آلية', typeKey: 'motorcycle' };
    const riderRep = b.rider ? all.find((r) => r._id === b.rider!._id) : null;
    const rep: Rep = riderRep
      ? { ...riderRep, vehicle, check: b.check || riderRep.check }
      : { _id: '', englishName: `${ar ? 'دبّاب' : 'Bike'} ${b.plate}`, vehicle, check: b.check };
    setOpen({ rep, bikeId: b._id, bikeOnly: !riderRep });
  };

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
          {/* Why some people are not shown is stated, so it is not mistaken for missing data. */}
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

      {/* Check by rep or by motorbike. */}
      <div className="grid grid-cols-2 gap-2">
        {([['reps', t(`المناديب (${data?.total ?? 0})`, `Riders (${data?.total ?? 0})`), User],
          ['bikes', t(`الدبّابات (${data?.bikes?.length ?? 0})`, `Bikes (${data?.bikes?.length ?? 0})`), Bike]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-bold ${mode === k
              ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {/* Display scope: my reps first; both counters refer to what is shown, not the whole register. */}
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'reps' && ([['mine', t(`تفقّدي أنا (${data?.mineTotal ?? 0})`, `My duty riders (${data?.mineTotal ?? 0})`)],
          ['all', t(`كل المناديب (${data?.total ?? 0})`, `All riders (${data?.total ?? 0})`)]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setScope(k as 'mine' | 'all')}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${scope === k
              ? 'border-[#f37121] bg-orange-50 text-[#f37121]' : 'border-slate-200 bg-white text-slate-600'}`}>
            {label}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={mode === 'bikes'
            ? t('ابحث باللوحة أو الراكب أو المفوَّض أو المدينة…', 'Search plate, rider, authorised person or city…')
            : t('ابحث بالاسم أو الهوية أو الإقامة أو اللوحة أو المشرف…', 'Search name, ID, iqama, plate or supervisor…')}
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px]" />
      </div>

      {mode === 'bikes' ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('الدبّابات المعروضة', 'Bikes shown')} value={bikes.length} />
            <Stat label={t('تمّ تفقّدها', 'Checked')} value={bikesDone.length} tone="text-emerald-600" />
            <Stat label={t('بقي', 'Remaining')} value={bikesPending.length} tone={bikesPending.length ? 'text-amber-600' : 'text-slate-400'} />
          </div>
          <p className="text-[11px] text-slate-500">
            {t('تفقّدُ دبّابٍ له راكبٌ في السجلّ أو مفوَّضٌ عليه يُسجَّل على المندوب أيضًا — ويظهر «تمّ» في القائمتين.',
               'Checking a bike with a known rider (register plate or authorisation) also counts for the rider — it shows as done in both lists.')}
          </p>
          {!!bikesPending.length && (
            <Section title={t('بانتظار التفقّد', 'Awaiting check')} count={bikesPending.length}>
              {bikesPending.map((b) => <BikeItem key={b._id} bike={b} ar={ar} onClick={() => openBike(b)} />)}
            </Section>
          )}
          {!!bikesDone.length && (
            <Section title={t('تمّ اليوم', 'Done today')} count={bikesDone.length}>
              {bikesDone.map((b) => <BikeItem key={b._id} bike={b} ar={ar} onClick={() => openBike(b)} />)}
            </Section>
          )}
          {!bikes.length && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">{t('لا نتائج', 'No results')}</div>
          )}
        </>
      ) : (<>
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
            <RepRow key={r._id} rep={r} ar={ar} onClick={() => setOpen({ rep: r })} />
          ))}
        </Section>
      )}

      {!!done.length && (
        <Section title={t('تمّ اليوم', 'Done today')} count={done.length}>
          {done.map((r) => <RepRow key={r._id} rep={r} ar={ar} onClick={() => setOpen({ rep: r })} />)}
        </Section>
      )}
      </>)}

      {open && <CheckModal rep={open.rep} bikeId={open.bikeId} bikeOnly={open.bikeOnly} ar={ar} plates={data?.vehicleOptions || []} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); notify(t('سُجّل التفقّد', 'Check recorded'), 'success'); }} />}
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

function BikeItem({ bike, ar, onClick }: { bike: BikeRowT; ar: boolean; onClick: () => void }) {
  const m = bike.check ? OUTCOME_META[bike.check.outcome] : null;
  const who = bike.rider?.name || (bike.authorizedName ? `${ar ? 'مفوَّض' : 'Authorised'}: ${bike.authorizedName}` : '');
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-start shadow-sm hover:border-[#f37121]/50">
      {bike.check?.photos?.[0]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={bike.check.photos[0].fileUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><Bike className="h-4 w-4" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13.5px] font-semibold text-slate-900"><bdi>{bike.plate}</bdi></span>
        <span className="block truncate text-[11px] text-slate-500">
          {[who || (ar ? 'بلا راكب في السجلّ' : 'No rider on record'), bike.cityAr, bike.departmentAr].filter(Boolean).join(' · ')}
        </span>
      </span>
      {m
        ? <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${m.cls}`}>{ar ? m.ar : m.en}</span>
        : <span className="shrink-0 rounded-md bg-[#f37121] px-3 py-1.5 text-[11px] font-bold text-white">{ar ? 'تفقّد' : 'Check'}</span>}
    </button>
  );
}

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
        {/* A rep who is not mine is labelled with his supervisor's name. Checking him is allowed but is covering, not the norm, so say so before the click and not after. */}
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
 * Full-size photo, opened from the review strip before saving.
 * A file-level component, not inside the render body, which would be rebuilt on every state change (inline components rule).
 * It is an overlay, not a second dialog: the check is not saved yet, so what the user is in must not close to show a photo. A tap anywhere closes, since touch has no small corner button.
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

function CheckModal({ rep, bikeId, bikeOnly, ar, plates, onClose, onSaved }: {
  rep: Rep; ar: boolean;
  /** A check opened from the motorbike list: the motorbike is known and its plate is not changed. */
  bikeId?: string;
  /** A motorbike with no known rider, so no rep photo. */
  bikeOnly?: boolean;
  /** Department motorbikes with their plates and register rider. */
  plates: { plate: string; typeAr: string; rider: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [outcome, setOutcome] = useState<Outcome>(rep.check?.outcome || 'started');
  const [shots, setShots] = useState<KindShot[]>([]);
  const [kind, setKind] = useState<PhotoKind>(bikeOnly ? 'vehicle' : 'rep');
  // A motorbike with no known rider: motorbike and box photos only, no rep to photograph; the server enforces the same.
  // Otherwise the three photos always apply: rep, motorbike and box.
  const NEEDED = REQUIRED_KINDS;
  // Saved value first (when editing a check), then the department register, then the common default.
  const [vehicleType, setVehicleType] = useState(
    rep.check?.vehicleType || rep.vehicle?.typeKey || 'motorcycle');
  const [plate, setPlate] = useState(rep.check?.vehiclePlate || rep.vehicle?.plate || '');
  // A plate that came from the register is shown read-only, and opened for typing with one click for someone out on a substitute vehicle, so it is not typed each morning and not locked when it changes.
  const fromRegister = !!rep.vehicle?.plate && !rep.check?.vehiclePlate;
  const [plateLocked, setPlateLocked] = useState(fromRegister);
  const [notes, setNotes] = useState(rep.check?.notes || '');
  const [saving, setSaving] = useState(false);
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  // The open photo at full size: opened by tapping its thumbnail in the review strip.
  const [preview, setPreview] = useState<{ dataUrl: string; label: string } | null>(null);

  // Location is requested gently: refusing permission does not block the check, but when present it answers what the photo cannot, whether the supervisor was really there.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {}, { timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  const needsPhoto = outcome === 'started';
  const already = (rep.check?.photos || []).length;
  // Each type has its own photo: previously saved ones count and new ones are added.
  const countOf = (k: PhotoKind) => shots.filter((s) => s.kind === k).length
    + (rep.check?.photos || []).filter((p) => (p.kind || 'vehicle') === k).length;
  const adDay = isThursday();
  const PHOTO_KINDS = adDay ? [...NEEDED, AD_KIND] : NEEDED;
  // Saving requires the three alone; advertising is an extra, not a requirement.
  const lacking = NEEDED.filter((k) => !countOf(k.key));
  /**
   * Someone who did not go out must say why.
   * Started duty is evidenced by three photos. Did not attend or was prevented from going out has no witness but the supervisor's word, and a whole day of income can drop on a click whose reason is unknown and asked about a week later. So the reason is required for both.
   * The server rejects it too (`NOTE_REQUIRED`); this is a pre-check, not a substitute.
   */
  const needsNote = outcome !== 'started';
  const noteMissing = needsNote && !notes.trim();
  const canSave = (needsPhoto ? !lacking.length : true) && !noteMissing;

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/b2c/duty', {
        // The subject is a row of the light-transport register, our reps' sheet. See `myReps`.
        ltEmployee: rep._id || undefined, vehicle: bikeId || undefined, outcome, vehicleType, vehiclePlate: plate,
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
        <p className="mb-3 text-[11px] text-slate-500">{[rep.repId, rep.branch?.name, bikeId ? rep.vehicle?.plate : ''].filter(Boolean).join(' · ')}</p>
        {bikeId && (
          <p className="-mt-2 mb-3 text-[11px] text-slate-500">
            {bikeOnly
              ? t('دبّابٌ بلا راكبٍ معروفٍ في السجلّ — الصورُ الثلاث مطلوبة: المندوبُ الذي أخرجه، والدبّاب، والبوكس.', 'No known rider — all three photos are required: the rider taking it out, the bike and the box.')
              : t('يُسجَّل التفقّد على الدبّاب وعلى راكبه معًا.', 'The check is recorded on the bike and its rider together.')}
          </p>
        )}

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
            {/* One photo per type. The limit was two per type, so the box was photographed two or three times for no reason: the check says this is him, his motorbike and his box, three photos and no more. To redo one, delete it from the review strip and capture reopens for that one. Advertising stays multiple since the sticker is photographed from several angles. */}
            <LiveCamera ar={ar} max={kind === 'ad' ? 6 : 1}
              label={t(`التقاط ${PHOTO_KINDS.find((k) => k.key === kind)!.ar}`, `Capture ${PHOTO_KINDS.find((k) => k.key === kind)!.en}`)}
              shots={shots.filter((s) => s.kind === kind)}
              onShot={(s) => {
                setShots((p) => [...p, { ...s, kind }]);
                // After capture, move to the first type not yet photographed. Advertising repeats, so it is not skipped after the first shot.
                const next = kind === 'ad' ? null : NEEDED.find((k) => k.key !== kind && !countOf(k.key));
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

            {/* All three are visible before saving. The screen showed only the selected type's photos, each shot hiding the previous, so one saved without seeing all three together, and a blurry or wrong photo was noticed only after saving. All are now in one strip before saving, labelled by type, each with a delete button that redoes only that one. */}
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
                        {/* The thumbnail opens. Reviewing a photo 20 px wide is not a review: blur and which motorbike are not visible. A tap opens it full size. */}
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
                {/* What is not photographed yet is named, so it is not hunted for among the chips. */}
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
            {/* Check applies to motorbikes. Car is not offered here: the screen asks about a motorbike and a box, and someone whose vehicle is a car does not appear in the list at all. Other remains for someone with no registered vehicle, whose description is typed. */}
            <select className={inp} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}
              disabled={plateLocked}>
              <option value="motorcycle">{t('دراجة نارية', 'Motorcycle')}</option>
              <option value="other">{t('أخرى', 'Other')}</option>
            </select>
          </Field>
          {/* Plate is chosen, not typed. His vehicle is in the register so it shows filled. Someone whose row is not linked to the register (a name that mismatched) used to type it each morning, incomplete or in another format. It is now a list of department motorbikes with the register rider's name: chosen once, and the server keeps the link so tomorrow it is filled. */}
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
                {/* A previously saved plate not in the list stays selected and is not erased. */}
                {!!plate && !plates.some((v) => v.plate === plate) && (
                  <option value={plate}>{plate}</option>
                )}
              </select>
            )}
          </Field>
        </div>
        {/* Where the plate came from and how to change it is stated, not guessed. */}
        {rep.vehicle?.plate && !bikeId && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <Bike className="h-3 w-3" />
            {plateLocked
              ? t(`مركبته في سجلّ النقل الخفيف${rep.vehicle.typeAr ? ` — ${rep.vehicle.typeAr}` : ''}`,
                  `His vehicle in the light-transport register${rep.vehicle.typeAr ? ` — ${rep.vehicle.typeAr}` : ''}`)
              : t('عُدِّلت يدويًّا — خرج على مركبةٍ غير مركبته.', 'Edited by hand — he went out on another vehicle.')}
            <button type="button" onClick={() => setPlateLocked((v) => {
              if (v) return false;                       // Opened for typing
              setPlate(rep.vehicle?.plate || '');        // Returned to his vehicle
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
        {/* The reason saving is blocked is named, such as missing box photo or missing reason, not a dimmed button with no explanation. */}
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
