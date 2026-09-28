'use client';
/**
 * ملفُّ الحادثة والمطالبة — لا سطرٌ في كشف.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كانت المطالبةُ كلُّها سطرًا في جدولٍ عرضُه تسعةُ أعمدة، وما لا يتّسع له السطرُ
 * لا يُقرأ إلّا بفتح نافذة التعديل: الطرفُ الآخر وهويّتُه، ونسبةُ الخطأ، ومصدرُ
 * البلاغ، ورقمُ نجم، ورقمُ المطالبة عند الشركة، وسجلُّ ردودها. فمن سُئل «إيه
 * اللي حصل في الحادثة دي؟» قرأ تسعَ خاناتٍ ثمّ فتح نافذةَ تحريرٍ ليقرأ الباقي —
 * وهي نافذةٌ للكتابة لا للقراءة.
 *
 * والمطالبةُ ملفٌّ يُفتَح ويُتابَع شهورًا: تُقدَّر، ويُطالَب، وتردّ الشركةُ مرّةً
 * ومرّة، ثمّ تُقفَل بمبلغ. فلها صفحتُها: أرقامُها في الأعلى، وتفاصيلُها مبوَّبةً،
 * وورقُها مرفوعٌ فيها، وسجلٌّ يقول من غيّر ماذا ومتى.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { Spinner } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import ClaimAttachments from '@/components/vehicles/ClaimAttachments';
import {
  getClaim, getClaimAudit, money, fmtDate, canEditVehicles,
} from '@/lib/vehicleRegistry';
import { auditActionLabel } from '@/lib/hr';
import {
  TriangleAlert, ArrowRight, Car, Building2, Users, FileText, History, ChevronLeft, Banknote,
} from 'lucide-react';

const NEUTRAL = '#64748b';

export default function ClaimDetailPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  const id = String((params as any)?.id || '');

  const [c, setC] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    try { const d = await getClaim(id); setC(d.claim); }
    catch { /* تبقى الشاشةُ على ما لديها */ }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // السجلُّ يُطلَب مرّةً: هو للمراجعة لا للمتابعة اللحظيّة.
  const loadAudit = useCallback(async () => {
    try { const d = await getClaimAudit(id); setAudit(d.logs || []); }
    catch { setAudit([]); }
  }, [id]);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  // كلُّ ما يمسّ القسمَ يبثّ هذا الحدث — فالمطالبةُ تُحدَّث وإن عُدِّلت من الجدول.
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!c) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-slate-500">{t('الحادثة غير موجودة', 'Claim not found')}</p>
        <Link href="/system/vehicles/registry/claims" className="text-[#f37121] font-semibold text-sm">
          {t('رجوع إلى الحوادث والمطالبات', 'Back to claims')}
        </Link>
      </div>
    );
  }

  const closed = c.statusCode === 'closed';
  const est = Number(c.claim?.estimatedAmountSar) || 0;
  const rec = Number(c.claim?.expectedRecoverySar) || 0;
  const gap = c.claim?.recoveryGapSar != null ? Number(c.claim.recoveryGapSar) : est - rec;

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

  const Kpi = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
      <p className="text-[11.5px] text-slate-500">{label}</p>
      <p className={`text-[19px] font-extrabold tabular-nums mt-0.5 ${accent}`}>{value}</p>
    </div>
  );

  // الملفُّ يُصدَّر شيتًا مسطَّحًا: خانةٌ في كلّ صفّ — يُلصَق في بريدٍ أو يُطبع.
  const flat = [
    [t('رقم الحادثة', 'Claim no.'), c.claimId],
    [t('موضوع الواقعة', 'Subject'), c.incidentSubjectAr],
    [t('اللوحة', 'Plate'), c.vehiclePlate],
    [t('التاريخ', 'Date'), fmtDate(c.accidentDate)],
    [t('نسبة الخطأ', 'Fault'), c.faultPercent == null ? '' : `${c.faultPercent}%`],
    [t('اسم السائق', 'Driver'), c.driverNameAr],
    [t('رقم إقامة السائق', 'Driver iqama'), c.driverIdNumber],
    [t('نوع السيارة', 'Vehicle type'), c.vehicleTypeAr],
    [t('رقم التقدير', 'Estimate no.'), c.reportOrEstimateNumber],
    [t('الطرف الآخر', 'Counterparty'), c.counterpartyNameAr],
    [t('هوية الطرف الآخر', 'Counterparty ID'), c.counterpartyNationalId],
    [t('مصدر البلاغ', 'Reported via'), c.reportedViaAr],
    [t('رقم نجم', 'Najm no.'), c.accidentNumber],
    [t('رقم التقرير/التقدير', 'Report/estimate no.'), c.reportOrEstimateNumber],
    [t('شركة التأمين', 'Insurer'), c.claim?.insurerAr],
    [t('رقم المطالبة', 'Claim number'), c.claim?.claimNumber],
    [t('المقدَّر', 'Estimated'), est || ''],
    [t('متوقع استرداده', 'Expected recovery'), rec || ''],
    [t('الفارق', 'Gap'), gap || ''],
    [t('الحالة', 'Status'), closed ? t('مقفولة', 'Closed') : t('قيد المتابعة', 'Open')],
    [t('الملاحظات', 'Notes'), c.claim?.notesAr],
    [t('المرفقات', 'Attachments'), (c.attachments || []).length],
  ].map(([k, v]) => ({ field: k, value: v ?? '' }));

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ترويسةٌ داكنةٌ كترويسة ملفّ المركبة — القسمُ يُقرأ بلغةٍ واحدة. */}
      <div className="rounded-2xl bg-slate-900 text-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <TriangleAlert className="w-6 h-6 text-[#f37121]" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[21px] font-extrabold font-mono tracking-tight">{c.claimId}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-bold ${
                  closed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-200'}`}>
                  {closed ? t('مقفولة', 'Closed') : t('قيد المتابعة', 'Open')}
                </span>
              </div>
              <p className="text-white/60 text-[12.5px] mt-0.5">
                {[c.vehiclePlate || c.incidentSubjectAr, fmtDate(c.accidentDate),
                  c.claim?.insurerAr, c.faultPercent != null ? `${t('خطؤنا', 'our fault')} ${c.faultPercent}%` : '']
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu fileName={`claim-${c.claimId}`} lang={ar ? 'ar' : 'en'} variant="subtle"
              label={t('تصدير', 'Export')}
              options={[{
                key: 'file', label: t('ملفّ الحادثة (Excel)', 'Claim file (Excel)'),
                sheets: [{
                  name: 'Claim',
                  rows: flat as unknown as Record<string, any>[],
                  columns: [
                    { header: t('البند', 'Field'), key: 'field', width: 28 },
                    { header: t('القيمة', 'Value'), key: 'value', width: 36 },
                  ],
                }],
              }]} />
            <button type="button" onClick={() => router.push('/system/vehicles/registry/claims')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors">
              <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /> {t('رجوع', 'Back')}
            </button>
          </div>
        </div>
      </div>

      {/* السؤالُ المالي أوّلًا: صرفنا كام وهنسترد كام وكام الفارق. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={t('المقدَّر (ر.س)', 'Estimated (SAR)')} value={money(est)} accent="text-slate-900" />
        <Kpi label={t('متوقع استرداده', 'Expected recovery')} value={money(rec)} accent="text-emerald-700" />
        <Kpi label={t('الفارق علينا', 'Gap on us')} value={money(gap)} accent={gap > 0 ? 'text-red-600' : 'text-slate-900'} />
        <Kpi label={t('المرفقات', 'Attachments')} value={String((c.attachments || []).length)} accent="text-slate-900" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3.5">
        <Section title={t('الواقعة', 'The incident')} icon={<TriangleAlert className="w-4 h-4" />} accent="#dc2626">
          <Row label={t('التاريخ', 'Date')} mono>{val(fmtDate(c.accidentDate))}</Row>
          <Row label={t('موضوع الواقعة', 'Subject')}>{val(c.incidentSubjectAr)}</Row>
          <Row label={t('نسبة الخطأ علينا', 'Our fault')}>{val(c.faultPercent == null ? '' : `${c.faultPercent}%`)}</Row>
          <Row label={t('مصدر البلاغ', 'Reported via')}>{val(c.reportedViaAr)}</Row>
          <Row label={t('رقم نجم', 'Najm no.')} mono>{val(c.accidentNumber)}</Row>
          <Row label={t('رقم التقرير/التقدير', 'Report/estimate no.')} mono>{val(c.reportOrEstimateNumber)}</Row>
        </Section>

        <Section title={t('المركبة', 'Vehicle')} icon={<Car className="w-4 h-4" />} accent="#0891b2"
          href={c.vehicle ? `/system/vehicles/registry/${typeof c.vehicle === 'object' ? c.vehicle._id : c.vehicle}` : undefined}
          hrefLabel={t('ملفّ المركبة', 'Vehicle file')}>
          <Row label={t('اللوحة', 'Plate')} mono>{val(c.vehiclePlate)}</Row>
          <Row label={t('القطاع', 'Sector')}>{val(c.vehicleSectorAr)}</Row>
          <Row label={t('النوع', 'Type')}>{val(c.vehicleTypeAr)}</Row>
          <Row label={t('الفئة', 'Category')}>{val(c.vehicleCategoryAr)}</Row>
          <Row label={t('الماركة', 'Brand')}>{val(c.vehicleBrandAr)}</Row>
          <Row label={t('السجل المالك', 'Owner registration')}>{val(c.ownerRegistrationAr)}</Row>
        </Section>

        {/* ── مَن كان يقود مركبتَنا ─────────────────────────────────────────
            كان هذا الكارتُ للطرف الآخر وحدَه، ولا يقول مَن كان خلف المقود عندنا
            — وهو أوّلُ ما يُسأل عنه: المخالفةُ تُقيَّد عليه، ويُسأل عن روايته،
            وتُراجَع رخصتُه. ويُقترَح من قائد القسم الفعليّ أو من مفوَّض المركبة،
            ويُصحَّح باليد: المفوَّضُ ليس دائمًا الراكب. */}
        <Section title={t('السائق والمركبة', 'Driver & vehicle')} icon={<Users className="w-4 h-4" />} accent="#f37121">
          <Row label={t('اسم السائق', 'Driver name')}>{val(c.driverNameAr)}</Row>
          <Row label={t('رقم الإقامة', 'Iqama number')} mono>{val(c.driverIdNumber)}</Row>
          <Row label={t('نوع السيارة', 'Vehicle type')}>{val(c.vehicleTypeAr || c.vehicle?.registrationTypeAr)}</Row>
          <Row label={t('رقم التقدير', 'Estimate number')} mono>{val(c.reportOrEstimateNumber)}</Row>
        </Section>

        {(!!c.counterpartyNameAr || !!c.counterpartyNationalId || c.faultRatio != null) && (
          <Section title={t('الطرف الآخر', 'Counterparty')} icon={<Users className="w-4 h-4" />} accent={NEUTRAL}>
            <Row label={t('الاسم', 'Name')}>{val(c.counterpartyNameAr)}</Row>
            <Row label={t('رقم الهوية', 'National ID')} mono>{val(c.counterpartyNationalId)}</Row>
            <Row label={t('نسبة الخطأ', 'Fault ratio')}>{val(c.faultRatio)}</Row>
          </Section>
        )}

        <Section title={t('المطالبة', 'The claim')} icon={<Building2 className="w-4 h-4" />} accent="#f37121">
          <Row label={t('شركة التأمين', 'Insurer')}>{val(c.claim?.insurerAr)}</Row>
          <Row label={t('رقم المطالبة', 'Claim number')} mono>{val(c.claim?.claimNumber)}</Row>
          <Row label={t('حالة الرقم', 'Number status')}>{val(c.claim?.claimNumberStatus)}</Row>
          <Row label={t('آخر تحديث من الشركة', 'Last insurer update')} mono>{val(fmtDate(c.claim?.lastInsurerUpdateDate))}</Row>
          <Row label={t('آخر ملاحظة', 'Last note')} mono>{val(fmtDate(c.claim?.lastNoteDate))}</Row>
        </Section>

        <Section title={t('الأرقام', 'The money')} icon={<Banknote className="w-4 h-4" />} accent="#16a34a">
          <Row label={t('المقدَّر', 'Estimated')} mono>{val(est ? `${money(est)} ${t('ر.س', 'SAR')}` : null)}</Row>
          <Row label={t('متوقع استرداده', 'Expected recovery')} mono>{val(rec ? `${money(rec)} ${t('ر.س', 'SAR')}` : null)}</Row>
          <Row label={t('الفارق علينا', 'Gap on us')} mono>{val(gap ? `${money(gap)} ${t('ر.س', 'SAR')}` : null)}</Row>
        </Section>

        {!!c.claim?.notesAr && (
          <Section title={t('ملاحظات', 'Notes')} icon={<FileText className="w-4 h-4" />} accent={NEUTRAL}>
            <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed py-1">{c.claim.notesAr}</p>
          </Section>
        )}
      </div>

      {/* الورقُ الذي تُبنى عليه الأرقام. */}
      <ClaimAttachments claimId={id} attachments={c.attachments || []} canEdit={canEdit}
        onChange={(claim) => setC(claim)} />

      {/* ردودُ الشركة — سجلٌّ يُضاف إليه ولا يُمحى، الأحدثُ أوّلًا. */}
      {!!c.insurerReplies?.length && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <p className="font-extrabold text-slate-900 flex items-center gap-1.5 text-[14.5px]">
              <Building2 className="w-4 h-4 text-slate-400" />{t('ردود شركة التأمين', 'Insurer replies')}
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">
                {c.insurerReplies.length}
              </span>
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {[...c.insurerReplies]
              .sort((a: any, b: any) => new Date(b.at).getTime() - new Date(a.at).getTime())
              .map((rep: any, i: number) => (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-500 mb-1">
                    <span>{fmtDate(rep.at)}{rep.byName ? ` · ${rep.byName}` : ''}</span>
                    {rep.amountSar != null && (
                      <span className="font-bold text-slate-800 tabular-nums">{money(rep.amountSar)} {t('ر.س', 'SAR')}</span>
                    )}
                  </div>
                  <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed">{rep.text}</p>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* ── سجلُّ الملفّ ──────────────────────────────────────────────────────
          من غيّر ماذا ومتى. والمطالبةُ سجلٌّ ماليٌّ يُراجَع، ولم تكن أيُّ كتابةٍ
          فيها تُقيَّد قبل هذا — فالصفوفُ القديمةُ لا سجلَّ لها، وما يُكتب من
          الآن يُقيَّد. */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="font-extrabold text-slate-900 flex items-center gap-1.5 text-[14.5px]">
            <History className="w-4 h-4 text-slate-400" />{t('سجلّ الملفّ', 'File history')}
            {!!audit?.length && (
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{audit.length}</span>
            )}
          </p>
        </div>
        <div className="p-4">
          {audit === null ? (
            <p className="text-[12.5px] text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</p>
          ) : !audit.length ? (
            <p className="text-[12.5px] text-slate-400">
              {t('لا قيود بعد — ما يُعدَّل من الآن يُسجَّل هنا باسم من عدّله ووقته.',
                 'No entries yet — changes from now on are recorded here with who and when.')}
            </p>
          ) : (
            <ol className={`relative ${isRTL ? 'border-r pr-5' : 'border-l pl-5'} border-slate-200 space-y-4`}>
              {audit.map((a: any) => (
                <li key={a._id} className="relative">
                  <span className={`absolute ${isRTL ? '-right-[27px]' : '-left-[27px]'} top-1 w-3 h-3 rounded-full bg-[#f37121]`} />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-slate-900 font-semibold text-[13px]">{auditActionLabel(a.action, lang)}</span>
                    <span className="text-slate-400 text-[11.5px]">
                      {new Date(a.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
                      {a.userName ? ` · ${a.userName}` : ''}
                    </span>
                  </div>
                  {/* ما تغيّر لا المستندُ كلُّه: قائمةُ الخانات تُقرأ، والمستندُ لا. */}
                  {Array.isArray(a.changes?.after) && !!a.changes.after.length && (
                    <p className="text-slate-500 text-[11.5px] mt-0.5">{a.changes.after.slice(0, 10).join('، ')}</p>
                  )}
                  {!Array.isArray(a.changes?.after) && a.changes?.after && typeof a.changes.after === 'object' && (
                    <p className="text-slate-500 text-[11.5px] mt-0.5">
                      {Object.entries(a.changes.after).slice(0, 6)
                        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('، ') : String(v ?? '')}`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
