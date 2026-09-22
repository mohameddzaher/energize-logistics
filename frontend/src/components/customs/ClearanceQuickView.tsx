'use client';
/**
 * نافذةُ المعاملة — كلُّ ما في المعاملة للقراءة، من أيّ شاشةٍ خارجَ التخليص.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * المحاسبُ يقرأ طلبَ صرفٍ فيسأل «أيُّ معاملةٍ هذه؟ كم كلّفت؟ ماذا دُفع منها؟».
 * وكان رقمُ المعاملة رابطًا إلى /system/customs/:id — شاشةِ قسمٍ لا تُفتح له،
 * فيضغط فيُطرَد. والمطلوبُ ليس شاشةَ التخليص بأزرارها ومراحلها القابلة للتعديل:
 * هو أن يرى. فصارت نافذةً فوق شاشته، للقراءة وحدَها، ولا يغادر مكانَه.
 *
 * وهي حيّة: `customs:updated` لهذه المعاملة يعيد قراءتَها وهي مفتوحة — فقرارٌ
 * يتّخذه زميلٌ أو مرفقٌ يضيفه التخليصُ يظهر أمامه في اللحظة.
 */
import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Paperclip, FileText, Ship, Package, Receipt, Wallet, Calendar, Hash, Building2 } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { getCustomsTranslations } from '@/lib/translations';
import { PAY_BADGE } from '@/components/customs/PaymentStages';

const STAGE_ORDER = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];

// مطابقةٌ لبنود شاشة المعاملة (customs/[id]) — الاسمُ نفسُه في المكانين.
const COSTS: [string, string, string][] = [
  ['deliveryOrder', 'قيمة إذن التسليم', 'Delivery order'],
  ['customsDuty', 'الرسوم الجمركية', 'Customs duty'],
  ['portFees', 'أجور الموانى', 'Port fees'],
  ['unloadingFees', 'أجور التفريغ', 'Unloading fees'],
  ['inspection', 'أجور الكشف', 'Inspection'],
  ['transport', 'سعر النقل من المورد', 'Transport — supplier'],
  ['transportToYard', 'النقل إلى الساحة', 'Transport to yard'],
  ['appointmentBooking', 'حجز الموعد', 'Appointment booking'],
  ['storage', 'تخزين', 'Storage'],
  ['yardFees', 'أجور الساحة', 'Yard fees'],
  ['exitPermit', 'تصريح الخروج (الأرضيات)', 'Exit permit (demurrage)'],
  ['demurrage', 'أرضيات', 'Demurrage'],
  ['extension', 'تمديد', 'Extension'],
  ['consolidator', 'الدامج', 'Consolidator'],
  ['commissions', 'عمولات', 'Commissions'],
  ['extraFees', 'أجور إضافية', 'Extra fees'],
  ['returnInvoice', 'فاتورة الإرجاع', 'Return invoice'],
];
const MARGIN: [string, string, string][] = [
  ['clearanceFee', 'أجور التخليص', 'Clearance fee'],
  ['transportSelling', 'سعر النقل للعميل', 'Transport price'],
  ['transportNet', 'صافي النقل', 'Transport net'],
  ['transportToYardNet', 'صافي النقل إلى الساحة', 'Transport-to-yard net'],
  ['yardNet', 'صافي الساحة', 'Yard net'],
  ['storageNet', 'صافي التخزين', 'Storage net'],
  ['securityScan', 'فحص أمني', 'Security scan'],
  ['labour', 'عمال', 'Labour'],
];

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v: any) => num(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.split('-').reverse().join('/');
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-GB');
};

function Fact({ icon: Icon, label, value }: { icon: any; label: string; value?: any }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className="truncate text-[13px] font-semibold text-slate-900" dir="auto">{value || '—'}</p>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, extra }: { title: string; icon: any; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Icon className="h-4 w-4 text-[#f37121]" />
        <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
        {extra ? <div className="ms-auto">{extra}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function ClearanceQuickView({ id, ar, onClose }: { id: string; ar: boolean; onClose: () => void }) {
  const T = getCustomsTranslations(ar ? 'ar' : 'en');
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState('');
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ clearance: any }>(`/api/customs-clearance/${id}`);
      if (!guard.isCurrent(mine)) return;
      setC(d.clearance); setError('');
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || 'Failed');
    }
  }, [id, guard]);

  useEffect(() => { setC(null); load(); }, [load]);
  useSocket('customs:updated', useCallback((p: any) => {
    const pid = String(p?.clearance?._id || p?.id || '');
    if (!pid || pid === id) load();
  }, [id, load]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = (c?.stagesDone || []) as string[];
  const doneCount = STAGE_ORDER.filter((k) => done.includes(k)).length;
  const costs = COSTS.filter(([k]) => num(c?.costs?.[k]) !== 0);
  const margin = MARGIN.filter(([k]) => num(c?.revenue?.[k]) !== 0);
  const stages = [...(c?.paymentStages || [])].sort((a: any, b: any) => String(b.date || b.addedAt || '').localeCompare(String(a.date || a.addedAt || '')));
  const profit = num(c?.revenue?.profit);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-6" onClick={onClose}>
      <div className="my-auto w-full max-w-4xl rounded-3xl bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'}>
        {/* الرأس: الرقمُ والعميلُ والمرحلة — ما يُسأل عنه أوّلًا */}
        <div className="flex items-start gap-3 rounded-t-3xl border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f37121]/15">
            <Ship className="h-5 w-5 text-[#f37121]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-lg font-extrabold text-slate-900">{c?.refNumber || '…'}</h2>
              {c && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  c.cancelled ? 'bg-red-100 text-red-700' : c.isCompleted ? 'bg-emerald-100 text-emerald-700' : c.upcoming ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800'}`}>
                  {c.cancelled ? T.cancelled : c.isCompleted ? (ar ? 'مُقفلة' : 'Closed') : c.upcoming ? (ar ? 'قادمة' : 'Upcoming') : (T.stages[c.stage] || c.stage)}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-slate-600">
              {c?.customerName || '—'}
              {c?.blNumber ? <span className="text-slate-400"> · {ar ? 'بوليصة' : 'BL'} <span className="font-mono">{c.blNumber}</span></span> : null}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!c && !error && (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        )}
        {!c && error && <p className="py-16 text-center text-sm text-red-600">{error}</p>}

        {c && (
          <div className="space-y-4 p-4 sm:p-5">
            {/* المالُ في ثلاثة أرقام */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                [ar ? 'إجمالي المصروفات' : 'Total costs', c.costs?.total, 'text-slate-900', 'bg-white'],
                [ar ? 'إجمالي الفاتورة' : 'Total invoiced', c.revenue?.totalInvoiced, 'text-slate-900', 'bg-white'],
                [ar ? 'صافي الربح' : 'Net profit', profit, profit < 0 ? 'text-red-600' : 'text-emerald-700', profit < 0 ? 'bg-red-50' : 'bg-emerald-50'],
              ].map(([label, v, tone, bg]) => (
                <div key={String(label)} className={`rounded-2xl border border-slate-200 px-4 py-3 ${bg}`}>
                  <p className="text-[11.5px] font-semibold text-slate-500">{label as string}</p>
                  <p className={`mt-1 text-xl font-extrabold tabular-nums ${tone}`}>
                    {money(v)} <span className="text-[11px] font-semibold text-slate-400">{ar ? 'ر.س' : 'SAR'}</span>
                  </p>
                </div>
              ))}
            </div>

            {/* التقدّم */}
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="font-bold text-slate-800">{ar ? 'مراحل المعاملة' : 'Progress'}</span>
                <span className="tabular-nums text-slate-500">{doneCount}/{STAGE_ORDER.length}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(doneCount / STAGE_ORDER.length) * 100}%` }} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {STAGE_ORDER.map((s) => {
                  const isDone = done.includes(s);
                  const isNow = c.stage === s;
                  return (
                    <span key={s} className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
                      isNow ? 'bg-[#f37121] text-white' : isDone ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                      {T.stages[s] || s}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* البيانات */}
            <Section title={ar ? 'بيانات المعاملة' : 'Details'} icon={FileText}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Fact icon={Hash} label={ar ? 'رقم البوليصة' : 'BL number'} value={c.blNumber} />
                <Fact icon={Building2} label={ar ? 'العميل' : 'Customer'} value={c.customerName} />
                <Fact icon={Ship} label={ar ? 'الوكيل الملاحي' : 'Shipping agent'} value={c.shippingAgent} />
                <Fact icon={Building2} label={ar ? 'الميناء / الفرع' : 'Port / branch'} value={[c.port, c.branch === 'dammam' ? T.dammam : T.jeddah].filter(Boolean).join(' · ')} />
                <Fact icon={Package} label={ar ? 'عدد الحاويات' : 'Containers'} value={c.containerCount || (c.containers || []).length || ''} />
                <Fact icon={Calendar} label={ar ? 'الشهر' : 'Period'} value={c.periodYear && c.periodMonth ? `${c.periodYear}-${String(c.periodMonth).padStart(2, '0')}` : ''} />
                <Fact icon={Hash} label={ar ? 'رقم البيان' : 'Declaration no.'} value={[c.declarationNumber, fmtDate(c.declarationDate)].filter(Boolean).join(' · ')} />
                <Fact icon={Hash} label={ar ? 'رقم إذن التسليم' : 'DO number'} value={c.doNumber} />
                <Fact icon={Calendar} label={ar ? 'استلام الأوراق' : 'Papers received'} value={fmtDate(c.papersReceivedDate)} />
                <Fact icon={Calendar} label={ar ? 'موعد التفريغ' : 'Unloading'} value={[fmtDate(c.unloadingAppointment), c.unloadingLocation].filter(Boolean).join(' · ')} />
                <Fact icon={Hash} label={ar ? 'تصريح الخروج' : 'Exit permit'} value={c.exitPermitNumber} />
                <Fact icon={Calendar} label={ar ? 'آخر موعد للإرجاع' : 'Return deadline'} value={fmtDate(c.returnDeadline)} />
                <Fact icon={Receipt} label={ar ? 'الفوترة' : 'Invoicing'} value={[c.billing?.invoiceStatus, c.billing?.ourInvoiceNumber].filter(Boolean).join(' · ')} />
                <Fact icon={Building2} label={ar ? 'المخلّص' : 'Assigned to'} value={c.assignedTo} />
              </div>
            </Section>

            {/* المال بالتفصيل */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title={ar ? 'المصروفات' : 'Costs'} icon={Receipt}
                extra={<span className="text-[12px] font-bold tabular-nums text-slate-700">{money(c.costs?.total)}</span>}>
                {costs.length ? (
                  <dl className="divide-y divide-slate-100 text-[13px]">
                    {costs.map(([k, a, e]) => (
                      <div key={k} className="flex items-center justify-between py-1.5">
                        <dt className="text-slate-600">{ar ? a : e}</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">{money(c.costs?.[k])}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="text-[12px] text-slate-400">{ar ? 'لا مصروفات مسجّلة.' : 'No costs recorded.'}</p>}
              </Section>
              <Section title={ar ? 'الإيراد والهامش' : 'Revenue & margin'} icon={Wallet}
                extra={<span className={`text-[12px] font-bold tabular-nums ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(profit)}</span>}>
                {margin.length ? (
                  <dl className="divide-y divide-slate-100 text-[13px]">
                    {margin.map(([k, a, e]) => (
                      <div key={k} className="flex items-center justify-between py-1.5">
                        <dt className="text-slate-600">{ar ? a : e}</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">{money(c.revenue?.[k])}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="text-[12px] text-slate-400">{ar ? 'لا إيراد مسجّل.' : 'No revenue recorded.'}</p>}
              </Section>
            </div>

            {/* مراحلُ السداد وطلباتُ الصرف */}
            <Section title={ar ? 'مراحل السداد وطلبات الصرف' : 'Payment stages & requests'} icon={Wallet}
              extra={<span className="text-[11px] text-slate-400">{stages.length}</span>}>
              {stages.length ? (
                <ul className="space-y-2">
                  {stages.map((s: any) => {
                    const st = (s.payStatus || 'pending') as keyof typeof PAY_BADGE;
                    const badge = PAY_BADGE[st] || PAY_BADGE.pending;
                    return (
                      <li key={s._id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-slate-900">{s.label || s.key}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${badge.cls}`}>{ar ? badge.ar : badge.en}</span>
                          <span className="ms-auto text-[12px] tabular-nums text-slate-500">{fmtDate(s.date) || fmtDate(s.addedAt)}</span>
                          {s.amount != null && <span className="text-[13px] font-bold tabular-nums text-slate-900">{money(s.amount)}</span>}
                        </div>
                        {(s.note || s.decisionNote || s.fileUrl || (s.proofFiles || []).length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                            {s.note ? <span className="text-slate-500">{s.note}</span> : null}
                            {s.decisionNote ? <span className="text-slate-600">— {s.decisionNote}</span> : null}
                            {s.fileUrl ? (
                              <a href={s.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                                <Paperclip className="h-3 w-3" />{s.fileName || (ar ? 'المرفق' : 'file')}
                              </a>
                            ) : null}
                            {(s.proofFiles || []).map((f: any, i: number) => (
                              <a key={i} href={f.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline">
                                <Paperclip className="h-3 w-3" />{f.fileName || (ar ? 'إثبات الدفع' : 'proof')}
                              </a>
                            ))}
                          </div>
                        )}
                        {(s.addedByName || s.decidedByName) && (
                          <p className="mt-1 text-[10.5px] text-slate-400">
                            {s.addedByName ? `${ar ? 'طلبها' : 'by'} ${s.addedByName}` : ''}
                            {s.decidedByName ? ` · ${ar ? 'ردّ' : 'decided by'} ${s.decidedByName}${s.decidedAt ? ` ${fmtDate(s.decidedAt)}` : ''}` : ''}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[12px] text-slate-400">{ar ? 'لا مراحل سداد بعد.' : 'No payment stages yet.'}</p>}
            </Section>

            {/* الحاويات والمرفقات */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title={ar ? 'الحاويات' : 'Containers'} icon={Package}
                extra={<span className="text-[11px] text-slate-400">{(c.containers || []).length}</span>}>
                {(c.containers || []).length ? (
                  <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                    {c.containers.map((k: any, i: number) => (
                      <span key={k._id || i} className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-[11.5px] text-slate-700">{k.containerNumber || '—'}</span>
                    ))}
                  </div>
                ) : <p className="text-[12px] text-slate-400">{ar ? 'لا حاويات مسجّلة.' : 'No containers.'}</p>}
              </Section>
              <Section title={ar ? 'المرفقات' : 'Attachments'} icon={Paperclip}
                extra={<span className="text-[11px] text-slate-400">{(c.attachments || []).length}</span>}>
                {(c.attachments || []).length ? (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {c.attachments.map((a: any, i: number) => (
                      <li key={a._id || i}>
                        <a href={a.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-slate-50">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate font-semibold text-blue-600">{a.title || a.fileName || (ar ? 'مرفق' : 'file')}</span>
                          <span className="ms-auto shrink-0 text-[11px] text-slate-400">{fmtDate(a.uploadedAt)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-[12px] text-slate-400">{ar ? 'لا مرفقات.' : 'No attachments.'}</p>}
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
