'use client';
/**
 * ملفُّ موظّفِ النقل الخفيف.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * الجدولُ يقول أين هو اليوم، ولا يقول كيف صار هناك. و«نقلناه من مشروعٍ إلى
 * مشروع» و«أنزلناه عن المركبة وأركبنا غيره» أسئلةٌ تُسأل بعد شهور — عند خلافٍ
 * على مخالفة، أو على أجرة، أو على عهدة — وخانةٌ تُستبدَل لا تحفظ جوابها.
 *
 * فهنا ملفُّه كاملًا: بياناتُه، وما هو عليه الآن، وأوامرُ تشغيله من الأحدث إلى
 * الأقدم، وسجلُّ كلّ نقلٍ بصاحبه ووقته. وملفُّه في الموارد البشريّة رابطٌ واحدٌ
 * من هنا — فالإنسانُ سجلٌّ واحدٌ لا اثنان.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { Spinner } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import {
  getLTEmployee, statusCls, KIND_AR, KIND_EN, HISTORY_KIND, fmtDate, canEditLT,
  type LTEmployee, type LTOrder,
} from '@/lib/lightTransport';
import {
  Truck, ArrowRight, User, Building2, Car, Home, History, ClipboardList, ChevronLeft, IdCard,
} from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

const NEUTRAL = '#64748b';

export default function LightTransportProfile() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = canEditLT(user as any);
  const id = String((params as any)?.id || '');

  const [e, setE] = useState<LTEmployee | null>(null);
  const [orders, setOrders] = useState<LTOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await getLTEmployee(id); setE(d.employee); setOrders(d.orders || []); }
    catch { /* تبقى الشاشةُ على ما لديها */ }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:updated', useCallback(() => load(), [load]));
  useSocket('hr:employee', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!e) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-slate-500">{t('الموظّف غير موجود', 'Employee not found')}</p>
        <Link href="/system/b2c/light-transport" className="text-[#f37121] font-semibold text-sm">
          {t('رجوع إلى السجلّ', 'Back to the register')}
        </Link>
      </div>
    );
  }

  const val = (x: unknown) => (x === null || x === undefined || x === ''
    ? <span className="text-slate-300 font-normal">—</span> : (x as React.ReactNode));

  const Row = ({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) => (
    <div className="flex items-baseline justify-between gap-4 py-[7px] border-b border-slate-100 last:border-0">
      <span className="text-[12px] text-slate-500 shrink-0 leading-tight">{label}</span>
      <span className={`text-[13.5px] font-semibold text-slate-900 text-end break-all leading-snug ${mono ? 'font-mono tracking-tight' : ''}`}>
        {children}
      </span>
    </div>
  );

  const Section = ({ title, icon, accent, children, href, hrefLabel }: {
    title: string; icon: React.ReactNode; accent: string; children: React.ReactNode;
    href?: string; hrefLabel?: string;
  }) => (
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

  const flat = [
    [t('الاسم', 'Name'), e.name],
    [t('رقم الهوية', 'ID number'), e.idNumber],
    [t('الوظيفة', 'Job'), e.jobTitleAr],
    [t('النوع', 'Kind'), ar ? KIND_AR[e.staffKind || ''] : KIND_EN[e.staffKind || '']],
    [t('المشروع', 'Project'), e.projectAr],
    [t('الفرع', 'Branch'), e.cityAr],
    [t('المشرف', 'Supervisor'), e.supervisorName],
    [t('نوع التعاقد', 'Contract'), e.contractTypeAr],
    [t('رقم السجل', 'Register'), e.registerNumber],
    [t('حالة العمل', 'Status'), e.workStatusShown],
    [t('الجنسية', 'Nationality'), e.nationalityAr],
    [t('تاريخ التعيين', 'Hire date'), fmtDate(e.hireDate)],
    [t('الجوال', 'Phone'), e.phone],
    [t('نوع المركبة', 'Vehicle type'), e.vehicleTypeAr],
    [t('رقم اللوحة', 'Plate'), e.vehiclePlate],
    [t('الرقم التسلسلي', 'Serial'), e.vehicle?.serialNumber],
    [t('السكن', 'Housing'), e.housing?.name],
    [t('الغرفة', 'Room'), e.housingRoom],
  ].map(([k, v]) => ({ field: k, value: v ?? '' }));

  const history = [...(e.history || [])].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="rounded-2xl bg-slate-900 text-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Truck className="w-6 h-6 text-[#f37121]" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[20px] font-extrabold tracking-tight">{e.name}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-bold ${statusCls(e.workStatusShown)}`}>
                  {e.workStatusShown || '—'}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-bold ${e.staffKind === 'rep' ? 'bg-indigo-500/25 text-indigo-200' : 'bg-teal-500/25 text-teal-200'}`}>
                  {ar ? KIND_AR[e.staffKind || ''] : KIND_EN[e.staffKind || '']}
                </span>
                {/* ومن أين جاء خبرُ الحالة — فلا يُسأل «مَن غيّرها؟». */}
                {e.statusSource === 'hr' && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-white/70">
                    {t('الحالة من الموارد البشرية', 'status from HR')}
                  </span>
                )}
              </div>
              <p className="text-white/60 text-[12.5px] mt-0.5 font-mono">
                {[e.idNumber, e.jobTitleAr, e.projectAr, e.cityAr, e.vehiclePlate].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu fileName={`lt-${e.idNumber}`} lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير', 'Export')}
              options={[{
                key: 'file', label: t('ملفّ الموظف (Excel)', 'Employee file (Excel)'),
                sheets: [{
                  name: 'Employee', rows: flat as unknown as Record<string, any>[],
                  columns: [
                    { header: t('البند', 'Field'), key: 'field', width: 26 },
                    { header: t('القيمة', 'Value'), key: 'value', width: 34 },
                  ],
                }],
              }]} />
            <button type="button" onClick={() => router.push('/system/b2c/light-transport')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors">
              <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /> {t('رجوع', 'Back')}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3.5">
        <Section title={t('الموظف', 'The employee')} icon={<User className="w-4 h-4" />} accent="#f37121"
          href={e.employee ? `/system/hr/employees/${(e.employee as any)._id}` : undefined}
          hrefLabel={t('ملفّه في الموارد البشرية', 'His HR file')}>
          <Row label={t('رقم الهوية', 'ID number')} mono>{val(e.idNumber)}</Row>
          <Row label={t('الجنسية', 'Nationality')}>{val(e.nationalityAr)}</Row>
          <Row label={t('الجوال', 'Phone')} mono>{val(e.phone)}</Row>
          <Row label={t('تاريخ التعيين', 'Hire date')} mono>{val(fmtDate(e.hireDate))}</Row>
          <Row label={t('نوع التعاقد', 'Contract')}>{val(e.contractTypeAr)}</Row>
          {/* ── والسجلُّ الذي هو على كفالته ──────────────────────────────────
              الشركةُ لها أكثرُ من سجلٍّ تجاريّ، ومن ليس على كفالتنا لا سجلَّ له.
              وهو سؤالٌ يُسأل عند التفتيش وعند التأمين. */}
          <Row label={t('رقم السجل', 'Register')} mono>{val(e.registerNumber)}</Row>
          <Row label={t('ملفّ الموارد البشرية', 'HR file')}>
            {e.hrLinked
              ? <span className="text-emerald-700">{e.employeeNumber || t('مربوط', 'linked')}</span>
              : <span className="text-violet-700">{t('لا ملفّ — القسم يملك السجلّ', 'no file — owned by the section')}</span>}
          </Row>
        </Section>

        <Section title={t('التشغيل', 'Deployment')} icon={<Building2 className="w-4 h-4" />} accent="#0891b2">
          <Row label={t('الوظيفة', 'Job')}>{val(e.jobTitleAr)}</Row>
          <Row label={t('المشروع', 'Project')}>{val(e.projectAr)}</Row>
          <Row label={t('الفرع', 'Branch')}>{val(e.cityAr)}</Row>
          <Row label={t('المشرف', 'Supervisor')}>{val(e.supervisorName)}</Row>
          <Row label={t('حالة العمل', 'Status')}>{val(e.workStatusShown)}</Row>
        </Section>

        <Section title={t('المركبة', 'Vehicle')} icon={<Car className="w-4 h-4" />} accent="#16a34a"
          href={e.vehicle ? `/system/vehicles/registry/${e.vehicle._id}` : undefined}
          hrefLabel={t('ملفّ المركبة في سجلّ المركبات', 'Vehicle file in the registry')}>
          <Row label={t('رقم اللوحة', 'Plate')} mono>{val(e.vehiclePlate)}</Row>
          <Row label={t('نوع المركبة', 'Type')}>{val(e.vehicleTypeAr || e.vehicle?.registrationTypeAr)}</Row>
          <Row label={t('الرقم التسلسلي', 'Serial')} mono>{val(e.vehicle?.serialNumber)}</Row>
          <Row label={t('الماركة', 'Brand')}>{val([e.vehicle?.brandAr, e.vehicle?.modelAr].filter(Boolean).join(' '))}</Row>
        </Section>

        <Section title={t('السكن', 'Housing')} icon={<Home className="w-4 h-4" />} accent={NEUTRAL}
          href="/system/b2c/settings" hrefLabel={t('إدارة السكن', 'Manage housing')}>
          <Row label={t('السكن', 'Housing')}>{val(e.housing?.name)}</Row>
          <Row label={t('الغرفة', 'Room')}>{val(e.housingRoom)}</Row>
          <Row label={t('مدينة السكن', 'Housing city')}>{val(e.housing?.cityAr)}</Row>
        </Section>

        {!!e.notesAr && (
          <Section title={t('ملاحظات', 'Notes')} icon={<IdCard className="w-4 h-4" />} accent={NEUTRAL}>
            <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed py-1">{e.notesAr}</p>
          </Section>
        )}
      </div>

      {/* ── أوامرُ التشغيل ───────────────────────────────────────────────────
          واحدٌ سارٍ والباقي مُغلَق. والمُغلَقُ لا يُمحى: هو جوابُ «على أيّ مركبةٍ
          كان في شهر كذا؟». */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <p className="font-extrabold text-slate-900 flex items-center gap-1.5 text-[14.5px]">
            <ClipboardList className="w-4 h-4 text-slate-400" />{t('أوامر التشغيل', 'Operating orders')}
            {!!orders.length && <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{orders.length}</span>}
          </p>
          {canEdit && (
            <Link href={`/system/b2c/orders?employee=${e._id}`}
              className="text-[12px] font-bold text-[#f37121] hover:underline">{t('أمر تشغيل جديد', 'New order')}</Link>
          )}
        </div>
        {!orders.length ? (
          <p className="px-4 py-6 text-[12.5px] text-slate-400">{t('لا أوامر تشغيل بعد.', 'No operating orders yet.')}</p>
        ) : (
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead className="bg-slate-100 text-slate-600 text-[11.5px] uppercase tracking-wide">
                <tr>{[t('الأمر', 'Order'), t('اللوحة', 'Plate'), t('المشروع', 'Project'), t('الفرع', 'Branch'),
                  t('المشرف', 'Supervisor'), t('من', 'From'), t('إلى', 'To'), t('الحالة', 'Status'),
                  t('التفويض', 'Authorisation'), t('أنشأه', 'By')]
                  .map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o._id} className="hover:bg-orange-50/40">
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-900">{o.orderNumber}</td>
                    <td className="px-3 py-2.5 font-mono">{o.vehiclePlate || '—'}</td>
                    <td className="px-3 py-2.5">{o.projectAr || '—'}</td>
                    <td className="px-3 py-2.5">{o.cityAr || '—'}</td>
                    <td className="px-3 py-2.5">{o.supervisorName || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600">{fmtDate(o.startDate) || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{fmtDate(o.endDate) || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${o.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {o.status === 'active' ? t('سارٍ', 'Active') : t('مُغلَق', 'Ended')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11.5px]">
                      {o.authorizationMoved
                        ? <span className="text-emerald-700 font-bold">{t('نُقل', 'moved')}{o.authorizationNumber ? ` · ${o.authorizationNumber}` : ''}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{o.createdByName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        )}
      </section>

      {/* ── سجلُّ النقل ──────────────────────────────────────────────────────
          كلُّ تغييرٍ في مشروعٍ أو فرعٍ أو مشرفٍ أو مركبةٍ أو سكنٍ أو حالةٍ يُقيَّد
          بصاحبه ووقته — وهو ما يُقرأ حين يُسأل «إمتى نقلناه؟». */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="font-extrabold text-slate-900 flex items-center gap-1.5 text-[14.5px]">
            <History className="w-4 h-4 text-slate-400" />{t('سجلّ الملفّ', 'File history')}
            {!!history.length && <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{history.length}</span>}
          </p>
        </div>
        <div className="p-4">
          {!history.length ? (
            <p className="text-[12.5px] text-slate-400">{t('لا قيود بعد.', 'No entries yet.')}</p>
          ) : (
            <ol className={`relative ${isRTL ? 'border-r pr-5' : 'border-l pl-5'} border-slate-200 space-y-4`}>
              {history.map((h, i) => (
                <li key={h._id || i} className="relative">
                  <span className={`absolute ${isRTL ? '-right-[27px]' : '-left-[27px]'} top-1 w-3 h-3 rounded-full bg-[#f37121]`} />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-slate-900 font-semibold text-[13px]">
                      {(HISTORY_KIND[h.kind || ''] || { ar: h.kind, en: h.kind })[ar ? 'ar' : 'en']}
                    </span>
                    <span className="text-slate-400 text-[11.5px]">
                      {h.at ? new Date(h.at).toLocaleString(ar ? 'ar-EG' : 'en-GB') : ''}
                      {h.byName ? ` · ${h.byName}` : ''}
                    </span>
                  </div>
                  {(h.fromValue || h.toValue) && (
                    <p className="text-[12.5px] mt-0.5">
                      {h.fromValue && <span className="text-slate-400 line-through">{h.fromValue}</span>}
                      {h.fromValue && h.toValue && <span className="text-slate-400 mx-1.5">→</span>}
                      {h.toValue && <span className="text-slate-800 font-semibold">{h.toValue}</span>}
                    </p>
                  )}
                  {h.note && <p className="text-slate-500 text-[11.5px] mt-0.5">{h.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
