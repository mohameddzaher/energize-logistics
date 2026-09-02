'use client';
// ملف العميل — عميل واحد بكامل سجل رحلاته معنا وإحصائياته، وتعديل نوعه وتقييمنا له.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, StatCard, Select } from '@/components/hr/HRKit';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { canViewFleet, canEditFleet, fleetStatusLabel, fmtD, Lang } from '@/lib/fleet';
import { useFleetLookups } from '@/hooks/useFleetLookups';
import { UserRound, ArrowRight, Star, Phone, Save, Link2, Route, Truck, Wallet, ExternalLink } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import PortalAccountCard from '@/components/system/PortalAccountCard';
import ReportButton from '@/components/system/ReportButton';

type Agg = { key: string; trips: number; income: number };
type Profile = {
  customer: { _id: string; name: string; phone?: string; email?: string; customerType?: string; rating?: number; notes?: string; paymentType?: string; taxNumber?: string; address?: string; routes?: { fromCity: string; toCity: string; price: number | null }[] };
  crm: { company: { _id: string; name: string; arabicName?: string; status?: string; type?: string; rating?: number; industry?: string; city?: string; phone?: string; email?: string }; activities: number; deals: number } | null;
  stats: {
    trips: number; income: number; fullRent: number; branchShare: number; driverExpense: number;
    avgTripIncome: number; byStatus: Record<string, number>; openTrips: number;
    firstTrip: string | null; lastTrip: string | null;
    byMonth: Agg[]; topRoutes: Agg[]; topVehicles: Agg[]; byPaymentType: Agg[];
  };
  shipments: { _id: string; waybillNumber: number; vehiclePlate?: string; driverName?: string; fromCity?: string; toCity?: string; status: string; price?: number; fullRent?: number; driverExpense?: number; loadType?: string; rentType?: string; paymentType?: string; customerType?: string; loadDate?: string; createdAt?: string; supervisorName?: string }[];
};

const money = (n: number) => (Number(n) || 0).toLocaleString('en-US');

const TRIPS_SHEET = 'Trips';
const exportColumns: ExportColumn[] = [
  { header: 'Waybill', key: 'waybillNumber' }, { header: 'From', key: 'fromCity' }, { header: 'To', key: 'toCity' },
  { header: 'Plate', key: 'vehiclePlate' }, { header: 'Driver', key: 'driverName' },
  { header: 'Load type', key: 'loadType' }, { header: 'Price', key: 'price' },
  { header: 'Status', key: 'status', transform: (v) => fleetStatusLabel(v, 'en') },
  { header: 'Load date', key: 'loadDate', transform: (v) => fmt.date(v) },
];

export default function FleetCustomerProfilePage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const { notify } = useDialog();
  const id = String(params?.id || '');
  const lkp = useFleetLookups(ar);

  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState('');
  const [rating, setRating] = useState(0);
  const [payType, setPayType] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<Profile>(`/api/fleet/customers/${id}/profile`);
      setData(d);
      setType(d.customer.customerType || '');
      setRating(d.customer.rating || 0);
      setPayType(d.customer.paymentType || '');
    } catch (e: any) { notify(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [id, notify]);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));

  const saveMeta = async () => {
    setSaving(true);
    try {
      await api.put(`/api/fleet/customers/${id}`, { customerType: type, rating, paymentType: payType });
      notify(ar ? 'تم الحفظ' : 'Saved', 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;
  if (!data) return <div className="text-slate-500 p-8">{ar ? 'العميل غير موجود' : 'Not found'}</div>;
  const c = data.customer;
  // ملفّ عميلٍ واحد: الجدول أدناه هو كامل سجلّ رحلاته، لا فلترَ عليه ولا ترقيم،
  // فنطاقٌ ثانٍ لن يزيد صفًّا واحدًا وإنّما يوهم المصدِّرَ بأنّ أمامه اختيارًا.
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: TRIPS_SHEET, rows: data.shipments, columns: exportColumns }] },
  ];

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<UserRound className="w-5 h-5" />} title={c.name}
        subtitle={c.customerType === 'heavy' ? (ar ? 'عميل نقل ثقيل' : 'Heavy transport customer') : c.customerType === 'branch' ? (ar ? 'عميل فروع' : 'Branch customer') : (ar ? 'عميل' : 'Customer')}>
        <div className="flex items-center gap-2">
          <ExportMenu fileName={`customer-${c.name}`} lang={ar ? 'ar' : 'en'} variant="primary" label={ar ? 'تصدير' : 'Export'} options={exportOptions} />
          <button type="button" onClick={() => router.push('/system/fleet/customers')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><ArrowRight className="w-4 h-4" /> {ar ? 'رجوع' : 'Back'}</button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label={ar ? 'إجمالي الرحلات' : 'Total trips'} value={data.stats.trips} accent="text-[#f37121]" />
        <StatCard label={ar ? 'رحلاتٌ جارية' : 'Open trips'} value={data.stats.openTrips} accent="text-amber-600" />
        <StatCard label={ar ? 'إجمالي الدخل (ر.س)' : 'Total income'} value={money(data.stats.income)} accent="text-emerald-600" />
        <StatCard label={ar ? 'متوسط الرحلة' : 'Avg / trip'} value={money(data.stats.avgTripIncome)} />
        <StatCard label={ar ? 'أول رحلة' : 'First trip'} value={data.stats.firstTrip ? fmtD(data.stats.firstTrip) : '—'} />
        <StatCard label={ar ? 'آخر رحلة' : 'Last trip'} value={data.stats.lastTrip ? fmtD(data.stats.lastTrip) : '—'} />
      </div>

      {/* ── المال ────────────────────────────────────────────────────────────
          «الإيجار كامل» ما يستلمه السائق من العميل، و«الدخل» حصّتُنا منه؛
          والفرق حصّة قسم الفروع. فصلُهما هنا يمنع قراءة الأول على أنّه الثاني. */}
      {(data.stats.fullRent > 0 || data.stats.driverExpense > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label={ar ? 'الإيجار كامل' : 'Full rent'} value={money(data.stats.fullRent)} />
          <StatCard label={ar ? 'حصّة الفروع' : 'Branch share'} value={money(data.stats.branchShare)} />
          <StatCard label={ar ? 'مصروف السائقين' : 'Driver expense'} value={money(data.stats.driverExpense)} accent="text-rose-600" />
          <StatCard label={ar ? 'الصافي لنا' : 'Net to us'} value={money(data.stats.income - data.stats.driverExpense)} accent="text-emerald-600" />
        </div>
      )}

      <div className="flex justify-end">
        <ReportButton subject="customer" id={c.name} label={ar ? 'التقرير الشامل للعميل' : 'Full customer report'} />
      </div>

      {/* حساب البوابة — العميل يتابع رحلاته وبوالصه بنفسه */}
      <PortalAccountCard source="fleet_customer" refId={id} name={c.name} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* بيانات العميل + التقييم */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <p className="font-bold text-slate-900">{ar ? 'بيانات العميل' : 'Customer details'}</p>
          {c.phone && <p className="text-sm text-slate-600 flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> <span className="font-mono">{c.phone}</span></p>}
          {c.email && <p className="text-sm text-slate-600">{c.email}</p>}
          {c.taxNumber && <p className="text-sm text-slate-600 font-mono">{ar ? 'الرقم الضريبي: ' : 'Tax no.: '}{c.taxNumber}</p>}
          {c.paymentType && (
            <span className={`inline-block text-[11px] px-2 py-1 rounded-lg font-semibold ${c.paymentType === 'tax' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {lkp('fleet_payment_type', c.paymentType) || c.paymentType}
            </span>
          )}
          {(c.routes || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">{c.routes!.map((r, i) => <span key={i} className="px-2.5 py-1 rounded-full bg-slate-100 text-xs text-slate-600">{r.fromCity} ← {r.toCity}{r.price ? ` · ${money(r.price)}` : ''}</span>)}</div>
          )}
          {canEditFleet(user) && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <label className="block text-xs font-semibold text-slate-700">{ar ? 'نوع العميل' : 'Customer type'}</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{ar ? '— غير محدد —' : '— unset —'}</option>
                <option value="heavy">{ar ? 'عملاء النقل الثقيل' : 'Heavy transport'}</option>
                <option value="branch">{ar ? 'عملاء الفروع' : 'Branch customers'}</option>
              </Select>
              <label className="block text-xs font-semibold text-slate-700">{ar ? 'نوع الدفع المتفق عليه' : 'Agreed payment type'}</label>
              <SearchableManagedSelect type="fleet_payment_type" value={payType} onChange={setPayType} placeholder={ar ? 'اختر…' : 'Choose…'} />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {ar
                  ? 'يُملأ تلقائيًّا في كل حمولةٍ جديدة لهذا العميل، ويبقى قابلًا للتعديل في تلك الحمولة وحدها.'
                  : 'Prefills every new shipment for this customer, still editable on that shipment alone.'}
              </p>
              <label className="block text-xs font-semibold text-slate-700">{ar ? 'تقييمنا للعميل' : 'Our rating'}</label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n === rating ? 0 : n)} aria-label={`${n}`}>
                    <Star className={`w-6 h-6 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>
                ))}
              </div>
              <button type="button" onClick={saveMeta} disabled={saving} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {ar ? 'حفظ' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* توزيع الحالات */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="font-bold text-slate-900 mb-3">{ar ? 'حالات الرحلات' : 'Trip statuses'}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.stats.byStatus).map(([k, n]) => (
              <span key={k} className="px-3 py-1.5 rounded-full bg-slate-100 text-sm text-slate-700">{fleetStatusLabel(k, lang as Lang)}: <b>{n}</b></span>
            ))}
            {Object.keys(data.stats.byStatus).length === 0 && <span className="text-slate-400 text-sm">{ar ? 'لا توجد رحلات' : 'No trips'}</span>}
          </div>
        </div>
      </div>

      {/* ── الربط بالـCRM ───────────────────────────────────────────────────
          العميل هنا وشركتُه في الـCRM سجلّان أُدخل كلٌّ منهما في قسمه؛ الاسم
          المطبَّع هو ما يجمعهما. وحين يجمعهما يجب أن يُرى — لا أن يبقى وصلةً
          في قاعدة البيانات لا أثر لها على الشاشة. */}
      {data.crm && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Link2 className="w-4 h-4 text-sky-600 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-slate-900 truncate">{data.crm.company.arabicName || data.crm.company.name}</p>
                <p className="text-xs text-slate-500">
                  {[data.crm.company.industry, data.crm.company.city, data.crm.company.status].filter(Boolean).join(' · ') || (ar ? 'مرتبط بسجلّ الـCRM' : 'Linked CRM company')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-600">{ar ? 'أنشطة' : 'Activities'}: <b>{data.crm.activities}</b></span>
              <span className="text-slate-600">{ar ? 'صفقات' : 'Deals'}: <b>{data.crm.deals}</b></span>
              <Link href={`/system/crm/companies?q=${encodeURIComponent(data.crm.company.name)}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-sky-200 text-sky-700 hover:bg-sky-100 text-xs font-semibold">
                <ExternalLink className="w-3.5 h-3.5" /> {ar ? 'فتحه في الـCRM' : 'Open in CRM'}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── تحليلات العميل ─────────────────────────────────────────────────── */}
      {data.stats.trips > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-bold text-slate-900 mb-3">{ar ? 'الدخل شهرًا بشهر' : 'Income by month'}</p>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.stats.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any, n: any) => [money(Number(v)), n === 'income' ? (ar ? 'الدخل' : 'Income') : (ar ? 'الحمولات' : 'Trips')]} />
                  <Bar dataKey="income" fill="#f37121" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <div>
              <p className="font-bold text-slate-900 mb-2 flex items-center gap-1.5"><Route className="w-4 h-4 text-slate-400" />{ar ? 'أكثر المسارات' : 'Top routes'}</p>
              {data.stats.topRoutes.length === 0 ? <p className="text-xs text-slate-400">—</p> : (
                <ul className="space-y-1.5">
                  {data.stats.topRoutes.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 truncate">{r.key || '—'}</span>
                      <span className="shrink-0 text-slate-500">{r.trips}× · <b className="text-emerald-700">{money(r.income)}</b></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="pt-3 border-t border-slate-100">
              <p className="font-bold text-slate-900 mb-2 flex items-center gap-1.5"><Truck className="w-4 h-4 text-slate-400" />{ar ? 'أكثر السيارات' : 'Top vehicles'}</p>
              {data.stats.topVehicles.length === 0 ? <p className="text-xs text-slate-400">—</p> : (
                <ul className="space-y-1.5">
                  {data.stats.topVehicles.map((v) => (
                    <li key={v.key} className="flex items-center justify-between gap-2 text-xs">
                      <Link href={`/system/fleet/vehicles?plate=${encodeURIComponent(v.key)}`} className="font-mono text-slate-600 hover:text-[#f37121] truncate">{v.key || '—'}</Link>
                      <span className="shrink-0 text-slate-500">{v.trips}× · <b className="text-emerald-700">{money(v.income)}</b></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data.stats.byPaymentType.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <p className="font-bold text-slate-900 mb-2 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-slate-400" />{ar ? 'حسب نوع الدفع' : 'By payment type'}</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.stats.byPaymentType.map((p) => (
                    <span key={p.key} className="px-2.5 py-1 rounded-full bg-slate-100 text-xs text-slate-700">
                      {lkp('fleet_payment_type', p.key) || p.key}: <b>{p.trips}</b> · {money(p.income)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* سجل الرحلات الكامل */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100"><p className="font-bold text-slate-900">{ar ? 'سجل الرحلات الكامل' : 'Full trip history'} ({data.shipments.length})</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>{[ar ? 'البوليصة' : 'Waybill', ar ? 'المسار' : 'Route', ar ? 'اللوحة' : 'Plate', ar ? 'السائق' : 'Driver', ar ? 'النوع' : 'Load', ar ? 'السعر' : 'Price', ar ? 'التاريخ' : 'Date', ar ? 'الحالة' : 'Status'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.shipments.map((s) => (
                <tr key={s._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2"><Link href={`/system/fleet/${s._id}`} className="text-[#f37121] hover:underline font-mono">{s.waybillNumber}</Link></td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{s.fromCity || '—'} ← {s.toCity || '—'}</td>
                  <td className="px-3 py-2 font-mono">{s.vehiclePlate || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{s.driverName || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{lkp('fleet_load_type', s.loadType) || '—'}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-700">{s.price ? money(s.price) : '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtD(s.loadDate || s.createdAt)}</td>
                  <td className="px-3 py-2">{fleetStatusLabel(s.status, lang as Lang)}</td>
                </tr>
              ))}
              {data.shipments.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">{ar ? 'لا توجد رحلات لهذا العميل' : 'No trips'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
