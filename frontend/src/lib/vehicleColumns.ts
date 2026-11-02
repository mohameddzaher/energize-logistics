/**
 * Vehicle register columns: one definition serving the table, the filter and the export.
 * The register page is the main element of the section, with every column and every datum of the vehicle, and the export has the same columns. When the table is written in one place and the export in another they drift apart, so both read this file.
 */
import { type VReg } from '@/lib/vehicleRegistry';
import { formatPlate } from '@/lib/flexMatch';

export type VCol = {
  key: string;
  ar: string;
  en: string;
  /** Value as shown on screen and filtered by. */
  get: (v: VReg) => any;
  /**
   * Export value when it differs from the display value.
   * The Hijri column is the only case: the screen shows a readable Hijri date, while Excel needs the Gregorian date to write a real date cell and display it in the Hijri calendar (`type: 'hijri'`). Exporting the Hijri text would make the cell General and unsortable by time.
   */
  raw?: (v: VReg) => any;
  width?: number;
  /** Excel cell type: `date` is written as a real date object, not text. */
  type?: 'text' | 'date' | 'number' | 'hijri';
  /** Columns shown in the table by default; the rest are opened from the columns button. */
  base?: boolean;
  mono?: boolean;
};

/**
 * Plate in the Tam platform format.
 * The platform always has three letter positions, so a two-letter plate leaves the third empty, which is where the two spaces between letters and number come from. Most plates here are of that kind. Only the spacing is fixed; the plate value is not otherwise changed.
 */
/** Register plate as displayed; one rule for the whole system now. It was written here alone, so it was fixed in the vehicle tables but not in fleet management, carrier trucks and the waybill. The rule is now in `lib/flexMatch` with its server twin, and this calls it; see `formatPlate`. */
export const platformPlate = (v: Partial<VReg>): string => formatPlate(v.plateNumber);

const d = (x: any) => (x ? String(x).slice(0, 10) : '');

/**
 * Hijri (Umm al-Qura) date matching a Gregorian date, for display.
 * Computed, not read: the Hijri operating-license and inspection columns read a stored field because the paper is the authority, but the field was empty for most vehicles, so the column was blank.
 */
export const hijriOf = (x: any): string => {
  if (!x) return '';
  const dt = new Date(x);
  if (Number.isNaN(dt.getTime())) return '';
  try {
    // Order is composed, not left to the locale. An English-locale `format` gives 03/25/1448 (month, day, year), while Gregorian dates beside it in the table are day/month/year, so the Hijri date reads reversed with nothing to warn: both are just numbers and a year. So the parts are taken and composed explicitly.
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
    }).formatToParts(dt);
    const pick = (t: string) => parts.find((x) => x.type === t)?.value || '';
    const [dd, mm, yy] = [pick('day'), pick('month'), pick('year')];
    if (!dd || !mm || !yy) return '';
    return `${dd.padStart(2, '0')}/${mm.padStart(2, '0')}/${yy}`;
  } catch { return ''; }
};

/** Days remaining to a date: negative if expired, empty when there is no date. */
export const daysLeft = (x: any): number | '' => {
  if (!x) return '';
  const t = new Date(x).getTime();
  if (Number.isNaN(t)) return '';
  return Math.ceil((t - Date.now()) / 86400000);
};

/** 'Open' is a word, not a number: zero means issuing is forbidden and empty means unknown. */
const limitText = (v: VReg) => (v.fuelCard?.limitStatus === 'open'
  ? 'مفتوح'
  : v.fuelCard?.limitSar != null ? v.fuelCard.limitSar : '');

export const REGISTRY_COLUMNS: VCol[] = [
  { key: 'sectorAr', ar: 'القطاع', en: 'Sector', get: (v) => v.sectorAr, width: 16, base: true },
  { key: 'departmentAr', ar: 'القسم', en: 'Department', get: (v) => v.departmentAr, width: 18, base: true },
  { key: 'cityAr', ar: 'المدينة', en: 'City', get: (v) => v.cityAr, width: 12, base: true },
  /**
   * A light-transport vehicle: where it works and with which project.
   * Light transport is the individuals (b2c) department, and city and project are managed there on the rider, not the vehicle, so the vehicle moves with him. They are read from the department register at display time (`ltCityAr`/`ltProjectAr` on the server), so edits there show here.
   */
  { key: 'ltCityAr', ar: 'مدينة التشغيل (نقل خفيف)', en: 'Operating city (light)', get: (v) => (v as any).ltCityAr || '', width: 16 },
  { key: 'ltProjectAr', ar: 'المشروع (نقل خفيف)', en: 'Project (light)', get: (v) => (v as any).ltProjectAr || '', width: 18 },
  { key: 'ltRiderName', ar: 'الراكب (نقل خفيف)', en: 'Rider (light)', get: (v) => (v as any).ltRiderName || '', width: 24 },
  { key: 'ownerNameAr', ar: 'المالك', en: 'Owner', get: (v) => v.ownerNameAr, width: 26, base: true },
  { key: 'tamStatusAr', ar: 'حالة تم', en: 'Tam status', get: (v) => v.tamStatusAr, width: 12 },
  { key: 'commercialRegistration', ar: 'السجل', en: 'CR', get: (v) => v.commercialRegistration, width: 16 },
  // Plate in platform format; see platformPlate.
  { key: 'plateNumber', ar: 'رقم اللوحة', en: 'Plate', get: (v) => platformPlate(v), width: 16, base: true, mono: true },
  { key: 'chassisNumber', ar: 'رقم الهيكل', en: 'Chassis', get: (v) => v.chassisNumber, width: 22, base: true, mono: true },
  { key: 'serialNumber', ar: 'الرقم التسلسلي', en: 'Serial', get: (v) => v.serialNumber, width: 18, base: true, mono: true },
  { key: 'registrationTypeAr', ar: 'نوع التسجيل', en: 'Registration type', get: (v) => v.registrationTypeAr, width: 14, base: true },
  // Owning company.
  // The group is two companies and the fleet is shared in operation but separate in ownership: license, insurance and violations are attributed to a specific company. A `base` column so it shows on screen and in export without being requested.
  { key: 'ownerCompanyAr', ar: 'الشركة المالكة', en: 'Owning company', get: (v) => v.ownerCompanyAr, width: 20, base: true },
  { key: 'brandAr', ar: 'ماركة المركبة', en: 'Brand', get: (v) => v.brandAr, width: 14, base: true },
  { key: 'modelAr', ar: 'طراز المركبة', en: 'Model', get: (v) => v.modelAr, width: 14, base: true },
  { key: 'modelYear', ar: 'الموديل', en: 'Year', get: (v) => v.modelYear, width: 10, type: 'number', base: true },
  { key: 'colorAr', ar: 'اللون', en: 'Colour', get: (v) => v.colorAr, width: 12, base: true },

  // Authorization.
  { key: 'authName', ar: 'اسم المفوض', en: 'Authorised person', get: (v) => v.authorizedPerson?.name, width: 24, base: true },
  { key: 'authIqama', ar: 'رقم الاقامة', en: 'Iqama number', get: (v) => v.authorizedPerson?.iqamaNumber, width: 16, mono: true },
  { key: 'authNumber', ar: 'رقم التفويض', en: 'Authorisation no.', get: (v) => v.authorizedPerson?.authorizationNumber, width: 16, mono: true },
  { key: 'authPhone', ar: 'جوال المفوض', en: 'Authorised phone', get: (v) => (v as any).authorizedPerson?.phone || '', width: 14, mono: true },
  // The authorized person is not always the rider. The authorization paper says who may drive and reality says who drives; the department sheet holds them as two columns, and they differ on fifty-eight vehicles. The rider is who is asked after an accident or violation.
  { key: 'actualDriverName', ar: 'القائد الفعلي', en: 'Actual driver', get: (v) => (v as any).actualDriver?.name || '', width: 24 },
  { key: 'actualDriverId', ar: 'هوية القائد الفعلي', en: 'Actual driver ID', get: (v) => (v as any).actualDriver?.idNumber || '', width: 14, mono: true },
  { key: 'authStart', ar: 'تاريخ بداية التفويض', en: 'Auth. start', get: (v) => d(v.authorizedPerson?.startDate), width: 18, type: 'date' },
  { key: 'authEnd', ar: 'تاريخ نهاية التفويض', en: 'Auth. end', get: (v) => d(v.authorizedPerson?.expiryDate), width: 18, type: 'date' },
  { key: 'authDays', ar: 'الايام المتبقية علي نهاية التفويض', en: 'Days to auth. end', get: (v) => daysLeft(v.authorizedPerson?.expiryDate), width: 16, type: 'number' },

  // Insurance.
  { key: 'insPolicy', ar: 'رقم وثيقة التأمين', en: 'Policy no.', get: (v) => v.insurance?.policyNumber, width: 18, mono: true },
  { key: 'insExpiry', ar: 'تاريخ انتهاء التأمين', en: 'Insurance expiry', get: (v) => d(v.insurance?.expiryDate), width: 18, type: 'date', base: true },
  { key: 'insDays', ar: 'الايام المتبقية علي انتهاء التأمين', en: 'Days to insurance expiry', get: (v) => daysLeft(v.insurance?.expiryDate), width: 16, type: 'number' },
  { key: 'insCompany', ar: 'شركة التأمين', en: 'Insurer', get: (v) => v.insurance?.companyAr, width: 20 },
  { key: 'insCoverage', ar: 'نوع التأمين', en: 'Coverage type', get: (v) => v.insurance?.coverageTypeAr, width: 16 },
  // The value is a number or text (e.g. owned by a bank). Text is not a gap: it says who pays the premium, and blanking it would count an insured vehicle as uninsured.
  { key: 'insPremium', ar: 'قيمة التأمين', en: 'Premium', width: 16,
    get: (v) => (v.insurance?.premiumSar != null ? v.insurance.premiumSar : (v.insurance?.premiumStatusAr || '')) },

  // Petro App.
  { key: 'fuelCardNumber', ar: 'شريحة بترو اب', en: 'Petro App chip', get: (v) => v.fuelCard?.cardNumber, width: 18, mono: true, base: true },
  { key: 'fuelPlateOnInvoice', ar: 'رقم اللوحة في فاتورة بترو اب', en: 'Plate on Petro App invoice', get: (v) => v.fuelCard?.plateOnInvoiceAr, width: 24 },
  { key: 'fuelStatus', ar: 'حالة الشريحة', en: 'Chip status', get: (v) => v.fuelCard?.statusAr, width: 14 },
  { key: 'fuelConsumptionType', ar: 'نوع الاستهلاك', en: 'Consumption type', get: (v) => v.fuelCard?.consumptionTypeAr, width: 16 },
  { key: 'fuelLimit', ar: 'حد الاستهلاك', en: 'Consumption limit', get: limitText, width: 14 },

  // Tracking.
  { key: 'gpsDevice', ar: 'جهاز GPS', en: 'GPS device', get: (v) => v.gps?.deviceModel, width: 16 },
  { key: 'gpsDeviceStatus', ar: 'حالة جهاز GPS', en: 'GPS device status', get: (v) => v.gps?.deviceStatusAr, width: 14 },
  { key: 'gpsProvider', ar: 'شركة ال GPS', en: 'GPS provider', get: (v) => v.gps?.provider, width: 16 },
  { key: 'gpsSerial', ar: 'سريال GPS', en: 'GPS serial', get: (v) => v.gps?.serialImei, width: 20, mono: true },
  { key: 'gpsExpiry', ar: 'تاريخ انتهاء ال GPS', en: 'GPS expiry', get: (v) => d(v.gps?.expiryDate), width: 18, type: 'date' },
  { key: 'gpsDays', ar: 'الايام المتبقية علي انتهاء ال GPS', en: 'Days to GPS expiry', get: (v) => daysLeft(v.gps?.expiryDate), width: 16, type: 'number' },

  // Operating card.
  { key: 'operatingCardNumber', ar: 'بطاقة التشغيل', en: 'Operating card', get: (v) => v.operatingCard?.cardNumber, width: 18, mono: true },
  { key: 'operatingCardExpiry', ar: 'تاريخ انتهاء بطاقة التشغيل', en: 'Operating card expiry', get: (v) => d(v.operatingCard?.expiryDate), width: 20, type: 'date' },
  { key: 'operatingCardDays', ar: 'الايام المتبقية علي انتهاء بطاقة التشغيل', en: 'Days to operating card expiry', get: (v) => daysLeft(v.operatingCard?.expiryDate), width: 16, type: 'number' },

  // Driving license (registration card). Hijri comes before Gregorian as in the requested report. The written value on the paper is read if present, else it is computed from the Gregorian date; see hijriOf.
  { key: 'licenseHijri', ar: 'تاريخ انتهاء رخصة السير هجري', en: 'Licence expiry (Hijri)', width: 20, type: 'hijri',
    get: (v) => v.vehicleLicense?.expiryDateHijri || hijriOf(v.vehicleLicense?.expiryDate),
    raw: (v) => d(v.vehicleLicense?.expiryDate) },
  { key: 'licenseExpiry', ar: 'تاريخ انتهاء رخصة السير ميلادي', en: 'Licence expiry', get: (v) => d(v.vehicleLicense?.expiryDate), width: 20, type: 'date' },
  { key: 'licenseDays', ar: 'الايام المتبقية علي انتهاء رخصة السير', en: 'Days to licence expiry', get: (v) => daysLeft(v.vehicleLicense?.expiryDate), width: 16, type: 'number' },

  // Periodic inspection.
  { key: 'inspectionHijri', ar: 'تاريخ انتهاء الفحص هجري', en: 'Inspection expiry (Hijri)', width: 20, type: 'hijri',
    get: (v) => v.inspection?.expiryDateHijri || hijriOf(v.inspection?.expiryDate),
    raw: (v) => d(v.inspection?.expiryDate) },
  { key: 'inspectionExpiry', ar: 'تاريخ انتهاء الفحص ميلادي', en: 'Inspection expiry', get: (v) => d(v.inspection?.expiryDate), width: 20, type: 'date' },
  { key: 'inspectionDays', ar: 'الايام المتبقية علي انتهاء الفحص', en: 'Days to inspection expiry', get: (v) => daysLeft(v.inspection?.expiryDate), width: 16, type: 'number' },

  { key: 'notesAr', ar: 'الملاحظات', en: 'Notes', get: (v) => v.notesAr, width: 30 },

  // Every field in the edit dialog has a column. These were written in the dialog with no table column: editing the operating status saved but its effect could not be seen in the register or filtered from a column header, so the save looked like it failed. They are appended at the end, not the middle: the order of the earlier ones is the report order.
  { key: 'serviceStatusAr', ar: 'حالة التشغيل', en: 'Service status', get: (v) => v.serviceStatusAr, width: 14 },
  { key: 'possessionStatusAr', ar: 'حالة الحيازة', en: 'Possession', get: (v) => v.possessionStatusAr, width: 12 },
  { key: 'authJobTitle', ar: 'وظيفة المفوض', en: 'Authorised job title', get: (v) => v.authorizedPerson?.jobTitleAr, width: 18 },
  { key: 'gpsDeviceId', ar: 'رقم جهاز GPS', en: 'GPS device id', get: (v) => v.gps?.deviceId, width: 16, mono: true },
  { key: 'gpsSim', ar: 'رقم شريحة GPS', en: 'GPS SIM', get: (v) => v.gps?.simNumber, width: 16, mono: true },
  { key: 'inspectionStatus', ar: 'حالة الفحص', en: 'Inspection status', get: (v) => v.inspection?.statusAr, width: 14 },
  { key: 'premiumStatus', ar: 'حالة القسط', en: 'Premium status', get: (v) => v.insurance?.premiumStatusAr, width: 16 },
];

export const BASE_COLUMN_KEYS = REGISTRY_COLUMNS.filter((c) => c.base).map((c) => c.key);
