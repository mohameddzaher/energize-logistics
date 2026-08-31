'use client';
// قائمة سجل المركبات — فلاتر متعددة، بحث، حالة كل مركبة، وتعديل/إضافة/حذف.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { syncUrl } from '@/lib/urlSync';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { VReg, statusColor, statusLabel, DOC_TYPES, fmtDate, money, daysText, canEditVehicles, canAdminVehicles } from '@/lib/vehicleRegistry';
import { canEditSection } from '@/lib/sections';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import ManagedSelect from '@/components/system/ManagedSelect';
import { Car, Plus, Edit, Trash2, BarChart3, CalendarClock, X, Save, ArrowRight } from 'lucide-react';

const EDIT_ROLES = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];

function VehicleRegistryListInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const { notify, confirm } = useDialog();
  // A grant of «تعديل» on المركبات has to bring the actions with it — the API
  // already accepts the calls (rbac lets a section grant through), so hiding the
  // buttons only made the section look read-only to people who aren't.
  const grant = canEditSection((user as any)?.permissions, 'Vehicles');
  const canEdit = canEditVehicles(user);
  const canDelete = canAdminVehicles(user);

  const [rows, setRows] = useState<VReg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp?.get('q') || '');
  const [editing, setEditing] = useState<VReg | null>(null);
  const [showForm, setShowForm] = useState(false);

  // كل فلاتر العنوان تُمرَّر كما هي إلى الخادم.
  //
  // كانت تُمرَّر قائمةٌ مكتوبة بالاسم، فأي فلتر خارجها — المدينة، الإدارة،
  // المفوَّض، مدى الانتهاء — يسقط في صمت: تضغط «١٠ منتهية» فيفتح الجدول ٣٣٥.
  // الرقم الذي يفتح غير ما يقول أسوأ من ألا يكون قابلًا للضغط أصلًا.
  const UI_ONLY = ['limit', 'page'];
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => k !== 'q' && !UI_ONLY.includes(k))));

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
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  }, [qs, notify]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  // ما تختاره هنا يعيش في العنوان: ترفع شرطًا أو تضيف آخر فيعمل الرجوعُ والتقدّم
  // ويبقى ما بنيتَه إن حدّثتَ الصفحة.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    syncUrl('/system/vehicles/registry', p);
  }, [q, JSON.stringify(filters)]);

  /** الرجوع إلى النظرة الشاملة حاملًا الفلتر الحاليّ — لا مُلقيًا به. */
  const backToOverview = () => {
    const p = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.push(`/system/vehicles/registry/overview${p ? `?${p}` : ''}`);
  };
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  // أسماء مقروءة للفلاتر التي لا تأتي من الخادم — بدونها تظهر الشريحة بمفتاحها
  // البرمجي («missingDocDate: insurance») ولا يقرؤه أحد.
  const EXTRA_LABELS: Record<string, { ar: string; en: string; values?: Record<string, { ar: string; en: string }> }> = {
    missing: { ar: 'ينقصها بيانات', en: 'Missing data', values: { 1: { ar: 'ينقصها بيانات', en: 'Missing data' } } },
    logistiGaps: { ar: 'نواقص لوجستي', en: 'Logisti gaps', values: {
      1: { ar: 'ينقصها شرط لوجستي', en: 'Has Logisti gaps' }, 0: { ar: 'مستوفية شروط لوجستي', en: 'Logisti complete' } } },
    hasGps: { ar: 'التتبّع', en: 'GPS', values: { 1: { ar: 'عليها جهاز تتبّع', en: 'With GPS' } } },
    missingDoc: { ar: 'بدون مستند', en: 'Missing document' },
    missingDocDate: { ar: 'بلا تاريخ انتهاء', en: 'No expiry date' },
    expiringDoc: { ar: 'قارب انتهاؤه', en: 'Expiring' },
    expiredDoc: { ar: 'منتهٍ', en: 'Expired' },
    expiryDoc: { ar: 'المستند', en: 'Document' },
    expiryFrom: { ar: 'الانتهاء من', en: 'Expiry from' },
    expiryTo: { ar: 'الانتهاء إلى', en: 'Expiry to' },
    yearFrom: { ar: 'سنة الصنع من', en: 'Year from' },
    yearTo: { ar: 'سنة الصنع إلى', en: 'Year to' },
    missingItem: { ar: 'البند الناقص', en: 'Missing item' },
    missingReason: { ar: 'سبب النقص', en: 'Missing reason' },
    logistiGap: { ar: 'شرط لوجستي', en: 'Logisti requirement' },
    insurancePolicy: { ar: 'وثيقة التأمين', en: 'Policy' },
  };

  // أعمدة التصدير — نفس أعمدة الجدول ومعها ما يُسأل عنه خارج الشاشة (الهيكل،
  // أرقام المستندات، المفوَّض، القسط). تواريخ المستندات تُبنى من DOC_TYPES نفسها
  // التي يبني منها الخادمُ حالاتِها، فلا يفترق مستندٌ ظهر في «الانتهاءات» عن
  // عمودٍ لا وجود له في الملفّ.
  const cols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plateNumber', width: 14 },
    { header: ar ? 'رقم الهيكل' : 'Chassis', key: 'chassisNumber', width: 20 },
    { header: ar ? 'القطاع' : 'Sector', key: 'sectorAr', width: 16 },
    { header: ar ? 'الإدارة' : 'Department', key: 'departmentAr', width: 16 },
    { header: ar ? 'المدينة' : 'City', key: 'cityAr', width: 12 },
    { header: ar ? 'نوع التسجيل' : 'Registration type', key: 'registrationTypeAr', width: 14 },
    { header: ar ? 'الماركة' : 'Brand', key: 'brandAr', width: 14 },
    { header: ar ? 'الطراز' : 'Model', key: 'modelAr', width: 14 },
    { header: ar ? 'سنة الصنع' : 'Year', key: 'modelYear', width: 10 },
    { header: ar ? 'اللون' : 'Color', key: 'colorAr', width: 12 },
    { header: ar ? 'المالك' : 'Owner', key: 'ownerNameAr', width: 26 },
    { header: ar ? 'حالة التشغيل' : 'Service status', key: 'serviceStatusAr', width: 14 },
    { header: ar ? 'المفوَّض' : 'Authorised holder', key: 'authorizedPerson.name', width: 22 },
    { header: ar ? 'رقم التفويض' : 'Authorisation no.', key: 'authorizedPerson.authorizationNumber', width: 16 },
    ...DOC_TYPES.map((d): ExportColumn => ({
      header: ar ? `انتهاء ${d.ar}` : `${d.en} expiry`,
      key: d.key,
      transform: (_v, row: VReg) => fmtDate(d.datePath(row)),
      width: 14,
    })),
    { header: ar ? 'رقم وثيقة التأمين' : 'Policy number', key: 'insurance.policyNumber', width: 18 },
    { header: ar ? 'شركة التأمين' : 'Insurer', key: 'insurance.companyAr', width: 20 },
    { header: ar ? 'قسط التأمين' : 'Premium (SAR)', key: 'insurance.premiumSar', transform: (v) => (v == null ? '' : money(v)), width: 14 },
    { header: ar ? 'الحالة العامة' : 'Overall status', key: 'overallStatus', transform: (v) => statusLabel(v || 'valid', ar), width: 14 },
    { header: ar ? 'المتبقّي' : 'Days left', key: 'overallDays', transform: (v) => daysText(v, ar), width: 18 },
    // النقطة البنفسجية في الجدول لا تقول ما الناقص؛ الملفّ يتّسع لتفصيلها،
    // وهو المقصود من تصديره أصلًا: قائمة عملٍ تُوزَّع لا صورةٌ للشاشة.
    { header: ar ? 'نواقص لوجستي' : 'Logisti gaps', key: 'logistiGaps', transform: (v: string[]) => (v || []).join(' · '), width: 30 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notesAr', width: 30 },
  ];

  const del = async (v: VReg) => {
    if (!(await confirm(ar ? `حذف المركبة ${v.plateNumber}؟` : `Delete ${v.plateNumber}?`))) return;
    try { await api.delete(`/api/vehicle-registry/${v._id}`); notify(ar ? 'تم الحذف' : 'Deleted', 'success'); load(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={backToOverview}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {ar ? 'النظرة الشاملة' : 'Overview'}
      </button>
      <PageHeader icon={<Car className="w-5 h-5" />} title={ar ? 'سجل المركبات' : 'Vehicle Registry'} subtitle={ar ? `${total} مركبة` : `${total} vehicles`}>
        <div className="flex items-center gap-2">
          <Link href="/system/vehicles/registry/dashboard" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><BarChart3 className="w-4 h-4" /> {ar ? 'التحليلات' : 'Analytics'}</Link>
          <Link href="/system/vehicles/registry/expiring" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm"><CalendarClock className="w-4 h-4" /> {ar ? 'الانتهاءات والتجديد' : 'Expiries & Renewals'}</Link>
          {canEdit && <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm"><Plus className="w-4 h-4" /> {ar ? 'إضافة' : 'Add'}</button>}
          <ExportMenu fileName="vehicle-registry" lang={lang as 'ar' | 'en'}
            options={[
              { key: 'filtered', label: exportScopeLabels(ar).shown, sheets: [{ name: ar ? 'المركبات' : 'Vehicles', rows: rows as any[], columns: cols }] },
              {
                key: 'all', label: exportScopeLabels(ar).all, hint: ar ? 'كل المركبات' : 'all vehicles',
                // «الكل» لا يُبنى من الصفوف المحمّلة: هذه ثمرةُ الفلتر الحاليّ
                // وسقفُها ٢٠٠٠ صف، فبناؤه منها يُخرج ملفًّا اسمُه «الكل» وفيه
                // ما نجا من الفلتر وحده.
                resolve: async () => {
                  const d = await api.get<{ vehicles: VReg[] }>('/api/vehicle-registry?limit=5000');
                  return [{ name: ar ? 'المركبات' : 'Vehicles', rows: (d.vehicles || []) as any[], columns: cols }];
                },
              },
            ]} />
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بلوحة/هيكل/مالك/بوليصة…' : 'plate / chassis / owner…'} className="px-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        <FilterPanel
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          extraLabels={EXTRA_LABELS}
          resultCount={total}
          resultLabel={ar ? 'المركبات المطابقة' : 'Matching vehicles'}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>{[ar ? 'اللوحة' : 'Plate', ar ? 'القطاع' : 'Sector', ar ? 'الإدارة' : 'Department', ar ? 'المدينة' : 'City', ar ? 'النوع' : 'Type', ar ? 'الماركة' : 'Brand', ar ? 'السنة' : 'Year', ar ? 'المالك' : 'Owner', ar ? 'التأمين' : 'Insurance', ar ? 'الحالة' : 'Status', ''].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((v) => (
                <tr key={v._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/system/vehicles/registry/${v._id}`} className="text-[#f37121] hover:underline font-mono font-semibold">{v.plateNumber}</Link>
                    {/* ── لا رقم بجانب اللوحة ──────────────────────────────────
                        كان يُكتب «ناقص ١» و«ناقص ٢»، والرقم عددُ شروط منصّة لوجستي
                        غير المستوفاة لا عددُ الخانات الفارغة. فيفتح الناظر مركبةً
                        «ناقص ٢» فيجد خانةً واحدة ناقصة كالتي عليها «ناقص ١»،
                        فيظنّ الرقم عبثًا — وهو ليس عبثًا، لكنّه يعدّ شيئًا غير
                        الذي يُفهَم منه في هذا الموضع. النقطة وحدها تقول «هنا عمل»،
                        وتفصيلُه في صفحة المركبة حيث يُقرأ شرطًا شرطًا. */}
                    {!!v.logistiGaps?.length && (
                      <span title={ar ? `ينقصها لمنصّة لوجستي: ${v.logistiGaps.join(' · ')}` : `Logisti gaps: ${v.logistiGaps.join(' · ')}`}
                        className="ms-1.5 inline-block w-1.5 h-1.5 rounded-full bg-violet-500 align-middle" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.sectorAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.departmentAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.cityAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.registrationTypeAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.brandAr || '—'} {v.modelAr}</td>
                  <td className="px-3 py-2 text-slate-500">{v.modelYear || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate" title={v.ownerNameAr}>{v.ownerNameAr || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{v.insurance?.expiryDate ? <span style={{ color: statusColor(v.docStatuses?.insurance?.status || 'none') }}>{fmtDate(v.insurance.expiryDate)}</span> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: `${statusColor(v.overallStatus || 'valid')}1a`, color: statusColor(v.overallStatus || 'valid') }}>{statusLabel(v.overallStatus || 'valid', ar)}{v.overallDays != null && v.overallStatus !== 'valid' ? ` · ${daysText(v.overallDays, ar)}` : ''}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {canEdit && <button onClick={() => { setEditing(v); setShowForm(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Edit className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button onClick={() => del(v)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">{ar ? 'لا توجد مركبات مطابقة' : 'No matching vehicles'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <VehicleForm vehicle={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function VehicleForm({ vehicle, onClose, onSaved }: { vehicle: VReg | null; onClose: () => void; onSaved: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [f, setF] = useState<any>(vehicle || { plateNumber: '', sectorAr: '', registrationTypeAr: '', brandAr: '', modelAr: '', modelYear: '', colorAr: '', ownerNameAr: '', chassisNumber: '', insurance: {}, operatingCard: {}, vehicleLicense: {}, inspection: {}, fuelCard: {} });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setSub = (o: string, k: string, v: any) => setF((p: any) => ({ ...p, [o]: { ...(p[o] || {}), [k]: v } }));

  const save = async () => {
    if (!f.plateNumber?.trim()) { notify(ar ? 'رقم اللوحة مطلوب' : 'Plate required', 'error'); return; }
    setSaving(true);
    try {
      if (vehicle) await api.put(`/api/vehicle-registry/${vehicle._id}`, f);
      else await api.post('/api/vehicle-registry', f);
      notify(ar ? 'تم الحفظ' : 'Saved', 'success'); onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setSaving(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const L = ({ children }: { children: React.ReactNode }) => <label className="block text-xs font-semibold text-slate-600 mb-1">{children}</label>;
  // بطاقةُ قسم: عنوانٌ واضحٌ وإطارٌ يحدّ ما يخصّه — بدل خطٍّ رفيعٍ يفصل ستّةً
  // وثلاثين خانةً مسكوبةً في شبكةٍ واحدة.
  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-xl border border-slate-200 bg-slate-50/40">
      <header className="px-4 py-2.5 border-b border-slate-200 bg-white rounded-t-xl">
        <p className="text-[13px] font-bold text-slate-800">{title}</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">{children}</div>
    </section>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{vehicle ? (ar ? 'تعديل مركبة' : 'Edit vehicle') : (ar ? 'إضافة مركبة' : 'Add vehicle')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        {/* ── الحقول ذات الاختيارات صارت قوائم لا كتابةً حرّة ─────────────────
            الحقل الحرّ يُكتب بألف صيغة: «مرسيدس» و«MercedesBenz» و«MERCEDES»
            ثلاثةُ صفوف لشيءٍ واحد، فيصير في الفلتر ثلاثةَ خيارات وفي التحليل
            ثلاثَ ماركات. والقائمة تُدار من إعدادات القسم، ومَن ينقصه خيارٌ
            يضيفه من داخلها فيراه كلُّ من بعده. */}
        {/* ── الأقسامُ بطاقاتٌ لا خطوطٌ باهتة ──────────────────────────────────
            كانت ستّةُ أقسامٍ تُرسَم شبكةً واحدةً متّصلة يفصلها خطٌّ رفيعٌ وعنوانٌ
            رماديّ، فتبدو ستّةً وثلاثين خانةً مسكوبةً على بعضها ولا يُعرف أين
            ينتهي التأمينُ ويبدأ المستند. فصار لكلّ قسمٍ بطاقتُه بعنوانها. */}
        <div className="space-y-4">
        <Card title={ar ? 'بيانات المركبة' : 'Vehicle'}>
          <div><L>{ar ? 'رقم اللوحة *' : 'Plate *'}</L><input className={inp} value={f.plateNumber} onChange={(e) => set('plateNumber', e.target.value)} /></div>
          <div><L>{ar ? 'رقم الهيكل' : 'Chassis'}</L><input className={inp} value={f.chassisNumber || ''} onChange={(e) => set('chassisNumber', e.target.value)} /></div>
          <div><L>{ar ? 'الرقم التسلسلي' : 'Serial'}</L><input className={inp} value={f.serialNumber || ''} onChange={(e) => set('serialNumber', e.target.value)} /></div>
          <div><L>{ar ? 'القطاع' : 'Sector'}</L><ManagedSelect storeLabel type="vehicle_sector" value={f.sectorAr || ''} onChange={(v) => set('sectorAr', v)} /></div>
          <div><L>{ar ? 'نوع التسجيل' : 'Registration type'}</L><ManagedSelect storeLabel type="vehicle_registration_type" value={f.registrationTypeAr || ''} onChange={(v) => set('registrationTypeAr', v)} /></div>
          <div><L>{ar ? 'الماركة' : 'Brand'}</L><ManagedSelect storeLabel type="vehicle_brand" value={f.brandAr || ''} onChange={(v) => set('brandAr', v)} /></div>
          <div><L>{ar ? 'الطراز' : 'Model'}</L><input className={inp} value={f.modelAr || ''} onChange={(e) => set('modelAr', e.target.value)} /></div>
          <div><L>{ar ? 'سنة الصنع' : 'Year'}</L><input type="number" className={inp} value={f.modelYear || ''} onChange={(e) => set('modelYear', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><L>{ar ? 'اللون' : 'Colour'}</L><ManagedSelect storeLabel type="vehicle_color" value={f.colorAr || ''} onChange={(v) => set('colorAr', v)} /></div>
          <div><L>{ar ? 'حالة التشغيل' : 'Service status'}</L><ManagedSelect storeLabel type="vehicle_service_status" value={f.serviceStatusAr || ''} onChange={(v) => set('serviceStatusAr', v)} /></div>
          <div><L>{ar ? 'حالة الحيازة' : 'Possession'}</L><ManagedSelect storeLabel type="vehicle_possession_status" value={f.possessionStatusAr || ''} onChange={(v) => set('possessionStatusAr', v)} /></div>
          <div><L>{ar ? 'الإدارة' : 'Department'}</L><ManagedSelect storeLabel type="vehicle_department" value={f.departmentAr || ''} onChange={(v) => set('departmentAr', v)} /></div>
          <div><L>{ar ? 'المدينة' : 'City'}</L><ManagedSelect storeLabel type="vehicle_city" value={f.cityAr || ''} onChange={(v) => set('cityAr', v)} /></div>
          <div><L>{ar ? 'المالك' : 'Owner'}</L><input className={inp} value={f.ownerNameAr || ''} onChange={(e) => set('ownerNameAr', e.target.value)} /></div>
          {/* ── السجلُّ التجاريّ ────────────────────────────────────────────
              رقمٌ تُجمَّع به المركباتُ في صفحة السجلّات وتُفلتَر به القوائم،
              ولم تكن له خانةٌ هنا — فيُقرأ في مكانٍ ولا يُصحَّح في أيّ مكان. */}
          <div><L>{ar ? 'السجل التجاري' : 'Commercial register'}</L><input className={inp} value={f.commercialRegistration || ''} onChange={(e) => set('commercialRegistration', e.target.value)} /></div>
        </Card>

        <Card title={ar ? 'التأمين' : 'Insurance'}>
          <div><L>{ar ? 'شركة التأمين' : 'Insurer'}</L><ManagedSelect storeLabel type="vehicle_insurance_company" value={f.insurance?.companyAr || ''} onChange={(v) => setSub('insurance', 'companyAr', v)} /></div>
          <div><L>{ar ? 'نوع التغطية' : 'Coverage type'}</L><ManagedSelect storeLabel type="vehicle_coverage_type" value={f.insurance?.coverageTypeAr || ''} onChange={(v) => setSub('insurance', 'coverageTypeAr', v)} /></div>
          <div><L>{ar ? 'رقم الوثيقة' : 'Policy no.'}</L><input className={inp} value={f.insurance?.policyNumber || ''} onChange={(e) => setSub('insurance', 'policyNumber', e.target.value)} /></div>
          <div><L>{ar ? 'تاريخ انتهاء التأمين' : 'Insurance expiry'}</L><input type="date" className={inp} value={(f.insurance?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('insurance', 'expiryDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'قسط التأمين' : 'Premium'}</L><input type="number" className={inp} value={f.insurance?.premiumSar || ''} onChange={(e) => setSub('insurance', 'premiumSar', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><L>{ar ? 'حالة القسط' : 'Premium status'}</L><ManagedSelect storeLabel type="vehicle_premium_status" value={f.insurance?.premiumStatusAr || ''} onChange={(v) => setSub('insurance', 'premiumStatusAr', v)} /></div>

        </Card>

        <Card title={ar ? 'المستندات' : 'Documents'}>
          <div><L>{ar ? 'رقم بطاقة التشغيل' : 'Operating card no.'}</L><input className={inp} value={f.operatingCard?.cardNumber || ''} onChange={(e) => setSub('operatingCard', 'cardNumber', e.target.value)} /></div>
          <div><L>{ar ? 'انتهاء بطاقة التشغيل' : 'Operating card expiry'}</L><input type="date" className={inp} value={(f.operatingCard?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('operatingCard', 'expiryDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'انتهاء رخصة السير' : 'Licence expiry'}</L><input type="date" className={inp} value={(f.vehicleLicense?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('vehicleLicense', 'expiryDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'حالة الفحص' : 'Inspection status'}</L><ManagedSelect storeLabel type="vehicle_inspection_status" value={f.inspection?.statusAr || ''} onChange={(v) => setSub('inspection', 'statusAr', v)} /></div>
          <div><L>{ar ? 'انتهاء الفحص' : 'Inspection expiry'}</L><input type="date" className={inp} value={(f.inspection?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('inspection', 'expiryDate', e.target.value || null)} /></div>

        </Card>

        <Card title={ar ? 'الوقود والتتبّع' : 'Fuel & tracking'}>
          <div><L>{ar ? 'مزوّد شريحة الوقود' : 'Fuel provider'}</L><ManagedSelect storeLabel type="vehicle_fuel_provider" value={f.fuelCard?.provider || ''} onChange={(v) => setSub('fuelCard', 'provider', v)} /></div>
          <div><L>{ar ? 'رقم شريحة الوقود' : 'Fuel card no.'}</L><input className={inp} value={f.fuelCard?.cardNumber || ''} onChange={(e) => setSub('fuelCard', 'cardNumber', e.target.value)} /></div>
          <div><L>{ar ? 'حالة الشريحة' : 'Card status'}</L><ManagedSelect storeLabel type="vehicle_fuel_card_status" value={f.fuelCard?.statusAr || ''} onChange={(v) => setSub('fuelCard', 'statusAr', v)} /></div>
          <div><L>{ar ? 'نوع الاستهلاك' : 'Consumption type'}</L><ManagedSelect storeLabel type="vehicle_consumption_type" value={f.fuelCard?.consumptionTypeAr || ''} onChange={(v) => setSub('fuelCard', 'consumptionTypeAr', v)} /></div>
          <div><L>{ar ? 'شركة الـGPS' : 'GPS provider'}</L><ManagedSelect storeLabel type="vehicle_gps_provider" value={f.gps?.provider || ''} onChange={(v) => setSub('gps', 'provider', v)} /></div>
          <div><L>{ar ? 'جهاز GPS' : 'GPS device'}</L><ManagedSelect storeLabel type="vehicle_gps_device" value={f.gps?.deviceModel || ''} onChange={(v) => setSub('gps', 'deviceModel', v)} /></div>
          <div><L>{ar ? 'سريال GPS' : 'GPS serial'}</L><input className={inp} value={f.gps?.serialImei || ''} onChange={(e) => setSub('gps', 'serialImei', e.target.value)} /></div>
          <div><L>{ar ? 'حالة جهاز GPS' : 'GPS device status'}</L><ManagedSelect storeLabel type="vehicle_gps_device_status" value={f.gps?.deviceStatusAr || ''} onChange={(v) => setSub('gps', 'deviceStatusAr', v)} /></div>
          <div><L>{ar ? 'انتهاء اشتراك GPS' : 'GPS expiry'}</L><input type="date" className={inp} value={(f.gps?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('gps', 'expiryDate', e.target.value || null)} /></div>

        </Card>

        <Card title={ar ? 'التفويض بالقيادة' : 'Driving authorisation'}>
          <div><L>{ar ? 'اسم المفوَّض' : 'Authorised person'}</L><input className={inp} value={f.authorizedPerson?.name || ''} onChange={(e) => setSub('authorizedPerson', 'name', e.target.value)} /></div>
          <div><L>{ar ? 'الوظيفة' : 'Job title'}</L><ManagedSelect storeLabel type="vehicle_job_title" value={f.authorizedPerson?.jobTitleAr || ''} onChange={(v) => setSub('authorizedPerson', 'jobTitleAr', v)} /></div>
          <div><L>{ar ? 'رقم الإقامة' : 'Iqama number'}</L><input className={inp} value={f.authorizedPerson?.iqamaNumber || ''} onChange={(e) => setSub('authorizedPerson', 'iqamaNumber', e.target.value)} /></div>
          <div><L>{ar ? 'رقم التفويض' : 'Authorisation no.'}</L><input className={inp} value={f.authorizedPerson?.authorizationNumber || ''} onChange={(e) => setSub('authorizedPerson', 'authorizationNumber', e.target.value)} /></div>
          <div><L>{ar ? 'بداية التفويض' : 'Auth. start'}</L><input type="date" className={inp} value={(f.authorizedPerson?.startDate || '').slice(0, 10)} onChange={(e) => setSub('authorizedPerson', 'startDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'نهاية التفويض' : 'Auth. expiry'}</L><input type="date" className={inp} value={(f.authorizedPerson?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('authorizedPerson', 'expiryDate', e.target.value || null)} /></div>

        </Card>

        <Card title={ar ? 'ملاحظات' : 'Notes'}>
          <div className="md:col-span-2"><textarea className={inp} rows={2} value={f.notesAr || ''} onChange={(e) => set('notesAr', e.target.value)} /></div>
        </Card>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm disabled:opacity-60"><Save className="w-4 h-4" /> {ar ? 'حفظ' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// `useSearchParams` يوجب حدَّ Suspense في موجِّه Next. كانت الصفحة تنجو صدفةً
// لأن غلاف القسم يعود قبل المحتوى أثناء التوليد المسبق — وأيّ تعديلٍ في بوّابة
// الدخول كان سيحوّلها إلى فشل بناءٍ صريح.
export default function VehicleRegistryList() {
  return <Suspense fallback={<Spinner />}><VehicleRegistryListInner /></Suspense>;
}
