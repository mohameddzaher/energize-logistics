/**
 * أعمدةُ سجل المركبات — تعريفٌ واحدٌ يخدم الجدولَ والفلترَ والتصدير.
 *
 * ── لماذا في ملفٍّ وحدَه ────────────────────────────────────────────────────
 * طُلب أن تكون صفحةُ السجلّ «العنصر الأساسيّ للقسم»: فيها كلُّ عمودٍ وكلُّ
 * بيانٍ يخصّ المركبة، وأن يخرج التصديرُ بالأعمدة نفسِها. وحين يُكتب الجدولُ في
 * موضعٍ والتصديرُ في موضعٍ آخر يفترقان في أوّل عمودٍ يُضاف — فيخرج ملفٌّ ينقصه
 * ما على الشاشة، أو شاشةٌ ينقصها ما في الملفّ. فالتعريفُ واحد.
 *
 * وترتيبُ الأعمدة هو الترتيبُ المطلوب حرفيًّا في التقرير، لا ترتيبٌ منطقيٌّ
 * نختاره: الملفُّ يُفتَح إلى جانب ملفّاتٍ سابقةٍ ويُقارَن عمودًا بعمود.
 */
import { type VReg } from '@/lib/vehicleRegistry';

export type VCol = {
  key: string;
  ar: string;
  en: string;
  /** القيمةُ كما تُعرَض وكما تُصدَّر — واحدةٌ لا اثنتان. */
  get: (v: VReg) => any;
  width?: number;
  /** نوعُ الخانة في إكسل: `date` تُكتب كائنَ تاريخٍ حقيقيًّا لا نصًّا. */
  type?: 'text' | 'date' | 'number';
  /** أعمدةٌ تظهر في الجدول افتراضيًّا. البقيّةُ تُفتَح من زرّ «الأعمدة». */
  base?: boolean;
  mono?: boolean;
};

/**
 * اللوحةُ بصيغة منصّة «تم».
 *
 * الحروفُ ثلاثةُ مواضعَ دائمًا، فاللوحةُ ذاتُ الحرفين تترك الموضعَ الثالث
 * فارغًا — ومن هنا تأتي المسافتان بين الحروف والرقم. والملفُّ يُرفَع إلى المنصّة
 * ويُطابَق بالنصّ، فمسافةٌ ناقصةٌ تعني صفًّا لا يُطابِق شيئًا.
 */
export const platformPlate = (v: Partial<VReg>): string => {
  const letters = String((v as any).plateLettersAr || '').trim();
  const digits = String((v as any).plateDigits || '').trim();
  if (!letters || !digits) return String(v.plateNumber || '');
  const parts = letters.split(/\s+/).filter(Boolean);
  while (parts.length < 3) parts.push('');
  return `${parts.slice(0, 3).join(' ')} ${digits}`;
};

const d = (x: any) => (x ? String(x).slice(0, 10) : '');

/** الأيامُ المتبقية على تاريخٍ — سالبةٌ للمنتهي، وفارغةٌ حين لا تاريخ. */
export const daysLeft = (x: any): number | '' => {
  if (!x) return '';
  const t = new Date(x).getTime();
  if (Number.isNaN(t)) return '';
  return Math.ceil((t - Date.now()) / 86400000);
};

/** «مفتوح» كلمةٌ لا رقم: صفرٌ يعني «ممنوع الصرف» وفراغٌ يعني «لا نعلم». */
const limitText = (v: VReg) => (v.fuelCard?.limitStatus === 'open'
  ? 'مفتوح'
  : v.fuelCard?.limitSar != null ? v.fuelCard.limitSar : '');

export const REGISTRY_COLUMNS: VCol[] = [
  { key: 'sectorAr', ar: 'القطاع', en: 'Sector', get: (v) => v.sectorAr, width: 16, base: true },
  { key: 'departmentAr', ar: 'القسم', en: 'Department', get: (v) => v.departmentAr, width: 18, base: true },
  { key: 'cityAr', ar: 'المدينة', en: 'City', get: (v) => v.cityAr, width: 12, base: true },
  { key: 'ownerNameAr', ar: 'المالك', en: 'Owner', get: (v) => v.ownerNameAr, width: 26, base: true },
  { key: 'tamStatusAr', ar: 'حالة تم', en: 'Tam status', get: (v) => v.tamStatusAr, width: 12 },
  { key: 'commercialRegistration', ar: 'السجل', en: 'CR', get: (v) => v.commercialRegistration, width: 16 },
  // اللوحةُ بصيغة المنصّة — راجع platformPlate.
  { key: 'plateNumber', ar: 'رقم اللوحة', en: 'Plate', get: (v) => platformPlate(v), width: 16, base: true, mono: true },
  { key: 'chassisNumber', ar: 'رقم الهيكل', en: 'Chassis', get: (v) => v.chassisNumber, width: 22, base: true, mono: true },
  { key: 'serialNumber', ar: 'الرقم التسلسلي', en: 'Serial', get: (v) => v.serialNumber, width: 18, base: true, mono: true },
  { key: 'registrationTypeAr', ar: 'نوع التسجيل', en: 'Registration type', get: (v) => v.registrationTypeAr, width: 14, base: true },
  { key: 'brandAr', ar: 'ماركة المركبة', en: 'Brand', get: (v) => v.brandAr, width: 14, base: true },
  { key: 'modelAr', ar: 'طراز المركبة', en: 'Model', get: (v) => v.modelAr, width: 14 },
  { key: 'modelYear', ar: 'الموديل', en: 'Year', get: (v) => v.modelYear, width: 10, type: 'number', base: true },
  { key: 'colorAr', ar: 'اللون', en: 'Colour', get: (v) => v.colorAr, width: 12 },

  // ── التفويض ────────────────────────────────────────────────────────────────
  { key: 'authName', ar: 'اسم المفوض', en: 'Authorised person', get: (v) => v.authorizedPerson?.name, width: 24, base: true },
  { key: 'authIqama', ar: 'رقم الاقامة', en: 'Iqama number', get: (v) => v.authorizedPerson?.iqamaNumber, width: 16, mono: true },
  { key: 'authNumber', ar: 'رقم التفويض', en: 'Authorisation no.', get: (v) => v.authorizedPerson?.authorizationNumber, width: 16, mono: true },
  { key: 'authStart', ar: 'تاريخ بداية التفويض', en: 'Auth. start', get: (v) => d(v.authorizedPerson?.startDate), width: 18, type: 'date' },
  { key: 'authEnd', ar: 'تاريخ نهاية التفويض', en: 'Auth. end', get: (v) => d(v.authorizedPerson?.expiryDate), width: 18, type: 'date' },
  { key: 'authDays', ar: 'الايام المتبقية علي نهاية التفويض', en: 'Days to auth. end', get: (v) => daysLeft(v.authorizedPerson?.expiryDate), width: 16, type: 'number' },

  // ── التأمين ────────────────────────────────────────────────────────────────
  { key: 'insPolicy', ar: 'رقم وثيقة التأمين', en: 'Policy no.', get: (v) => v.insurance?.policyNumber, width: 18, mono: true },
  { key: 'insExpiry', ar: 'تاريخ انتهاء التأمين', en: 'Insurance expiry', get: (v) => d(v.insurance?.expiryDate), width: 18, type: 'date', base: true },
  { key: 'insDays', ar: 'الايام المتبقية علي انتهاء التأمين', en: 'Days to insurance expiry', get: (v) => daysLeft(v.insurance?.expiryDate), width: 16, type: 'number' },
  { key: 'insCompany', ar: 'شركة التأمين', en: 'Insurer', get: (v) => v.insurance?.companyAr, width: 20 },
  { key: 'insCoverage', ar: 'نوع التأمين', en: 'Coverage type', get: (v) => v.insurance?.coverageTypeAr, width: 16 },
  // القيمةُ رقمٌ أو نصٌّ («ملكية بنك الراجحي») — والنصُّ ليس نقصًا، هو يقول
  // مَن يدفع القسط. تفريغُه يجعل المركبة تُعدّ بلا تأمينٍ وهي مؤمَّنة.
  { key: 'insPremium', ar: 'قيمة التأمين', en: 'Premium', width: 16,
    get: (v) => (v.insurance?.premiumSar != null ? v.insurance.premiumSar : (v.insurance?.premiumStatusAr || '')) },

  // ── بترو اب ────────────────────────────────────────────────────────────────
  { key: 'fuelCardNumber', ar: 'شريحة بترو اب', en: 'Petro App chip', get: (v) => v.fuelCard?.cardNumber, width: 18, mono: true, base: true },
  { key: 'fuelPlateOnInvoice', ar: 'رقم اللوحة في فاتورة بترو اب', en: 'Plate on Petro App invoice', get: (v) => v.fuelCard?.plateOnInvoiceAr, width: 24 },
  { key: 'fuelStatus', ar: 'حالة الشريحة', en: 'Chip status', get: (v) => v.fuelCard?.statusAr, width: 14 },
  { key: 'fuelConsumptionType', ar: 'نوع الاستهلاك', en: 'Consumption type', get: (v) => v.fuelCard?.consumptionTypeAr, width: 16 },
  { key: 'fuelLimit', ar: 'حد الاستهلاك', en: 'Consumption limit', get: limitText, width: 14 },

  // ── التتبّع ────────────────────────────────────────────────────────────────
  { key: 'gpsDevice', ar: 'جهاز GPS', en: 'GPS device', get: (v) => v.gps?.deviceModel, width: 16 },
  { key: 'gpsDeviceStatus', ar: 'حالة جهاز GPS', en: 'GPS device status', get: (v) => v.gps?.deviceStatusAr, width: 14 },
  { key: 'gpsProvider', ar: 'شركة ال GPS', en: 'GPS provider', get: (v) => v.gps?.provider, width: 16 },
  { key: 'gpsSerial', ar: 'سريال GPS', en: 'GPS serial', get: (v) => v.gps?.serialImei, width: 20, mono: true },
  { key: 'gpsExpiry', ar: 'تاريخ انتهاء ال GPS', en: 'GPS expiry', get: (v) => d(v.gps?.expiryDate), width: 18, type: 'date' },
  { key: 'gpsDays', ar: 'الايام المتبقية علي انتهاء ال GPS', en: 'Days to GPS expiry', get: (v) => daysLeft(v.gps?.expiryDate), width: 16, type: 'number' },

  // ── بطاقة التشغيل ──────────────────────────────────────────────────────────
  { key: 'operatingCardNumber', ar: 'بطاقة التشغيل', en: 'Operating card', get: (v) => v.operatingCard?.cardNumber, width: 18, mono: true },
  { key: 'operatingCardExpiry', ar: 'تاريخ انتهاء بطاقة التشغيل', en: 'Operating card expiry', get: (v) => d(v.operatingCard?.expiryDate), width: 20, type: 'date' },
  { key: 'operatingCardDays', ar: 'الايام المتبقية علي انتهاء بطاقة التشغيل', en: 'Days to operating card expiry', get: (v) => daysLeft(v.operatingCard?.expiryDate), width: 16, type: 'number' },

  // ── رخصة السير ─────────────────────────────────────────────────────────────
  // الهجريُّ المخزَّن يسبق الميلاديّ كما في التقرير المطلوب — وهو المكتوبُ على
  // الورقة نفسِها، فيُعرَض كما كُتب لا محسوبًا.
  { key: 'licenseHijri', ar: 'تاريخ انتهاء رخصة السير هجري', en: 'Licence expiry (Hijri)', get: (v) => v.vehicleLicense?.expiryDateHijri, width: 20 },
  { key: 'licenseExpiry', ar: 'تاريخ انتهاء رخصة السير ميلادي', en: 'Licence expiry', get: (v) => d(v.vehicleLicense?.expiryDate), width: 20, type: 'date' },
  { key: 'licenseDays', ar: 'الايام المتبقية علي انتهاء رخصة السير', en: 'Days to licence expiry', get: (v) => daysLeft(v.vehicleLicense?.expiryDate), width: 16, type: 'number' },

  // ── الفحص الدوري ───────────────────────────────────────────────────────────
  { key: 'inspectionHijri', ar: 'تاريخ انتهاء الفحص هجري', en: 'Inspection expiry (Hijri)', get: (v) => v.inspection?.expiryDateHijri, width: 20 },
  { key: 'inspectionExpiry', ar: 'تاريخ انتهاء الفحص ميلادي', en: 'Inspection expiry', get: (v) => d(v.inspection?.expiryDate), width: 20, type: 'date' },
  { key: 'inspectionDays', ar: 'الايام المتبقية علي انتهاء الفحص', en: 'Days to inspection expiry', get: (v) => daysLeft(v.inspection?.expiryDate), width: 16, type: 'number' },

  { key: 'notesAr', ar: 'الملاحظات', en: 'Notes', get: (v) => v.notesAr, width: 30 },
];

export const BASE_COLUMN_KEYS = REGISTRY_COLUMNS.filter((c) => c.base).map((c) => c.key);
