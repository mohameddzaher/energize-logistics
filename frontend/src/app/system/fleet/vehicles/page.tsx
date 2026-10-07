'use client';
/**
 * سياراتنا — the 58 trucks of our own fleet.
 *
 * ── وطاقمُ الشاحنة يُسنَد من صفّ الشاحنة ────────────────────────────────────
 * كان الإسنادُ من صفحة السائقين وحدَها: تُفتَح، ويُبحَث عن الرجل بين اثنين
 * وستّين، وتُختار شاحنتُه من قائمة. والسؤالُ عند المشرف معكوسٌ — ينظر إلى
 * شاحنةٍ فيقول «مَن عليها؟ ومَن معه؟» — فصار عمودين في هذا الجدول: السائقُ
 * الأوّل والسائقُ الثاني، يُبدَّل كلٌّ منهما في موضعه.
 *
 * وكان العمودُ واحدًا يسرد الأسماء بلا رتبة، فلا يُعرَف مِن الشاشة مَن الأوّل.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatPlate } from '@/lib/flexMatch';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Truck, Plus, Pencil, Trash2, Check, Loader2, UserCog, BarChart3, Wrench, UserPlus } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, Select, SmallBadge, StatCard, ErrorNotice, SearchableSelect,
} from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { FleetVehicle, FleetDriver, TRAILER_TYPES, GPS_TYPES, foldAr, canEditFleet, canAdminFleet, seatsOf } from '@/lib/fleet';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters } from '@/hooks/useColumnFilters';

// أعمدة تصدير السيارات — الشاشة تصدّر مرّتين (الكل، والمعروض بعد الفلتر)،
// فالتعريف واحدٌ كي لا يفترق الملفان.
const VEHICLE_COLUMNS = [
  { header: 'Plate', key: 'plate', width: 16 },
  { header: 'Description', key: 'name', width: 22 },
  { header: 'Trailer type', key: 'trailerType', width: 14 },
  { header: 'GPS', key: 'gpsType', width: 8 },
  { header: 'Brand', key: 'brand', width: 14 },
  { header: 'Color', key: 'color', width: 12 },
  // بالرتبة لا مجموعةً: ملفٌّ يقول «أحمد + خالد» لا يقول مَن الأوّل.
  { header: 'First driver', key: 'drivers', transform: (v: any) => (v || []).find((d: any) => (d.seat || 1) === 1)?.name || '', width: 24 },
  { header: 'Second driver', key: 'drivers', transform: (v: any) => (v || []).find((d: any) => d.seat === 2)?.name || '', width: 24 },
  { header: 'Driver count', key: 'drivers', transform: (v: any) => (v || []).length, width: 12 },
  { header: 'Supervisor', key: 'supervisorName', width: 20 },
  { header: 'Carrying now', key: 'trip', transform: (v: any) => (v ? `WB ${v.waybillNumber} → ${v.toCity || ''}` : 'Idle'), width: 24 },
  { header: 'Live city', key: 'live', transform: (v: any) => v?.city || '', width: 14 },
  { header: 'Maintenance', key: 'maintenance', transform: (v: any) => (v ? (v.status === 'overdue' ? 'Overdue' : v.status === 'due' ? 'Due' : 'OK') : ''), width: 14 },
  { header: 'Km to service', key: 'maintenance', transform: (v: any) => (v?.kmToService ?? ''), width: 14 },
  { header: 'Notes', key: 'notes', width: 28 },
];

const EMPTY = { plate: '', name: '', brand: '', color: '', trailerType: '', gpsType: '', notes: '' };

export default function FleetVehiclesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditFleet(user);
  const admin = canAdminFleet(user);

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [gpsFilter, setGpsFilter] = useState('');
  const [seatsFilter, setSeatsFilter] = useState('');
  const [maintFilter, setMaintFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // تعيين المشرف — مدير القسم يوزّع السيارات على المشرفين من هنا.
  const [supervisors, setSupervisors] = useState<{ _id: string; firstName: string; lastName: string; email: string }[]>([]);
  const [assigning, setAssigning] = useState<FleetVehicle | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  useEffect(() => {
    if (!admin) return;
    api.get<{ users: any[] }>('/api/fleet/supervisors').then((d) => setSupervisors(d.users || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);
  const saveAssign = async () => {
    if (!assigning) return;
    setAssignSaving(true);
    try {
      await api.patch(`/api/fleet/vehicles/${assigning._id}/supervisor`, { supervisor: assignTo || null });
      setAssigning(null); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setAssignSaving(false);
  };

  // ── سائقو القسم: قائمةُ الاختيار في العمودين ──────────────────────────
  // تُجلَب مرّةً مع الشاحنات، والسوكِت يعيدها عند كلّ نقل — فلا تُسنَد شاحنةٌ
  // إلى رجلٍ نقله زميلٌ قبل لحظة.
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [seatBusy, setSeatBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, dr] = await Promise.all([
        api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles'),
        api.get<{ drivers: FleetDriver[] }>('/api/fleet/drivers'),
      ]);
      setVehicles(d.vehicles || []);
      setDrivers(dr.drivers || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));
  // Driver moves change the chips on this page too.
  useSocket('fleet:drivers', useCallback(() => load(), [load]));

  /**
   * ── والمقعدان يُكتبان في نداءٍ واحد ──────────────────────────────────────
   * لو كُتب كلُّ مقعدٍ وحدَه لمرّت القاعدةُ بلحظةٍ فيها رجلان في مقعدٍ واحد،
   * أو رُفض الإسنادُ لأنّ «الشاحنة عليها سائقان بالفعل» — وهو ترتيبُ الكتابة
   * لا حقيقةُ الطاقم. فالخادمُ يأخذ المقعدين معًا ويرتّبهما.
   */
  const setSeat = async (v: FleetVehicle, which: 1 | 2, driverId: string) => {
    const [a, b] = seatsOf(v);
    const next = {
      first: which === 1 ? driverId : (a?._id || ''),
      second: which === 2 ? driverId : (b?._id || ''),
    };
    // الرجلُ نفسُه في المقعدين لا معنى له: مَن رُفع إلى الأوّل يخلو مقعدُه.
    if (next.first && next.first === next.second) {
      if (which === 1) next.second = ''; else next.first = '';
    }
    setSeatBusy(v._id);
    try {
      await api.patch(`/api/fleet/vehicles/${v._id}/drivers`, next);
      await load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSeatBusy('');
  };

  /** خيارُ السائق: اسمُه، وأين هو الآن — فلا يُسحَب رجلٌ من شاحنةٍ بلا علم. */
  const driverOptions = useMemo(() => {
    const plateOf = (d: FleetDriver) => (typeof d.vehicle === 'object' && d.vehicle ? d.vehicle.plate : '');
    return [
      { value: '', label: ar ? 'المقعد شاغر' : 'Seat empty' },
      ...drivers.map((d) => ({
        value: d._id,
        label: d.name,
        hint: [
          plateOf(d) ? (ar ? `على ${plateOf(d)}${d.seat === 2 ? ' (ثانٍ)' : ''}` : `on ${plateOf(d)}${d.seat === 2 ? ' (2nd)' : ''}`)
            : (ar ? 'بلا شاحنة' : 'unassigned'),
          d.working ? '' : (ar ? 'لا يعمل' : 'off'),
        ].filter(Boolean).join(' · '),
      })),
    ];
  }, [drivers, ar]);

  // «إضافة سائق ثانٍ»: أيُّ سائقٍ، على أيّ شاحنة — السؤالُ الذي طُلب بالحرف.
  const [secondOpen, setSecondOpen] = useState(false);
  const [secondForm, setSecondForm] = useState({ vehicle: '', driver: '' });
  const [secondSaving, setSecondSaving] = useState(false);
  const saveSecond = async () => {
    const veh = vehicles.find((v) => v._id === secondForm.vehicle);
    if (!veh || !secondForm.driver) return;
    const [a] = seatsOf(veh);
    if (a && a._id === secondForm.driver) {
      notify(ar ? 'هو سائقُها الأوّل بالفعل.' : 'He is already its first driver.', 'error');
      return;
    }
    setSecondSaving(true);
    try {
      await api.patch(`/api/fleet/vehicles/${veh._id}/drivers`, { first: a?._id || '', second: secondForm.driver });
      setSecondOpen(false); setSecondForm({ vehicle: '', driver: '' });
      await load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSecondSaving(false);
  };

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setShowModal(true); };
  const openEdit = (v: FleetVehicle) => {
    setEditing(v);
    setForm({ plate: v.plate, name: v.name || '', brand: v.brand || '', color: v.color || '', trailerType: v.trailerType || '', gpsType: v.gpsType || '', notes: v.notes || '' });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.plate.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/fleet/vehicles/${editing._id}`, form);
      else await api.post('/api/fleet/vehicles', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (v: FleetVehicle) => {
    if (!(await confirm(ar
      ? `إزالة السيارة «${v.plate}»؟ يُنزَل سائقوها منها وتبقى شحناتها السابقة كما هي.`
      : `Remove “${v.plate}”? Its drivers are unseated; past shipments keep their snapshot.`))) return;
    try { await api.delete(`/api/fleet/vehicles/${v._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = vehicles.filter((v) => {
    if (gpsFilter && (v.gpsType || '') !== gpsFilter) return false;
    const seats = (v.drivers || []).length;
    if (seatsFilter === '0' && seats !== 0) return false;
    if (seatsFilter === '1' && seats !== 1) return false;
    if (seatsFilter === '2' && seats < 2) return false;
    if (maintFilter && (v.maintenance?.status || '') !== maintFilter) return false;
    const s = foldAr(search.trim());
    if (!s) return true;
    const names = (v.drivers || []).map((d) => d.name).join(' ');
    return [v.plate, v.name, v.trailerType, names].some((x) => foldAr(String(x || '')).includes(s));
  });

  // قمعُ الأعمدة — القيمُ كما تُقرأ في الصفّ. راجع hooks/useColumnFilters.
  const cf = useColumnFilters<any>({
    plate: (v) => formatPlate(v.plate),
    trailerType: (v) => v.trailerType || '',
    maintenance: (v) => (v.maintenance ? String(v.maintenance.status || '') : ''),
    gps: (v) => v.gpsType || '',
    driver1: (v) => seatsOf(v)[0]?.name || '',
    driver2: (v) => seatsOf(v)[1]?.name || '',
    supervisor: (v) => (v as any).supervisorName || '',
  }, filtered, ar ? 'ar' : 'en');
  const shown = cf.apply(filtered);

  if (loading) return <Spinner />;

  const seatCount = (v: FleetVehicle) => (v.drivers || []).length;
  const withNone = vehicles.filter((v) => seatCount(v) === 0).length;
  const withOne = vehicles.filter((v) => seatCount(v) === 1).length;
  const withTwo = vehicles.filter((v) => seatCount(v) >= 2).length;
  const maintOverdue = vehicles.filter((v) => v.maintenance?.status === 'overdue').length;
  const maintDue = vehicles.filter((v) => v.maintenance?.status === 'due').length;

  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={ar ? 'سياراتنا' : 'Our vehicles'}
        subtitle={ar
          ? `${vehicles.length} سيارة · ${withTwo} بسائقين · ${withNone} بدون سائق — السائق الأول والثاني يُسندان من الجدول هنا`
          : `${vehicles.length} vehicles · ${withTwo} with two drivers · ${withNone} with none — first and second driver are assigned right here`}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-vehicles"
          options={[
            { key: 'filtered', label: ar ? 'المعروض حسب الفلتر' : 'Filtered view', sheets: [{ name: 'Vehicles', rows: filtered as any[], columns: VEHICLE_COLUMNS }] },
            { key: 'all', label: ar ? 'كل السيارات' : 'All vehicles', sheets: [{ name: 'Vehicles', rows: vehicles as any[], columns: VEHICLE_COLUMNS }] },
          ]} />
        {/* الأيقونةُ بجانب «إضافة سيارة»: سؤالٌ واحدٌ — مَن يركب ثانيًا، وعلى
            أيّ شاحنة — بدل الذهاب إلى صفحة السائقين والبحث فيها. */}
        {editor && (
          <button type="button" onClick={() => setSecondOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#f37121]/40 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/10"
            title={ar ? 'إضافة سائق ثانٍ على شاحنة' : 'Add a second driver to a truck'}>
            <UserPlus className="w-4 h-4" /> {ar ? 'إضافة سائق ثانٍ' : 'Add second driver'}
          </button>
        )}
        {admin && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة سيارة' : 'Add vehicle'}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* ── والبطاقةُ تُصفّي الجدولَ تحتها ───────────────────────────────────
          «ستُّ شاحناتٍ بلا سائق» رقمٌ لا يُفتَح: يُقرأ ثمّ يُبحَث عن الستّ
          بالعين في سبعٍ وخمسين صفًّا. والفلاترُ قائمةٌ في الشاشة أصلًا
          (`seatsFilter` و`maintFilter`) — فالبطاقةُ تضغطها، وضغطةٌ ثانيةٌ
          تُرجع الكلّ. */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label={ar ? 'إجمالي السيارات' : 'Total vehicles'} value={vehicles.length}
          onClick={() => { setSeatsFilter(''); setMaintFilter(''); setGpsFilter(''); setSearch(''); }}
          active={!seatsFilter && !maintFilter && !gpsFilter && !search}
          hint={ar ? 'اضغط لعرض الكل' : 'tap to show all'} />
        <StatCard label={ar ? 'بدون سائق' : 'No driver'} value={withNone} accent={withNone > 0 ? 'text-red-600' : 'text-slate-900'}
          onClick={() => setSeatsFilter((v) => (v === '0' ? '' : '0'))} active={seatsFilter === '0'}
          hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
        <StatCard label={ar ? 'بسائق واحد' : 'One driver'} value={withOne}
          onClick={() => setSeatsFilter((v) => (v === '1' ? '' : '1'))} active={seatsFilter === '1'}
          hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
        <StatCard label={ar ? 'بسائقين' : 'Two drivers'} value={withTwo} accent="text-emerald-600"
          onClick={() => setSeatsFilter((v) => (v === '2' ? '' : '2'))} active={seatsFilter === '2'}
          hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
        <StatCard label={ar ? 'صيانةٌ متأخّرة' : 'Maintenance overdue'} value={maintOverdue}
          accent={maintOverdue > 0 ? 'text-red-600' : 'text-slate-900'}
          onClick={() => setMaintFilter((v) => (v === 'overdue' ? '' : 'overdue'))} active={maintFilter === 'overdue'}
          hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
        <StatCard label={ar ? 'صيانةٌ مستحقّة' : 'Maintenance due'} value={maintDue}
          accent={maintDue > 0 ? 'text-amber-600' : 'text-slate-900'}
          onClick={() => setMaintFilter((v) => (v === 'due' ? '' : 'due'))} active={maintFilter === 'due'}
          hint={ar ? 'اضغط لعرضها' : 'tap to open'} />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px] basis-72">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث باللوحة أو السائق أو نوع التيدر…' : 'Search plate, driver or trailer…'} />
        </div>
        <div className="w-36 grow sm:grow-0">
          <Select value={gpsFilter} onChange={(e) => setGpsFilter(e.target.value)}>
            <option value="">{ar ? 'كل أنواع GPS' : 'All GPS'}</option>
            {GPS_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </div>
        <div className="w-52 grow sm:grow-0">
          <Select value={maintFilter} onChange={(e) => setMaintFilter(e.target.value)}>
            <option value="">{ar ? 'كل حالات الصيانة' : 'All maintenance'}</option>
            <option value="overdue">{ar ? 'صيانةٌ متأخّرة' : 'Overdue'}</option>
            <option value="due">{ar ? 'صيانةٌ مستحقّة' : 'Due soon'}</option>
            <option value="ok">{ar ? 'سليمة' : 'OK'}</option>
          </Select>
        </div>
        <div className="w-44 grow sm:grow-0">
          <Select value={seatsFilter} onChange={(e) => setSeatsFilter(e.target.value)}>
            <option value="">{ar ? 'كل السيارات' : 'All vehicles'}</option>
            <option value="0">{ar ? 'بدون سائق' : 'No driver'}</option>
            <option value="1">{ar ? 'بسائق واحد' : 'One driver'}</option>
            <option value="2">{ar ? 'بسائقين' : 'Two drivers'}</option>
          </Select>
        </div>
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className={th}>{cf.head('plate', ar ? 'اللوحة' : 'Plate')}</th>
            <th className={th}>{cf.head('trailerType', ar ? 'نوع التيدر' : 'Trailer type')}</th>
            <th className={th}>{cf.head('maintenance', ar ? 'الصيانة' : 'Maintenance')}</th>
            <th className={th}>{cf.head('gps', 'GPS')}</th>
            <th className={th}>{cf.head('driver1', ar ? 'السائق الأول' : 'First driver')}</th>
            <th className={th}>{cf.head('driver2', ar ? 'السائق الثاني' : 'Second driver')}</th>
            <th className={th}>{cf.head('supervisor', ar ? 'المشرف المسؤول' : 'Supervisor')}</th>
            <th className={th}>{ar ? 'ملاحظات' : 'Notes'}</th>
            <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                {/* اللوحة هي مدخل التحليل: ضغطةٌ واحدة تفتح كل ما فعلته هذه
                    السيارة خلال أي فترة — وكان الوصول إليه يمرّ بشاشة تحليلاتٍ
                    عامة لا تُفتح منها سيارةٌ بعينها أصلًا. */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link href={`/system/fleet/vehicles/${v._id}`} className="text-[#f37121] font-bold font-mono hover:underline">{formatPlate(v.plate)}</Link>
                  {v.name && <span className="block text-xs text-slate-500">{v.name}</span>}
                </td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{v.trailerType || '—'}</td>
                {/* ── الصيانة من لوكيشن سوليوشن ──────────────────────────────
                    القسمان يتكلّمان عن الشاحنة نفسها؛ وفصلُهما هو ما يجعل
                    شاحنةً صيانتُها متأخّرة تُحمَّل اليوم وتقف في الطريق غدًا. */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {!v.maintenance ? <span className="text-slate-300">—</span> : (
                    <Link href={v.maintenance.unitId != null ? `/system/ls2/${v.maintenance.unitId}` : `/system/ls2/fleet-assets?tab=tires&q=${encodeURIComponent(v.plate)}`}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg font-semibold hover:opacity-80 ${
                        v.maintenance.status === 'overdue' ? 'bg-red-50 text-red-700'
                          : v.maintenance.status === 'due' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                      title={v.maintenance.nextServiceName || undefined}>
                      <Wrench className="w-3 h-3" />
                      {v.maintenance.status === 'overdue' ? (ar ? 'متأخّرة' : 'Overdue')
                        : v.maintenance.status === 'due' ? (ar ? 'مستحقّة' : 'Due') : (ar ? 'سليمة' : 'OK')}
                      {v.maintenance.kmToService != null && (
                        <span className="opacity-70 font-normal">{Number(v.maintenance.kmToService).toLocaleString('en-US')} {ar ? 'كم' : 'km'}</span>
                      )}
                    </Link>
                  )}
                </td>
                <td className="px-4 py-3">
                  {v.gpsType
                    ? <SmallBadge bg={v.gpsType === 'LS' ? 'bg-emerald-500/15' : 'bg-blue-500/15'}
                        text={v.gpsType === 'LS' ? 'text-emerald-700' : 'text-blue-700'} label={v.gpsType} />
                    : <span className="text-slate-400">—</span>}
                </td>
                {/* ── المقعدان: كلٌّ في خانته يُبدَّل في موضعه ──────────────
                    ومَن لا يعمل يُلوَّن: شاحنةٌ سائقُها في إجازةٍ لا تتحرّك،
                    والاسمُ وحدَه لا يقول ذلك. */}
                {([1, 2] as const).map((seat) => {
                  const who = seatsOf(v)[seat - 1];
                  return (
                    <td key={seat} className="px-4 py-3">
                      {editor ? (
                        <div className="min-w-[170px]">
                          <SearchableSelect
                            value={who?._id || ''}
                            onChange={(x) => setSeat(v, seat, x)}
                            searchAfter={0} disabled={seatBusy === v._id}
                            placeholder={seat === 1 ? (ar ? 'بدون سائق' : 'No driver') : (ar ? 'المقعد شاغر' : 'Seat empty')}
                            searchPlaceholder={ar ? 'ابحث بالاسم…' : 'Search name…'}
                            options={driverOptions} />
                          {who?.working === false && (
                            <span className="mt-1 inline-block px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10.5px] font-semibold">
                              {ar ? 'لا يعمل' : 'Off'}
                            </span>
                          )}
                        </div>
                      ) : who ? (
                        <span className={`px-2 py-1 rounded-lg text-xs whitespace-nowrap ${who.working === false ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}
                          title={who.phone || undefined}>
                          {who.name}{who.working === false ? (ar ? ' · لا يعمل' : ' · off') : ''}
                        </span>
                      ) : seat === 1 ? (
                        <SmallBadge bg="bg-red-500/15" text="text-red-700" label={ar ? 'بدون سائق' : 'No driver'} />
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-4 py-3 whitespace-nowrap">
                  {v.supervisorName
                    ? <SmallBadge bg="bg-[#f37121]/10" text="text-[#f37121]" label={v.supervisorName} />
                    : <span className="text-slate-400 text-xs">{ar ? 'غير مُسند' : 'Unassigned'}</span>}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs max-w-[220px] truncate" title={v.notes || undefined}>{v.notes || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {admin && (
                      <button type="button" onClick={() => { setAssigning(v); setAssignTo(v.supervisor || ''); }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعيين المشرف' : 'Assign supervisor'}>
                        <UserCog className="w-4 h-4" />
                      </button>
                    )}
                    <Link href={`/system/fleet/vehicles/${v._id}`} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تحليل السيارة' : 'Vehicle analysis'}>
                      <BarChart3 className="w-4 h-4" />
                    </Link>
                    {editor && <button type="button" onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                    {admin && <button type="button" onClick={() => remove(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-500 py-12">
                {vehicles.length === 0
                  ? (ar ? 'لا توجد سيارات بعد.' : 'No vehicles yet.')
                  : (ar ? 'لا نتائج مطابقة للبحث.' : 'No matches.')}
              </td></tr>
            )}
          </tbody>
        </table>
      </ScrollX>

      {/* تعيين المشرف: هذه السيارة مسؤول عنها مَن؟ */}
      <Modal open={!!assigning} onClose={() => setAssigning(null)}
        title={assigning ? (ar ? `المشرف المسؤول عن ${assigning.plate}` : `Supervisor for ${assigning.plate}`) : ''}
        footer={<>
          <button type="button" onClick={() => setAssigning(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveAssign} disabled={assignSaving}>
            {assignSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="space-y-2">
          <Field label={ar ? 'المشرف' : 'Supervisor'}>
            <SearchableSelect
              value={assignTo} onChange={setAssignTo}
              placeholder={ar ? 'بدون مشرف' : 'No supervisor'}
              searchPlaceholder={ar ? 'ابحث بالاسم…' : 'Search name…'}
              options={[
                { value: '', label: ar ? 'بدون مشرف' : 'No supervisor' },
                ...supervisors.map((u) => ({ value: u._id, label: `${u.firstName} ${u.lastName}`.trim() || u.email, hint: u.email })),
              ]}
            />
          </Field>
          {supervisors.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {ar ? 'لا يوجد مستخدمون بدور «مشرف أسطول» بعد — أنشئهم من إدارة المستخدمين أولًا.' : 'No users with the fleet_supervisor role yet — create them in user management first.'}
            </p>
          )}
        </div>
      </Modal>

      {/* إضافة سائق ثانٍ: مَن، وعلى أيّ شاحنة. والشاحنةُ تُعرض بسائقها الأوّل
          فيُرى مع مَن سيركب قبل الحفظ، وما كان مقعدُها الثاني مشغولًا لا يُعرَض
          بوصفه فارغًا — تُقال حالُه. */}
      <Modal open={secondOpen} onClose={() => setSecondOpen(false)}
        title={ar ? 'إضافة سائق ثانٍ' : 'Add a second driver'}
        footer={<>
          <button type="button" onClick={() => setSecondOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveSecond} disabled={secondSaving || !secondForm.vehicle || !secondForm.driver}>
            {secondSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'إسناد' : 'Assign'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={ar ? 'السائق — مَن يركب ثانيًا' : 'Driver — who rides second'}>
            <SearchableSelect value={secondForm.driver} onChange={(x) => setSecondForm((f) => ({ ...f, driver: x }))}
              searchAfter={0} placeholder={ar ? 'اختر السائق…' : 'Pick the driver…'}
              searchPlaceholder={ar ? 'ابحث بالاسم…' : 'Search name…'}
              options={driverOptions.filter((o) => o.value)} />
          </Field>
          <Field label={ar ? 'على أيّ سيارة' : 'On which truck'}>
            <SearchableSelect value={secondForm.vehicle} onChange={(x) => setSecondForm((f) => ({ ...f, vehicle: x }))}
              searchAfter={0} placeholder={ar ? 'اختر السيارة…' : 'Pick the truck…'}
              searchPlaceholder={ar ? 'ابحث باللوحة…' : 'Search plate…'}
              options={vehicles.map((v) => {
                const [a, b] = seatsOf(v);
                return {
                  value: v._id,
                  label: v.plate,
                  hint: [
                    a ? (ar ? `الأول: ${a.name}` : `1st: ${a.name}`) : (ar ? 'بدون سائق أول' : 'no first driver'),
                    b ? (ar ? `الثاني: ${b.name} — سيُستبدل` : `2nd: ${b.name} — will be replaced`) : (ar ? 'المقعد الثاني شاغر' : 'second seat free'),
                  ].join(' · '),
                };
              })} />
          </Field>
          {(() => {
            const veh = vehicles.find((v) => v._id === secondForm.vehicle);
            const [, b] = veh ? seatsOf(veh) : [null, null];
            const moving = drivers.find((d) => d._id === secondForm.driver);
            const from = moving && typeof moving.vehicle === 'object' && moving.vehicle ? moving.vehicle.plate : '';
            if (!veh || !moving) return null;
            return (
              <div className="text-xs rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-600 space-y-1">
                {from && from !== veh.plate && (
                  <p>{ar ? `سيُنقل ${moving.name} من ${from} إلى ${veh.plate}، ويبقى على ${from} مَن عليها.`
                        : `${moving.name} moves from ${from} to ${veh.plate}.`}</p>
                )}
                {b && b._id !== moving._id && (
                  <p className="text-amber-700">{ar ? `${b.name} ينزل من المقعد الثاني ويعود بلا شاحنة.` : `${b.name} leaves the second seat and goes unassigned.`}</p>
                )}
              </div>
            );
          })()}
        </div>
      </Modal>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? (ar ? 'تعديل سيارة' : 'Edit vehicle') : (ar ? 'إضافة سيارة' : 'Add vehicle')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.plate.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'رقم اللوحة *' : 'Plate *'}><TextInput value={form.plate} onChange={(e) => setForm((f: any) => ({ ...f, plate: e.target.value }))} /></Field>
          <Field label={ar ? 'الوصف' : 'Description'}><TextInput value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={ar ? 'الماركة' : 'Brand'}><TextInput value={form.brand} onChange={(e) => setForm((f: any) => ({ ...f, brand: e.target.value }))} /></Field>
          <Field label={ar ? 'اللون' : 'Color'}><TextInput value={form.color} onChange={(e) => setForm((f: any) => ({ ...f, color: e.target.value }))} /></Field>
          <Field label={ar ? 'نوع التيدر' : 'Trailer type'}>
            <Select value={form.trailerType} onChange={(e) => setForm((f: any) => ({ ...f, trailerType: e.target.value }))}>
              <option value="">—</option>
              {TRAILER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'نوع التتبع (GPS)' : 'GPS type'}>
            <Select value={form.gpsType} onChange={(e) => setForm((f: any) => ({ ...f, gpsType: e.target.value }))}>
              <option value="">—</option>
              {GPS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
