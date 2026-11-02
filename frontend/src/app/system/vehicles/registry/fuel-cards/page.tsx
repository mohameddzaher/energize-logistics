'use client';
// Petro App: the fuel chip for each vehicle: its number, the plate as printed on the invoice, its status, consumption type and cap.
// The plate in the Petro App invoice is not a duplicate of the plate: it is written in another format on the invoice and is the only key for matching an invoice line to a vehicle. An "open" cap is not a high cap; it means no cap, and it is the first thing asked in a fuel review.
import { Fuel, Unplug } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { canEditVehicles } from '@/lib/vehicleRegistry';
import { useAuth } from '@/context/AuthContext';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { isNotRequiredCode } from '@/components/vehicles/ReqToggle';
import { type Chip } from '@/components/ls2/FilterBar';
import { useLanguage } from '@/context/LanguageContext';
import { money, type VReg } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  // Who drives the vehicle and his residency number. The fuel chip is issued by a person, and fuel review asks who drew, not which vehicle drew. The answer was on another page, requiring two tabs matched by plate.
  { key: 'authName', ar: 'اسم القائد / المفوَّض', en: 'Driver / authorised', get: (v) => v.authorizedPerson?.name, width: 24 },
  { key: 'authIqama', ar: 'رقم الإقامة', en: 'Iqama number', mono: true, get: (v) => v.authorizedPerson?.iqamaNumber, width: 16 },
  { key: 'cardNumber', ar: 'شريحة بترو اب', en: 'Petro App chip', mono: true, get: (v) => v.fuelCard?.cardNumber, width: 18 },
  { key: 'plateOnInvoiceAr', ar: 'رقم اللوحة في فاتورة بترو اب', en: 'Plate on Petro App invoice', get: (v) => v.fuelCard?.plateOnInvoiceAr, width: 24 },
  { key: 'statusAr', ar: 'حالة الشريحة', en: 'Chip status', get: (v) => v.fuelCard?.statusAr, width: 14 },
  { key: 'consumptionTypeAr', ar: 'نوع الاستهلاك', en: 'Consumption type', get: (v) => v.fuelCard?.consumptionTypeAr, width: 16 },
  {
    key: 'limitSar', ar: 'حد الاستهلاك', en: 'Consumption limit', width: 14,
    // "Open" is a word, not a number: showing it as blank hides the vehicles with no spending limit, exactly what the review looks for.
    get: (v) => (v.fuelCard?.limitStatus === 'open' ? 'مفتوح — بلا سقف'
      : v.fuelCard?.limitSar != null ? money(v.fuelCard.limitSar) : ''),
  },
];

// "Open" is a flag, not a number: zero in the cap field would mean spending forbidden and blank would mean unknown, both the opposite of the intent. So the flag is a checkbox that writes `open`, and unchecking it returns the cap to the written number.
const FIELDS: DocField[] = [
  { path: 'fuelCard.cardNumber', ar: 'رقم شريحة بترو اب', en: 'Petro App chip number', mono: true },
  { path: 'fuelCard.plateOnInvoiceAr', ar: 'رقم اللوحة في فاتورة بترو اب', en: 'Plate on Petro App invoice' },
  { path: 'fuelCard.provider', ar: 'المزوّد', en: 'Provider' },
  // Both lists are managed from section settings. A free field is written in a thousand forms (three spellings of "active" become three filter options for one thing). The Arabic name is stored, not the key, because the stored value has been Arabic text since the first import and filters and exports read it.
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

  // Removing the chip is a recorded action, not a field to blank. It is a condition of clearing an employee: his service does not end while the chip is in his hand, even if the vehicle was his, because the chip is ours and draws from our account. A condition built on a blank field proves nothing: blank it and it passes, leaving no answer to who removed it and when.
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
  // This family's chips are about the chip's state, not a date expiring; it has no date.
  const CHIPS: Chip[] = [
    { key: '', label: t('الكل', 'All') },
    { key: 'has', label: t('لها شريحة', 'Has a chip'), tone: 'green', test: (v: VReg) => !!v.fuelCard?.cardNumber },
    // "No chip" is a work list, not an inventory. A vehicle marked not required has no chip and no work on it: it is not ours, or it does not draw from our account. Counting it under "no chip" inflates the number with rows nothing can be opened from, the same reason required/not-required exists in the other families.
    { key: 'none', label: t('بلا شريحة — مطلوبة', 'No chip — needed'), tone: 'red',
      test: (v: VReg) => !v.fuelCard?.cardNumber && !isNotRequiredCode(v.fuelCard?.statusCode) },
    { key: 'notReq', label: t('غير مطلوبة', 'Not required'), tone: 'slate',
      test: (v: VReg) => isNotRequiredCode(v.fuelCard?.statusCode) },
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
      // A chip exists when it has a number, not when any field is filled. Ten vehicles had a chip status but no chip, so they counted as having one and vanished from the add list, and searching for them found nothing.
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
