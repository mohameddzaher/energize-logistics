'use client';
// بطاقاتُ السائقين — سجلٌّ في قسم المركبات.
//
// البطاقةُ وثيقةٌ تنتهي ويُطالَب بتجديدها، ولها سجلٌّ لوجستيٌّ تُصدَر تحته —
// ومركباتُ سجلٍّ لا يقودها إلّا مَن بطاقتُه منه. فالسجلُّ هنا لا في ملفّ الموظّف.
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, SearchableSelect, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/vehicles/useColumnFilters';
import { IdCard, Plus, Pencil, Trash2, RotateCcw, Phone } from 'lucide-react';
import { flexNormalize } from '@/lib/flexMatch';

interface Card {
  _id: string; idNumber: string; name?: string; dateOfBirth?: string; absherPhone?: string;
  logisticRegister?: string; cardNumber?: string; cardType?: string; expiryDate?: string;
  notes?: string; isActive?: boolean; daysLeft: number | null; state: string;
  employee?: { _id: string; employeeNumber?: string; arabicName?: string; firstName?: string; lastName?: string; employmentStatus?: string } | null;
  // الشيءان الآخران اللذان يخصّان السائق لا المركبة.
  fidelity?: { status?: '' | 'covered' | 'required'; policyNumber?: string; addedDate?: string; notes?: string };
  authorizations?: { _id: string; source?: 'registry' | 'assignment'; vehicle: string | null; plateNumber: string; startDate?: string; expiryDate?: string; authorizationNumber?: string }[];
  // لوحاتٌ يسمّيها سجلُّ الإسناد الأقدمُ لهذا السائق وتخالف ورقةَ تفويضه.
  staleAssignments?: string[];
}

// ── خيانة الأمانة ────────────────────────────────────────────────────────────
// وثيقةٌ واحدةٌ على مستوى الشركة، والسؤالُ عن السائق سؤالٌ واحد: أمشمولٌ هو؟
// و«مطلوب» ليست حالةً محايدة — هي سائقٌ يعمل والوثيقةُ لا تغطّيه.
const FIDELITY: Record<string, { ar: string; en: string; cls: string }> = {
  covered: { ar: 'مشمول', en: 'Covered', cls: 'bg-emerald-100 text-emerald-700' },
  required: { ar: 'مطلوب ضمُّه', en: 'Required', cls: 'bg-red-100 text-red-700' },
  '': { ar: 'غير محدَّد', en: 'Not set', cls: 'bg-slate-100 text-slate-500' },
};

// شرائحُ الانتهاء بلغة بقيّة مستندات القسم ولونِها نفسِه.
const STATE: Record<string, { ar: string; en: string; cls: string }> = {
  expired: { ar: 'منتهية', en: 'Expired', cls: 'bg-red-100 text-red-700' },
  critical: { ar: 'حرجة (≤٣٠ يوم)', en: 'Critical (≤30d)', cls: 'bg-orange-100 text-orange-700' },
  warning: { ar: 'تحذير (≤٦٠ يوم)', en: 'Warning (≤60d)', cls: 'bg-amber-100 text-amber-700' },
  upcoming: { ar: 'قريبة (≤٩٠ يوم)', en: 'Upcoming (≤90d)', cls: 'bg-sky-100 text-sky-700' },
  valid: { ar: 'سارية', en: 'Valid', cls: 'bg-emerald-100 text-emerald-700' },
  unknown: { ar: 'بلا تاريخ', en: 'No date', cls: 'bg-slate-100 text-slate-600' },
};

// ── أعمدةُ الجدول وقارئُ كلٍّ منها ───────────────────────────────────────────
// تعريفٌ واحدٌ للترويسة وللقمع: القيمةُ تُقرأ بالتعبير نفسِه الذي تُرسم به
// الخليّة، فما يُفلتَر عليه هو ما يُقرأ حرفًا بحرف.
const COL_DEFS: [string, string, string][] = [
  ['name', 'الاسم', 'Name'],
  ['idNumber', 'رقم الهوية', 'ID'],
  ['absher', 'جوال أبشر', 'Absher'],
  ['register', 'السجل اللوجستي', 'Register'],
  ['cardNumber', 'رقم البطاقة', 'Card no.'],
  ['cardType', 'النوع', 'Type'],
  ['expiry', 'الانتهاء', 'Expiry'],
  ['daysLeft', 'المتبقي', 'Days left'],
  ['state', 'الحالة', 'State'],
  ['fidelity', 'خيانة الأمانة', 'Fidelity'],
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
  expiry: (c) => c.expiryDate,
  daysLeft: (c) => c.daysLeft,
  state: (c) => c.state,
  fidelity: (c) => c.fidelity?.status || '',
  // اللوحاتُ المفوَّضة: يُفلتَر على اللوحة الواحدة لا على القائمة المجمَّعة —
  // فمن يبحث عن مركبةٍ بعينها يجدها ولو كان السائقُ يمسك اثنتين.
  auth: (c) => (c.authorizations || []).map((a) => a.plateNumber).filter(Boolean).join(' · '),
  employee: (c) => (c.employee ? (c.employee.employeeNumber || c.employee.arabicName || '✓') : ''),
};

const EMPTY: Partial<Card> = { idNumber: '', name: '', absherPhone: '', logisticRegister: '', cardNumber: '', cardType: 'سنوية', expiryDate: '', notes: '' };

export default function DriverCardsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();

  const canEdit = ['super_admin', 'admin', 'vehicles_manager', 'hr_manager'].includes((user as any)?.role || '')
    || canEditSection((user as any)?.permissions, 'Vehicles');

  const [cards, setCards] = useState<Card[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [options, setOptions] = useState<{ logisticRegister: string[]; cardType: string[] }>({ logisticRegister: [], cardType: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fState, setFState] = useState('');
  const [fReg, setFReg] = useState('');
  const [fType, setFType] = useState('');
  const [fFid, setFFid] = useState('');
  const [editing, setEditing] = useState<Partial<Card> | null>(null);
  const [saving, setSaving] = useState(false);
  const [emps, setEmps] = useState<any[]>([]);
  const cf = useColumnFilters<Card>();

  const load = useCallback(async () => {
    try {
      const d = await api.get<any>('/api/vehicle-registry/driver-cards');
      setCards(d.cards || []); setTotals(d.totals || {}); setOptions(d.options || { logisticRegister: [], cardType: [] });
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

  // الفلترةُ في المتصفّح: ثلاثةٌ وستّون صفًّا، ونداءُ الخادم لكلّ حرفٍ إسراف.
  // والطيُّ هو الطيُّ الموحَّد — راجع lib/flexMatch.
  const fold = flexNormalize;
  const shown = useMemo(() => {
    const n = fold(q);
    return cards.filter((c) => {
      if (fState && c.state !== fState) return false;
      if (fReg && (c.logisticRegister || '') !== fReg) return false;
      if (fType && (c.cardType || '') !== fType) return false;
      if (fFid && (c.fidelity?.status || '') !== fFid) return false;
      if (!n) return true;
      // ويُبحَث باللوحة أيضًا: «مَن المفوَّض على ٥٠٣٤؟» سؤالٌ يُسأل من هنا الآن.
      return [c.name, c.idNumber, c.cardNumber, c.absherPhone, c.logisticRegister, c.cardType, c.notes,
        c.employee?.employeeNumber, c.employee?.arabicName,
        ...(c.authorizations || []).map((a) => a.plateNumber)].some((v) => fold(v).includes(n));
    });
  }, [cards, q, fState, fReg, fType, fFid]);

  // آخرُ ما يُطبَّق: فوق البحث والشرائح، كما يفعل إكسل.
  const shownRows = cf.apply(shown, GETTERS);

  const activeF = [fState, fReg, fType, fFid].filter(Boolean).length;

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
    { header: t('رقم البطاقة', 'Card number'), key: 'cardNumber', width: 16 },
    { header: t('نوع البطاقة', 'Card type'), key: 'cardType', width: 12 },
    { header: t('تاريخ الانتهاء', 'Expiry'), key: 'expiryDate', width: 14 },
    { header: t('الأيام المتبقية', 'Days left'), key: 'daysLeft', width: 12 },
    { header: t('خيانة الأمانة', 'Fidelity insurance'), key: 'fidelity',
      transform: (v: any) => (ar ? FIDELITY[v?.status || ''].ar : FIDELITY[v?.status || ''].en), width: 14 },
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

      {/* البطاقاتُ تُفلتِر بالضغط: الرقمُ الذي يُقرأ هو الذي يُفتح. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label={t('إجمالي البطاقات', 'Total cards')} value={totals.total || 0} onClick={() => { setFState(''); setFFid(''); }} on={!fState && !fFid} />
        <Stat label={t('منتهية', 'Expired')} value={totals.expired || 0} accent="text-red-600" onClick={() => setFState('expired')} on={fState === 'expired'} />
        <Stat label={t('تنتهي خلال ٣٠ يوم', 'Within 30 days')} value={totals.critical || 0} accent="text-orange-600" onClick={() => setFState('critical')} on={fState === 'critical'} />
        <Stat label={t('تنتهي خلال ٦٠ يوم', 'Within 60 days')} value={totals.warning || 0} accent="text-amber-600" onClick={() => setFState('warning')} on={fState === 'warning'} />
        <Stat label={t('سارية', 'Valid')} value={totals.valid || 0} accent="text-emerald-600" onClick={() => setFState('valid')} on={fState === 'valid'} />
      </div>

      {/* ── الشخصُ لا المركبة ────────────────────────────────────────────────
          ثلاثةُ أشياء تخصُّ السائق نفسَه: بطاقتُه، وخيانةُ أمانته، وما هو
          مفوَّضٌ عليه. وكانت متفرّقةً في ثلاث شاشات لا يجمعها اسمُه. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t('مشمولون بخيانة الأمانة', 'Fidelity covered')} value={totals.fidelityCovered || 0} accent="text-emerald-600"
          onClick={() => setFFid('covered')} on={fFid === 'covered'} />
        <Stat label={t('مطلوب ضمُّهم', 'Fidelity required')} value={totals.fidelityRequired || 0} accent="text-red-600"
          onClick={() => setFFid('required')} on={fFid === 'required'} />
        <Stat label={t('بلا جواب', 'Not set')} value={totals.fidelityUnknown || 0} accent="text-slate-500"
          onClick={() => setFFid('')} on={false} />
        <Stat label={t('لديهم تفويض ساري', 'Holding a live authorisation')} value={totals.authorized || 0} accent="text-sky-600" />
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
        <select value={fFid} onChange={(e) => setFFid(e.target.value)} aria-label={t('خيانة الأمانة', 'Fidelity insurance')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('خيانة الأمانة — الكل', 'Fidelity — all')}</option>
          <option value="covered">{t('مشمول', 'Covered')}</option>
          <option value="required">{t('مطلوب ضمُّه', 'Required')}</option>
        </select>
        {(activeF > 0 || q) && (
          <button type="button" onClick={() => { setFState(''); setFReg(''); setFType(''); setFFid(''); setQ(''); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
            <RotateCcw className="w-4 h-4" /> {t('مسح', 'Clear')}
          </button>
        )}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="text-xs text-slate-500">{t(`${shownRows.length} من ${cards.length}`, `${shownRows.length} of ${cards.length}`)}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {COL_DEFS.map(([key, arL, enL]) => (
                  <th key={key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center">
                      {t(arL, enL)}
                      {cf.header(key, shown, GETTERS[key], ar,
                        key === 'state' ? (v: any) => (STATE[String(v)] ? (ar ? STATE[String(v)].ar : STATE[String(v)].en) : String(v))
                          : key === 'fidelity' ? (v: any) => (ar ? FIDELITY[String(v)]?.ar : FIDELITY[String(v)]?.en) || String(v)
                            : undefined)}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shownRows.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : shownRows.map((c) => {
                const st = STATE[c.state] || STATE.unknown;
                return (
                  <tr key={c._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold text-slate-900 max-w-[220px] truncate" title={c.name}>{c.name || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{c.idNumber}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {c.absherPhone ? <a href={`tel:${c.absherPhone}`} className="inline-flex items-center gap-1 hover:text-[#f37121]"><Phone className="w-3.5 h-3.5" />{c.absherPhone}</a> : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{c.logisticRegister || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{c.cardNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.cardType || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.expiryDate || '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{c.daysLeft === null ? '—' : c.daysLeft}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${st.cls}`}>{ar ? st.ar : st.en}</span></td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${FIDELITY[c.fidelity?.status || ''].cls}`}
                        title={c.fidelity?.notes || c.fidelity?.policyNumber || ''}>
                        {ar ? FIDELITY[c.fidelity?.status || ''].ar : FIDELITY[c.fidelity?.status || ''].en}
                      </span>
                    </td>
                    {/* اللوحاتُ تُفتَح: الصفُّ يجيب «ما بيده؟» ثمّ يوصل إليه. */}
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
                      {/* الخلافُ يُعرَض ولا يُبتلَع: سجلُّ الإسناد الأقدم يسمّي
                          له شاحنةً أخرى، وأحدُهما قديم — ومَن يعرف أيُّهما هو
                          مديرُ القسم لا الشاشة. */}
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
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setEditing(c)} className="p-1 text-slate-400 hover:text-[#f37121]" title={t('تعديل', 'Edit')}><Pencil className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => remove(c)} className="p-1 text-slate-400 hover:text-red-600" title={t('حذف', 'Delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing?._id ? t('تعديل بطاقة', 'Edit card') : t('بطاقة جديدة', 'New card')}
        footer={<>
          <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('رقم الهوية *', 'ID number *')}>
            <TextInput value={editing?.idNumber || ''} onChange={(e) => setEditing((p) => ({ ...p, idNumber: e.target.value }))} /></Field>
          <Field label={t('الاسم', 'Name')}>
            <TextInput value={editing?.name || ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} /></Field>
          {/* الربطُ بالموظّف يجعل تجديدَ البطاقة يُحدِّث ملفَّه معه. */}
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
          <Field label={t('رقم البطاقة', 'Card number')}>
            <TextInput value={editing?.cardNumber || ''} onChange={(e) => setEditing((p) => ({ ...p, cardNumber: e.target.value }))} /></Field>
          <Field label={t('نوع البطاقة', 'Card type')}>
            <TextInput value={editing?.cardType || ''} onChange={(e) => setEditing((p) => ({ ...p, cardType: e.target.value }))} /></Field>
          <Field label={t('تاريخ الانتهاء', 'Expiry date')}>
            <TextInput type="date" value={editing?.expiryDate || ''} onChange={(e) => setEditing((p) => ({ ...p, expiryDate: e.target.value }))} /></Field>
          <Field label={t('تاريخ الميلاد', 'Date of birth')}>
            <TextInput type="date" value={editing?.dateOfBirth || ''} onChange={(e) => setEditing((p) => ({ ...p, dateOfBirth: e.target.value }))} /></Field>
          {/* ── خيانة الأمانة ───────────────────────────────────────────────
              رقمُ الوثيقة وتاريخُ انتهائها في «وثائق تأمين الشركة» لا هنا،
              فوثيقةٌ واحدةٌ تغطّي الجميع ونسخُها على كلّ سائقٍ يجعلها تفترق عند
              أوّل تجديد. الذي يُكتب هنا هو موقعُ هذا السائق منها. */}
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
