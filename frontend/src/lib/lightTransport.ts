/**
 * النقلُ الخفيف — أنواعُه ونداءاتُه وأعمدةُ جدوله.
 *
 * والأعمدةُ تُعرَّف مرّةً واحدةً هنا: الترويسةُ والقمعُ والتصديرُ يقرؤون
 * التعريفَ نفسَه، فما يُفلتَر عليه هو ما يُعرَض وهو ما يُصدَّر حرفًا بحرف.
 * تعريفان يفترقان بعد أسبوعٍ من التعديل، فيُصدَّر عمودٌ لا يُرى ويُفلتَر على
 * قيمةٍ لا تُعرض.
 */
import api from '@/lib/api';

export interface LTEmployee {
  _id: string;
  idNumber: string;
  name: string;
  nationalityAr?: string;
  phone?: string;
  hireDate?: string | null;
  cityAr?: string;
  projectAr?: string;
  jobTitleAr?: string;
  staffKind?: 'rep' | 'admin';
  contractTypeAr?: string;
  registerNumber?: string;
  vehicleTypeAr?: string;
  vehiclePlate?: string;
  /**
   * بطاقةُ التشغيل والفحصُ الدوريُّ — من سجلّ المركبة، بحالتهما محسوبةً
   * بعتبات قسم المركبات. راجع `docOf` في الخادم.
   */
  operatingCard?: LTDoc;
  inspection?: LTDoc;
  supervisorName?: string;
  /**
   * حسابُ المشرف على النظام — هو الأصل، والاسمُ لقطةٌ منه.
   * راجع `backend/utils/b2cSupervisors`: من أُسند إليه رجلٌ هنا رآه في تفقّد
   * بداية الدوام.
   */
  supervisorUser?: { _id: string; firstName?: string; lastName?: string; role?: string } | string | null;
  workStatusAr?: string;
  /** الحالةُ كما تُقرأ: حالةُ القسم، تغلبها الموارد البشريّةُ حين تنفي. */
  workStatusShown?: string;
  /** نوعُ المركبة من سجلّها متى كانت مربوطةً — مفردةٌ واحدةٌ للاثنين. */
  vehicleTypeShown?: string;
  statusSource?: 'hr' | 'section';
  hrLinked?: boolean;
  employeeNumber?: string;
  notesAr?: string;
  isActive?: boolean;
  housingRoom?: string;
  vehicle?: { _id: string; plateNumber?: string; serialNumber?: string; registrationTypeAr?: string; brandAr?: string; modelAr?: string } | null;
  housing?: { _id: string; name?: string; cityAr?: string } | null;
  employee?: { _id: string; employeeNumber?: string; arabicName?: string; employmentStatus?: string } | null;
  supervisor?: { _id: string; arabicName?: string; employeeNumber?: string } | null;
  history?: LTHistory[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LTHistory {
  _id?: string; at?: string; byName?: string; kind?: string;
  fromValue?: string; toValue?: string; note?: string;
}

/**
 * نوعُ التعاقد مطويًّا — «كفالة» و«كفاله» واحد، و«فري لانسر» و«فريلانسر» واحد.
 * تُستعمل في العدّ وفي الفلترة معًا، فلا يفترق الكارتُ عن الجدول.
 */
export const foldContract = (v?: string) => String(v || '')
  .replace(/[ً-ْ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, '');
export const isFreelance = (r: { contractTypeAr?: string }) => foldContract(r.contractTypeAr).includes('فريلانسر');
export const hasContract = (r: { contractTypeAr?: string }) => !!foldContract(r.contractTypeAr);

/** مفاتيحُ الفلترة المشتقّة — تُحسَب في الشاشة ولا تُرسَل إلى الخادم. */
export const LOCAL_KEYS = ['contractKind', 'doc'] as const;
export const serverFilters = (f: Record<string, string>) => {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v && !LOCAL_KEYS.includes(k as any)) o[k] = v;
  return o;
};

/** حالةُ وثيقةٍ على مركبةِ الموظّف — نفسُ مفرداتِ قسم المركبات. */
export interface LTDoc {
  expiryDate?: string | null;
  number?: string;
  statusAr?: string;
  state: 'valid' | 'upcoming' | 'warning' | 'critical' | 'expired' | 'missing' | 'not_applicable';
  days: number | null;
}

/** ألوانُ حالة الوثيقة — نفسُها في كلّ شاشةٍ تقرؤها. */
export const DOC_CLS: Record<string, string> = {
  expired: 'bg-red-100 text-red-700',
  critical: 'bg-orange-100 text-orange-700',
  warning: 'bg-amber-100 text-amber-800',
  upcoming: 'bg-sky-100 text-sky-700',
  valid: 'bg-emerald-100 text-emerald-700',
  missing: 'bg-slate-100 text-slate-500',
  not_applicable: 'bg-slate-100 text-slate-400',
};
export const DOC_AR: Record<string, string> = {
  expired: 'منتهية', critical: 'حرج', warning: 'تحذير', upcoming: 'قريبًا',
  valid: 'سارية', missing: 'غير مسجَّلة', not_applicable: 'غير مطلوبة',
};
export const DOC_EN: Record<string, string> = {
  expired: 'Expired', critical: 'Critical', warning: 'Warning', upcoming: 'Soon',
  valid: 'Valid', missing: 'Not recorded', not_applicable: 'N/A',
};

export interface LTTotals {
  total: number;
  /** نوعُ التعاقد — كارتان ثابتان فوق الجدول، محسوبان على ما بعد الفلترة. */
  sponsored: number;
  freelance: number;
  cardGap: number; cardSoon: number;
  inspectionGap: number; inspectionSoon: number; reps: number; admins: number; working: number; notWorking: number;
  onLeave: number; terminated: number; withVehicle: number; withoutVehicle: number;
  hrLinked: number; ownedHere: number; housed: number; unhoused: number;
  byProject: Record<string, number>; byCity: Record<string, number>; byJob: Record<string, number>;
  byContract: Record<string, number>; byRegister: Record<string, number>;
  byVehicleType: Record<string, number>; bySupervisor: Record<string, number>;
  byStatus: Record<string, number>;
}

/**
 * معرِّفُ حساب المشرف في صفٍّ — يجيء مُعبَّأً من القائمة ومجرَّدًا بعد الحفظ.
 * `populate` تردّ كائنًا، والحفظُ المحليُّ يترك معرِّفًا نصًّا — فيُقرأ الاثنان.
 */
export const supervisorIdOf = (e?: { supervisorUser?: unknown } | null): string => {
  const v = e?.supervisorUser as any;
  if (!v) return '';
  return typeof v === 'string' ? v : String(v._id || '');
};

/** مشرفٌ متاحٌ للإسناد — حسابٌ على النظام بدورِ إشرافٍ في القسم. */
export interface LTSupervisor {
  _id: string;
  /** ما يُعرَض: الاسمُ العربيُّ من ملفّه، وإلّا اسمُ حسابه. */
  name: string;
  nameEn: string;
  nameAr: string;
  role: string;
  roleAr: string;
  email?: string;
  employeeNumber?: string;
}

export interface LTOptions {
  project: string[]; city: string[]; jobTitle: string[]; contractType: string[];
  register: string[]; vehicleType: string[];
  /** حساباتُ الإشراف — لا أسماءٌ مكتوبة. */
  supervisor: LTSupervisor[];
  /** أسماءُ مشرفين كُتبت في السجلّ ولا حسابَ لها بعد — تبقى للفلترة. */
  supervisorsUnlinked?: string[];
  housing: { _id: string; name: string }[];
}

export interface LTRoom { _id?: string; name: string; kind: 'rep' | 'admin' | 'any'; capacity: number; notes?: string; occupied?: number; free?: number }
export interface LTHousing {
  _id: string; name: string; cityAr?: string; addressAr?: string;
  declaredCapacity?: number; rooms: LTRoom[]; isActive?: boolean; notes?: string;
  totalCapacity?: number; occupied?: number; free?: number;
}

export interface LTOrder {
  _id: string; orderNumber: string;
  ltEmployee: string; employeeName: string; employeeIdNumber: string;
  vehicle?: { _id: string; plateNumber?: string; registrationTypeAr?: string } | string | null;
  vehiclePlate?: string; vehicleTypeAr?: string;
  projectAr?: string; cityAr?: string; supervisorName?: string;
  housing?: { _id: string; name?: string } | string | null; housingRoom?: string;
  startDate?: string; endDate?: string | null; status: 'active' | 'ended'; endReasonAr?: string;
  authorizationMoved?: boolean; authorizationNumber?: string;
  authorizationStart?: string | null; authorizationEnd?: string | null;
  notesAr?: string; createdByName?: string; createdAt?: string;
}


/**
 * ── والكاردُ يقرأ ما في الجدول ──────────────────────────────────────────────
 * الأعدادُ كانت تأتي من الخادم محسوبةً على فلاترِه وحدَها، وفلترُ العمود (الشبيهُ
 * بفلتر إكسل) يُطبَّق في المتصفّح بعدها. فمن فلتر عمودًا رأى الجدولَ يَنقُص
 * والكاردَ ثابتًا — رقمان لشيءٍ واحدٍ على شاشةٍ واحدة، ولا يُعرَف أيُّهما الصحيح.
 *
 * فالأعدادُ تُحسَب هنا من الصفوف المعروضة فعلًا — أيًّا كان ما نقّاها: شريحةٌ أو
 * بحثٌ أو فلترُ عمود. والمنطقُ هو منطقُ الخادم نفسُه (`totalsOf` في المتحكِّم)
 * كي لا يفترق الرقمُ باختلاف الجهة التي حسبته.
 */
export function ltTotalsOf(rows: LTEmployee[]): LTTotals {
  const count = (fn: (r: LTEmployee) => boolean) => rows.filter(fn).length;
  const group = (fn: (r: LTEmployee) => string | undefined) => {
    const o: Record<string, number> = {};
    for (const r of rows) { const k = fn(r) || '—'; o[k] = (o[k] || 0) + 1; }
    return o;
  };
  // «على رأس العمل» = ليس منتهيَ الخدمة ولا موقوفًا — والإجازةُ عملٌ موقوتٌ لا انتهاء.
  const working = (r: LTEmployee) => !['إنهاء خدمة', 'متوقف'].includes(String(r.workStatusShown || ''));
  const gap = (d?: LTDoc) => !!d && ['expired', 'critical'].includes(d.state);
  const soon = (d?: LTDoc) => !!d && ['warning', 'upcoming'].includes(d.state);
  return {
    total: rows.length,
    sponsored: count((r) => hasContract(r) && !isFreelance(r)),
    freelance: count(isFreelance),
    cardGap: count((r) => gap(r.operatingCard)),
    cardSoon: count((r) => soon(r.operatingCard)),
    inspectionGap: count((r) => gap(r.inspection)),
    inspectionSoon: count((r) => soon(r.inspection)),
    reps: count((r) => r.staffKind === 'rep'),
    admins: count((r) => r.staffKind === 'admin'),
    working: count(working),
    notWorking: count((r) => !working(r)),
    onLeave: count((r) => ['إجازة', 'اجازه'].includes(String(r.workStatusShown || ''))),
    terminated: count((r) => r.workStatusShown === 'إنهاء خدمة'),
    withVehicle: count((r) => !!r.vehicle),
    withoutVehicle: count((r) => !r.vehicle),
    hrLinked: count((r) => !!r.hrLinked),
    ownedHere: count((r) => !r.hrLinked),
    housed: count((r) => !!r.housing),
    unhoused: count((r) => !r.housing),
    byProject: group((r) => r.projectAr),
    byCity: group((r) => r.cityAr),
    byJob: group((r) => r.jobTitleAr),
    byContract: group((r) => r.contractTypeAr),
    byRegister: group((r) => r.registerNumber),
    byVehicleType: group((r) => r.vehicleTypeShown || r.vehicleTypeAr),
    bySupervisor: group((r) => r.supervisorName),
    byStatus: group((r) => r.workStatusShown),
  };
}

const qs = (o: Record<string, string>) =>
  Object.entries(o).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/**
 * ── والمسارُ يُكتب صريحًا لا يُركَّب ──────────────────────────────────────────
 * كان يُبنى من ثابتٍ ومقطعٍ («BASE» ثمّ اسمُ النقطة)، وخريطةُ نقاطِ الصفحات تُولَّد بقراءة
 * النصوص في ملفّ الصفحة وما تستورده — فلا ترى نصًّا مركَّبًا. فكُتب للصفحات
 * مسارٌ واحدٌ عامٌّ للقسم كلِّه، ثمّ سقط عند إعادة التوليد، فصارت
 * صفحةُ أوامر التشغيل بلا نقاطٍ أصلًا: ومَن مُنح هذه الصفحةَ وحدَها يأخذ 403 من
 * كلّ نداءٍ فيها (راجع middleware/pageGate).
 *
 * فالمسارُ يُكتب حرفًا حرفًا — طولٌ زائدٌ في الشِّفرة يقابل بابًا لا يُغلق خطأً.
 */

export const getLTEmployees = (q: Record<string, string> = {}) =>
  api.get<{ employees: LTEmployee[]; totals: LTTotals; options: LTOptions }>(`/api/light-transport/employees${qs(q) ? `?${qs(q)}` : ''}`);
export const getLTEmployee = (id: string) =>
  api.get<{ employee: LTEmployee; orders: LTOrder[] }>(`/api/light-transport/employees/${id}`);
export const createLTEmployee = (body: any) => api.post<{ employee: LTEmployee }>(`/api/light-transport/employees`, body);
export const updateLTEmployee = (id: string, body: any) => api.put<{ employee: LTEmployee }>(`/api/light-transport/employees/${id}`, body);
export const deactivateLTEmployee = (id: string, reason: string) => api.post(`/api/light-transport/employees/${id}/deactivate`, { reason });

export const getLTHousing = () => api.get<{ housing: LTHousing[] }>(`/api/light-transport/housing`);
export const saveLTHousing = (id: string | null, body: any) =>
  (id ? api.put<{ housing: LTHousing }>(`/api/light-transport/housing/${id}`, body) : api.post<{ housing: LTHousing }>(`/api/light-transport/housing`, body));
export const deleteLTHousing = (id: string) => api.delete(`/api/light-transport/housing/${id}`);

export const getLTOrders = (q: Record<string, string> = {}) =>
  api.get<{ orders: LTOrder[]; totals: { total: number; active: number; ended: number; authorizationMoved: number } }>(`/api/light-transport/orders${qs(q) ? `?${qs(q)}` : ''}`);
export const getLTOrderOptions = () => api.get<{
  employees: { _id: string; name: string; idNumber: string; jobTitleAr?: string; staffKind?: string; projectAr?: string; cityAr?: string; vehiclePlate?: string; supervisorName?: string; supervisorUser?: string }[];
  vehicles: { _id: string; plateNumber: string; serialNumber?: string; typeAr?: string; brand?: string; authorizedName?: string; authorizedId?: string }[];
  housing: { _id: string; name: string; rooms: { name: string; kind: string; capacity: number }[] }[];
  supervisors: LTSupervisor[];
}>(`/api/light-transport/orders/options`);
export const createLTOrder = (body: any) => api.post<{ order: LTOrder }>(`/api/light-transport/orders`, body);
/**
 * نقلُ تفويضِ مركبةٍ وحدَه — بلا أمرِ تشغيلٍ جديد. يُستعمَل حين تكون المركبةُ
 * مفوَّضةً لشخصٍ وقائدُها الفعليُّ آخرَ (حالةٌ قائمةٌ في أربعةَ عشرَ مركبة)، أو
 * حين يُنقَل التفويضُ من مندوبٍ إلى مندوب. `toEmployee` فارغًا يعني رفعَه.
 */
export const moveLTAuthorization = (body: {
  vehicle: string; toEmployee?: string; authorizationNumber?: string;
  startDate?: string; expiryDate?: string; reason?: string;
}) => api.post<{ vehicle: { _id: string; plateNumber: string; authorizedPerson: any } }>(`/api/light-transport/authorization/move`, body);
export const endLTOrder = (id: string, body: any) => api.post<{ order: LTOrder }>(`/api/light-transport/orders/${id}/end`, body);

// ── العرض ───────────────────────────────────────────────────────────────────
export const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** شرائحُ الحالة بلونها — «إنهاء خدمة» و«متوقف» ليستا محايدتين. */
export const LT_STATUS: Record<string, { cls: string }> = {
  'يعمل': { cls: 'bg-emerald-100 text-emerald-700' },
  'إجازة': { cls: 'bg-sky-100 text-sky-700' },
  'متوقف': { cls: 'bg-amber-100 text-amber-700' },
  'إنهاء خدمة': { cls: 'bg-red-100 text-red-700' },
};
export const statusCls = (s?: string) => LT_STATUS[String(s || '')]?.cls || 'bg-slate-100 text-slate-600';

export const KIND_AR: Record<string, string> = { rep: 'مندوب', admin: 'إداري' };
export const KIND_EN: Record<string, string> = { rep: 'Rep', admin: 'Admin' };

/** أسبابُ قيدِ السجلّ بلغةٍ تُقرأ — لا مفاتيحُ إنجليزيّة في شاشةٍ عربيّة. */
export const HISTORY_KIND: Record<string, { ar: string; en: string }> = {
  created: { ar: 'أُنشئ السجلّ', en: 'Record created' },
  project: { ar: 'نقلٌ بين المشاريع', en: 'Project moved' },
  city: { ar: 'نقلٌ بين الفروع', en: 'Branch moved' },
  supervisor: { ar: 'تغييرُ المشرف', en: 'Supervisor changed' },
  vehicle: { ar: 'تغييرُ المركبة', en: 'Vehicle changed' },
  housing: { ar: 'تغييرُ السكن', en: 'Housing changed' },
  status: { ar: 'تغييرُ الحالة', en: 'Status changed' },
  order: { ar: 'أمرُ تشغيل', en: 'Operating order' },
  authorization: { ar: 'نقلُ تفويض', en: 'Authorisation moved' },
};

/**
 * ── أعمدةُ الجدول: تعريفٌ واحدٌ للترويسة والقمع والتصدير ────────────────────
 * كلُّ عمودٍ يقول اسمَه وكيف يُقرأ. و«اللوحة» و«الإجراءات» تُثبَّتان في الأوّل
 * (راجع components/vehicles/stickyLead): الجدولُ عرضُه عشرون عمودًا، ومن يمرّ
 * يمينًا يفقد مَن يقرأ عنه.
 */
export type LTCol = { key: string; ar: string; en: string; get: (e: LTEmployee) => any; width?: number; mono?: boolean };

export const LT_COLUMNS: LTCol[] = [
  { key: 'plate', ar: 'رقم اللوحة', en: 'Plate', get: (e) => e.vehiclePlate || '', width: 14, mono: true },
  { key: 'name', ar: 'الاسم', en: 'Name', get: (e) => e.name, width: 30 },
  { key: 'idNumber', ar: 'رقم الهوية', en: 'ID number', get: (e) => e.idNumber, width: 14, mono: true },
  { key: 'jobTitleAr', ar: 'الوظيفة', en: 'Job', get: (e) => e.jobTitleAr || '', width: 12 },
  { key: 'staffKind', ar: 'النوع', en: 'Kind', get: (e) => KIND_AR[e.staffKind || ''] || '', width: 10 },
  { key: 'projectAr', ar: 'المشروع', en: 'Project', get: (e) => e.projectAr || '', width: 14 },
  { key: 'cityAr', ar: 'الفرع', en: 'Branch', get: (e) => e.cityAr || '', width: 12 },
  { key: 'supervisorName', ar: 'المشرف', en: 'Supervisor', get: (e) => e.supervisorName || '', width: 18 },
  { key: 'vehicleTypeAr', ar: 'نوع المركبة', en: 'Vehicle type', get: (e) => e.vehicleTypeAr || '', width: 14 },
  { key: 'contractTypeAr', ar: 'نوع التعاقد', en: 'Contract', get: (e) => e.contractTypeAr || '', width: 12 },
  { key: 'registerNumber', ar: 'رقم السجل', en: 'Register', get: (e) => e.registerNumber || '', width: 16, mono: true },
  { key: 'workStatus', ar: 'حالة العمل', en: 'Status', get: (e) => e.workStatusShown || '', width: 12 },
  { key: 'nationalityAr', ar: 'الجنسية', en: 'Nationality', get: (e) => e.nationalityAr || '', width: 12 },
  { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date', get: (e) => fmtDate(e.hireDate), width: 13, mono: true },
  { key: 'phone', ar: 'الجوال', en: 'Phone', get: (e) => e.phone || '', width: 13, mono: true },
  { key: 'housing', ar: 'السكن', en: 'Housing', get: (e) => e.housing?.name || '', width: 14 },
  { key: 'housingRoom', ar: 'الغرفة', en: 'Room', get: (e) => e.housingRoom || '', width: 12 },
  { key: 'serialNumber', ar: 'الرقم التسلسلي', en: 'Serial', get: (e) => e.vehicle?.serialNumber || '', width: 15, mono: true },
  // ── وثيقتا المركبة في الجدول والتصدير ────────────────────────────────────
  // «كارتُ تشغيلِ مَن ينتهي هذا الشهر؟» يُقرأ من صفّ الرجل لا من سجلّ المركبات:
  // من يُوقَف صباحًا هو الرجل.
  { key: 'operatingCardNumber', ar: 'رقم كارت التشغيل', en: 'Operating card no.', get: (e) => e.operatingCard?.number || '', width: 16, mono: true },
  { key: 'operatingCardExpiry', ar: 'انتهاء كارت التشغيل', en: 'Operating card expiry', get: (e) => fmtDate(e.operatingCard?.expiryDate), width: 16, mono: true },
  { key: 'inspectionExpiry', ar: 'انتهاء الفحص', en: 'Inspection expiry', get: (e) => fmtDate(e.inspection?.expiryDate), width: 15, mono: true },
  { key: 'hrLinked', ar: 'ملفّ الموارد البشرية', en: 'HR file', get: (e) => (e.hrLinked ? (e.employeeNumber || 'مربوط') : 'لا ملفّ'), width: 16 },
  { key: 'notesAr', ar: 'ملاحظات', en: 'Notes', get: (e) => e.notesAr || '', width: 28 },
];

/** ما يُثبَّت في أوّل الجدول — واللوحةُ أوّلُ ما يُسأل عنه في هذا القسم. */
export const LT_PINNED = ['plate'];

export const canEditLT = (u?: { role?: string | null; permissions?: Record<string, string> | null } | null) =>
  ['super_admin', 'admin', 'b2c_manager', 'b2c_project_lead', 'it_manager'].includes(String(u?.role || ''))
  || u?.permissions?.B2C === 'edit';
