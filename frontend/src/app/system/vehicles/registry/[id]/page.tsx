'use client';
// ملفّ المركبة — الشاشة الشاملة، لا ملخّصٌ يُحيل إلى غيره.
//
// كانت تعرض حقلًا أو حقلين من كلّ عائلة مستندات، فمَن أراد بيانات التتبّع أو
// التفويض ذهب إلى صفحتهما وبحث باللوحة. وأسوأ من النقص أنّها كانت تقرأ الحقل
// الخطأ: «جهاز GPS» من `gps.deviceId` وهو فارغٌ في المركبات الأربعين والمئتين
// كلِّها — الجهاز في `deviceModel` — فكانت كلُّ مركبةٍ عليها جهازٌ تقول
// «غير مركّب»، وهي جملةٌ تُقرأ حقيقةً لا خطأَ عرض.
//
// فصار كلُّ كارتٍ هنا يحمل ما تحمله صفحتُه: نفس الحقول ونفس الحالة ونفس الأيام
// المتبقّية. وصفحةُ العائلة تبقى لأنّها تُقارن مركبةً بمركبة؛ وهذه تجمع مركبةً
// واحدة كلَّها في مكانٍ واحد.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ReportButton from '@/components/system/ReportButton';
import ExportMenu from '@/components/ls2/ExportMenu';
import {
  VReg, statusColor, statusLabel, DOC_TYPES, fmtDate, money, daysText,
} from '@/lib/vehicleRegistry';
import {
  Car, ArrowRight, Satellite, IdCard, ShieldCheck, Fuel, FileText, ClipboardCheck,
  AlertTriangle, History, MapPin,
} from 'lucide-react';

export default function VehicleRegistryDetail() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
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
  if (!v) return <div className="p-8 text-slate-500">{t('المركبة غير موجودة', 'Not found')}</div>;

  const field = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-end break-all">{value || '—'}</span>
    </div>
  );

  /** تاريخُ مستندٍ بحالته وأيامه — نفس ما تعرضه صفحة العائلة، من نفس المصدر. */
  const dateField = (label: string, date: string | null | undefined, docKey: string) => {
    const st = v.docStatuses?.[docKey];
    return field(label, date
      ? (
        <span>
          <span style={{ color: statusColor(st?.status || 'none') }}>{fmtDate(date)}</span>
          {st?.days != null && <span className="text-xs text-slate-400"> · {daysText(st.days, ar)}</span>}
        </span>
      )
      : '—');
  };

  const Section = ({ title, icon, children, tone }: { title: string; icon: React.ReactNode; children: React.ReactNode; tone?: string }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="font-bold text-slate-900 mb-2 flex items-center gap-1.5 text-[14px]">
        <span className="text-slate-400" style={tone ? { color: tone } : undefined}>{icon}</span>{title}
      </p>
      {children}
    </div>
  );

  // ملفُّ المركبة يُصدَّر شيتًا واحدًا مسطَّحًا: حقلٌ في كل صفّ — وهو الشكل
  // الذي يُلصَق في بريدٍ أو يُطبع، لا جدولٌ عرضُه ستّون عمودًا.
  const flat = [
    [t('رقم اللوحة', 'Plate'), v.plateNumber],
    [t('رقم الهيكل', 'Chassis'), v.chassisNumber],
    [t('الرقم التسلسلي', 'Serial'), v.serialNumber],
    [t('القطاع', 'Sector'), v.sectorAr],
    [t('الإدارة', 'Department'), v.departmentAr],
    [t('المدينة', 'City'), v.cityAr],
    [t('المالك', 'Owner'), v.ownerNameAr],
    [t('حالة التشغيل', 'Service status'), v.serviceStatusAr],
    [t('الماركة', 'Brand'), v.brandAr],
    [t('الطراز', 'Model'), v.modelAr],
    [t('سنة الصنع', 'Year'), v.modelYear],
    [t('اللون', 'Colour'), v.colorAr],
    [t('رقم وثيقة التأمين', 'Policy no.'), v.insurance?.policyNumber],
    [t('شركة التأمين', 'Insurer'), v.insurance?.companyAr],
    [t('انتهاء التأمين', 'Insurance expiry'), fmtDate(v.insurance?.expiryDate)],
    [t('رقم بطاقة التشغيل', 'Operating card no.'), v.operatingCard?.cardNumber],
    [t('انتهاء بطاقة التشغيل', 'Op. card expiry'), fmtDate(v.operatingCard?.expiryDate)],
    [t('انتهاء رخصة السير', 'Licence expiry'), fmtDate(v.vehicleLicense?.expiryDate)],
    [t('انتهاء الفحص', 'Inspection expiry'), fmtDate(v.inspection?.expiryDate)],
    [t('جهاز GPS', 'GPS device'), v.gps?.deviceModel],
    [t('سريال GPS', 'GPS serial'), v.gps?.serialImei],
    [t('شركة الـGPS', 'GPS provider'), v.gps?.provider],
    [t('انتهاء اشتراك GPS', 'GPS expiry'), fmtDate(v.gps?.expiryDate)],
    [t('اسم المفوَّض', 'Authorised person'), v.authorizedPerson?.name],
    [t('رقم الإقامة', 'Iqama'), v.authorizedPerson?.iqamaNumber],
    [t('رقم التفويض', 'Authorisation no.'), v.authorizedPerson?.authorizationNumber],
    [t('نهاية التفويض', 'Authorisation expiry'), fmtDate(v.authorizedPerson?.expiryDate)],
    [t('رقم شريحة الوقود', 'Fuel card no.'), v.fuelCard?.cardNumber],
    [t('عدد الحوادث', 'Accidents'), v.accidentCount ?? 0],
  ].map(([k, val]) => ({ field: k, value: val ?? '' }));

  const gpsOn = !!(v.gps?.deviceModel || v.gps?.serialImei || v.gps?.provider);
  const auth = v.authorizedPerson;
  const authOn = !!(auth?.name || auth?.authorizationNumber);

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Car className="w-5 h-5" />} title={v.plateNumber}
        subtitle={[v.brandAr, v.modelAr, v.sectorAr, v.cityAr].filter(Boolean).join(' · ')}>
        {/* PDF شامل للمركبة: يجمع سجلَّها هنا مع تليمتري لوكيشن سوليوشن
            وحمولات الأسطول في ورقةٍ واحدة بترويسة الشركة. */}
        <ReportButton subject="vehicle" id={v.plateNumber} label={t('تقرير PDF شامل', 'Full PDF report')} />
        <ExportMenu fileName={`vehicle-${v.plateNumber}`} lang={ar ? 'ar' : 'en'} variant="subtle"
          options={[{
            key: 'sheet', label: t('ملفّ المركبة (Excel)', 'Vehicle file (Excel)'),
            sheets: [{
              name: 'Vehicle',
              rows: flat as unknown as Record<string, any>[],
              columns: [
                { header: t('البند', 'Field'), key: 'field', width: 28 },
                { header: t('القيمة', 'Value'), key: 'value', width: 36 },
              ],
            }],
          }]} />
        <button type="button" onClick={() => router.push('/system/vehicles/registry')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" /> {t('رجوع', 'Back')}
        </button>
      </PageHeader>

      {/* حالة المستندات */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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

      {/* بنودٌ ناقصة وشروط لوجستي — قائمةُ عملٍ لا وصف */}
      {(!!v.missingItems?.length || !!v.logistiGaps?.length) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="font-bold text-amber-800 mb-2 flex items-center gap-1.5 text-[14px]"><AlertTriangle className="w-4 h-4" />{t('نواقص هذه المركبة', 'What this vehicle is missing')}</p>
          <div className="flex flex-wrap gap-1.5">
            {(v.missingItems || []).map((mi, i) => (
              <span key={`m${i}`} className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-xs text-amber-800">
                {mi.item}{mi.reason ? ` · ${mi.reason}` : ''}
              </span>
            ))}
            {(v.logistiGaps || []).map((g, i) => (
              <span key={`g${i}`} className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-xs text-amber-800">{g}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={t('الهوية والتصنيف', 'Identity & classification')} icon={<Car className="w-4 h-4" />}>
          {field(t('رقم اللوحة', 'Plate'), <span className="font-mono">{v.plateNumber}</span>)}
          {field(t('رقم الهيكل', 'Chassis'), <span className="font-mono">{v.chassisNumber}</span>)}
          {field(t('الرقم التسلسلي', 'Serial'), <span className="font-mono">{v.serialNumber}</span>)}
          {field(t('القطاع', 'Sector'), v.sectorAr)}
          {field(t('الإدارة', 'Department'), v.departmentAr)}
          {field(t('المدينة', 'City'), v.cityAr)}
          {field(t('نوع التسجيل', 'Registration type'), v.registrationTypeAr)}
          {field(t('الماركة / الطراز', 'Brand / model'), [v.brandAr, v.modelAr].filter(Boolean).join(' '))}
          {field(t('سنة الصنع', 'Year'), v.modelYear)}
          {field(t('اللون', 'Colour'), v.colorAr)}
          {field(t('حالة التشغيل', 'Service status'), v.serviceStatusAr)}
        </Section>

        <Section title={t('الملكية والحيازة', 'Ownership')} icon={<MapPin className="w-4 h-4" />}>
          {field(t('المالك', 'Owner'), v.ownerNameAr)}
          {field(t('السجل التجاري', 'Commercial reg.'), v.commercialRegistration)}
          {field(t('حالة الحيازة', 'Possession'), v.possessionStatusAr)}
          {field(t('حالة تم', 'Tam status'), v.tamStatusAr)}
          {field(t('عدد الحوادث', 'Accidents'), (
            <Link href={`/system/vehicles/accidents?q=${encodeURIComponent(v.plateNumber)}`}
              className={v.accidentCount ? 'text-red-600 hover:underline font-bold' : ''}>{v.accidentCount ?? 0}</Link>
          ))}
        </Section>

        {/* ── التتبّع: نفس أعمدة صفحة أجهزة التتبّع بالضبط ─────────────────── */}
        <Section title={t('جهاز التتبّع GPS', 'GPS tracking')} icon={<Satellite className="w-4 h-4" />} tone={gpsOn ? '#0ea5e9' : undefined}>
          {field(t('جهاز GPS', 'GPS device'), v.gps?.deviceModel || (gpsOn ? '—' : t('غير مركّب', 'Not installed')))}
          {field(t('حالة جهاز GPS', 'Device status'), v.gps?.deviceStatusAr || v.gps?.status)}
          {field(t('شركة الـGPS', 'Provider'), v.gps?.provider)}
          {field(t('سريال GPS', 'Serial / IMEI'), <span className="font-mono">{v.gps?.serialImei}</span>)}
          {field(t('رقم الشريحة', 'SIM number'), <span className="font-mono">{v.gps?.simNumber}</span>)}
          {dateField(t('تاريخ انتهاء الـGPS', 'Subscription expiry'), v.gps?.expiryDate, 'gps')}
          {gpsOn && (
            <Link href={`/system/vehicles/registry/gps?q=${encodeURIComponent(v.plateNumber)}`}
              className="mt-2 inline-block text-xs text-sky-700 hover:underline">{t('فتحها في صفحة أجهزة التتبّع ←', 'Open in the GPS page →')}</Link>
          )}
        </Section>

        {/* ── التفويض: نفس أعمدة صفحة التفاويض ─────────────────────────────── */}
        <Section title={t('التفويض بالقيادة', 'Driving authorisation')} icon={<IdCard className="w-4 h-4" />} tone={authOn ? '#7c3aed' : undefined}>
          {field(t('اسم المفوَّض', 'Authorised person'), auth?.name)}
          {field(t('الوظيفة', 'Job title'), auth?.jobTitleAr)}
          {field(t('رقم الإقامة', 'Iqama number'), <span className="font-mono">{auth?.iqamaNumber}</span>)}
          {field(t('رقم التفويض', 'Authorisation number'), <span className="font-mono">{auth?.authorizationNumber}</span>)}
          {field(t('تاريخ بداية التفويض', 'Start date'), auth?.startDate ? fmtDate(auth.startDate) : '—')}
          {dateField(t('تاريخ نهاية التفويض', 'End date'), auth?.expiryDate, 'authorization')}
          {authOn && (
            <Link href={`/system/vehicles/registry/authorizations?q=${encodeURIComponent(v.plateNumber)}`}
              className="mt-2 inline-block text-xs text-violet-700 hover:underline">{t('فتحها في صفحة التفاويض ←', 'Open in the authorisations page →')}</Link>
          )}
        </Section>

        <Section title={t('التأمين', 'Insurance')} icon={<ShieldCheck className="w-4 h-4" />}>
          {field(t('رقم الوثيقة', 'Policy no.'), <span className="font-mono">{v.insurance?.policyNumber}</span>)}
          {field(t('الشركة', 'Company'), v.insurance?.companyAr)}
          {field(t('نوع التغطية', 'Coverage'), v.insurance?.coverageTypeAr)}
          {dateField(t('تاريخ الانتهاء', 'Expiry'), v.insurance?.expiryDate, 'insurance')}
          {field(t('القسط', 'Premium'), v.insurance?.premiumSar ? money(v.insurance.premiumSar) : '—')}
          {field(t('حالة القسط', 'Premium status'), v.insurance?.premiumStatusAr)}
          <Link href={`/system/vehicles/registry/insurance?q=${encodeURIComponent(v.plateNumber)}`}
            className="mt-2 inline-block text-xs text-slate-500 hover:text-[#f37121] hover:underline">{t('فتحها في صفحة التأمين ←', 'Open in the insurance page →')}</Link>
        </Section>

        <Section title={t('شريحة الوقود', 'Fuel card')} icon={<Fuel className="w-4 h-4" />}>
          {field(t('المزوّد', 'Provider'), v.fuelCard?.provider)}
          {field(t('رقم الشريحة', 'Card no.'), <span className="font-mono">{v.fuelCard?.cardNumber}</span>)}
          {field(t('اللوحة على الفاتورة', 'Plate on invoice'), v.fuelCard?.plateOnInvoiceAr)}
          {field(t('الحالة', 'Status'), v.fuelCard?.statusAr)}
          {field(t('نوع الاستهلاك', 'Consumption'), v.fuelCard?.consumptionTypeAr)}
          {field(t('الحد', 'Limit'), v.fuelCard?.limitStatus === 'open' ? t('بدون سقف', 'Open') : (v.fuelCard?.limitSar ? money(v.fuelCard.limitSar) : '—'))}
          <Link href={`/system/vehicles/registry/fuel-cards?q=${encodeURIComponent(v.plateNumber)}`}
            className="mt-2 inline-block text-xs text-slate-500 hover:text-[#f37121] hover:underline">{t('فتحها في صفحة بترو اب ←', 'Open in the fuel-cards page →')}</Link>
        </Section>

        <Section title={t('بطاقة التشغيل ورخصة السير', 'Operating card & licence')} icon={<FileText className="w-4 h-4" />}>
          {field(t('رقم بطاقة التشغيل', 'Operating card no.'), <span className="font-mono">{v.operatingCard?.cardNumber}</span>)}
          {dateField(t('انتهاء بطاقة التشغيل', 'Op. card expiry'), v.operatingCard?.expiryDate, 'operatingCard')}
          {dateField(t('انتهاء رخصة السير', 'Licence expiry'), v.vehicleLicense?.expiryDate, 'vehicleLicense')}
          {field(t('انتهاء الرخصة (هجري)', 'Licence expiry (Hijri)'), v.vehicleLicense?.expiryDateHijri)}
          <Link href={`/system/vehicles/registry/operating-cards?q=${encodeURIComponent(v.plateNumber)}`}
            className="mt-2 inline-block text-xs text-slate-500 hover:text-[#f37121] hover:underline">{t('فتحها في صفحة بطاقات التشغيل ←', 'Open in the operating-cards page →')}</Link>
        </Section>

        <Section title={t('الفحص الدوري', 'Periodic inspection')} icon={<ClipboardCheck className="w-4 h-4" />}>
          {field(t('حالة الفحص', 'Status'), v.inspection?.statusAr)}
          {dateField(t('انتهاء الفحص', 'Expiry'), v.inspection?.expiryDate, 'inspection')}
          {field(t('انتهاء الفحص (هجري)', 'Expiry (Hijri)'), v.inspection?.expiryDateHijri)}
          <Link href={`/system/vehicles/registry/inspection?q=${encodeURIComponent(v.plateNumber)}`}
            className="mt-2 inline-block text-xs text-slate-500 hover:text-[#f37121] hover:underline">{t('فتحها في صفحة الفحص ←', 'Open in the inspection page →')}</Link>
        </Section>

        {!!v.notesAr && (
          <Section title={t('ملاحظات', 'Notes')} icon={<FileText className="w-4 h-4" />}>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{v.notesAr}</p>
          </Section>
        )}
      </div>

      {/* سجلّ التجديدات — الأثر يُقرأ إلى الوراء: أي رقمٍ كان قبل أيّ رقم */}
      {!!v.renewals?.length && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
            <p className="font-bold text-slate-900 flex items-center gap-1.5 text-[14px]"><History className="w-4 h-4 text-slate-400" />{t('سجلّ التجديدات', 'Renewal history')} ({v.renewals.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>{[t('المستند', 'Document'), t('الانتهاء السابق', 'Previous expiry'), t('الانتهاء الجديد', 'New expiry'), t('الرقم السابق', 'Previous no.'), t('الرقم الجديد', 'New no.'), t('التكلفة', 'Cost'), t('بواسطة', 'By'), t('التاريخ', 'Date')]
                  .map((h) => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {v.renewals.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2">{(DOC_TYPES.find((d) => d.key === r.document) || { ar: r.document, en: r.document })[ar ? 'ar' : 'en']}</td>
                    <td className="px-3 py-2 text-slate-500">{r.previousExpiry ? fmtDate(r.previousExpiry) : '—'}</td>
                    <td className="px-3 py-2 font-semibold">{fmtDate(r.newExpiry)}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{r.previousNumber || '—'}</td>
                    <td className="px-3 py-2 font-mono">{r.newNumber || '—'}</td>
                    <td className="px-3 py-2">{r.cost != null ? money(r.cost) : '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.byName || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.at ? fmtDate(r.at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
