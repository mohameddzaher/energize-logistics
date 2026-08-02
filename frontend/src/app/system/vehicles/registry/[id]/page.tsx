'use client';
// تفاصيل مركبة — كل الحقول مجمّعة + حالة كل مستند وأيامه المتبقية.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { VReg, statusColor, statusLabel, docLabel, DOC_TYPES, fmtDate, money, daysText } from '@/lib/vehicleRegistry';
import { Car, ArrowRight } from 'lucide-react';

export default function VehicleRegistryDetail() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [v, setV] = useState<VReg | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api.get<{ vehicle: VReg }>(`/api/vehicle-registry/${id}`); setV(d.vehicle); }
    catch { /* keep */ } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!v) return <div className="p-8 text-slate-500">{ar ? 'المركبة غير موجودة' : 'Not found'}</div>;

  const field = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-end">{value ?? '—'}</span>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="font-bold text-slate-900 mb-2">{title}</p>{children}
    </div>
  );

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Car className="w-5 h-5" />} title={v.plateNumber}
        subtitle={`${v.brandAr || ''} ${v.modelAr || ''} · ${v.sectorAr || ''}`}>
        <button onClick={() => router.push('/system/vehicles/registry')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><ArrowRight className="w-4 h-4" /> {ar ? 'رجوع' : 'Back'}</button>
      </PageHeader>

      {/* حالة المستندات */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {DOC_TYPES.map((d) => {
          const st = v.docStatuses?.[d.key];
          const date = d.datePath(v);
          return (
            <div key={d.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">{ar ? d.ar : d.en}</p>
              <p className="text-sm font-bold" style={{ color: statusColor(st?.status || 'none') }}>{statusLabel(st?.status || 'none', ar)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{date ? fmtDate(date) : '—'}{st?.days != null ? ` · ${daysText(st.days, ar)}` : ''}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={ar ? 'الهوية والتصنيف' : 'Identity & classification'}>
          {field(ar ? 'رقم اللوحة' : 'Plate', v.plateNumber)}
          {field(ar ? 'رقم الهيكل' : 'Chassis', v.chassisNumber)}
          {field(ar ? 'الرقم التسلسلي' : 'Serial', v.serialNumber)}
          {field(ar ? 'القطاع' : 'Sector', v.sectorAr)}
          {field(ar ? 'نوع التسجيل' : 'Registration type', v.registrationTypeAr)}
          {field(ar ? 'الماركة / الطراز' : 'Brand / model', `${v.brandAr || ''} ${v.modelAr || ''}`)}
          {field(ar ? 'سنة الصنع' : 'Year', v.modelYear)}
          {field(ar ? 'اللون' : 'Color', v.colorAr)}
        </Section>
        <Section title={ar ? 'الملكية' : 'Ownership'}>
          {field(ar ? 'المالك' : 'Owner', v.ownerNameAr)}
          {field(ar ? 'السجل التجاري' : 'Commercial reg.', v.commercialRegistration)}
          {field(ar ? 'حالة تم' : 'Tam status', v.tamStatusAr)}
        </Section>
        <Section title={ar ? 'التأمين' : 'Insurance'}>
          {field(ar ? 'رقم الوثيقة' : 'Policy no.', v.insurance?.policyNumber)}
          {field(ar ? 'الشركة' : 'Company', v.insurance?.companyAr)}
          {field(ar ? 'نوع التغطية' : 'Coverage', v.insurance?.coverageTypeAr)}
          {field(ar ? 'تاريخ الانتهاء' : 'Expiry', v.insurance?.expiryDate ? <span style={{ color: statusColor(v.docStatuses?.insurance?.status || 'none') }}>{fmtDate(v.insurance.expiryDate)}</span> : '—')}
          {field(ar ? 'القسط' : 'Premium', v.insurance?.premiumSar ? money(v.insurance.premiumSar) : '—')}
        </Section>
        <Section title={ar ? 'شريحة الوقود' : 'Fuel card'}>
          {field(ar ? 'المزوّد' : 'Provider', v.fuelCard?.provider)}
          {field(ar ? 'رقم الشريحة' : 'Card no.', v.fuelCard?.cardNumber)}
          {field(ar ? 'الحالة' : 'Status', v.fuelCard?.statusAr)}
          {field(ar ? 'نوع الاستهلاك' : 'Consumption', v.fuelCard?.consumptionTypeAr)}
          {field(ar ? 'الحد' : 'Limit', v.fuelCard?.limitStatus === 'open' ? (ar ? 'بدون سقف' : 'Open') : (v.fuelCard?.limitSar ? money(v.fuelCard.limitSar) : '—'))}
        </Section>
        <Section title={ar ? 'المستندات' : 'Documents'}>
          {field(ar ? 'بطاقة التشغيل' : 'Operating card', v.operatingCard?.cardNumber)}
          {field(ar ? 'انتهاء بطاقة التشغيل' : 'Op. card expiry', v.operatingCard?.expiryDate ? fmtDate(v.operatingCard.expiryDate) : '—')}
          {field(ar ? 'انتهاء رخصة السير' : 'License expiry', v.vehicleLicense?.expiryDate ? fmtDate(v.vehicleLicense.expiryDate) : '—')}
          {field(ar ? 'حالة الفحص' : 'Inspection status', v.inspection?.statusAr)}
          {field(ar ? 'انتهاء الفحص' : 'Inspection expiry', v.inspection?.expiryDate ? fmtDate(v.inspection.expiryDate) : '—')}
        </Section>
        <Section title={ar ? 'GPS والملاحظات' : 'GPS & notes'}>
          {field(ar ? 'جهاز GPS' : 'GPS device', v.gps?.deviceId || (ar ? 'غير مركّب' : 'Not installed'))}
          {field(ar ? 'المزوّد' : 'Provider', v.gps?.provider)}
          {field(ar ? 'ملاحظات' : 'Notes', v.notesAr)}
        </Section>
      </div>
    </div>
  );
}
