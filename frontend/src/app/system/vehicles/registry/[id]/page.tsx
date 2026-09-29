'use client';
// ملفّ المركبة — الشاشة الشاملة، لا ملخّصٌ يُحيل إلى غيره.
//
// كانت تعرض حقلًا أو حقلين من كلّ عائلة مستندات، فمَن أراد بيانات التتبّع أو
// التفويض ذهب إلى صفحتهما وبحث باللوحة. وأسوأ من النقص أنّها كانت تقرأ الحقل
// الخطأ: «جهاز GPS» من `gps.deviceId` وهو فارغٌ في المركبات الأربعين والمئتين
// كلِّها — الجهاز في `deviceModel` — فكانت كلُّ مركبةٍ عليها جهازٌ تقول
// «غير مركّب»، وهي جملةٌ تُقرأ حقيقةً لا خطأَ عرض.
//
// ── ولماذا هذا القدر من التباين ──────────────────────────────────────────────
// الشاشة الأولى كانت رماديّةً متساوية: التسمية والقيمة بالوزن نفسه تقريبًا،
// وحدودٌ باهتة، وعناوينُ لا تُفرّق كارتًا عن كارت. فالعين لا تجد أين تقع،
// وقراءةُ رقم بطاقة التشغيل تحتاج بحثًا لا نظرة.
//
// فالقيمة الآن أغمق وأثقل من تسميتها بدرجتين، والأرقام الرسميّة بخطٍّ ثابت
// العرض لأنّها تُقارَن بأخرى وتُنسَخ، وكلُّ كارتٍ له شريطُ لونٍ علويّ من لون
// حالة مستنده — فالمنتهي يُرى أحمرَ قبل أن يُقرأ.
//
// وكلُّ ما هنا حيٌّ: كلُّ تعديلٍ في أيّ صفحةٍ من صفحات القسم يبثّ `vreg:updated`
// (إحدى عشرة عمليّةً كلُّها تبثّه)، ونداءُ المركبة الواحدة بلا ذاكرةٍ مؤقّتة —
// فما يُكتب في صفحة التفاويض يظهر هنا في اللحظة نفسها بلا تحديث.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner } from '@/components/hr/HRKit';
import ReportButton from '@/components/system/ReportButton';
import { RenewModal, type RenewTarget } from '@/components/vehicles/RenewModals';
import VehicleDocuments from '@/components/vehicles/VehicleDocuments';
import ExportMenu from '@/components/ls2/ExportMenu';
import {
  VReg, statusColor, statusLabel, STATUS_META, statusMeta, DOC_TYPES, fmtDate, money, daysText, canEditVehicles, toHijri,
} from '@/lib/vehicleRegistry';
import { useAuth } from '@/context/AuthContext';
import {
  Car, ArrowRight, Satellite, IdCard, ShieldCheck, Fuel, FileText, ClipboardCheck,
  AlertTriangle, History, Building2, ChevronLeft, ExternalLink, RefreshCcw,
} from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

/** لونُ عائلةٍ حين لا يكون لها مستندٌ بحالة — للهوية والملكية. */
const NEUTRAL = '#64748b';

/**
 * ── لبناتُ العرض على مستوى الملفّ لا داخلَ جسم الرسم ─────────────────────────
 *
 * كانت `Row` و`Section` و`DateRow` تُعرَّف داخل مكوّن الصفحة. والدالّةُ
 * المعرَّفةُ في جسم الرسم تُبنى من جديدٍ عند كلّ حالةٍ تتغيّر، فتراها React
 * نوعًا جديدًا كلَّ مرّة: تهدم الشجرةَ كلَّها وتبنيها. وأثرُ ذلك يُرى في أوّل
 * خانةِ إدخال — حرفٌ يُكتب في الملاحظات فتُهدَم الخانةُ وتُبنى، فيضيع المؤشّرُ
 * وتقفز الصفحةُ إلى أوّلها. وهو نفسُه سببُ الوميض وإعادة الجلب في غيرها.
 *
 * فمكانُها هنا: نوعُها ثابتٌ فلا يُعاد التركيب، ويُمرَّر إليها ما تحتاجه.
 */
function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[7px] border-b border-slate-100 last:border-0">
      <span className="text-[12px] text-slate-500 shrink-0 leading-tight">{label}</span>
      <span className={`text-[13.5px] font-semibold text-slate-900 text-end break-all leading-snug ${mono ? 'font-mono tracking-tight' : ''}`}>
        {children}
      </span>
    </div>
  );
}

const valOf = (x: unknown) => (x === null || x === undefined || x === '' ? <span className="text-slate-300 font-normal">—</span> : (x as React.ReactNode));

/** تاريخُ مستندٍ بحالته وأيامه — نفس ما تعرضه صفحة العائلة، من نفس المصدر. */
function DocDateRow({ label, date, st, ar }: {
  label: string; date?: string | null; st?: { status?: string; days?: number | null }; ar: boolean;
}) {
  const meta = statusMeta(st?.status);
  if (!date) return <Row label={label}>{valOf(null)}</Row>;
  return (
    <Row label={label}>
      <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
        <span className="font-mono tracking-tight">{fmtDate(date)}</span>
        {st?.days != null && (
          <span className={`px-1.5 py-[1px] rounded text-[11px] font-bold ${meta?.bg} ${meta?.text}`}>
            {daysText(st.days, ar)}
          </span>
        )}
      </span>
    </Row>
  );
}

function Section({ title, icon, accent, children, href, hrefLabel, isRTL }: {
  title: string; icon: React.ReactNode; accent: string; children: React.ReactNode;
  href?: string; hrefLabel?: string; isRTL?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="h-1" style={{ background: accent }} />
      <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${accent}1a`, color: accent }}>{icon}</span>
        <h2 className="font-extrabold text-slate-900 text-[14.5px] tracking-tight">{title}</h2>
      </div>
      <div className="px-4 pb-3 flex-1">{children}</div>
      {href && (
        <Link href={href}
          className="mx-4 mb-3 inline-flex items-center gap-1 self-start text-[11.5px] font-bold text-slate-500 hover:text-[#f37121] transition-colors">
          {hrefLabel} <ChevronLeft className={`w-3.5 h-3.5 ${isRTL ? '' : 'rotate-180'}`} />
        </Link>
      )}
    </section>
  );
}

export default function VehicleRegistryDetail() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  const id = String(params?.id || '');
  const [v, setV] = useState<VReg | null>(null);
  const [loading, setLoading] = useState(true);
  // ── التجديد من الملفّ نفسه ────────────────────────────────────────────────
  // كان المستند يُرى منتهيًا هنا ثم يُخرَج إلى شاشة عائلته ليُجدَّد — والشاشتان
  // تفتحان النافذة ذاتها. فمن يقف على الملفّ ويرى الأحمر يجدّده من موضعه.
  const [renewing, setRenewing] = useState<RenewTarget | null>(null);
  // مسوّدةُ الملاحظة — تُزامَن مع ما يصل من الخادم، ويبقى ما يكتبه المستخدمُ
  // إن كان قد بدأ الكتابة (حدثٌ حيٌّ لا يمحو سطرًا نصفَ مكتوب).
  const [noteDraft, setNoteDraft] = useState('');
  const [noteTouched, setNoteTouched] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api.get<{ vehicle: VReg }>(`/api/vehicle-registry/${id}`); setV(d.vehicle); }
    catch { /* keep */ } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!noteTouched) setNoteDraft(v?.notesAr || ''); }, [v?.notesAr, noteTouched]);

  /** تُحفَظ الملاحظةُ وحدَها — لا يُرسَل الملفُّ كلُّه فيُخاطر بخاناتٍ لم تُقرأ. */
  const saveNote = useCallback(async () => {
    setSavingNote(true);
    try {
      await api.put(`/api/vehicle-registry/${id}`, { notesAr: noteDraft });
      setNoteTouched(false);
      await load();
    } catch (e) { /* الرسالةُ تصل من الحارس العامّ */ }
    setSavingNote(false);
  }, [id, noteDraft, load]);
  // كلُّ ما يمسّ المركبة يبثّ هذا الحدث: التعديل، التجديد، الحوادث، الإعدادات.
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!v) return <div className="p-8 text-slate-500">{t('المركبة غير موجودة', 'Not found')}</div>;

  // لبناتُ العرضِ مرفوعةٌ إلى مستوى الملفّ — راجع تعليقَها هناك.
  const val = (x: unknown) => (x === null || x === undefined || x === '' ? <span className="text-slate-300 font-normal">—</span> : (x as React.ReactNode));
  const DateRow = ({ label, date, docKey }: { label: string; date?: string | null; docKey: string }) => (
    <DocDateRow label={label} date={date} st={v.docStatuses?.[docKey]} ar={ar} />
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
    [t('الحوادث والمطالبات', 'Accidents & claims'), v.accidentCount ?? 0],
  ].map(([k, value]) => ({ field: k, value: value ?? '' }));

  const gpsOn = !!(v.gps?.deviceModel || v.gps?.serialImei || v.gps?.provider);
  const auth = v.authorizedPerson;
  const authOn = !!(auth?.name || auth?.authorizationNumber);
  const docAccent = (key: string) => statusColor(v.docStatuses?.[key]?.status || 'none');

  /** صفحةُ عائلة كلّ مستند — البطاقةُ تفتحها مفلترةً على هذه المركبة. */
  const DOC_PAGE: Record<string, string> = {
    insurance: 'insurance/vehicles',
    operatingCard: 'operating-cards',
    vehicleLicense: 'licenses',
    inspection: 'inspection',
    gps: 'gps',
    authorization: 'authorizations',
  };
  const openDocPage = (key: string) =>
    router.push(`/system/vehicles/registry/${DOC_PAGE[key] || 'expiring'}?q=${encodeURIComponent(v.plateNumber)}`);

  /**
   * ── النواقصُ التي تُعمَل ─────────────────────────────────────────────────
   *
   * ما في `missingItems` ثلاثةُ أصناف: مستندٌ ناقصٌ باسمه (يُعمَل)، ووصفٌ لا
   * عملَ فيه («نوع اللوحة: نقل عام»)، وشرطُ منصّةٍ مكتوبٌ جملةً طويلةً جاءت مع
   * الشيت («أن تكون مالكًا أو مستخدمًا فعليًّا…»). والأخيران يُقرآن نقصًا وليسا
   * كذلك، فيُخفيان النقصَ الحقيقيَّ بينهما.
   *
   * فيبقى ما يُطابق مستندًا نعرفه — وله عندئذٍ بابٌ يُفتَح ويُستكمَل منه.
   */
  const realGaps = ((): { key: string; label: string; reason?: string; href?: string }[] => {
    const out: { key: string; label: string; reason?: string; href?: string }[] = [];
    const seen = new Set<string>();
    for (const mi of (v.missingItems || [])) {
      const item = String(mi.item || '').trim();
      if (!item) continue;
      // جملةٌ طويلةٌ ليست اسمَ مستند — شرطُ منصّةٍ لا يُعمَل به من هنا.
      if (item.length > 34 || item.includes(':')) continue;
      const doc = DOC_TYPES.find((d) => item.includes(d.ar) || d.ar.includes(item));
      if (!doc) continue;
      if (seen.has(doc.key)) continue;
      seen.add(doc.key);
      out.push({
        key: doc.key,
        label: ar ? doc.ar : doc.en,
        reason: String(mi.reason || '').trim() || undefined,
        href: `/system/vehicles/registry/${DOC_PAGE[doc.key] || 'expiring'}?q=${encodeURIComponent(v.plateNumber)}`,
      });
    }
    // ومستندٌ منتهٍ أو غائبٌ نقصٌ ولو لم يُكتب في القائمة — الحالةُ هي الخبر.
    for (const d of DOC_TYPES) {
      if (seen.has(d.key)) continue;
      const st = v.docStatuses?.[d.key]?.status;
      if (!['expired', 'missing', 'required'].includes(String(st || ''))) continue;
      seen.add(d.key);
      out.push({
        key: d.key,
        label: ar ? d.ar : d.en,
        reason: st === 'expired' ? (ar ? 'منتهٍ' : 'expired') : (ar ? 'غير مسجَّل' : 'not recorded'),
        href: `/system/vehicles/registry/${DOC_PAGE[d.key] || 'expiring'}?q=${encodeURIComponent(v.plateNumber)}`,
      });
    }
    return out;
    // حسابٌ عاديٌّ لا خطّاف: الموضعُ بعد عودةٍ مبكّرة، وخطّافٌ هنا يكسر
    // ترتيبَ الخطّافات (React #310). وهي ستّةُ بنودٍ لا تحتاج تذكّرًا.
  })();

  const renewTarget = (key: string): RenewTarget => {
    const d = DOC_TYPES.find((x) => x.key === key);
    return {
      vehicleId: v._id, plateNumber: v.plateNumber, docKey: key,
      docAr: d?.ar, docEn: d?.en,
      expiryDate: d?.datePath(v) || null,
      documentNumber: d?.numberOf(v) || '',
      startDate: key === 'authorization' ? (v.authorizedPerson?.startDate || null) : null,
    };
  };

  // أسوأُ حالةِ مستندٍ على المركبة — هي عنوانُ حالتها في الترويسة.
  const worst = v.overallStatus || 'none';
  const worstMeta = statusMeta(worst);
  const outOfService = !!v.serviceStatusAr && !/في الخدمة|مستخدم/.test(v.serviceStatusAr);

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── الترويسة: اللوحة هي البطل ─────────────────────────────────────── */}
      {/* الترويسة بلون الشريط الجانبيّ نفسه (slate-900): لونان متقاربان في
          شاشةٍ واحدة يُقرآن خطأً مطبعيًّا لا قرارًا. */}
      <header className="rounded-2xl bg-slate-900 border border-slate-800 text-white shadow-lg overflow-hidden">
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Car className="w-6 h-6 text-[#f37121]" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight font-mono leading-none">{v.plateNumber}</h1>
              <p className="text-[12.5px] text-white/65 mt-1.5 truncate">
                {[v.brandAr, v.modelAr, v.sectorAr, v.cityAr].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-[11.5px] font-extrabold ${worstMeta.bg} ${worstMeta.text}`}>
              {statusLabel(worst, ar)}
            </span>
            {outOfService && (
              <span className="px-2.5 py-1 rounded-lg text-[11.5px] font-extrabold bg-white/15 text-white">{v.serviceStatusAr}</span>
            )}
            <ReportButton onDark subject="vehicle" id={v.plateNumber} label={t('تقرير PDF شامل', 'Full PDF report')} />
            <ExportMenu fileName={`vehicle-${v.plateNumber}`} lang={ar ? 'ar' : 'en'}
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
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors">
              <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /> {t('رجوع', 'Back')}
            </button>
          </div>
        </div>
      </header>

      {/* ── حالة المستندات: تُقرأ من بعيد ─────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {DOC_TYPES.map((d) => {
          const st = v.docStatuses?.[d.key];
          const meta = statusMeta(st?.status);
          const date = d.datePath(v);
          return (
            <div key={d.key} className="group rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-slate-300 hover:shadow transition-all">
              <div className="h-1.5" style={{ background: meta.color }} />
              {/* البطاقةُ مدخلٌ لا لافتة: ضغطةٌ تفتح صفحة عائلتها مفلترةً على هذه
                  المركبة، وزرُّ التجديد يجدّدها من مكانها بلا مغادرة الملفّ. */}
              <button type="button" onClick={() => openDocPage(d.key)}
                className="w-full text-start p-3 cursor-pointer">
                <p className="text-[11.5px] font-bold text-slate-500 mb-1.5 truncate">{ar ? d.ar : d.en}</p>
                <p className="text-[15px] font-extrabold leading-none" style={{ color: meta.color }}>
                  {statusLabel(st?.status || 'none', ar)}
                </p>
                <p className="text-[11.5px] text-slate-500 mt-2 font-mono tracking-tight">{date ? fmtDate(date) : '—'}</p>
                {st?.days != null && (
                  <p className={`text-[11px] font-bold mt-1 inline-block px-1.5 py-[1px] rounded ${meta.bg} ${meta.text}`}>
                    {daysText(st.days, ar)}
                  </p>
                )}
              </button>
              {canEdit && (
                <button type="button" onClick={() => setRenewing(renewTarget(d.key))}
                  className="w-full px-3 py-1.5 text-[11.5px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-t border-emerald-100 flex items-center justify-center gap-1">
                  <RefreshCcw className="w-3 h-3" /> {t('تجديد', 'Renew')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── نواقصُ المركبة: ما يُعمَل، لا ما كُتب في الشيت ────────────────────
          كانت القائمةُ تخلط ثلاثةَ أشياء: نقصًا حقيقيًّا («الفحص الدوري ·
          مطلوب»)، ووصفًا لا يُعمَل به («نوع اللوحة: نقل عام»)، وشرطًا مكتوبًا
          بلغة المنصّة لا يفهمه قارئُه («أن تكون مالكًا أو مستخدمًا فعليًّا…»).
          فتُقرأ كلُّها تحت عنوانٍ واحدٍ فلا يُعرَف ما المطلوبُ فعلُه.

          فبقي النقصُ وحدَه، ومعه بابُه: كلُّ بندٍ مستنَدٌ معروفٌ يفتح صفحتَه
          مباشرةً — يُجدَّد من هناك لا يُقرأ هنا. وما لا يُعرَف له مستندٌ لا
          يُعرَض أصلًا. */}
      {!!realGaps.length && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
          <p className="font-extrabold text-amber-900 mb-2.5 flex items-center gap-1.5 text-[14px]">
            <AlertTriangle className="w-4 h-4" />
            {t(`نواقص هذه المركبة (${realGaps.length})`, `What this vehicle is missing (${realGaps.length})`)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {realGaps.map((g) => (
              g.href ? (
                <Link key={g.key} href={g.href}
                  className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-[12px] font-semibold text-amber-900 hover:border-[#f37121] hover:text-[#f37121] transition-colors">
                  {g.label}
                  {g.reason ? <span className="font-normal text-amber-700">· {g.reason}</span> : null}
                  <span className="text-[11px] font-bold text-[#f37121] opacity-0 group-hover:opacity-100 transition-opacity">
                    {t('استكملها ←', 'fix it ←')}
                  </span>
                </Link>
              ) : (
                <span key={g.key} className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-[12px] font-semibold text-amber-900">
                  {g.label}{g.reason ? <span className="font-normal text-amber-700"> · {g.reason}</span> : null}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3.5">
        <Section isRTL={isRTL} title={t('الهوية والتصنيف', 'Identity & classification')} icon={<Car className="w-4 h-4" />} accent={NEUTRAL}>
          <Row label={t('رقم اللوحة', 'Plate')} mono>{v.plateNumber}</Row>
          <Row label={t('رقم الهيكل', 'Chassis')} mono>{val(v.chassisNumber)}</Row>
          <Row label={t('الرقم التسلسلي', 'Serial')} mono>{val(v.serialNumber)}</Row>
          <Row label={t('القطاع', 'Sector')}>{val(v.sectorAr)}</Row>
          <Row label={t('الإدارة', 'Department')}>{val(v.departmentAr)}</Row>
          <Row label={t('المدينة', 'City')}>{val(v.cityAr)}</Row>
          <Row label={t('نوع التسجيل', 'Registration type')}>{val(v.registrationTypeAr)}</Row>
          <Row label={t('الماركة / الطراز', 'Brand / model')}>{val([v.brandAr, v.modelAr].filter(Boolean).join(' '))}</Row>
          <Row label={t('سنة الصنع', 'Year')} mono>{val(v.modelYear)}</Row>
          <Row label={t('اللون', 'Colour')}>{val(v.colorAr)}</Row>
          <Row label={t('حالة التشغيل', 'Service status')}>
            <span className={outOfService ? 'text-red-600' : 'text-emerald-700'}>{val(v.serviceStatusAr)}</span>
          </Row>
        </Section>

        <Section isRTL={isRTL} title={t('الملكية والحيازة', 'Ownership')} icon={<Building2 className="w-4 h-4" />} accent={NEUTRAL}>
          <Row label={t('المالك', 'Owner')}>{val(v.ownerNameAr)}</Row>
          <Row label={t('السجل التجاري', 'Commercial reg.')} mono>{val(v.commercialRegistration)}</Row>
          <Row label={t('حالة الحيازة', 'Possession')}>{val(v.possessionStatusAr)}</Row>
          <Row label={t('حالة تم', 'Tam status')}>{val(v.tamStatusAr)}</Row>
          {/* الحوادث تُقرأ من سجلّ مطالبات هذا القسم لا من سجلّ قسمٍ آخر —
              والعدّاد محسوبٌ من المطالبات الفعّالة، فالرقم يفتح ما يعدّه. */}
          <Row label={t('الحوادث والمطالبات', 'Accidents & claims')}>
            <Link href={`/system/vehicles/registry/claims?q=${encodeURIComponent(v.plateNumber)}`}
              className={`inline-flex items-center gap-1 hover:underline ${v.accidentCount ? 'text-red-600' : 'text-slate-900'}`}>
              {v.accidentCount ?? 0}<ExternalLink className="w-3 h-3 opacity-60" />
            </Link>
          </Row>
        </Section>

        {/* ── التتبّع: نفس أعمدة صفحة أجهزة التتبّع بالضبط ─────────────────── */}
        <Section isRTL={isRTL} title={t('جهاز التتبّع GPS', 'GPS tracking')} icon={<Satellite className="w-4 h-4" />}
          accent={gpsOn ? docAccent('gps') : NEUTRAL}
          href={gpsOn ? `/system/vehicles/registry/gps?q=${encodeURIComponent(v.plateNumber)}` : undefined}
          hrefLabel={t('صفحة أجهزة التتبّع', 'GPS page')}>
          <Row label={t('جهاز GPS', 'GPS device')}>
            {v.gps?.deviceModel
              ? <span className="font-mono">{v.gps.deviceModel}</span>
              : (gpsOn ? val(null) : <span className="text-slate-400 font-normal">{t('غير مركّب', 'Not installed')}</span>)}
          </Row>
          <Row label={t('حالة جهاز GPS', 'Device status')}>{val(v.gps?.deviceStatusAr || v.gps?.status)}</Row>
          <Row label={t('شركة الـGPS', 'Provider')}>{val(v.gps?.provider)}</Row>
          <Row label={t('سريال GPS', 'Serial / IMEI')} mono>{val(v.gps?.serialImei)}</Row>
          <Row label={t('رقم الشريحة', 'SIM number')} mono>{val(v.gps?.simNumber)}</Row>
          <DateRow label={t('انتهاء الاشتراك', 'Subscription expiry')} date={v.gps?.expiryDate} docKey="gps" />
        </Section>

        {/* ── التفويض: نفس أعمدة صفحة التفاويض ─────────────────────────────── */}
        <Section isRTL={isRTL} title={t('التفويض بالقيادة', 'Driving authorisation')} icon={<IdCard className="w-4 h-4" />}
          accent={authOn ? docAccent('authorization') : NEUTRAL}
          href={authOn ? `/system/vehicles/registry/authorizations?q=${encodeURIComponent(v.plateNumber)}` : undefined}
          hrefLabel={t('صفحة التفاويض', 'Authorisations page')}>
          <Row label={t('اسم المفوَّض', 'Authorised person')}>{val(auth?.name)}</Row>
          <Row label={t('الوظيفة', 'Job title')}>{val(auth?.jobTitleAr)}</Row>
          <Row label={t('رقم الإقامة', 'Iqama number')} mono>{val(auth?.iqamaNumber)}</Row>
          <Row label={t('رقم التفويض', 'Authorisation number')} mono>{val(auth?.authorizationNumber)}</Row>
          <Row label={t('بداية التفويض', 'Start date')} mono>{auth?.startDate ? fmtDate(auth.startDate) : val(null)}</Row>
          <DateRow label={t('نهاية التفويض', 'End date')} date={auth?.expiryDate} docKey="authorization" />
        </Section>

        <Section isRTL={isRTL} title={t('التأمين', 'Insurance')} icon={<ShieldCheck className="w-4 h-4" />} accent={docAccent('insurance')}
          href={`/system/vehicles/registry/insurance/vehicles?q=${encodeURIComponent(v.plateNumber)}`}
          hrefLabel={t('صفحة تأمين المركبات', 'Vehicle-insurance page')}>
          <Row label={t('رقم الوثيقة', 'Policy no.')} mono>{val(v.insurance?.policyNumber)}</Row>
          <Row label={t('الشركة', 'Company')}>{val(v.insurance?.companyAr)}</Row>
          <Row label={t('نوع التغطية', 'Coverage')}>{val(v.insurance?.coverageTypeAr)}</Row>
          <DateRow label={t('تاريخ الانتهاء', 'Expiry')} date={v.insurance?.expiryDate} docKey="insurance" />
          <Row label={t('القسط', 'Premium')} mono>{v.insurance?.premiumSar ? `${money(v.insurance.premiumSar)} ${t('ر.س', 'SAR')}` : val(null)}</Row>
          <Row label={t('حالة القسط', 'Premium status')}>{val(v.insurance?.premiumStatusAr)}</Row>
        </Section>

        <Section isRTL={isRTL} title={t('شريحة الوقود', 'Fuel card')} icon={<Fuel className="w-4 h-4" />} accent="#0891b2"
          href={`/system/vehicles/registry/fuel-cards?q=${encodeURIComponent(v.plateNumber)}`}
          hrefLabel={t('صفحة بترو اب', 'Fuel-cards page')}>
          <Row label={t('المزوّد', 'Provider')}>{val(v.fuelCard?.provider)}</Row>
          <Row label={t('رقم الشريحة', 'Card no.')} mono>{val(v.fuelCard?.cardNumber)}</Row>
          <Row label={t('اللوحة على الفاتورة', 'Plate on invoice')} mono>{val(v.fuelCard?.plateOnInvoiceAr)}</Row>
          <Row label={t('الحالة', 'Status')}>{val(v.fuelCard?.statusAr)}</Row>
          <Row label={t('نوع الاستهلاك', 'Consumption')}>{val(v.fuelCard?.consumptionTypeAr)}</Row>
          <Row label={t('الحد', 'Limit')} mono>
            {v.fuelCard?.limitStatus === 'open'
              ? <span className="text-emerald-700">{t('بدون سقف', 'Open')}</span>
              : (v.fuelCard?.limitSar ? money(v.fuelCard.limitSar) : val(null))}
          </Row>
        </Section>

        {/* ── بطاقةُ التشغيل ورخصةُ السير: مستندان لا مستند ─────────────────
            كانا في بطاقةٍ واحدةٍ عنوانُها يجمعهما ورابطُها يفتح صفحةَ بطاقات
            التشغيل وحدَها — فتاريخُ رخصةِ السير يُقرأ تحت عنوان غيرِه ولا
            يُوصل إلى صفحته. وهما مستندان مستقلّان: لكلٍّ تاريخُه وحالتُه
            وصفحتُه وتجديدُه، فلكلٍّ بطاقتُه. */}
        <Section isRTL={isRTL} title={t('بطاقة التشغيل', 'Operating card')} icon={<FileText className="w-4 h-4" />}
          accent={docAccent('operatingCard')}
          href={`/system/vehicles/registry/operating-cards?q=${encodeURIComponent(v.plateNumber)}`}
          hrefLabel={t('صفحة بطاقات التشغيل', 'Operating-cards page')}>
          <Row label={t('رقم البطاقة', 'Card no.')} mono>{val(v.operatingCard?.cardNumber)}</Row>
          <DateRow label={t('تاريخ الانتهاء', 'Expiry')} date={v.operatingCard?.expiryDate} docKey="operatingCard" />
        </Section>

        <Section isRTL={isRTL} title={t('رخصة السير', 'Vehicle licence')} icon={<FileText className="w-4 h-4" />}
          accent={docAccent('vehicleLicense')}
          href={`/system/vehicles/registry/licenses?q=${encodeURIComponent(v.plateNumber)}`}
          hrefLabel={t('صفحة رخص السير', 'Licences page')}>
          <DateRow label={t('تاريخ الانتهاء', 'Expiry')} date={v.vehicleLicense?.expiryDate} docKey="vehicleLicense" />
          {/* الهجريُّ المكتوبُ في الرخصة أوّلًا — والمحسوبُ إن لم يُسجَّل. */}
          <Row label={t('تاريخ الانتهاء (هجري)', 'Expiry (Hijri)')} mono>
            {val(v.vehicleLicense?.expiryDateHijri || toHijri(v.vehicleLicense?.expiryDate))}
          </Row>
        </Section>

        <Section isRTL={isRTL} title={t('الفحص الدوري', 'Periodic inspection')} icon={<ClipboardCheck className="w-4 h-4" />}
          accent={docAccent('inspection')}
          href={`/system/vehicles/registry/inspection?q=${encodeURIComponent(v.plateNumber)}`}
          hrefLabel={t('صفحة الفحص', 'Inspection page')}>
          <Row label={t('حالة الفحص', 'Status')}>{val(v.inspection?.statusAr)}</Row>
          <DateRow label={t('انتهاء الفحص', 'Expiry')} date={v.inspection?.expiryDate} docKey="inspection" />
          <Row label={t('انتهاء الفحص (هجري)', 'Expiry (Hijri)')} mono>
            {val(v.inspection?.expiryDateHijri || toHijri(v.inspection?.expiryDate))}
          </Row>
        </Section>

        {/* ── والملاحظةُ تُكتب من هنا، والكارتُ يظهر ولو كانت فارغة ──────────
            كان يختفي متى خلت الملاحظة، فيُفتَح الملفُّ فلا يُرى للملاحظات موضعٌ
            أصلًا — ويُظنّ أنّ الميزةَ غيرُ موجودة. وهي تُكتب حيث تُقرأ: مَن
            يقف على الملفّ ويرى ما يستدعي ملاحظةً يكتبها في موضعها، لا يعود
            إلى الجدول ويفتح نافذةَ تعديل. */}
        <Section isRTL={isRTL} title={t('ملاحظات', 'Notes')} icon={<FileText className="w-4 h-4" />} accent={NEUTRAL}>
          {!canEdit ? (
            <p className="text-[13.5px] text-slate-800 whitespace-pre-wrap leading-relaxed pt-1">
              {v.notesAr || <span className="text-slate-300">—</span>}
            </p>
          ) : (
            <div className="pt-1 space-y-2">
              <textarea
                value={noteDraft}
                onChange={(e) => { setNoteDraft(e.target.value); setNoteTouched(true); }}
                rows={3}
                aria-label={t('ملاحظات المركبة', 'Vehicle notes')}
                placeholder={t('اكتب ملاحظةً عن هذه المركبة…', 'Write a note about this vehicle…')}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
              {noteDraft !== (v.notesAr || '') && (
                <div className="flex items-center gap-2">
                  <button type="button" disabled={savingNote} onClick={saveNote}
                    className="px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-bold disabled:opacity-50">
                    {savingNote ? t('يُحفظ…', 'Saving…') : t('حفظ الملاحظة', 'Save note')}
                  </button>
                  <button type="button" onClick={() => setNoteDraft(v.notesAr || '')}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[12.5px]">
                    {t('تراجع', 'Undo')}
                  </button>
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* ملفّات المركبة — صورُ ما سبق من مستندات */}
      <VehicleDocuments vehicleId={v._id} canEdit={canEdit} />

      {/* سجلّ التجديدات — الأثر يُقرأ إلى الوراء: أي رقمٍ كان قبل أيّ رقم */}
      {!!v.renewals?.length && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <p className="font-extrabold text-slate-900 flex items-center gap-1.5 text-[14.5px]">
              <History className="w-4 h-4 text-slate-400" />{t('سجلّ التجديدات', 'Renewal history')}
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{v.renewals.length}</span>
            </p>
          </div>
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead className="bg-slate-100 text-slate-600 text-[11.5px] uppercase tracking-wide">
                {/* ── والملاحظةُ والإيصالُ عمودان هنا ─────────────────────────
                    نافذةُ التجديد تسأل عن ملاحظةٍ ورقمِ إيصال وتحفظهما فعلًا في
                    `renewals[]`، ولم يكن في النظام كلِّه موضعٌ واحدٌ يقرؤهما:
                    خمسةُ مواضعَ تكتب ولا موضعٌ يعرض. فمن كتب ملاحظةً عند
                    التجديد رآها تُبتلَع — وهذا مكانُها الطبيعيّ: سطرُ التجديد
                    الذي تشرحه. */}
                <tr>{[t('المستند', 'Document'), t('الانتهاء السابق', 'Previous expiry'), t('الانتهاء الجديد', 'New expiry'), t('الرقم السابق', 'Previous no.'), t('الرقم الجديد', 'New no.'), t('التكلفة', 'Cost'), t('رقم الإيصال', 'Reference'), t('ملاحظة', 'Note'), t('بواسطة', 'By'), t('التاريخ', 'Date')]
                  .map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {v.renewals.map((r, i) => (
                  <tr key={i} className="hover:bg-orange-50/40">
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{(DOC_TYPES.find((d) => d.key === r.document) || { ar: r.document, en: r.document })[ar ? 'ar' : 'en']}</td>
                    <td className="px-3 py-2.5 text-slate-400 font-mono line-through">{r.previousExpiry ? fmtDate(r.previousExpiry) : '—'}</td>
                    <td className="px-3 py-2.5 font-bold text-emerald-700 font-mono">{fmtDate(r.newExpiry)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400 line-through">{r.previousNumber || '—'}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-900">{r.newNumber || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-800">{r.cost != null ? money(r.cost) : '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600">{r.reference || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700 max-w-[22rem]" title={r.note || ''}>{r.note || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.byName || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap font-mono">{r.at ? fmtDate(r.at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {renewing && (
        <RenewModal row={renewing} ar={ar}
          onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}
    </div>
  );
}
