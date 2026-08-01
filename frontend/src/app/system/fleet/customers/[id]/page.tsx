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
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { canViewFleet, canEditFleet, fleetStatusLabel, fmtD, Lang } from '@/lib/fleet';
import { useFleetLookups } from '@/hooks/useFleetLookups';
import { UserRound, ArrowRight, Star, FileDown, Phone, Save } from 'lucide-react';

type Profile = {
  customer: { _id: string; name: string; phone?: string; email?: string; customerType?: string; rating?: number; notes?: string; routes?: { fromCity: string; toCity: string; price: number | null }[] };
  stats: { trips: number; income: number; avgTripIncome: number; byStatus: Record<string, number>; firstTrip: string | null; lastTrip: string | null };
  shipments: { _id: string; waybillNumber: number; vehiclePlate?: string; driverName?: string; fromCity?: string; toCity?: string; status: string; price?: number; loadType?: string; rentType?: string; paymentType?: string; customerType?: string; loadDate?: string; createdAt?: string; supervisorName?: string }[];
};

const money = (n: number) => (Number(n) || 0).toLocaleString('en-US');

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

  const load = useCallback(async () => {
    try {
      const d = await api.get<Profile>(`/api/fleet/customers/${id}/profile`);
      setData(d);
      setType(d.customer.customerType || '');
      setRating(d.customer.rating || 0);
    } catch (e: any) { notify(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [id, notify]);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));

  const saveMeta = async () => {
    setSaving(true);
    try {
      await api.put(`/api/fleet/customers/${id}`, { customerType: type, rating });
      notify(ar ? 'تم الحفظ' : 'Saved', 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const doExport = () => {
    if (!data) return;
    exportToExcel(data.shipments, [
      { header: 'Waybill', key: 'waybillNumber' }, { header: 'From', key: 'fromCity' }, { header: 'To', key: 'toCity' },
      { header: 'Plate', key: 'vehiclePlate' }, { header: 'Driver', key: 'driverName' },
      { header: 'Load type', key: 'loadType' }, { header: 'Price', key: 'price' },
      { header: 'Status', key: 'status', transform: (v) => fleetStatusLabel(v, 'en') },
      { header: 'Load date', key: 'loadDate', transform: (v) => fmt.date(v) },
    ], `customer-${data.customer.name}-${new Date().toISOString().slice(0, 10)}`, 'Trips');
  };

  if (!canViewFleet(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;
  if (!data) return <div className="text-slate-500 p-8">{ar ? 'العميل غير موجود' : 'Not found'}</div>;
  const c = data.customer;

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<UserRound className="w-5 h-5" />} title={c.name}
        subtitle={c.customerType === 'heavy' ? (ar ? 'عميل نقل ثقيل' : 'Heavy transport customer') : c.customerType === 'branch' ? (ar ? 'عميل فروع' : 'Branch customer') : (ar ? 'عميل' : 'Customer')}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"><FileDown className="w-4 h-4" /> {ar ? 'تصدير' : 'Export'}</button>
          <button type="button" onClick={() => router.push('/system/fleet/dashboard')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><ArrowRight className="w-4 h-4" /> {ar ? 'رجوع' : 'Back'}</button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <StatCard label={ar ? 'إجمالي الرحلات' : 'Total trips'} value={data.stats.trips} accent="text-[#f37121]" />
        <StatCard label={ar ? 'إجمالي الدخل (ر.س)' : 'Total income'} value={money(data.stats.income)} accent="text-emerald-600" />
        <StatCard label={ar ? 'متوسط الرحلة' : 'Avg / trip'} value={money(data.stats.avgTripIncome)} />
        <StatCard label={ar ? 'أول رحلة' : 'First trip'} value={data.stats.firstTrip ? fmtD(data.stats.firstTrip) : '—'} />
        <StatCard label={ar ? 'آخر رحلة' : 'Last trip'} value={data.stats.lastTrip ? fmtD(data.stats.lastTrip) : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* بيانات العميل + التقييم */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <p className="font-bold text-slate-900">{ar ? 'بيانات العميل' : 'Customer details'}</p>
          {c.phone && <p className="text-sm text-slate-600 flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> <span className="font-mono">{c.phone}</span></p>}
          {c.email && <p className="text-sm text-slate-600">{c.email}</p>}
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

      {/* سجل الرحلات الكامل */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100"><p className="font-bold text-slate-900">{ar ? 'سجل الرحلات الكامل' : 'Full trip history'} ({data.shipments.length})</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
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
