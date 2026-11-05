'use client';
// Driver cards, a register in the vehicles section.
// The card is an expiring document tied to a logistics register, and a register's vehicles are driven only by holders of its card, so the register lives here, not in the employee file.
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, SearchableSelect, Loader2 } from '@/components/hr/HRKit';
import IqamaPersonInfo from '@/components/vehicles/IqamaPersonInfo';
import PersonLookup from '@/components/vehicles/PersonLookup';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { IdCard, Plus, Pencil, Trash2, RotateCcw, Phone } from 'lucide-react';
import { LEAD, LEAD_CELL } from '@/components/vehicles/stickyLead';
import { flexNormalize } from '@/lib/flexMatch';
import ScrollX from '@/components/system/ScrollX';
import ManagedSelect from '@/components/system/ManagedSelect';
import { PersonDocDate, docStateLabel, personDocExportColumns, type DocState } from '@/components/system/PersonDocDate';

interface Card {
  /** Derived on the server: a real number in the field, not a word or blank. */
  hasCard?: boolean;
  _id: string; idNumber: string; name?: string; dateOfBirth?: string; absherPhone?: string;
  logisticRegister?: string; cardNumber?: string; cardType?: string; expiryDate?: string;
  notes?: string; isActive?: boolean; daysLeft: number | null; state: string;
  /** Transport type written on the card; takes precedence over the type derived from the driver's vehicles. */
  transportTypeAr?: string;
  /** Derived on the server from the registration type of the vehicles authorized to him; not written on the card. */
  vehicleClass?: 'heavy' | 'light' | 'motorcycle' | 'none'; vehicleClassAr?: string; vehicleClassEn?: string;
  employee?: { _id: string; employeeNumber?: string; arabicName?: string; firstName?: string; lastName?: string; employmentStatus?: string } | null;
  // The other two items belong to the driver, not the vehicle.
  fidelity?: { status?: '' | 'covered' | 'required'; policyNumber?: string; addedDate?: string; notes?: string };
  // Residency and driving licence expiry come from his HR file (utils/personDocDates).
  iqamaExpiry?: string; licenseExpiry?: string; iqamaState?: DocState; licenseState?: DocState;
  authorizations?: { _id: string; source?: 'registry' | 'assignment'; vehicle: string | null; plateNumber: string; startDate?: string; expiryDate?: string; authorizationNumber?: string; registrationTypeAr?: string }[];
  // Plates the older assignment log names for this driver that disagree with his authorization paper.
  staleAssignments?: string[];
}

// Breach-of-trust insurance. One company-wide policy, so the only per-driver question is whether he is covered. "Required" is not neutral: it means a driver is working without coverage.
const FIDELITY: Record<string, { ar: string; en: string; cls: string }> = {
  covered: { ar: 'مشمول', en: 'Covered', cls: 'bg-emerald-100 text-emerald-700' },
  required: { ar: 'مطلوب ضمُّه', en: 'Required', cls: 'bg-red-100 text-red-700' },
  '': { ar: 'غير محدَّد', en: 'Not set', cls: 'bg-slate-100 text-slate-500' },
};

// Transport type. The card itself does not distinguish heavy from other drivers; the difference is in the registration type of the vehicle authorized to him, which the server derives (`driverClass` in the controller).
const VCLASS: Record<string, { ar: string; en: string; cls: string }> = {
  heavy: { ar: 'نقل ثقيل', en: 'Heavy', cls: 'bg-indigo-100 text-indigo-700' },
  light: { ar: 'مركبة خاصة', en: 'Private', cls: 'bg-teal-100 text-teal-700' },
  motorcycle: { ar: 'دراجة آلية', en: 'Motorcycle', cls: 'bg-violet-100 text-violet-700' },
  none: { ar: 'بلا تفويض', en: 'No auth.', cls: 'bg-slate-100 text-slate-500' },
};

// Expiry chips use the same wording and colours as the rest of the section.
// Day counts are not in the labels because thresholds are configurable in section settings; a hard-coded "<=30" would lie after a change. The count is read from the remaining-days column.
const STATE: Record<string, { ar: string; en: string; cls: string }> = {
  expired: { ar: 'منتهية', en: 'Expired', cls: 'bg-red-100 text-red-700' },
  critical: { ar: 'حرجة', en: 'Critical', cls: 'bg-orange-100 text-orange-700' },
  warning: { ar: 'تحذير', en: 'Warning', cls: 'bg-amber-100 text-amber-700' },
  upcoming: { ar: 'قريبة', en: 'Soon', cls: 'bg-sky-100 text-sky-700' },
  valid: { ar: 'سارية', en: 'Valid', cls: 'bg-emerald-100 text-emerald-700' },
  unknown: { ar: 'بلا تاريخ', en: 'No date', cls: 'bg-slate-100 text-slate-600' },
};

// Table columns and each column's reader: one definition for header and filter, using the same expression the cell renders, so what is filtered is exactly what is shown.
const COL_DEFS: [string, string, string][] = [
  ['name', 'الاسم', 'Name'],
  ['idNumber', 'رقم الهوية', 'ID'],
  ['absher', 'جوال أبشر', 'Absher'],
  ['register', 'السجل اللوجستي', 'Register'],
  ['cardNumber', 'رقم البطاقة', 'Card no.'],
  ['cardType', 'نوع البطاقة', 'Card type'],
  ['vclass', 'نوع النقل', 'Transport'],
  ['expiry', 'الانتهاء', 'Expiry'],
  ['daysLeft', 'المتبقي', 'Days left'],
  ['state', 'الحالة', 'State'],
  ['fidelity', 'خيانة الأمانة', 'Fidelity'],
  ['iqamaExp', 'انتهاء الإقامة', 'Iqama expiry'],
  ['licenseExp', 'انتهاء رخصة القيادة', 'Licence expiry'],
  ['auth', 'التفاويض', 'Authorisations'],
  ['employee', 'الموظف', 'Employee'],
];
const GETTERS: Record<string, (c: Card) => any> = {
  name: (c) => c.name,
  idNumber: (c) => c.idNumber,
  absher: (c) => c.absherPhone,
  register: (c) => c.logisticRegister,
  cardNumber: (c) => c.cardNumber,
  cardType: (c) => c.cardType,
  vclass: (c) => c.vehicleClass || 'none',
  expiry: (c) => c.expiryDate,
  daysLeft: (c) => c.daysLeft,
  state: (c) => c.state,
  fidelity: (c) => c.fidelity?.status || '',
  // Filtered by status (expired / within 30 days / valid / not recorded), not by date.
  iqamaExp: (c) => c.iqamaState || 'missing',
  licenseExp: (c) => c.licenseState || 'missing',
  // Authorized plates: filter on each single plate, not the joined list, so a specific vehicle is found even if the driver holds two.
  auth: (c) => (c.authorizations || []).map((a) => a.plateNumber).filter(Boolean).join(' · '),
  employee: (c) => (c.employee ? (c.employee.employeeNumber || c.employee.arabicName || '✓') : ''),
};

const EMPTY: Partial<Card> = { idNumber: '', name: '', absherPhone: '', logisticRegister: '', cardNumber: '', cardType: 'سنوية', transportTypeAr: '', expiryDate: '', notes: '' };

export default function DriverCardsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();

  const canEdit = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager', 'hr_manager'].includes((user as any)?.role || '')
    || canEditSection((user as any)?.permissions, 'Vehicles');

  const [cards, setCards] = useState<Card[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [options, setOptions] = useState<{ logisticRegister: string[]; cardType: string[]; vehicleClass?: { code: string; ar: string; en: string }[] }>({ logisticRegister: [], cardType: [], vehicleClass: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fState, setFState] = useState('');
  const [fReg, setFReg] = useState('');
  const [fType, setFType] = useState('');
  const [fFid, setFFid] = useState('');
  const [fClass, setFClass] = useState('');
  const [editing, setEditing] = useState<Partial<Card> | null>(null);
  // Has card / no card: derived on the server and used as a filter chip like the others.
  const [fHas, setFHas] = useState<'' | 'yes' | 'no'>('');
  const [saving, setSaving] = useState(false);
  const [emps, setEmps] = useState<any[]>([]);
  const cf = useColumnFilters<Card>();

  const load = useCallback(async () => {
    try {
      const d = await api.get<any>('/api/vehicle-registry/driver-cards');
      setCards(d.cards || []); setTotals(d.totals || {}); setOptions(d.options || { logisticRegister: [], cardType: [], vehicleClass: [] });
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));
  useEffect(() => {
    if (!editing) return;
    api.get<{ employees: any[] }>('/api/vehicles/employees').then((r) => setEmps(r.employees || [])).catch(() => {});
  }, [editing]);

  // Filtering runs in the browser: the dataset is small and a server call per keystroke is wasteful. Text folding is the shared one in lib/flexMatch.
  const fold = flexNormalize;
  const shown = useMemo(() => {
    const n = fold(q);
    return cards.filter((c) => {
      if (fState && c.state !== fState) return false;
      /** "Light" on the card merges motorcycle and private vehicle into one class opposite heavy transport; the card and the table must use the same split. */
      if (fClass === 'light') {
        if (!c.hasCard || !['light', 'motorcycle'].includes(c.vehicleClass || '')) return false;
      } else if (fClass === 'heavy') {
        if (!c.hasCard || c.vehicleClass !== 'heavy') return false;
      } else if (fClass && (c.vehicleClass || 'none') !== fClass) return false;
      // "Has card" is derived on the server from the card number; see hasCard in listDriverCards.
      if (fHas === 'yes' && !c.hasCard) return false;
      if (fHas === 'no' && c.hasCard) return false;
      if (fReg && (c.logisticRegister || '') !== fReg) return false;
      if (fType && (c.cardType || '') !== fType) return false;
      if (fFid && (c.fidelity?.status || '') !== fFid) return false;
      if (!n) return true;
      // Also searchable by plate, so "who is authorized on plate X" can be answered here.
      return [c.name, c.idNumber, c.cardNumber, c.absherPhone, c.logisticRegister, c.cardType, c.notes,
        c.employee?.employeeNumber, c.employee?.arabicName,
        ...(c.authorizations || []).map((a) => a.plateNumber)].some((v) => fold(v).includes(n));
    });
  }, [cards, q, fState, fReg, fType, fFid, fHas, fClass]);

  // Applied last: above search and chips, like Excel.
  const shownRows = cf.apply(shown, GETTERS);

  const activeF = [fState, fReg, fType, fFid, fHas, fClass].filter(Boolean).length;

  const save = async () => {
    if (!editing?.idNumber?.trim()) { notify(t('رقم الهوية مطلوب', 'ID number required'), 'error'); return; }
    setSaving(true);
    try {
      if (editing._id) await api.put(`/api/vehicle-registry/driver-cards/${editing._id}`, editing);
      else await api.post('/api/vehicle-registry/driver-cards', editing);
      setEditing(null); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const remove = async (c: Card) => {
    if (!(await confirm({ message: t(`حذف بطاقة «${c.name || c.idNumber}»؟`, `Delete card for “${c.name || c.idNumber}”?`) }))) return;
    try { await api.delete(`/api/vehicle-registry/driver-cards/${c._id}`); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const cols: ExportColumn[] = [
    { header: t('رقم الهوية', 'ID number'), key: 'idNumber', width: 16 },
    { header: t('الاسم', 'Name'), key: 'name', width: 28 },
    { header: t('جوال أبشر', 'Absher phone'), key: 'absherPhone', width: 14 },
    { header: t('السجل اللوجستي', 'Logistic register'), key: 'logisticRegister', width: 16 },
    // The export matches the cell. On screen a missing number shows a red "required" badge; in the file the cell used to be blank, which reads as a data-entry omission rather than a driver without a card.
    { header: t('رقم البطاقة', 'Card number'), key: 'cardNumber', width: 16,
      transform: (v: any, row: any) => (row?.hasCard ? v : t('مطلوبة — لم تُستخرج', 'Needed — not issued')) },
    // A column that can be summed and filtered in Excel, not a badge read by eye only.
    { header: t('له بطاقة', 'Has card'), key: 'hasCard',
      transform: (v: any) => (v ? t('نعم', 'Yes') : t('لا', 'No')), width: 10 },
    { header: t('نوع البطاقة', 'Card type'), key: 'cardType', width: 12 },
    { header: t('تاريخ الانتهاء', 'Expiry'), key: 'expiryDate', width: 14 },
    { header: t('الأيام المتبقية', 'Days left'), key: 'daysLeft', width: 12 },
    { header: t('خيانة الأمانة', 'Fidelity insurance'), key: 'fidelity',
      transform: (v: any) => (ar ? FIDELITY[v?.status || ''].ar : FIDELITY[v?.status || ''].en), width: 14 },
    ...personDocExportColumns(ar),
    { header: t('عدد التفاويض', 'Authorisations'), key: 'authorizations', transform: (v: any) => (v?.length || 0), width: 12 },
    { header: t('المركبات المفوَّضة', 'Authorised vehicles'), key: 'authorizations',
      transform: (v: any) => (v || []).map((a: any) => a.plateNumber).filter(Boolean).join(' · '), width: 30 },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 30 },
  ];

  if (loading) return <Spinner />;

  const Stat = ({ label, value, accent, onClick, on }: { label: string; value: any; accent?: string; onClick?: () => void; on?: boolean }) => (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`text-start bg-white border rounded-xl px-4 py-3 shadow-sm transition-all ${
        on ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'} ${onClick ? 'hover:border-[#f37121]/50 cursor-pointer' : ''}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent || 'text-slate-900'}`}>{value}</p>
    </button>
  );

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<IdCard className="w-6 h-6 text-[#f37121]" />}
        title={t('بطاقات السائقين', 'Driver cards')}
        subtitle={t('سجلُّ البطاقات وتواريخ انتهائها والسجل اللوجستي الصادرة تحته', 'Card register, expiry dates and the logistic register they were issued under')}>
        <ExportMenu fileName="driver-cards" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('بطاقات السائقين', 'Driver cards'), rows: shownRows, columns: cols }] }]} />
        {canEdit && <PrimaryButton onClick={() => setEditing({ ...EMPTY })}><Plus className="w-4 h-4" /> {t('بطاقة جديدة', 'New card')}</PrimaryButton>}
      </PageHeader>

      {/* Cards filter on click: the number shown is the list that opens. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Drivers, not cards. The headline number was total cards while some drivers have no card extracted; the question is how many drivers we have and how many hold a card. */}
        <Stat label={t('إجمالي السائقين', 'Total drivers')} value={totals.drivers ?? totals.total ?? 0}
          onClick={() => { setFState(''); setFFid(''); setFHas(''); setFClass(''); }} on={!fState && !fFid && !fHas && !fClass} />
        <Stat label={t('لهم بطاقة', 'With a card')} value={totals.withCard || 0} accent="text-emerald-600"
          onClick={() => { setFHas('yes'); setFState(''); }} on={fHas === 'yes'} />
        <Stat label={t('بلا بطاقة — مطلوبة', 'No card — needed')} value={totals.withoutCard || 0} accent="text-red-600"
          onClick={() => { setFHas('no'); setFState(''); }} on={fHas === 'no'} />
        <Stat label={t('منتهية', 'Expired')} value={totals.expired || 0} accent="text-red-600" onClick={() => setFState('expired')} on={fState === 'expired'} />
        {/* The three expiry chips match the rest of the section and use names, not day counts: thresholds come from section settings and apply immediately. */}
        <Stat label={t('حرجة', 'Critical')} value={totals.critical || 0} accent="text-orange-600" onClick={() => setFState('critical')} on={fState === 'critical'} />
        <Stat label={t('تحذير', 'Warning')} value={totals.warning || 0} accent="text-amber-600" onClick={() => setFState('warning')} on={fState === 'warning'} />
        <Stat label={t('قريبة', 'Soon')} value={totals.upcoming || 0} accent="text-sky-600" onClick={() => setFState('upcoming')} on={fState === 'upcoming'} />
        <Stat label={t('سارية', 'Valid')} value={totals.valid || 0} accent="text-emerald-600" onClick={() => setFState('valid')} on={fState === 'valid'} />
      </div>

      {/* The person, not the vehicle: card, breach-of-trust cover and what is authorized to him, previously scattered across three screens with no common key but his name. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t('لديهم وثيقة خيانة الأمانة', 'Have a fidelity policy')} value={totals.fidelityCovered || 0} accent="text-emerald-600"
          onClick={() => setFFid('covered')} on={fFid === 'covered'} />
        <Stat label={t('ليس لديهم وثيقة خيانة الأمانة', 'No fidelity policy')} value={totals.fidelityRequired || 0} accent="text-red-600"
          onClick={() => setFFid('required')} on={fFid === 'required'} />
        {/* Split of the cards themselves into heavy vs light; the two counts partition card holders and never exceed them. */}
        <Stat label={t('سائقين النقل الثقيل', 'Heavy-transport drivers')} value={totals.heavy || 0} accent="text-indigo-600"
          onClick={() => setFClass(fClass === 'heavy' ? '' : 'heavy')} on={fClass === 'heavy'} />
        <Stat label={t('سائقين النقل الخفيف', 'Light-transport drivers')} value={totals.light || 0} accent="text-violet-600"
          onClick={() => setFClass(fClass === 'light' ? '' : 'light')} on={fClass === 'light'} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[16rem]">
          <SearchInput value={q} onChange={setQ}
            placeholder={t('بحث بالاسم أو الهوية أو رقم البطاقة أو الجوال أو السجل…', 'name, ID, card no., phone, register…')} />
        </div>
        <select value={fReg} onChange={(e) => setFReg(e.target.value)} aria-label={t('السجل اللوجستي', 'Logistic register')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('كل السجلات اللوجستية', 'All registers')}</option>
          {options.logisticRegister.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label={t('نوع البطاقة', 'Card type')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('كل الأنواع', 'All types')}</option>
          {options.cardType.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fClass} onChange={(e) => setFClass(e.target.value)} aria-label={t('نوع النقل', 'Transport type')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('نوع النقل — الكل', 'Transport — all')}</option>
          {(options.vehicleClass || []).map((o) => <option key={o.code} value={o.code}>{ar ? o.ar : o.en}</option>)}
        </select>
        <select value={fFid} onChange={(e) => setFFid(e.target.value)} aria-label={t('خيانة الأمانة', 'Fidelity insurance')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('خيانة الأمانة — الكل', 'Fidelity — all')}</option>
          <option value="covered">{t('مشمول', 'Covered')}</option>
          <option value="required">{t('مطلوب ضمُّه', 'Required')}</option>
        </select>
        {(activeF > 0 || q) && (
          <button type="button" onClick={() => { setFState(''); setFReg(''); setFType(''); setFFid(''); setFClass(''); setQ(''); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
            <RotateCcw className="w-4 h-4" /> {t('مسح', 'Clear')}
          </button>
        )}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="text-xs text-slate-500">{t(`${shownRows.length} من ${cards.length}`, `${shownRows.length} of ${cards.length}`)}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {/* Actions first and sticky (components/vehicles/stickyLead). */}
                {canEdit && (
                  <th className={`${LEAD} bg-slate-900 px-3 py-2.5 text-start font-semibold whitespace-nowrap`}>
                    {t('إجراءات', 'Actions')}
                  </th>
                )}
                {COL_DEFS.map(([key, arL, enL]) => (
                  <th key={key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center">
                      {t(arL, enL)}
                      {cf.header(key, shown, GETTERS[key], ar,
                        key === 'vclass' ? (v: any) => (ar ? VCLASS[String(v)]?.ar : VCLASS[String(v)]?.en) || String(v)
                          : key === 'state' ? (v: any) => (STATE[String(v)] ? (ar ? STATE[String(v)].ar : STATE[String(v)].en) : String(v))
                            : key === 'fidelity' ? (v: any) => (ar ? FIDELITY[String(v)]?.ar : FIDELITY[String(v)]?.en) || String(v)
                              : key === 'iqamaExp' || key === 'licenseExp' ? (v: any) => docStateLabel(v as DocState, ar)
                                : undefined)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.length === 0 ? (
                <tr><td colSpan={COL_DEFS.length + (canEdit ? 1 : 0)} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : shownRows.map((c) => {
                const st = STATE[c.state] || STATE.unknown;
                return (
                  <tr key={c._id} className="group border-b border-slate-100 hover:bg-slate-50">
                    {canEdit && (
                      <td className={`${LEAD_CELL} px-3 py-2.5 whitespace-nowrap`}>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setEditing(c)} className="p-1 text-slate-400 hover:text-[#f37121]" title={t('تعديل', 'Edit')}><Pencil className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => remove(c)} className="p-1 text-slate-400 hover:text-red-600" title={t('حذف', 'Delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-semibold text-slate-900 max-w-[220px] truncate" title={c.name}>{c.name || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{c.idNumber}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {c.absherPhone ? <a href={`tel:${c.absherPhone}`} className="inline-flex items-center gap-1 hover:text-[#f37121]"><Phone className="w-3.5 h-3.5" />{c.absherPhone}</a> : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{c.logisticRegister || '—'}</td>
                    {/* A blank means "required": the state is derived, not typed as a word into a number field; see hasCard. */}
                    <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                      {c.hasCard
                        ? c.cardNumber
                        : <span className="font-sans px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">{t('مطلوبة — لم تُستخرج', 'Needed — not issued')}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.cardType || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${VCLASS[c.vehicleClass || 'none'].cls}`}
                        title={c.authorizations?.map((a) => `${a.plateNumber} — ${a.registrationTypeAr || ''}`).join(' · ') || ''}>
                        {ar ? VCLASS[c.vehicleClass || 'none'].ar : VCLASS[c.vehicleClass || 'none'].en}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.expiryDate || '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{c.daysLeft === null ? '—' : c.daysLeft}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${st.cls}`}>{ar ? st.ar : st.en}</span></td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${FIDELITY[c.fidelity?.status || ''].cls}`}
                        title={c.fidelity?.notes || c.fidelity?.policyNumber || ''}>
                        {ar ? FIDELITY[c.fidelity?.status || ''].ar : FIDELITY[c.fidelity?.status || ''].en}
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><PersonDocDate ar={ar} date={c.iqamaExpiry} state={c.iqamaState} /></td>
                    <td className="px-3 py-2.5"><PersonDocDate ar={ar} date={c.licenseExpiry} state={c.licenseState} /></td>
                    {/* Plates open: the row answers what he holds, then links to it. */}
                    <td className="px-3 py-2.5 text-xs">
                      {(c.authorizations || []).length === 0
                        ? <span className="text-slate-300">—</span>
                        : (
                          <div className="flex flex-wrap gap-1 max-w-[15rem]">
                            {c.authorizations!.map((a) => (
                              <Link key={a._id} href={a.vehicle ? `/system/vehicles/registry/${a.vehicle}` : '#'}
                                className="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 font-mono text-[11px] hover:bg-sky-100"
                                title={[a.authorizationNumber && t(`تفويض ${a.authorizationNumber}`, `authorisation ${a.authorizationNumber}`),
                                  a.startDate && t(`من ${a.startDate}`, `from ${a.startDate}`),
                                  a.expiryDate && t(`إلى ${a.expiryDate}`, `to ${a.expiryDate}`)].filter(Boolean).join(' · ')}>
                                {a.plateNumber || '—'}
                              </Link>
                            ))}
                          </div>
                        )}
                      {/* Show the disagreement instead of swallowing it: the older assignment log names another truck for him and one is stale; only the section manager knows which. */}
                      {!!c.staleAssignments?.length && (
                        <p className="mt-1 text-[10px] text-amber-600 leading-tight"
                          title={t('سجلّ الإسناد الأقدم يسمّي له هذه اللوحة — يُراجَع', 'The older assignment register names this plate for him — needs review')}>
                          ⚠ {t('سجلٌّ أقدم:', 'older register:')} {c.staleAssignments.join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {c.employee ? (c.employee.employeeNumber || c.employee.arabicName || '✓')
                        : <span className="text-amber-600 text-xs">{t('غير مربوط', 'unlinked')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing?._id ? t('تعديل بطاقة', 'Edit card') : t('بطاقة جديدة', 'New card')}
        footer={<>
          <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
        </>}>
        {/* Searching for the card holder fills his fields. Name, ID number and Absher mobile already live in HR and the light-transport register, so read them instead of retyping on every card. */}
        <div className="mb-3">
          <PersonLookup ar={ar}
            label={t('ابحث عن الشخص فتُملأ بيانات البطاقة', 'Find the person to fill the card')}
            hint={t('بالاسم أو رقم الهوية أو الإقامة — والكتابة اليدوية تبقى متاحة.',
                    'By name, national ID or iqama — typing by hand still works.')}
            onPick={(pp) => setEditing((p) => ({
              ...p,
              idNumber: pp.idNumber || p?.idNumber || '',
              name: pp.name || p?.name || '',
              absherPhone: pp.absherPhone || pp.phone || p?.absherPhone || '',
              dateOfBirth: pp.dateOfBirth || p?.dateOfBirth || '',
              ...(pp.employeeId ? { employee: pp.employeeId as any } : {}),
            }))} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('رقم الهوية *', 'ID number *')}>
            <TextInput value={editing?.idNumber || ''} onChange={(e) => setEditing((p) => ({ ...p, idNumber: e.target.value }))} />
            {/* His birth date and mobile sit under the number and fill both fields when empty. */}
            <IqamaPersonInfo idNumber={editing?.idNumber} ar={ar}
              onFound={(pp) => setEditing((p) => ({ ...p, dateOfBirth: p?.dateOfBirth || pp.dateOfBirth || '', absherPhone: p?.absherPhone || pp.absherPhone || pp.phone || '' }))} /></Field>
          <Field label={t('الاسم', 'Name')}>
            <TextInput value={editing?.name || ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} /></Field>
          {/* Linking to the employee makes a card renewal update his file too. */}
          <div className="sm:col-span-2"><Field label={t('الموظف المرتبط', 'Linked employee')}>
            <SearchableSelect value={(editing?.employee as any)?._id || (editing?.employee as any) || ''} searchAfter={0}
              onChange={(v) => setEditing((p) => ({ ...p, employee: v as any }))}
              placeholder={t('اختر الموظف — اكتب للبحث…', 'Pick employee — type to search…')}
              searchPlaceholder={t('اسم أو رقم وظيفي أو إقامة…', 'name, employee no. or iqama…')}
              options={emps.map((e) => ({ value: e._id, label: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(), hint: e.employeeNumber || e.iqamaNumber || '' }))} /></Field></div>
          <Field label={t('جوال أبشر', 'Absher phone')}>
            <TextInput value={editing?.absherPhone || ''} onChange={(e) => setEditing((p) => ({ ...p, absherPhone: e.target.value }))} /></Field>
          <Field label={t('السجل اللوجستي', 'Logistic register')}>
            <TextInput value={editing?.logisticRegister || ''} onChange={(e) => setEditing((p) => ({ ...p, logisticRegister: e.target.value }))} /></Field>
          {/* No words in a number field. A driver without a card used to get a word in the number field, which then read as a number and counted the row as a card. The status is derived from blank: leave it empty and the table shows "required". */}
          <Field label={t('رقم البطاقة', 'Card number')}>
            <TextInput value={editing?.cardNumber || ''}
              placeholder={t('اتركه فارغًا إن لم تُستخرج بعد', 'Leave empty if not issued yet')}
              onChange={(e) => setEditing((p) => ({ ...p, cardNumber: e.target.value }))} />
            {!String(editing?.cardNumber || '').trim() && (
              <p className="mt-1 text-[11.5px] text-red-700">
                {t('بلا رقم ⇒ تُقرأ «مطلوبة — لم تُستخرج» في الجدول', 'No number ⇒ shows as "needed — not issued"')}
              </p>
            )}
          </Field>
          <Field label={t('نوع البطاقة', 'Card type')}>
            <ManagedSelect storeLabel type="vehicle_driver_card_type" value={editing?.cardType || ''}
              onChange={(v: string) => setEditing((p) => ({ ...p, cardType: v }))} /></Field>
          {/* Transport type is written at creation. Deriving it only from the driver's vehicles is right for someone holding a vehicle but wrong for a heavy-transport driver whose card is issued before assignment (shown as unauthorized). The written value wins; the derived one fills blanks. */}
          <Field label={t('نوع النقل', 'Transport type')}>
            <ManagedSelect storeLabel type="vehicle_transport_type" value={editing?.transportTypeAr || ''}
              onChange={(v: string) => setEditing((p) => ({ ...p, transportTypeAr: v }))} /></Field>
          <Field label={t('تاريخ الانتهاء', 'Expiry date')}>
            <TextInput type="date" value={editing?.expiryDate || ''} onChange={(e) => setEditing((p) => ({ ...p, expiryDate: e.target.value }))} /></Field>
          <Field label={t('تاريخ الميلاد', 'Date of birth')}>
            <TextInput type="date" value={editing?.dateOfBirth || ''} onChange={(e) => setEditing((p) => ({ ...p, dateOfBirth: e.target.value }))} /></Field>
          {/* Breach-of-trust. The policy number and expiry live in the company insurance documents, not here: one policy covers all, and copies on each driver diverge at first renewal. Only this driver's position in it is written here. */}
          <Field label={t('خيانة الأمانة', 'Fidelity insurance')}>
            <select value={editing?.fidelity?.status || ''} aria-label={t('خيانة الأمانة', 'Fidelity insurance')}
              onChange={(e) => setEditing((p) => ({ ...p, fidelity: { ...(p?.fidelity || {}), status: e.target.value as any } }))}
              className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
              <option value="">{t('غير محدَّد', 'Not set')}</option>
              <option value="covered">{t('مشمول', 'Covered')}</option>
              <option value="required">{t('مطلوب ضمُّه', 'Required')}</option>
            </select></Field>
          <Field label={t('تاريخ الضمّ للوثيقة', 'Added to policy on')}>
            <TextInput type="date" value={editing?.fidelity?.addedDate || ''}
              onChange={(e) => setEditing((p) => ({ ...p, fidelity: { ...(p?.fidelity || {}), addedDate: e.target.value } }))} /></Field>
          <div className="sm:col-span-2"><Field label={t('وثيقة خاصّة (إن لم يكن على وثيقة الشركة)', 'Own policy number (if not on the company policy)')}>
            <TextInput value={editing?.fidelity?.policyNumber || ''}
              onChange={(e) => setEditing((p) => ({ ...p, fidelity: { ...(p?.fidelity || {}), policyNumber: e.target.value } }))} /></Field></div>
          <div className="sm:col-span-2"><Field label={t('ملاحظات', 'Notes')}>
            <TextInput value={editing?.notes || ''} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} /></Field></div>
        </div>
      </Modal>
    </div>
  );
}
