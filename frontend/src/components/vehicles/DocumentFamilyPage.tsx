'use client';
// ── صفحةُ عائلةِ مستندٍ واحدة: بطاقات التشغيل، التفاويض، رخص السير… ──────────
//
// المشكلة التي تحلّها ليست نقصًا في البيانات. أرقام بطاقات التشغيل مسجَّلة على
// مئتين وعشرين مركبة، وأرقام التفاويض على مئتين وإحدى وعشرين، وكلُّها في قاعدة
// البيانات منذ الاستيراد. الذي كان ناقصًا هو **عمودٌ يعرضها**: قائمةُ المركبات
// العامّة تعرض اللوحة والقطاع والمالك، فمن يفلتر على بطاقة التشغيل يحصل على
// الصفوف الصحيحة ولا يرى رقمَ بطاقةٍ واحدة فيها — فيظنّ الملف لم يُستورَد.
//
// ولماذا صفحةٌ لكل عائلة لا أعمدةٌ إضافية في القائمة العامّة: أعمدةُ المستندات
// الستّة مجتمعةً تجاوز الأربعين عمودًا، وجدولٌ بأربعين عمودًا لا يُقرأ. وفي
// الملف المصدر كانت كلُّ عائلةٍ مجموعةً بلونها وحدها — والشاشة تتبع الورقة التي
// يعرفها القسم.
//
// وكلُّ صفحةٍ من السبع لا تكتب من هذا شيئًا: تصف أعمدتها وتنتهي. لو نُسخ الهيكل
// سبع مرات لافترقت النسخُ عند أوّل تعديل — يُصلَح ترتيبُ العنوان في واحدة ويبقى
// في ستّ، ويُضاف زرُّ التجديد في واحدة ويغيب عن ستّ.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { syncUrl } from '@/lib/urlSync';
import { docNeed } from '@/lib/vehicleRegistry';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import { RenewModal, BulkRenewModal, SharedPolicyRenewModal, type RenewTarget } from '@/components/vehicles/RenewModals';
import { ColumnFilter } from '@/components/ColumnFilter';
import { ArrowRight, RefreshCw, Plus, Pencil, Eraser, Trash2, X, Save, Search } from 'lucide-react';

/** مجموعةٌ فارغةٌ ثابتة — لئلّا تُبنى واحدةٌ جديدة في كلّ رسمةٍ فتُعاد اللوحة. */
const EMPTY_SET: Set<string> = new Set();
import { VReg, DOC_TYPES, daysText, STATE_META, publicState, canEditVehicles, canAdminVehicles, isSharedPaper } from '@/lib/vehicleRegistry';
import { flexIncludes } from '@/lib/flexMatch';
import ManagedSelect from '@/components/system/ManagedSelect';

/** عمودٌ واحد: كيف يُقرأ من المركبة، وكيف يُسمّى، وكيف يُرسَم. */
export type DocColumn = {
  key: string;
  ar: string; en: string;
  /** القيمة الخام — يُبنى منها العمود والتصدير معًا فلا يفترق الملفّ عن الشاشة. */
  get: (v: VReg) => string | number | null | undefined;
  /** أرقامُ الأوراق تُقرأ يسارًا إلى يمين مهما كانت لغة الصفحة. */
  mono?: boolean;
  width?: number;
};

/**
 * حقلٌ واحد قابلٌ للتحرير من حقول هذه العائلة.
 *
 * وهو غيرُ `DocColumn` عمدًا: العمود يَعرِض وقد يكون محسوبًا («مفتوح — بلا سقف»
 * نصٌّ يُبنى من حقلين)، والحقل يُكتب فيُحفَظ فلا بدّ له من مسارٍ حقيقيّ في
 * المركبة. جعلُهما واحدًا كان يعني إمّا أعمدةً لا تُحرَّر أو حقولًا تُكتب في
 * لا مكان.
 */
export type DocField = {
  /** المسار في مستند المركبة: `operatingCard.cardNumber`. */
  path: string;
  ar: string; en: string;
  kind?: 'text' | 'date' | 'number' | 'flag';
  /** خانةُ اختيارٍ تكتب نصًّا: «مفتوح» في `fuelCard.limitStatus` ليست صحيحًا/خطأً. */
  on?: string; off?: string;
  mono?: boolean;
  /** يأخذ عرضَ الشبكة كلَّه — للأسماء الطويلة. */
  wide?: boolean;
  hint?: string;
  /**
   * نوعُ قائمةٍ منسدلة يُملأ منها الحقل بدل الكتابة الحرّة — تُدار من
   * «إعدادات القسم ← القوائم المنسدلة». الخانةُ الحرّة تُكتب بألف صيغة:
   * «سائق نقل ثقيل» و«سائق ثقيل» و«سائق» ثلاثةُ مسمّياتٍ لواحد، فيصير الفلترُ
   * ثلاثةَ خيارات. ويُخزَّن الاسمُ العربيّ لا المفتاح، لأنّ المخزَّن نصٌّ
   * عربيٌّ منذ أوّل استيراد وتقرؤه الفلاتر والتصديرات.
   */
  lookup?: string;
};

/** قراءةُ مسارٍ منقوط. `?.` لا يكفي هنا لأن المسار نصٌّ لا يُعرَف إلا وقت التشغيل. */
const readPath = (o: any, path: string) =>
  path.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);

/** بناءُ كائنٍ متداخل من مسارٍ منقوط — **متداخلًا لا منقوطًا**، انظر أدناه. */
const writePath = (o: any, path: string, val: any) => {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[ks[ks.length - 1]] = val;
  return o;
};

/**
 * ما يُرسَل إلى الخادم متداخلٌ دائمًا، لا `{'operatingCard.cardNumber': …}`.
 *
 * `express-mongo-sanitize` على الخادم يحذف كلَّ مفتاحٍ فيه نقطة قبل أن يصل إلى
 * المتحكّم، فالمسارُ المنقوط يُرسَل ويختفي في صمت: تظهر رسالةُ «تم الحفظ» ولا
 * يتغيّر شيء. والمتحكّم هو الذي يُسطِّح المتداخلَ إلى مساراتٍ فيدمج بدل أن يستبدل.
 */
const buildPatch = (fields: DocField[], vals: Record<string, any>) => {
  const out: any = {};
  for (const f of fields) {
    const raw = vals[f.path];
    let v: any;
    if (f.kind === 'number') v = raw === '' || raw == null ? null : Number(raw);
    else if (f.kind === 'date') v = raw ? raw : null;
    else if (f.kind === 'flag') v = raw ? (f.on ?? 'open') : (f.off ?? '');
    else v = raw ?? '';
    writePath(out, f.path, v);
  }
  return out;
};

/** أوّلُ جزءٍ من كل مسار — الكائنُ الذي تعيش فيه العائلة (`gps`, `insurance`…). */
const rootsOf = (fields: DocField[]) =>
  [...new Set(fields.map((f) => f.path.split('.')[0]).filter((r) => r))];

/** أهذه المركبة مسجَّلٌ عليها شيءٌ من هذه العائلة أصلًا؟ */
const filled = (x: any) => x !== null && x !== undefined && x !== '';
const hasDoc = (v: VReg, fields: DocField[], keyField?: string) => (keyField
  ? filled(readPath(v, keyField))
  : fields.some((f) => filled(readPath(v, f.path))));

/** قيمةُ الحقل كما تقبلها خانةُ الإدخال — التاريخ يُقتطع إلى `YYYY-MM-DD`. */
const inputValue = (v: VReg | null, f: DocField) => {
  const raw = v ? readPath(v, f.path) : undefined;
  if (f.kind === 'flag') return !!raw && raw === (f.on ?? 'open');
  if (raw === null || raw === undefined) return '';
  if (f.kind === 'date') return String(raw).slice(0, 10);
  return raw;
};

/**
 * حالةُ هذا المستند على هذه المركبة، بالاسم الذي يفهمه `STATE_META`.
 * تُقرأ من `docStatuses` الذي يحسبه الخادم بعتبات الإعدادات — لا تُحسَب هنا،
 * وإلا لاختلفت ألوان هذه الشاشة عن شاشة التنبيهات على نفس المركبة نفسِها.
 */
const stateOf = (v: VReg, docKey: string) => {
  const s = v.docStatuses?.[docKey];
  if (!s) return { state: 'missing', days: null as number | null };
  const state = s.status === 'none' ? 'missing' : s.status === ('not_required' as any) ? 'not_applicable' : s.status;
  return { state, days: s.days };
};

function DocumentFamilyPageInner({
  docKey, path, icon, titleAr, titleEn, subtitleAr, subtitleEn, columns, fileName, searchIn, chips, fields, keyField, rowAction,
}: {
  /**
   * مفتاح المستند ذي تاريخ الانتهاء — أو `null` لعائلةٍ لا تنتهي.
   *
   * شريحةُ بترو اب من هذا الثاني: لها رقمٌ وحالةٌ وسقفُ صرف ولا تاريخَ انتهاء
   * لها. وإقحامُها في عمود «الأيام المتبقية» كان سيجعل ثلاثمئة مركبة تظهر
   * «بلا تاريخ» في شاشةٍ لا معنى للتاريخ فيها أصلًا — نقصٌ مُختلَق يُوهم أن
   * ثَمّ عملًا مطلوبًا. ومعه يسقط زرُّ التجديد: لا يُجدَّد ما لا ينتهي.
   */
  docKey: string | null;
  /** مسار هذه الصفحة — الفلاتر تعيش في عنوانها هي لا في عنوان غيرها. */
  path: string;
  icon: React.ReactNode;
  titleAr: string; titleEn: string;
  subtitleAr: string; subtitleEn: string;
  columns: DocColumn[];
  fileName: string;
  /** الحقول التي يمسّها البحث السريع فوق الجدول. */
  searchIn?: (v: VReg) => (string | number | null | undefined)[];
  /** شرائح خاصة بالعائلة — تحلّ محلّ شرائح الحالة حين لا مستندَ ينتهي. */
  chips?: Chip[];
  /**
   * حقولُ هذه العائلة وحدها — وبها وحدها تُفتَح الإضافةُ والتعديل والمسح.
   *
   * ولماذا لا تُفتَح استمارةُ المركبة الكاملة من هنا: فيها سبعةٌ وأربعون حقلًا
   * تخصّ سبعَ عائلاتٍ أخرى، ومن يفتحها ليصحّح رقمَ بطاقة تشغيلٍ يمرّ على التأمين
   * والفحص والوقود في طريقه — فتصير كلُّ صفحةٍ بابًا خلفيًّا إلى كل شيء، ويصير
   * وجودُ سبع صفحاتٍ بلا معنى. تلك مهمّةُ صفحة السجل العامّة.
   *
   * وتركُها فارغةً يُبقي الصفحةَ للقراءة والتجديد كما كانت — لا تظهر أزرارٌ لا
   * تعرف أين تكتب.
   */
  fields?: DocField[];
  /**
   * الحقلُ الذي **وجودُه** يعني أنّ المستند موجود.
   *
   * ── ولماذا لا يكفي «أيُّ حقلٍ مملوء» ────────────────────────────────────────
   * كان «عليها مستند» يعني أن أيَّ حقلٍ من حقول العائلة غيرُ فارغ. وفي شرائح
   * الوقود عشرُ مركباتٍ مكتوبٌ عندها **حالةُ الشريحة** ولا شريحةَ لها — فتُحسب
   * «عليها شريحة»، فتختفي من قائمة الاختيار عند الإضافة. وهو ما اشتُكي منه
   * بالحرف: يُبحَث عن مركبةٍ لا شريحةَ لها فلا تظهر، مع أنّ الفلترَ فوق الجدول
   * يقول إنّها هناك.
   *
   * فالمستندُ يوجد بوجود ما يُعرَّف به: رقمُ الشريحة، رقمُ الوثيقة، رقمُ
   * البطاقة. وما عداه صفةٌ له لا وجودٌ لـه.
   */
  keyField?: string;
  /**
   * زرٌّ إضافيٌّ في صفّ العائلة — لفعلٍ يُقيَّد لا لخانةٍ تُفرَّغ.
   *
   * «نزعُ الشريحة» مثالُه: هو شرطٌ في إخلاء طرف الموظّف، فلا يصحّ أن يكون مسحًا
   * صامتًا لخانة. يُنادي نقطتَه الخاصّة التي تُقيّد مَن نزعها ومتى.
   */
  rowAction?: (v: VReg, reload: () => void) => React.ReactNode;
}) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  const sp = useSearchParams();
  const router = useRouter();
  const canEdit = canEditVehicles(user);
  /** الحذف الحقيقيّ صلاحيةٌ أضيق من التعديل — وهذه هي القسمة نفسها في الخادم. */
  const canDelete = canAdminVehicles(user);
  /** لا كتابةَ بلا حقولٍ معلومة: صفحةٌ لم تُصرّح بحقولها تبقى كما كانت. */
  const editable = canEdit && !!fields?.length;

  const doc = docKey ? DOC_TYPES.find((d) => d.key === docKey) : undefined;
  const renewable = !!doc && canEdit;

  const [rows, setRows] = useState<VReg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp?.get('q') || '');
  const [chip, setChip] = useState('');
  // ── الفلتر الداخليّ: مدى الأيام حتى الانتهاء ────────────────────────────────
  //
  // الفلتر الأساسيّ يجيب عن «أيّ مركبات؟» — قطاعًا ومدينةً ومالكًا. وهذا يجيب عن
  // سؤالٍ آخر لا يُغني عنه: «ما الذي ينتهي قبل كذا يومًا؟» وهما يعملان معًا لا
  // بدلًا من بعض: «بطاقات تشغيل النقل الثقيل في جدّة التي تنتهي خلال أسبوع»
  // سؤالٌ واحد، وكان يحتاج شاشتين.
  //
  // ويُقرأ من العنوان كبقيّة الفلاتر، فالرابط يُرسَل ويُفتح على ما فُلتِر عليه.
  const [within, setWithin] = useState(sp?.get('within') || '');
  const [includeExpired, setIncludeExpired] = useState(sp?.get('incExp') !== '0');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renewing, setRenewing] = useState<RenewTarget | null>(null);
  const [bulk, setBulk] = useState<RenewTarget[] | null>(null);
  // ── تجديدُ الورقة المشتركة ────────────────────────────────────────────────
  // وثيقةُ تأمينٍ واحدة تغطّي مئةً وثمانيًا وتسعين مركبة. «اختر ثمّ جدِّد» يعني
  // مئةً وثمانٍ وتسعين تأشيرةً لحدثٍ واحد، وأيُّ مركبةٍ تُنسى تبقى «منتهية» وهي
  // مؤمَّنة. فتُسأل الوثيقةُ بدل المركبات — راجع SharedPolicyRenewModal.
  const [sharedOpen, setSharedOpen] = useState(false);
  // ── فلترُ العمود على طريقة إكسل ───────────────────────────────────────────
  // القمعُ في رأس العمود يفتح قيمَه فتُؤشَّر المطلوبة. والقيمةُ تُقرأ بدالّة
  // العمود نفسِها التي تُرسم بها الخلية ويُصدَّر بها الملفّ — فما يُفلتَر عليه
  // هو ما يُقرأ حرفًا بحرف. والصفوفُ هنا محمَّلةٌ كاملةً (limit=2000) فالقائمة
  // كاملةٌ لا قائمةَ صفحةٍ واحدة.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = useCallback((key: string, sel: Set<string>) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (sel.size) next[key] = sel; else delete next[key];
      return next;
    });
  }, []);
  /** استمارةُ العائلة: `vehicle: null` تعني «اختر المركبة أوّلًا» — أي إنشاء. */
  const [form, setForm] = useState<{ vehicle: VReg | null } | null>(null);

  // كل ما في العنوان فلترٌ يُمرَّر للخادم كما هو. القائمة المكتوبة بالاسم كانت
  // تُسقِط أي فلترٍ خارجها في صمت، فتفتح الشاشةُ الأسطول كلَّه وهي تقول إنها
  // مفلترة — ورقمٌ يفتح غير ما يقول أسوأ من رقمٍ لا يُضغَط.
  const UI_ONLY = ['limit', 'page', 'q'];
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => !UI_ONLY.includes(k))));

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    p.set('limit', '2000');
    return p.toString();
  }, [q, JSON.stringify(filters)]);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ vehicles: VReg[]; total: number }>(`/api/vehicle-registry?${qs}`);
      setRows(d.vehicles || []); setTotal(d.total || 0);
      // الاختيارُ الذي خرج من النتيجة لا يبقى محفوظًا في الخفاء: من يفلتر ثم
      // يضغط «تجديد جماعي» لا يقصد مركباتٍ لم تعد أمامه.
      setPicked((prev) => new Set([...prev].filter((id) => (d.vehicles || []).some((v) => v._id === id))));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  }, [qs, notify]);

  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  // ما تختاره يعيش في العنوان: الرجوعُ والتقدّم يعملان، والرابط يُرسَل كما هو.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    if (within) p.set('within', within);
    if (!includeExpired) p.set('incExp', '0');
    syncUrl(path, p);
  }, [q, JSON.stringify(filters), within, includeExpired, path]);

  // ── الشرائح: حالةُ **هذا** المستند وحده ──────────────────────────────────
  // لا حالة المركبة العامّة: مركبةٌ تأمينها منتهٍ وبطاقةُ تشغيلها سارية ليست
  // «منتهية» في صفحة بطاقات التشغيل، ولو عُدَّت كذلك لفتحت الشريحةُ صفوفًا لا
  // علاقة لها بالعمل الذي فُتحت الشاشة من أجله.
  // ── الشرائح: أربعٌ يقرؤها المستخدم ────────────────────────────────────────
  //
  // كانت عشرًا: ثلاثُ درجاتٍ للإلحاح تُقرأ شيئًا واحدًا، و«بلا تاريخ مسجَّل»
  // منفصلةٌ عن «مطلوب» وهي منها، و«غير مطلوب» و«موجود» و«لدى جهةٍ أخرى» —
  // شرائحُ لا يُفتَح شيءٌ منها. وقال صاحبُ القسم في «غير مطلوب»: «طالما غير
  // مطلوب مش عايز أعرف عنه حاجة»، وفي «موجود»: «ماهي بيانات عادية».
  //
  // فبقي ما يُفتَح فعلًا: ما انتهى، وما قارب، وما هو سليم، وما ينقصنا. واسمُ
  // المستند في الشريحة نفسِها — «التأمين منتهٍ» لا «منتهٍ» — لأنّ الشاشةَ
  // الواحدةَ تعرض مستندًا واحدًا، و«منتهٍ» وحدَها تترك السائل يسأل: منتهٍ ماذا؟
  const famLabelShort = doc ? (ar ? doc.ar : doc.en) : '';
  const CHIPS: Chip[] = useMemo(() => (chips || (!docKey ? [{ key: '', label: t('الكل', 'All') }] : [
    { key: '', label: t('الكل', 'All') },
    {
      key: 'expired',
      label: t(`${famLabelShort} منتهٍ`, `${famLabelShort} expired`),
      tone: 'red',
      test: (v: VReg) => stateOf(v, docKey).state === 'expired',
    },
    {
      // الدرجاتُ الثلاثُ في شريحةٍ واحدة — راجع publicState في lib/vehicleRegistry.
      key: 'due',
      label: t('قارب على الانتهاء', 'Due soon'),
      tone: 'amber',
      test: (v: VReg) => publicState(stateOf(v, docKey).state) === 'due',
    },
    { key: 'valid', label: t('ساري', 'Valid'), tone: 'green', test: (v: VReg) => stateOf(v, docKey).state === 'valid' },
    {
      // ── «مطلوب» تجمع النقصين ─────────────────────────────────────────────
      // مركبةٌ يلزمها المستندُ ولم يُستخرج، ومركبةٌ استُخرج لها ولا تاريخَ
      // مسجَّلٌ له — كلتاهما عملٌ ينتظر، وفصلُهما في شريحتين يجعل قائمةَ العمل
      // نصفين لا يُقرآن معًا. والتي لا يلزمها المستندُ أصلًا ليست منهما.
      key: 'needed',
      label: t('مطلوب — ناقص', 'Needed — missing'),
      tone: 'red',
      test: (v: VReg) => docNeed(v, docKey) === 'required' || stateOf(v, docKey).state === 'missing',
    },
  ])), [ar, docKey, chips, famLabelShort]);

  // ── البحث يمرّ مرّتين، فلا بدّ أن يتّفقا ──────────────────────────────────
  // الخادم يبحث في كلّ حقلٍ نصّيّ في المركبة، ثم تُصفَّى النتيجةُ هنا مرّةً
  // أخرى بالنصّ نفسه. فلو كانت هذه الغربلةُ تنظر في حقلين فقط أسقطت ما وجده
  // الخادم في حقلٍ ثالث — تكتب رقم هويّة المفوَّض فيصله الصفّ ثم تحذفه الشاشة.
  // ولذلك تُجمع هنا **كلُّ** قيم الصفّ، وما يمرّره النداء يُضاف إليها لا يحلّ
  // محلَّها.
  const deepValues = (o: any, depth = 0): (string | number)[] => {
    if (o == null || depth > 3) return [];
    if (Array.isArray(o)) return o.flatMap((x) => deepValues(x, depth + 1));
    if (typeof o === 'object') return Object.entries(o)
      .filter(([k]) => k !== '_id' && k !== '__v')
      .flatMap(([, x]) => deepValues(x, depth + 1));
    return typeof o === 'string' || typeof o === 'number' ? [o] : [];
  };
  const search = useCallback(
    (v: VReg) => [...deepValues(v), ...(searchIn ? searchIn(v) : [])],
    [searchIn],
  );
  const chipFiltered = useChipFilter(rows, CHIPS, chip, q, search);

  // ── ويُطبَّق مدى الأيام فوق الشرائح، لا بدلًا منها ──────────────────────────
  // الترتيب مقصود: الشريحة تقول «منتهٍ» والمدى يقول «خلال سبعة» — واجتماعُهما
  // «المنتهي أو الذي ينتهي خلال سبعة»، وهو ما يُسأل عنه فعلًا.
  //
  // والمركبة بلا تاريخٍ مسجَّل تخرج من أيّ مدًى: لا تاريخ لها يُقاس، وإدخالُها
  // في «ينتهي خلال سبعة» يجعل الرقم يعِد بعملٍ لا يوجد.
  const f = useMemo(() => {
    if (!docKey || within === '') return chipFiltered;
    const n = Number(within);
    if (!Number.isFinite(n)) return chipFiltered;
    const shown = chipFiltered.shown.filter((v: VReg) => {
      const st = stateOf(v, docKey);
      if (st.days == null) return false;
      if (st.days < 0) return includeExpired;   // المنتهي: يُضمّ أو يُستبعَد صراحةً
      return st.days <= n;
    });
    return { ...chipFiltered, shown };
  }, [chipFiltered, docKey, within, includeExpired]);

  // ── وفلاترُ الأعمدة فوق ذلك كلِّه ─────────────────────────────────────────
  // آخرُ ما يُطبَّق، فيرى ما تركته الشرائحُ والمدّة — كما يفعل إكسل بالضبط.
  const colText = useCallback((c: DocColumn, v: VReg) => {
    const raw = c.get(v);
    return raw === null || raw === undefined || raw === '' ? '' : String(raw);
  }, []);
  const shownRows = useMemo(() => {
    const keys = Object.keys(colFilters);
    if (!keys.length) return f.shown;
    return f.shown.filter((v: VReg) => keys.every((k) => {
      const c = columns.find((x) => x.key === k);
      if (!c) return true;
      return colFilters[k].has(colText(c, v));
    }));
  }, [f.shown, colFilters, columns, colText]);
  const colFilterCount = Object.keys(colFilters).length;

  // صفٌّ مسطَّح للتصدير: نفس الدوالّ التي تُرسم بها الخلايا، فالملفّ لا يختلف
  // عن الشاشة ولا يحتاج تعريفًا ثانيًا للأعمدة.
  const flat = (v: VReg) => {
    const o: Record<string, any> = {};
    for (const c of columns) o[c.key] = c.get(v) ?? '';
    if (docKey) {
      const st = stateOf(v, docKey);
      o.__state = ar ? (STATE_META[st.state]?.ar || st.state) : (STATE_META[st.state]?.en || st.state);
      o.__days = st.days ?? '';
    }
    return o;
  };
  const exportCols: ExportColumn[] = [
    ...columns.map((c) => ({ header: ar ? c.ar : c.en, key: c.key, width: c.width || 18 })),
    ...(docKey ? [
      { header: t('الحالة', 'State'), key: '__state', width: 14 },
      { header: t('الأيام المتبقية', 'Days left'), key: '__days', width: 12 },
    ] : []),
  ];

  const targetOf = (v: VReg): RenewTarget => ({
    vehicleId: v._id, plateNumber: v.plateNumber, docKey: docKey || '',
    docAr: doc?.ar, docEn: doc?.en, expiryDate: doc?.datePath(v) || null,
    documentNumber: doc?.numberOf(v) || '',
    // التفويض له بدايةٌ تُجدَّد مع نهايته — والنافذة وحدها تعرف أيّ مستندٍ له
    // بداية، فتُمرَّر القيمة الحاليّة لتُقارَن بالجديدة.
    startDate: docKey === 'authorization' ? (v.authorizedPerson?.startDate || null) : null,
  });

  /** ما يُسمّى به المستند في التأكيدات والرسائل — اسمُه إن كان مستندًا، وإلا عنوانُ الصفحة. */
  const famLabel = doc ? (ar ? doc.ar : doc.en) : t(titleAr, titleEn);

  // ── «حذف» في صفحة مستند: مسحُ المستند لا مسحُ المركبة ──────────────────────
  //
  // المركبة موجودةٌ في الواقع ولها لوحةٌ وهيكلٌ وحوادثُ وتفاويض؛ انتهاءُ بطاقة
  // تشغيلها أو خطأٌ في رقمها لا يعني أنها لم تعد موجودة. وحذفُها من هنا كان
  // يمحو معها ستَّ عائلاتٍ أخرى لا تظهر في هذه الشاشة أصلًا — وهو ضررٌ لا يراه
  // الضاغطُ على الزرّ. فالإجراءُ المتلِف الصحيح هنا هو تفريغُ هذه العائلة وحدها،
  // والمركبةُ تبقى في السجلّ صفًّا خانتُه فارغة — وهذا بالضبط ما تُظهره
  // شريحةُ «بلا تاريخ مسجَّل» بوصفه عملًا مطلوبًا.
  const clearDoc = useCallback(async (v: VReg) => {
    if (!fields?.length) return;
    const ok = await confirm({
      title: t('مسح بيانات المستند', 'Clear document data'),
      tone: 'danger',
      confirmLabel: t('مسح البيانات', 'Clear data'),
      message: t(
        `ستُفرَّغ خانات «${famLabel}» على المركبة ${v.plateNumber}. المركبة نفسها تبقى في السجلّ ببقيّة مستنداتها، وتظهر هنا بلا بيانات.`,
        `The «${famLabel}» fields on vehicle ${v.plateNumber} will be emptied. The vehicle itself stays in the registry with its other documents, and appears here with no data.`),
    });
    if (!ok) return;
    // ويُمسح معها `statusCode`: هو سببُ غياب التاريخ («غير مطلوب»، «لدى البنك»)،
    // وإبقاؤه بعد تفريغٍ صريح يجعل الصفَّ يعتذر عن نقصٍ لم يعد قائمًا.
    const patch = buildPatch(fields, {});
    for (const r of rootsOf(fields)) writePath(patch, `${r}.statusCode`, '');
    try {
      await api.put(`/api/vehicle-registry/${v._id}`, patch);
      notify(t('تم مسح بيانات المستند', 'Document data cleared'), 'success');
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  }, [fields, famLabel, confirm, notify, load, ar]);

  // أرقامُ الوثائق المشتركة وعددُ مركبات كلٍّ منها — تُبنى من الصفوف المحمَّلة،
  // فما يُعرَض للتجديد هو ما في الشاشة لا قائمةٌ من مصدرٍ آخر قد تختلف عنها.
  const sharedGroups = useMemo(() => {
    if (!docKey || !isSharedPaper(docKey) || !doc) return [];
    const m = new Map<string, { number: string; count: number; expiryDate?: string | null }>();
    for (const v of rows) {
      const n = String(doc.numberOf(v) || '').trim();
      if (!n) continue;
      const g = m.get(n);
      const exp = doc.datePath(v) || null;
      if (!g) m.set(n, { number: n, count: 1, expiryDate: exp });
      else {
        g.count += 1;
        // أقربُ انتهاءٍ في المجموعة هو انتهاءُ الوثيقة عمليًّا.
        if (exp && (!g.expiryDate || new Date(exp) < new Date(g.expiryDate))) g.expiryDate = exp;
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [rows, docKey, doc]);

  // «اختيار كل المعروض» يعني المعروضَ بعد فلاتر الأعمدة أيضًا — وإلّا اختار
  // صفوفًا لا يراها الضاغطُ على المربّع.
  const allShownPicked = shownRows.length > 0 && shownRows.every((v: VReg) => picked.has(v._id));
  const toggleAll = () => setPicked((p) => {
    const n = new Set(p);
    if (allShownPicked) shownRows.forEach((v: VReg) => n.delete(v._id));
    else shownRows.forEach((v: VReg) => n.add(v._id));
    return n;
  });

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link href="/system/vehicles/registry/overview"
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {t('النظرة الشاملة', 'Overview')}
      </Link>

      <PageHeader icon={icon} title={t(titleAr, titleEn)} subtitle={t(subtitleAr, subtitleEn)}>
        {renewable && sharedGroups.length > 0 && (
          <button
            onClick={() => setSharedOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#12325c] hover:bg-[#0d2544] text-white text-sm font-semibold"
            title={t('الوثيقة الواحدة تغطّي عدّة مركبات — تُجدَّد مرّةً واحدة',
                     'One policy covers many vehicles — renew it once')}>
            <RefreshCw className="w-4 h-4" />
            {t('تجديد وثيقة كاملة', 'Renew a whole policy')}
          </button>
        )}
        {renewable && picked.size > 0 && (
          <button
            onClick={() => setBulk(rows.filter((v) => picked.has(v._id)).map(targetOf))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
            <RefreshCw className="w-4 h-4" />
            {t(`تجديد ${picked.size} مستند`, `Renew ${picked.size}`)}
          </button>
        )}
        {editable && (
          <button onClick={() => setForm({ vehicle: null })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold">
            <Plus className="w-4 h-4" />
            {t('إضافة', 'Add')}
          </button>
        )}
        {/* ── نطاقان لا واحد ────────────────────────────────────────────────
            «المعروض» هو الشاشة بالضبط بعد الفلتر والشريحة والبحث وفلاتر
            الأعمدة. و«الكلّ» هو السجلّ كلُّه بلا فلتر — كان لا سبيل إليه إلّا
            بمسح كلّ فلترٍ باليد ثمّ التصدير ثمّ إعادتها. والأعمدةُ واحدةٌ في
            الحالتين، وهي أعمدةُ الشاشة نفسُها، فأيُّ عمودٍ يُضاف هنا يظهر في
            الملفّ بلا تعريفٍ ثانٍ. */}
        <ExportMenu fileName={fileName} lang={lang as 'ar' | 'en'}
          options={[
            {
              key: 'shown',
              label: t('تصدير المعروض (بعد الفلتر)', 'Export what is shown (filtered)'),
              sheets: [{ name: t(titleAr, titleEn).slice(0, 28), rows: shownRows.map(flat), columns: exportCols }],
            },
            {
              key: 'all',
              label: t('تصدير الكلّ', 'Export everything'),
              hint: t('السجلّ كلُّه', 'whole register'),
              resolve: async () => {
                const d = await api.get<{ vehicles: VReg[] }>('/api/vehicle-registry?limit=2000');
                return [{ name: t(titleAr, titleEn).slice(0, 28), rows: (d.vehicles || []).map(flat), columns: exportCols }];
              },
            },
          ]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {colFilterCount > 0 && (
          <button onClick={() => setColFilters({})}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
            {t(`مسح فلاتر الأعمدة (${colFilterCount})`, `Clear column filters (${colFilterCount})`)}
          </button>
        )}
        <FilterPanel
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          resultCount={total}
          resultLabel={t('المركبات المطابقة', 'Matching vehicles')}
        />
      </div>

      {/* ── الفلتر الداخليّ: «ما الذي ينتهي قبل كذا يومًا؟» ────────────────────
          يعمل مع الفلتر الأساسيّ فوقه لا بدلًا منه، ومع شرائح الحالة تحته.
          والمدّة رقمٌ يُكتب لا قائمةٌ ثابتة: الأزرار اختصارٌ للشائع، ومَن أراد
          سبعةً وأربعين يومًا يكتبها. */}
      {!!docKey && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold text-slate-700">{t('ينتهي خلال', 'Expiring within')}</span>
          <input type="number" min={0} max={3650} value={within}
            onChange={(e) => setWithin(e.target.value)}
            placeholder={t('كل المدد', 'Any')}
            className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-center font-bold" />
          <span className="text-[12px] text-slate-500">{t('يوم', 'days')}</span>
          <div className="flex flex-wrap gap-1.5">
            {[7, 15, 30, 60, 90, 180].map((n) => (
              <button key={n} onClick={() => setWithin(String(n))}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}>{n}</button>
            ))}
            <button onClick={() => setWithin('')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                within === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>{t('الكل', 'All')}</button>
          </div>
          {within !== '' && (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer ms-1">
              <input type="checkbox" checked={includeExpired}
                onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
              {t('يشمل المنتهي', 'Include expired')}
            </label>
          )}
          {within !== '' && (
            <span className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 ms-auto">
              {t(`المعروض ${f.shown.length} مركبة`, `${f.shown.length} shown`)}
            </span>
          )}
        </div>
      )}

      <FilterBar chips={CHIPS} counts={f.counts} active={chip} onChange={setChip}
        query={q} onQuery={setQ}
        placeholder={t('ابحث بأيّ شيء — لوحة، هيكل، مالك، رقم هويّة، رقم وثيقة، سريال جهاز…', 'Search anything — plate, chassis, owner, ID, policy, serial…')}
        shown={shownRows.length} total={rows.length} ar={ar} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[12.5px]">
              <tr>
                {renewable && (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={allShownPicked} onChange={toggleAll}
                      title={t('اختيار كل المعروض', 'Select all shown')} className="accent-[#f37121]" />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-start font-bold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {ar ? c.ar : c.en}
                      <ColumnFilter
                        rows={f.shown}
                        field={c.key}
                        valueOf={(r: any) => colText(c, r)}
                        selected={colFilters[c.key] || EMPTY_SET}
                        onChange={(sel) => setColFilter(c.key, sel)}
                        lang={ar ? 'ar' : 'en'} />
                    </span>
                  </th>
                ))}
                {docKey && <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('الحالة', 'State')}</th>}
                {(renewable || editable || rowAction) && <th className="px-3 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shownRows.map((v: VReg) => {
                const st = docKey ? stateOf(v, docKey) : null;
                const meta = st ? (STATE_META[st.state] || STATE_META.valid) : null;
                return (
                  <tr key={v._id} className={`hover:bg-slate-50 ${picked.has(v._id) ? 'bg-orange-50/60' : ''}`}>
                    {renewable && (
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={picked.has(v._id)} className="accent-[#f37121]"
                          onChange={() => setPicked((p) => {
                            const n = new Set(p); if (n.has(v._id)) n.delete(v._id); else n.add(v._id); return n;
                          })} />
                      </td>
                    )}
                    {columns.map((c, i) => {
                      const val = c.get(v);
                      const text = val === null || val === undefined || val === '' ? '—' : String(val);
                      return (
                        <td key={c.key}
                          className={`px-3 py-2 whitespace-nowrap ${c.mono ? 'font-mono text-[12.5px]' : 'text-[13px]'} ${i === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                          {...(c.mono ? { dir: 'ltr' } : {})}>
                          {i === 0
                            ? <Link href={`/system/vehicles/registry/${v._id}`} className="text-[#f37121] hover:underline">{text}</Link>
                            : text}
                        </td>
                      );
                    })}
                    {st && meta && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${meta.bg}`}>
                          {st.days == null ? (ar ? meta.ar : meta.en) : daysText(st.days, ar)}
                        </span>
                      </td>
                    )}
                    {(renewable || editable || rowAction) && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {rowAction?.(v, load)}
                          {renewable && (
                            <button onClick={() => setRenewing(targetOf(v))}
                              className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11.5px] font-semibold hover:bg-emerald-100 whitespace-nowrap">
                              {t('تجديد', 'Renew')}
                            </button>
                          )}
                          {editable && (
                            <button onClick={() => setForm({ vehicle: v })}
                              title={t('تعديل بيانات هذا المستند', 'Edit this document')}
                              className="p-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {/* المِمحاة لا سلّةُ المهملات: الأيقونةُ نفسها تقول إن
                              الممسوح بياناتٌ لا مركبة. */}
                          {editable && hasDoc(v, fields!, keyField) && (
                            <button onClick={() => clearDoc(v)}
                              title={t('مسح بيانات هذا المستند', 'Clear this document')}
                              className="p-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                              <Eraser className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!f.shown.length && (
                <tr><td colSpan={columns.length + 3} className="px-3 py-12 text-center text-slate-500">
                  {t('لا نتائج مطابقة', 'No matching rows')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {renewing && (
        <RenewModal row={renewing} ar={ar} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}
      {sharedOpen && docKey && (
        <SharedPolicyRenewModal docKey={docKey} groups={sharedGroups} ar={ar}
          onClose={() => setSharedOpen(false)}
          onDone={() => { setSharedOpen(false); setPicked(new Set()); load(); }} />
      )}
      {bulk && (
        <BulkRenewModal rows={bulk} ar={ar} onClose={() => setBulk(null)}
          onDone={() => { setBulk(null); setPicked(new Set()); load(); }} />
      )}
      {form && !!fields?.length && (
        <DocFormModal vehicle={form.vehicle} fields={fields} keyField={keyField} famLabel={famLabel} ar={ar}
          canDelete={canDelete}
          onClose={() => setForm(null)}
          onDone={() => { setForm(null); load(); }} />
      )}
    </div>
  );
}

// `useSearchParams` يوجب حدَّ Suspense في موجِّه Next، وإلا صار البناءُ فشلًا
// صريحًا عند أوّل تعديلٍ في غلاف القسم.
export default function DocumentFamilyPage(props: Parameters<typeof DocumentFamilyPageInner>[0]) {
  return <Suspense fallback={<Spinner />}><DocumentFamilyPageInner {...props} /></Suspense>;
}


// ── استمارةُ العائلة: إنشاءٌ وتعديل، وحذفُ المركبة خلف بابٍ مغلق ─────────────
//
// و«الإنشاء» هنا ليس إنشاءَ مركبة. المركبةُ تُولد في صفحة السجل العامّة بلوحتها
// وهيكلها وقطاعها، ولا يصحّ أن تُولد من صفحة بطاقات التشغيل ببطاقةٍ ولوحةٍ فقط —
// فتدخل الأسطولَ ناقصةَ الهوية من بابٍ جانبيّ. الذي ينقص فعلًا هو **مستندٌ لم
// يُسجَّل بعد على مركبةٍ قائمة**: مئةٌ وخمسَ عشرة مركبةً بلا رقم بطاقة تشغيل،
// وطريقُ إدخالها كان يمرّ باستمارة السبعة والأربعين حقلًا. فالإنشاء هنا: اختر
// المركبة — والقائمةُ تبدأ بمن لا مستندَ له — ثم املأ حقول العائلة وحدها.
function DocFormModal({ vehicle, fields, keyField, famLabel, ar, canDelete, onClose, onDone }: {
  vehicle: VReg | null;
  fields: DocField[];
  keyField?: string;
  famLabel: string;
  ar: boolean;
  canDelete: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const creating = !vehicle;

  const [target, setTarget] = useState<VReg | null>(vehicle);
  const [vals, setVals] = useState<Record<string, any>>(
    () => Object.fromEntries(fields.map((f) => [f.path, inputValue(vehicle, f)])));
  const [saving, setSaving] = useState(false);

  // ── قائمةُ الاختيار تُجلب غيرَ مفلترة ──────────────────────────────────────
  // فلترُ الشاشة سؤالٌ عن **المعروض**، لا حدٌّ لما يجوز تسجيلُه: من يفلتر على
  // «المنتهي» ثم يضغط «إضافة» لا يقصد أن يُمنع من مركبةٍ سارية.
  const [pool, setPool] = useState<VReg[] | null>(null);
  const [pq, setPq] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  useEffect(() => {
    if (!creating) return;
    api.get<{ vehicles: VReg[] }>('/api/vehicle-registry?limit=2000')
      .then((d) => setPool(d.vehicles || []))
      .catch((e: any) => notify(e?.message || 'Failed', 'error'));
  }, [creating, notify]);

  // اختيارُ المركبة يُبحَث فيه باللوحة، فيُطوى كما تُطوى في كلّ بحثٍ آخر:
  // مَن ينسخ اللوحة بمسافتين كان لا يجد مركبتَه هنا فيسجّل المستند على غيرها.
  const candidates = useMemo(() => (pool || []).filter((v) => {
    if (onlyMissing && hasDoc(v, fields, keyField)) return false;
    return flexIncludes(pq, v.plateNumber, v.ownerNameAr, v.departmentAr, v.sectorAr);
  }).slice(0, 400), [pool, pq, onlyMissing, fields]);

  /** اختيارُ مركبةٍ يملأ الاستمارة بما عليها فعلًا — لا بفراغٍ يمحو ما هو مسجَّل. */
  const pick = (v: VReg) => {
    setTarget(v);
    setVals(Object.fromEntries(fields.map((f) => [f.path, inputValue(v, f)])));
  };

  const save = async () => {
    if (!target) { notify(t('اختر المركبة أوّلًا', 'Pick a vehicle first'), 'error'); return; }
    setSaving(true);
    try {
      await api.put(`/api/vehicle-registry/${target._id}`, buildPatch(fields, vals));
      notify(t('تم الحفظ', 'Saved'), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setSaving(false); }
  };

  // ── حذفُ المركبة نفسها: خلف إفصاحٍ وكتابةِ اللوحة بخطّ اليد ────────────────
  // زرٌّ يُضغط بالخطأ في صفٍّ من ثلاثمئة صفّ يمحو مركبةً بحوادثها وتفاويضها
  // وتاريخِ تجديداتها كلِّه. وكتابةُ اللوحة ليست تشديدًا شكليًّا: هي تُجبر على
  // قراءة أيِّ صفٍّ يُحذَف قبل حذفه.
  const [showDanger, setShowDanger] = useState(false);
  const [typed, setTyped] = useState('');
  const [killing, setKilling] = useState(false);
  const armed = !!target && typed.trim() === String(target.plateNumber || '').trim();
  const destroy = async () => {
    if (!target || !armed) return;
    setKilling(true);
    try {
      await api.delete(`/api/vehicle-registry/${target._id}`);
      notify(t(`حُذفت المركبة ${target.plateNumber}`, `Deleted ${target.plateNumber}`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setKilling(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-slate-900">
            {creating ? t(`إضافة ${famLabel}`, `Add ${famLabel}`) : t(`تعديل ${famLabel}`, `Edit ${famLabel}`)}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {target
            ? <>{target.plateNumber}{target.ownerNameAr ? ` · ${target.ownerNameAr}` : ''}</>
            : t('اختر المركبة التي تريد تسجيل هذا المستند عليها', 'Pick the vehicle to record this document on')}
          {creating && target && (
            <button onClick={() => setTarget(null)} className="ms-2 text-[#f37121] hover:underline text-[12px]">
              {t('تغيير المركبة', 'change vehicle')}
            </button>
          )}
        </p>

        {/* ── منتقي المركبة ─────────────────────────────────────────────── */}
        {creating && !target && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input value={pq} onChange={(e) => setPq(e.target.value)} autoFocus
                  placeholder={t('ابحث بلوحة أو مالك أو إدارة…', 'Search plate, owner or department…')}
                  className={`${inp} ps-9`} />
              </div>
              {/* الافتراضُ «التي بلا بيانات»: هي سببُ فتح النافذة. ومن أراد
                  تصحيحَ مركبةٍ مسجَّلة يرفع العلامة — لا يُمنع منها. */}
              <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={onlyMissing} className="accent-[#f37121]"
                  onChange={(e) => setOnlyMissing(e.target.checked)} />
                {t('التي لا بيانات لها فقط', 'Only vehicles with no data')}
              </label>
            </div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {pool === null && <div className="p-4"><Spinner /></div>}
              {pool !== null && !candidates.length && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  {t('لا مركبات مطابقة', 'No matching vehicles')}
                </p>
              )}
              {candidates.map((v) => (
                <button key={v._id} onClick={() => pick(v)}
                  className="w-full text-start px-3 py-2 hover:bg-orange-50 flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-900 text-[13px]">{v.plateNumber}</span>
                  <span className="text-[12px] text-slate-500 truncate">
                    {[v.ownerNameAr, v.departmentAr, v.cityAr].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
            {pool !== null && (
              <p className="text-[11.5px] text-slate-500">
                {t(`${candidates.length} مركبة معروضة من ${pool.length}`, `${candidates.length} of ${pool.length} shown`)}
              </p>
            )}
          </div>
        )}

        {/* ── حقول العائلة وحدها ────────────────────────────────────────── */}
        {target && (
          <>
            {creating && hasDoc(target, fields) && (
              <p className="mb-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t('على هذه المركبة بياناتٌ مسجَّلة لهذا المستند — ما تحفظه سيحلّ محلَّها.',
                   'This vehicle already has data for this document — saving will replace it.')}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map((fl) => (
                <div key={fl.path} className={fl.wide ? 'md:col-span-2' : ''}>
                  {fl.kind === 'flag' ? (
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer h-full pt-5">
                      <input type="checkbox" className="accent-[#f37121]" checked={!!vals[fl.path]}
                        onChange={(e) => setVals((p) => ({ ...p, [fl.path]: e.target.checked }))} />
                      {ar ? fl.ar : fl.en}
                    </label>
                  ) : (
                    <>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        {ar ? fl.ar : fl.en}
                        {fl.hint && <span className="font-normal text-slate-400"> ({fl.hint})</span>}
                      </label>
                      {fl.lookup ? (
                        <ManagedSelect storeLabel type={fl.lookup} value={vals[fl.path] ?? ''}
                          onChange={(v) => setVals((p) => ({ ...p, [fl.path]: v }))}
                          placeholder={t('اختر…', 'Select…')} />
                      ) : (
                        <input
                          type={fl.kind === 'date' ? 'date' : fl.kind === 'number' ? 'number' : 'text'}
                          value={vals[fl.path] ?? ''}
                          onChange={(e) => setVals((p) => ({ ...p, [fl.path]: e.target.value }))}
                          className={`${inp} ${fl.mono ? 'font-mono' : ''}`}
                          {...(fl.mono ? { dir: 'ltr' } : {})} />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
              {t('لا يُكتب من هنا إلا حقول هذا المستند — بقيّة بيانات المركبة تُعدَّل من صفحة سجل المركبات.',
                 'Only this document\u2019s fields are written here — the rest of the vehicle is edited in the vehicle registry.')}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">
                {t('إلغاء', 'Cancel')}
              </button>
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {t('حفظ', 'Save')}
              </button>
            </div>
          </>
        )}

        {/* ── حذفُ المركبة كلِّها — لمن يملك الحذف، وفي التعديل وحده ─────── */}
        {!creating && canDelete && target && (
          <div className="mt-5 pt-4 border-t border-slate-200">
            {!showDanger ? (
              <button onClick={() => setShowDanger(true)}
                className="inline-flex items-center gap-1.5 text-[12px] text-red-600 hover:text-red-800 hover:underline">
                <Trash2 className="w-3.5 h-3.5" />
                {t('حذف المركبة من السجلّ نهائيًا', 'Permanently delete this vehicle')}
              </button>
            ) : (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 space-y-2">
                <p className="text-[12.5px] text-red-800 font-semibold leading-relaxed">
                  {t(`هذا ليس مسحًا لـ«${famLabel}». ستُحذف المركبة ${target.plateNumber} من سجلّ المركبات نهائيًا، بكل مستنداتها وتفاويضها وسجلّ تجديداتها — ولا رجعة.`,
                     `This is not clearing «${famLabel}». Vehicle ${target.plateNumber} will be permanently removed from the registry with every document, authorisation and renewal record — this cannot be undone.`)}
                </p>
                <label className="block text-[11.5px] font-semibold text-red-800">
                  {t(`اكتب رقم اللوحة للتأكيد: ${target.plateNumber}`, `Type the plate to confirm: ${target.plateNumber}`)}
                </label>
                <input value={typed} onChange={(e) => setTyped(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-red-300 text-sm bg-white" />
                <div className="flex gap-2">
                  <button onClick={() => { setShowDanger(false); setTyped(''); }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[12.5px]">
                    {t('تراجع', 'Back')}
                  </button>
                  <button onClick={destroy} disabled={!armed || killing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[12.5px] font-semibold disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" /> {t('حذف المركبة نهائيًا', 'Delete vehicle')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** أعمدةٌ تتكرّر في كل عائلة: اللوحة أوّلًا، ثم ما يُعرَف به موضعُ المركبة. */
export const commonColumns = (): DocColumn[] => [
  { key: 'plateNumber', ar: 'رقم اللوحة', en: 'Plate', get: (v) => v.plateNumber, width: 16 },
  { key: 'sectorAr', ar: 'القطاع', en: 'Sector', get: (v) => v.sectorAr, width: 16 },
  { key: 'departmentAr', ar: 'الإدارة', en: 'Department', get: (v) => v.departmentAr, width: 18 },
  { key: 'cityAr', ar: 'المدينة', en: 'City', get: (v) => v.cityAr, width: 14 },
  { key: 'ownerNameAr', ar: 'المالك', en: 'Owner', get: (v) => v.ownerNameAr, width: 26 },
];
