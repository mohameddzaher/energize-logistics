'use client';
// بترو اب — شريحةُ الوقود لكل مركبة: رقمُها، واللوحةُ كما تُطبَع على الفاتورة،
// وحالتُها ونوعُ استهلاكها وسقفُه.
//
// و«اللوحة في فاتورة بترو اب» ليست تكرارًا للوحة: تُكتب في الفاتورة بصيغةٍ
// أخرى، وهي المفتاح الوحيد لمطابقة بند الفاتورة بالمركبة. وسقفٌ «مفتوح» ليس
// سقفًا عاليًا — هو لا سقف، وهو أوّل ما يُسأل عنه في مراجعة الوقود.
import { Fuel, Unplug } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { canEditVehicles } from '@/lib/vehicleRegistry';
import { useAuth } from '@/context/AuthContext';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { type Chip } from '@/components/ls2/FilterBar';
import { useLanguage } from '@/context/LanguageContext';
import { money, type VReg } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  // ── ومن يقود المركبة، ورقمُ إقامته ────────────────────────────────────────
  // شريحةُ الوقود تُصرَف بيد إنسان، ومراجعةُ الوقود تسأل «مَن صرف؟» لا «أيّ
  // مركبة صرفت». وكان الجوابُ في صفحةٍ أخرى، فيُفتَح تبويبان ويُطابَق باللوحة.
  { key: 'authName', ar: 'اسم القائد / المفوَّض', en: 'Driver / authorised', get: (v) => v.authorizedPerson?.name, width: 24 },
  { key: 'authIqama', ar: 'رقم الإقامة', en: 'Iqama number', mono: true, get: (v) => v.authorizedPerson?.iqamaNumber, width: 16 },
  { key: 'cardNumber', ar: 'شريحة بترو اب', en: 'Petro App chip', mono: true, get: (v) => v.fuelCard?.cardNumber, width: 18 },
  { key: 'plateOnInvoiceAr', ar: 'رقم اللوحة في فاتورة بترو اب', en: 'Plate on Petro App invoice', get: (v) => v.fuelCard?.plateOnInvoiceAr, width: 24 },
  { key: 'statusAr', ar: 'حالة الشريحة', en: 'Chip status', get: (v) => v.fuelCard?.statusAr, width: 14 },
  { key: 'consumptionTypeAr', ar: 'نوع الاستهلاك', en: 'Consumption type', get: (v) => v.fuelCard?.consumptionTypeAr, width: 16 },
  {
    key: 'limitSar', ar: 'حد الاستهلاك', en: 'Consumption limit', width: 14,
    // «مفتوح» تُكتب كلمةً لا رقمًا: عرضُها فراغًا يخفي المركبات التي لا حدَّ
    // لصرفها، وهي بالضبط ما تبحث عنه المراجعة.
    get: (v) => (v.fuelCard?.limitStatus === 'open' ? 'مفتوح — بلا سقف'
      : v.fuelCard?.limitSar != null ? money(v.fuelCard.limitSar) : ''),
  },
];

// «مفتوح» علامةٌ لا رقم: صفرٌ في خانة السقف يعني «ممنوع الصرف»، وفراغٌ يعني
// «لا نعلم» — وكلاهما عكسُ المقصود. فالعلامةُ خانةُ اختيارٍ تكتب `open`، وحين
// تُرفع يعود السقفُ إلى الرقم المكتوب.
const FIELDS: DocField[] = [
  { path: 'fuelCard.cardNumber', ar: 'رقم شريحة بترو اب', en: 'Petro App chip number', mono: true },
  { path: 'fuelCard.plateOnInvoiceAr', ar: 'رقم اللوحة في فاتورة بترو اب', en: 'Plate on Petro App invoice' },
  { path: 'fuelCard.provider', ar: 'المزوّد', en: 'Provider' },
  // ── القائمتان تُداران من إعدادات القسم ──────────────────────────────────
  // الخانةُ الحرّة تُكتب بألف صيغة: «نشطة» و«نشط» و«فعالة» ثلاثةُ خياراتٍ في
  // الفلتر لشيءٍ واحد. ويُخزَّن الاسمُ العربيُّ لا المفتاح، لأنّ المخزَّن نصٌّ
  // عربيٌّ منذ أوّل استيرادٍ وتقرؤه الفلاتر والتصديرات.
  { path: 'fuelCard.statusAr', ar: 'حالة الشريحة', en: 'Chip status', lookup: 'vehicle_fuel_card_status' },
  { path: 'fuelCard.consumptionTypeAr', ar: 'نوع الاستهلاك', en: 'Consumption type', lookup: 'vehicle_consumption_type' },
  { path: 'fuelCard.limitSar', ar: 'حد الاستهلاك (ر.س)', en: 'Consumption limit (SAR)', kind: 'number' },
  { path: 'fuelCard.limitStatus', ar: 'مفتوح — بلا سقف صرف', en: 'Open — no spending ceiling',
    kind: 'flag', on: 'open', off: '' },
];

export default function Page() {
  const ar = useLanguage().lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { confirm, notify } = useDialog();
  const canEdit = canEditVehicles(user);

  // ── نزعُ الشريحة فعلٌ يُقيَّد، لا خانةٌ تُفرَّغ ────────────────────────────────
  // هو شرطٌ في إخلاء طرف الموظّف: لا تُنهى خدمتُه والشريحةُ في يده — ولو كانت
  // المركبةُ مركبتَه، فالشريحةُ شريحتُنا وتصرف من حسابنا. وشرطٌ يُبنى على خانةٍ
  // فارغةٍ لا يُثبِت شيئًا: تُفرَّغ فيسقط، ولا يبقى جوابٌ لـ«مَن نزعها ومتى؟».
  const removeChip = async (v: VReg, reload: () => void) => {
    const who = v.authorizedPerson?.name ? ` (${v.authorizedPerson.name})` : '';
    if (!(await confirm(t(
      `نزع شريحة بترو اب ${v.fuelCard?.cardNumber} عن المركبة ${v.plateNumber}${who}؟ يُقيَّد النزع باسمك وتاريخه.`,
      `Remove Petro App chip ${v.fuelCard?.cardNumber} from ${v.plateNumber}${who}? The removal is recorded with your name and the date.`)))) return;
    try {
      const r = await api.post<{ message: string }>(`/api/vehicle-registry/${v._id}/fuel-card`, { action: 'remove' });
      notify(r?.message || t('نُزعت الشريحة', 'Chip removed'), 'success');
      reload();
    } catch (e: any) { notify(e?.message || t('تعذّر النزع', 'Could not remove'), 'error'); }
  };
  // شرائحُ هذه العائلة عن حالة الشريحة لا عن انتهاء تاريخ — لا تاريخ لها.
  const CHIPS: Chip[] = [
    { key: '', label: t('الكل', 'All') },
    { key: 'has', label: t('لها شريحة', 'Has a chip'), tone: 'green', test: (v: VReg) => !!v.fuelCard?.cardNumber },
    { key: 'none', label: t('بلا شريحة', 'No chip'), tone: 'red', test: (v: VReg) => !v.fuelCard?.cardNumber },
    { key: 'open', label: t('بلا سقف استهلاك', 'No spending ceiling'), tone: 'amber', test: (v: VReg) => v.fuelCard?.limitStatus === 'open' },
    { key: 'noInvoicePlate', label: t('بلا لوحة على الفاتورة', 'No plate on invoice'), tone: 'violet', test: (v: VReg) => !!v.fuelCard?.cardNumber && !v.fuelCard?.plateOnInvoiceAr },
  ];
  return (
    <DocumentFamilyPage
      docKey={null}
      chips={CHIPS}
      path="/system/vehicles/registry/fuel-cards"
      icon={<Fuel className="w-5 h-5" />}
      titleAr="بترو اب — شرائح الوقود" titleEn="Petro App — Fuel Cards"
      subtitleAr="رقم الشريحة واللوحة كما تُطبَع على الفاتورة وحالتها ونوع استهلاكها وسقفه"
      subtitleEn="Chip number, the plate as printed on the invoice, status, consumption type and limit"
      fileName="vehicle-fuel-cards"
      columns={COLUMNS}
      fields={FIELDS}
      // ── وجودُ الشريحة رقمُها، لا أيُّ خانةٍ مملوءة ────────────────────────
      // عشرُ مركباتٍ مكتوبٌ عندها حالةُ شريحةٍ ولا شريحةَ لها، فكانت تُحسَب
      // «عليها شريحة» وتختفي من قائمة الإضافة — يُبحَث عنها فلا تظهر.
      keyField="fuelCard.cardNumber"
      rowAction={(v, reload) => (canEdit && v.fuelCard?.cardNumber ? (
        <button key="unplug" onClick={() => removeChip(v, reload)}
          title={t('نزع الشريحة — يُقيَّد ويُشترط قبل إنهاء خدمة حاملها', 'Remove the chip — recorded, and required before its holder can be terminated')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11.5px] font-semibold hover:bg-amber-100 whitespace-nowrap">
          <Unplug className="w-3.5 h-3.5" />{t('نزع الشريحة', 'Remove chip')}
        </button>
      ) : null)}
      searchIn={(v) => [v.plateNumber, v.fuelCard?.cardNumber, v.fuelCard?.plateOnInvoiceAr, v.ownerNameAr,
        v.authorizedPerson?.name, v.authorizedPerson?.iqamaNumber]}
    />
  );
}
