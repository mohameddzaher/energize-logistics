'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { ArrowLeft, ArrowRight, Check, Loader2, Ship, Copy, Mail, Ban, RotateCcw, ChevronRight, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import ExportMenu, { type ExportColumn, type ExportSheet } from '@/components/ls2/ExportMenu';
import { getCustomsTranslations, getCustomsIdExtraTranslations } from '@/lib/translations';
import ClearanceAttachments from '@/components/customs/ClearanceAttachments';

const STAGE_ORDER = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];

export default function CustomsDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'].includes(user?.role || '') || canEditSection((user as any)?.permissions, 'Customs'); // matrix edit grants count too
  const { lang, isRTL } = useLanguage();
  const T = getCustomsTranslations(lang);
  const txx = getCustomsIdExtraTranslations(lang);

  const [c, setC] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');

  const canDelete = ['super_admin', 'admin', 'customs_manager'].includes(user?.role || '');

  const removeClearance = async () => {
    if (!window.confirm(lang === 'ar'
      ? `حذف المعاملة ${c?.refNumber || ''} نهائيًّا؟ تُحذف معها مراحلُها ومستنداتُها. ولو كانت ملغاةً فحسب فالأصحّ تركُها ملغاة.`
      : `Permanently delete clearance ${c?.refNumber || ''}? Its stages and documents go with it. If it was merely cancelled, leave it cancelled.`)) return;
    try { await api.delete(`/api/customs-clearance/${params?.id}`); router.push('/system/customs'); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const fetchOne = useCallback(async () => {
    try {
      const data = await api.get<any>(`/api/customs-clearance/${params.id}`);
      setC(data.clearance);
    } catch {
      router.push('/system/customs');
    }
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => { fetchOne(); }, [fetchOne]);
  useSocket('customs:updated', useCallback((d: any) => { if (d?.clearance?._id === params.id) setC(d.clearance); }, [params.id]));

  // Persist a partial change immediately (gives the "automatic / instant" feel).
  const patch = async (partial: any) => {
    if (!canEdit || !c) return;
    setSaving(true);
    const optimistic = {
      ...c, ...partial,
      documents: { ...c.documents, ...(partial.documents || {}) },
      agentPapers: { ...c.agentPapers, ...(partial.agentPapers || {}) },
      stageDates: { ...c.stageDates, ...(partial.stageDates || {}) },
      stageDone: { ...c.stageDone, ...(partial.stageDone || {}) },
      costs: { ...c.costs, ...(partial.costs || {}) },
      revenue: { ...c.revenue, ...(partial.revenue || {}) },
      billing: { ...c.billing, ...(partial.billing || {}) },
    };
    setC(optimistic);
    try {
      const data = await api.put<any>(`/api/customs-clearance/${c._id}`, optimistic);
      if (data?.clearance) setC(data.clearance);
    } catch (e: any) {
      // The page saves silently as you type — a silent revert here means the
      // user walks away believing a value stuck when it didn't. Say it loudly.
      notify(e?.message || (lang === 'ar' ? 'لم يتم الحفظ — رجعنا القيمة السابقة' : 'Not saved — the previous value was restored'), 'error');
      fetchOne();
    }
    setSaving(false);
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1400);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!c) return null;

  const currentIdx = STAGE_ORDER.indexOf(c.stage);
  const bl = c.blNumber || '';
  const emails = {
    doInvoiceRequest: { subject: `BL ${bl}`, body: 'Dear,\nGreetings,\n\nKindly find attached file & issue DO invoice.' },
    linkDoRequest: { subject: `BL ${bl}`, body: 'Dear,\nGreetings,\n\nKindly find attached files & link DO.' },
    etaEnquiry: { subject: 'ETA enquiry', body: `Dear,\nGreetings,\n\nKindly Provide ETA for the following BL/s:\n1- ${bl}` },
  };
  const mailto = (s: string, b: string) =>
    `mailto:${c.shippingAgentEmail || ''}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`;

  const Back = isRTL ? ArrowRight : ArrowLeft;
  const ar = lang === 'ar';

  // --- master-spreadsheet field groups -------------------------------------
  const STAGE_DATE_FIELDS: [string, string, string][] = [
    ['doInvoiceEmailed', 'ميل فاتورة إذن التسليم', 'DO invoice emailed'],
    ['doInvoicePaid', 'سداد فاتورة إذن التسليم', 'DO invoice paid'],
    ['doLinkEmailed', 'ميل ربط إذن التسليم', 'DO link emailed'],
    ['dutyPaid', 'سداد الرسوم الجمركية', 'Customs duty paid'],
    ['portFeesPaid', 'سداد الموانى', 'Port fees paid'],
    ['unloadingFeesPaid', 'سداد التفريغ', 'Unloading fees paid'],
    ['containersReturned', 'الإرجاع', 'Containers returned'],
    ['returnInvoiceDate', 'فاتورة الإرجاع', 'Return invoice'],
  ];
  // ── التكاليف: مبالغُ تُدفع للغير وتُمرَّر على العميل كما هي ──────────────
  // مجموعُها هو «اجمالى المصروفات» في الماستر حرفًا بحرف — لا يُزاد عليه بندٌ
  // من بنود الهامش ولا يُنقص منه، وإلّا اختلف رقمُ الشاشة عن رقم المحاسبة.
  const COST_FIELDS: [string, string, string][] = [
    ['deliveryOrder', 'قيمة إذن التسليم', 'Delivery order'],
    ['customsDuty', 'الرسوم الجمركية', 'Customs duty'],
    ['portFees', 'أجور الموانى', 'Port fees'],
    ['unloadingFees', 'أجور التفريغ', 'Unloading fees'],
    ['inspection', 'أجور الكشف', 'Inspection'],
    ['transport', 'أجور النقل (بالضريبة)', 'Transport (incl. VAT)'],
    ['transportToYard', 'النقل إلى الساحة', 'Transport to yard'],
    ['appointmentBooking', 'حجز الموعد', 'Appointment booking'],
    ['storage', 'تخزين', 'Storage'],
    ['yardFees', 'أجور الساحة', 'Yard fees'],
    ['exitPermit', 'تصريح الخروج', 'Exit permit'],
    ['demurrage', 'أرضيات', 'Demurrage'],
    ['extension', 'تمديد', 'Extension'],
    ['consolidator', 'الدامج', 'Consolidator'],
    ['commissions', 'عمولات', 'Commissions'],
    ['returnInvoice', 'فاتورة الإرجاع', 'Return invoice'],
  ];
  // ── الهامش: ما يُضاف فوق المصروفات، ومجموعُه هو الربح ────────────────────
  const MARGIN_FIELDS: [string, string, string][] = [
    ['clearanceFee', 'أجور التخليص', 'Clearance fee'],
    ['transportNet', 'صافي النقل', 'Transport net'],
    ['transportToYardNet', 'صافي النقل إلى الساحة', 'Transport-to-yard net'],
    ['yardNet', 'صافي الساحة', 'Yard net'],
    ['storageNet', 'صافي التخزين', 'Storage net'],
    ['securityScan', 'فحص أمنى', 'Security scan'],
    ['labour', 'عمال', 'Labour'],
  ];
  // بنودٌ تُسجَّل ولا تدخل الجمع: سعرُ بيع النقل إجماليٌّ صافيه محسوبٌ أعلاه،
  // وصافي نقل الساحة عمودٌ مساعدٌ خارج صيغة الربح في الماستر.
  const REVENUE_EXTRA: [string, string, string][] = [
    ['transportSelling', 'سعر بيع النقل', 'Transport selling price'],
    ['yardTransportNet', 'صافي نقل الساحة', 'Yard transport net'],
  ];
  const REVENUE_FIELDS: [string, string, string][] = [...MARGIN_FIELDS, ...REVENUE_EXTRA];

  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const costsTotal = Math.round(COST_FIELDS.reduce((a, [k]) => a + n(c.costs?.[k]), 0) * 100) / 100;
  const profit = Math.round(MARGIN_FIELDS.reduce((a, [k]) => a + n(c.revenue?.[k]), 0) * 100) / 100;
  const invoiced = Math.round((costsTotal + profit) * 100) / 100;
  const margin = invoiced ? (profit / invoiced) * 100 : 0;
  const sar = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

  const containers: any[] = Array.isArray(c.containers) ? c.containers : [];
  const setContainers = (rows: any[]) => patch({ containers: rows });
  const updateContainer = (i: number, key: string, v: any) =>
    setContainers(containers.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));

  // ---- Excel: شيتٌ لكل بطاقةٍ على الشاشة ----------------------------------
  // بطاقات هذه الصفحة ليست جدولًا واحدًا: بيانات ومراحل ومصروفات وإيرادات
  // وحاويات. دمجُها في شيتٍ واحد يخلط المصروف بالإيراد في عمودٍ واحد، فيصير
  // مجموع الملفّ بلا معنى — ولذلك مصنّفٌ متعدّد الشيتات.
  const kvCols: ExportColumn[] = [
    { header: ar ? 'البند' : 'Field', key: 'label', width: 32 },
    { header: ar ? 'القيمة' : 'Value', key: 'value', width: 40 },
  ];
  const kv = (label: string, value: any) => ({ label, value: value === null || value === undefined || value === '' ? '—' : value });

  const infoSheet: ExportSheet = {
    name: ar ? 'بيانات المعاملة' : 'Transaction',
    columns: kvCols,
    rows: [
      kv(ar ? 'الرقم المرجعي' : 'Reference', c.refNumber),
      kv(T.blNumber, c.blNumber), kv(T.customerName, c.customerName),
      kv(T.invoiceNumber, c.invoiceNumber), kv(T.invoiceDate, c.invoiceDate ? String(c.invoiceDate).slice(0, 10) : ''),
      kv(T.port, c.port), kv(T.invoiceType, c.invoiceType),
      kv(T.containerCount, c.containerCount), kv(T.totalWeight, c.totalWeight),
      kv(T.invoiceValue, c.invoiceValue), kv(T.currency, c.currency),
      kv(T.exporterCompany, c.exporterCompany), kv(T.countryOfOrigin, c.countryOfOrigin),
      kv(T.hsCode, c.hsCode), kv(T.saberNumber, c.saberNumber), kv(T.assignedTo, c.assignedTo),
      kv(T.branch, c.branch === 'dammam' ? T.dammam : T.jeddah),
      kv(T.shippingAgent, c.shippingAgent), kv(T.shippingAgentEmail, c.shippingAgentEmail),
      kv(ar ? 'المرحلة الحالية' : 'Current stage', c.cancelled ? T.cancelled : (T.stages[c.stage] || c.stage)),
      kv(ar ? 'رقم البيان' : 'Declaration no.', c.declarationNumber),
      kv(ar ? 'تاريخ البيان' : 'Declaration date', c.declarationDate),
      kv(ar ? 'تاريخ استلام الورق' : 'Papers received', c.papersReceivedDate),
      kv(ar ? 'موعد التفريغ' : 'Unloading appointment', c.unloadingAppointment),
      kv(ar ? 'مكان التفريغ' : 'Unloading location', c.unloadingLocation),
      kv(ar ? 'رقم إذن التسليم' : 'DO number', c.doNumber),
      kv(ar ? 'رقم تصريح الخروج' : 'Exit permit no.', c.exitPermitNumber),
      kv(ar ? 'المدينة' : 'City', c.city),
      kv(ar ? 'الشهر' : 'Month', c.periodMonth ? MONTH_LABELS[Number(c.periodMonth) - 1][ar ? 0 : 1] : ''),
      kv(ar ? 'السنة' : 'Year', c.periodYear),
      kv(T.notes, c.notes),
    ],
  };

  const pipelineSheet: ExportSheet = {
    name: ar ? 'مراحل التخليص' : 'Pipeline',
    columns: [
      { header: '#', key: 'index', width: 6 },
      { header: ar ? 'المرحلة' : 'Stage', key: 'stage', width: 30 },
      { header: ar ? 'الحالة' : 'State', key: 'state', width: 18 },
    ],
    rows: STAGE_ORDER.map((sKey, i) => ({
      index: i + 1,
      stage: T.stages[sKey] || sKey,
      state: i < currentIdx ? (ar ? 'مكتملة' : 'Done')
        : (i === currentIdx && !c.cancelled) ? (ar ? 'المرحلة الحالية' : 'Current')
          : (ar ? 'لم تبدأ' : 'Not started'),
    })),
  };

  const tick = (v: any) => (v ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No'));
  const checklistCols: ExportColumn[] = [
    { header: ar ? 'المستند' : 'Item', key: 'label', width: 34 },
    { header: ar ? 'متوفر' : 'Present', key: 'done', width: 12 },
  ];
  const documentsSheet: ExportSheet = {
    name: ar ? 'مستندات المعاملة' : 'Documents',
    columns: checklistCols,
    rows: [
      { label: T.docBl, done: tick(c.documents?.bl) },
      { label: T.docCommercialInvoice, done: tick(c.documents?.commercialInvoice) },
      { label: T.docCertificateOfOrigin, done: tick(c.documents?.certificateOfOrigin) },
      { label: T.docPackingList, done: tick(c.documents?.packingList) },
      { label: T.docSaber, done: tick(c.documents?.saber) },
    ],
  };
  const agentPapersSheet: ExportSheet = {
    name: ar ? 'أوراق المخلّص' : 'Agent papers',
    columns: checklistCols,
    rows: [
      { label: T.paperBlStamped, done: tick(c.agentPapers?.blStamped) },
      { label: T.paperCustomerAuth, done: tick(c.agentPapers?.customerAuthorization) },
      { label: T.paperCompanyAuth, done: tick(c.agentPapers?.companyAuthorization) },
    ],
  };

  const milestonesSheet: ExportSheet = {
    name: ar ? 'مراحل السداد' : 'Payments',
    columns: [
      { header: ar ? 'البند' : 'Milestone', key: 'label', width: 32 },
      { header: ar ? 'تم' : 'Done', key: 'done', width: 10 },
      { header: ar ? 'التاريخ' : 'Date', key: 'date', width: 16 },
    ],
    rows: STAGE_DATE_FIELDS.map(([key, arLabel, enLabel]) => ({
      label: ar ? arLabel : enLabel,
      done: tick(c.stageDone?.[key]),
      date: c.stageDates?.[key] || '—',
    })),
  };

  const amountCols: ExportColumn[] = [
    { header: ar ? 'البند' : 'Item', key: 'label', width: 32 },
    { header: ar ? 'المبلغ (ر.س)' : 'Amount (SAR)', key: 'amount', width: 16 },
  ];
  // صفّ الإجمالي جزءٌ من البطاقة على الشاشة، وحذفه من الملفّ يجعل القارئ يجمع
  // بنفسه فيختلف رقمه عن الرقم الذي تعرضه الصفحة.
  const costsSheet: ExportSheet = {
    name: ar ? 'التكاليف' : 'Costs',
    columns: amountCols,
    rows: [
      ...COST_FIELDS.map(([key, arLabel, enLabel]) => ({ label: ar ? arLabel : enLabel, amount: n(c.costs?.[key]) })),
      { label: ar ? 'إجمالي المصروفات' : 'Total costs', amount: costsTotal },
    ],
  };
  const revenueSheet: ExportSheet = {
    name: ar ? 'الإيرادات والفوترة' : 'Revenue',
    columns: amountCols,
    rows: [
      ...REVENUE_FIELDS.map(([key, arLabel, enLabel]) => ({ label: ar ? arLabel : enLabel, amount: n(c.revenue?.[key]) })),
      { label: ar ? 'إجمالي الفاتورة' : 'Total invoiced', amount: invoiced },
      { label: ar ? 'حالة الفاتورة' : 'Invoice status', amount: c.billing?.invoiceStatus || '—' },
      { label: ar ? 'رقم فاتورتنا' : 'Our invoice no.', amount: c.billing?.ourInvoiceNumber || '—' },
      { label: ar ? 'تاريخ الفوترة' : 'Invoiced at', amount: c.billing?.invoicedAt || '—' },
      { label: ar ? 'صافي الربح' : 'Net profit', amount: profit },
      { label: ar ? 'هامش الربح %' : 'Margin %', amount: Math.round(margin * 10) / 10 },
    ],
  };

  const containersSheet: ExportSheet = {
    name: ar ? 'الحاويات' : 'Containers',
    columns: [
      { header: ar ? 'رقم الحاوية' : 'Container no.', key: 'containerNumber', width: 20 },
      { header: ar ? 'تصريح الخروج' : 'Exit permit', key: 'exitPermit', width: 16 },
      { header: ar ? 'البيان' : 'Declaration', key: 'declaration', width: 18 },
      { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 34 },
    ],
    rows: containers,
  };

  const attachmentsSheet: ExportSheet = {
    name: ar ? 'المرفقات' : 'Attachments',
    columns: [
      { header: ar ? 'الاسم' : 'Title', key: 'title', width: 34 },
      { header: ar ? 'المرحلة' : 'Stage', key: 'stage', width: 26 },
      { header: ar ? 'رفعه' : 'Uploaded by', key: 'by', width: 22 },
      { header: ar ? 'التاريخ' : 'Date', key: 'at', width: 16 },
    ],
    rows: (c.attachments || []).map((a: any) => ({
      title: a.title || a.fileName || '—',
      stage: a.stage ? (T.stages[a.stage] || a.stage) : (ar ? 'عامّ' : 'General'),
      by: a.uploadedByName || '—',
      at: a.uploadedAt ? String(a.uploadedAt).slice(0, 10) : '—',
    })),
  };

  const exportSheets: ExportSheet[] = [
    infoSheet, pipelineSheet, documentsSheet, agentPapersSheet, attachmentsSheet,
    milestonesSheet, costsSheet, revenueSheet,
    // جدول الحاويات لا يُرسَم أصلًا إن لم تُسجَّل حاوية، فشيتٌ فارغٌ باسمه
    // يوحي بحاوياتٍ ضاعت من الملفّ لا بمعاملةٍ بلا حاويات.
    ...(containers.length ? [containersSheet] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/system/customs" className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"><Back className="w-4 h-4" /></Link>
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center"><Ship className="w-5 h-5 text-[#f37121]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{c.refNumber}</h1>
            <p className="text-slate-500 text-sm">{c.branch === 'dammam' ? T.dammam : T.jeddah} · {c.cancelled ? T.cancelled : (T.stages[c.stage] || c.stage)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-slate-400 text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /></span>}
          <ExportMenu fileName={`customs-${c.refNumber || c.blNumber || c._id}`} lang={lang as 'ar' | 'en'}
            options={[{ key: 'full', label: ar ? 'ملف المعاملة كاملًا' : 'The whole clearance', sheets: exportSheets }]} />
          {canEdit && (
            c.cancelled
              ? <button type="button" onClick={() => patch({ cancelled: false })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/15 text-green-600 text-sm font-medium hover:bg-green-500/25 transition-colors"><RotateCcw className="w-4 h-4" /> {T.reactivate}</button>
              : <button type="button" onClick={() => patch({ cancelled: true })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 text-red-600 text-sm font-medium hover:bg-red-500/25 transition-colors"><Ban className="w-4 h-4" /> {T.markCancelled}</button>
          )}
          {/* الإلغاء واقعةٌ تبقى في السجلّ؛ والحذف لمعاملةٍ أُدخلت خطأً أو
              مكرَّرة، ولا معنى لبقائها «ملغاة» تُحسب في العدّ. وهو للمدير
              وحده — مع تفاصيلها كلّها. */}
          {canDelete && (
            <button type="button" onClick={removeClearance} title={ar ? 'حذف المعاملة' : 'Delete clearance'}
              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stage pipeline (dark card on the light page) */}
      <div className="relative overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">{T.progress}</h3>
          {canEdit && currentIdx < STAGE_ORDER.length - 1 && !c.cancelled && (
            <button type="button" onClick={() => patch({ stage: STAGE_ORDER[currentIdx + 1] })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-xs font-medium hover:bg-[#e06010] transition-colors">
              {T.advanceStage} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {STAGE_ORDER.map((s, i) => {
            const done = i < currentIdx;
            const cur = i === currentIdx && !c.cancelled;
            return (
              <button key={s} type="button" disabled={!canEdit} onClick={() => patch({ stage: s })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-start transition-colors ${canEdit ? 'cursor-pointer' : 'cursor-default'} ${
                  cur ? 'bg-[#f37121] text-white' : done ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800'
                }`}>
                <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${cur ? 'bg-white/20' : done ? 'bg-green-500/30 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                  {done ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="truncate">{T.stages[s]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transaction data */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.transactionData}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldInput label={T.blNumber} value={c.blNumber} onSave={(v) => patch({ blNumber: v })} disabled={!canEdit} />
            <FieldInput label={T.customerName} value={c.customerName} onSave={(v) => patch({ customerName: v })} disabled={!canEdit} />
            <FieldInput label={T.invoiceNumber} value={c.invoiceNumber} onSave={(v) => patch({ invoiceNumber: v })} disabled={!canEdit} />
            <FieldInput label={T.invoiceDate} type="date" value={c.invoiceDate ? String(c.invoiceDate).slice(0, 10) : ''} onSave={(v) => patch({ invoiceDate: v || null })} disabled={!canEdit} />
            <FieldInput label={T.port} value={c.port} onSave={(v) => patch({ port: v })} disabled={!canEdit} />
            <FieldSelect label={T.invoiceType} value={c.invoiceType || ''} options={[['', '—'], ['C&F', 'C&F'], ['CIF', 'CIF'], ['FOB', 'FOB']]} onSave={(v) => patch({ invoiceType: v })} disabled={!canEdit} />
            <FieldInput label={T.containerCount} type="number" value={c.containerCount} onSave={(v) => patch({ containerCount: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={T.totalWeight} type="number" value={c.totalWeight} onSave={(v) => patch({ totalWeight: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={T.invoiceValue} type="number" value={c.invoiceValue} onSave={(v) => patch({ invoiceValue: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={T.currency} value={c.currency} onSave={(v) => patch({ currency: v })} disabled={!canEdit} />
            <FieldInput label={T.exporterCompany} value={c.exporterCompany} onSave={(v) => patch({ exporterCompany: v })} disabled={!canEdit} />
            <FieldInput label={T.countryOfOrigin} value={c.countryOfOrigin} onSave={(v) => patch({ countryOfOrigin: v })} disabled={!canEdit} />
            <FieldInput label={T.hsCode} value={c.hsCode} onSave={(v) => patch({ hsCode: v })} disabled={!canEdit} />
            <FieldInput label={T.saberNumber} value={c.saberNumber} onSave={(v) => patch({ saberNumber: v })} disabled={!canEdit} />
            <FieldInput label={T.assignedTo} value={c.assignedTo} onSave={(v) => patch({ assignedTo: v })} disabled={!canEdit} />
            <FieldSelect label={T.branch} value={c.branch} options={[['jeddah', T.jeddah], ['dammam', T.dammam]]} onSave={(v) => patch({ branch: v })} disabled={!canEdit} />
            <FieldInput label={T.shippingAgent} value={c.shippingAgent} onSave={(v) => patch({ shippingAgent: v })} disabled={!canEdit} />
            <FieldInput label={T.shippingAgentEmail} value={c.shippingAgentEmail} onSave={(v) => patch({ shippingAgentEmail: v })} disabled={!canEdit} />
          </div>
          <div className="mt-4">
            <FieldInput label={T.notes} value={c.notes} onSave={(v) => patch({ notes: v })} disabled={!canEdit} />
          </div>
        </div>

        {/* Side column: checklists + emails */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.documentsChecklist}</h3>
            <div className="space-y-1">
              <Toggle label={T.docBl} on={c.documents?.bl} onToggle={(v) => patch({ documents: { bl: v } })} disabled={!canEdit} />
              <Toggle label={T.docCommercialInvoice} on={c.documents?.commercialInvoice} onToggle={(v) => patch({ documents: { commercialInvoice: v } })} disabled={!canEdit} />
              <Toggle label={T.docCertificateOfOrigin} on={c.documents?.certificateOfOrigin} onToggle={(v) => patch({ documents: { certificateOfOrigin: v } })} disabled={!canEdit} />
              <Toggle label={T.docPackingList} on={c.documents?.packingList} onToggle={(v) => patch({ documents: { packingList: v } })} disabled={!canEdit} />
              <Toggle label={T.docSaber} on={c.documents?.saber} onToggle={(v) => patch({ documents: { saber: v } })} disabled={!canEdit} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.agentPapersChecklist}</h3>
            <div className="space-y-1">
              <Toggle label={T.paperBlStamped} on={c.agentPapers?.blStamped} onToggle={(v) => patch({ agentPapers: { blStamped: v } })} disabled={!canEdit} />
              <Toggle label={T.paperCustomerAuth} on={c.agentPapers?.customerAuthorization} onToggle={(v) => patch({ agentPapers: { customerAuthorization: v } })} disabled={!canEdit} />
              <Toggle label={T.paperCompanyAuth} on={c.agentPapers?.companyAuthorization} onToggle={(v) => patch({ agentPapers: { companyAuthorization: v } })} disabled={!canEdit} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.emailTemplates}</h3>
            <div className="space-y-3">
              {([['doInvoiceRequest', T.doInvoiceRequest], ['linkDoRequest', T.linkDoRequest], ['etaEnquiry', T.etaEnquiry]] as const).map(([key, label]) => {
                const e = emails[key];
                const full = `${txx.subjectLabel} ${e.subject}\n\n${e.body}`;
                return (
                  <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-900 text-sm font-medium mb-1">{label}</p>
                    <pre className="text-slate-600 text-xs whitespace-pre-wrap font-sans mb-2">{e.body}</pre>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => copy(key, full)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors">
                        <Copy className="w-3.5 h-3.5" /> {copied === key ? T.copied : T.copyText}
                      </button>
                      <a href={mailto(e.subject, e.body)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] text-white text-xs hover:bg-[#e06010] transition-colors">
                        <Mail className="w-3.5 h-3.5" /> {T.openEmail}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Master-spreadsheet data (بيانات ماستر التخليص)                      */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Declaration & scheduling */}
        <Card title={ar ? 'بيانات البيان والمواعيد' : 'Declaration & scheduling'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldInput label={ar ? 'رقم البيان' : 'Declaration no.'} value={c.declarationNumber} onSave={(v) => patch({ declarationNumber: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'تاريخ البيان' : 'Declaration date'} type="date" value={c.declarationDate} onSave={(v) => patch({ declarationDate: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'تاريخ استلام الورق' : 'Papers received'} type="date" value={c.papersReceivedDate} onSave={(v) => patch({ papersReceivedDate: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'موعد التفريغ' : 'Unloading appointment'} value={c.unloadingAppointment} onSave={(v) => patch({ unloadingAppointment: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'مكان التفريغ' : 'Unloading location'} value={c.unloadingLocation} onSave={(v) => patch({ unloadingLocation: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'رقم إذن التسليم' : 'DO number'} value={c.doNumber} onSave={(v) => patch({ doNumber: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'رقم تصريح الخروج' : 'Exit permit no.'} value={c.exitPermitNumber} onSave={(v) => patch({ exitPermitNumber: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'أيّام السماح للإرجاع' : 'Return free days'} type="number" value={c.returnFreeDays ?? 0} onSave={(v) => patch({ returnFreeDays: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={ar ? 'آخر موعد إرجاع' : 'Return deadline'} type="date" value={c.returnDeadline} onSave={(v) => patch({ returnDeadline: v })} disabled={!canEdit} />
            <FieldInput label={ar ? 'المدينة' : 'City'} value={c.city} onSave={(v) => patch({ city: v })} disabled={!canEdit} />
            <FieldSelect label={ar ? 'الشهر' : 'Month'} value={String(c.periodMonth || '')} disabled={!canEdit}
              options={[['', '—'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), MONTH_LABELS[i][ar ? 0 : 1]] as [string, string])]}
              onSave={(v) => patch({ periodMonth: v ? Number(v) : null })} />
            <FieldInput label={ar ? 'السنة' : 'Year'} type="number" value={c.periodYear} onSave={(v) => patch({ periodYear: v ? Number(v) : null })} disabled={!canEdit} />
          </div>
        </Card>

        {/* Payment milestones */}
        <Card title={ar ? 'مراحل السداد' : 'Payment milestones'}>
          <p className="text-slate-500 text-xs mb-3">
            {ar ? 'علّم على المرحلة عند إتمامها، وأضف التاريخ إن كان معروفاً.' : 'Tick a milestone when done; add the date if known.'}
          </p>
          <div className="space-y-2">
            {STAGE_DATE_FIELDS.map(([key, arLabel, enLabel]) => (
              <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <button type="button" disabled={!canEdit} onClick={() => patch({ stageDone: { [key]: !c.stageDone?.[key] } })}
                  className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${c.stageDone?.[key] ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'} ${canEdit ? '' : 'cursor-default'}`}
                  aria-label={ar ? arLabel : enLabel}>
                  {c.stageDone?.[key] && <Check className="w-3.5 h-3.5" />}
                </button>
                <span className="flex-1 text-sm text-slate-700 truncate">{ar ? arLabel : enLabel}</span>
                <input type="date" disabled={!canEdit} value={c.stageDates?.[key] || ''}
                  onChange={(e) => patch({ stageDates: { [key]: e.target.value }, stageDone: e.target.value ? { [key]: true } : {} })}
                  className="w-[9.5rem] px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60 [color-scheme:light]" />
              </div>
            ))}
          </div>
        </Card>

        {/* Costs */}
        <Card title={ar ? 'التكاليف' : 'Costs'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {COST_FIELDS.map(([key, arLabel, enLabel]) => (
              <FieldInput key={key} label={ar ? arLabel : enLabel} type="number" value={c.costs?.[key] ?? 0}
                onSave={(v) => patch({ costs: { [key]: Number(v) || 0 } })} disabled={!canEdit} />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3">
            <span className="text-slate-300 text-sm">{ar ? 'إجمالي المصروفات' : 'Total costs'}</span>
            <span className="text-white font-bold text-lg">{sar(costsTotal)} <span className="text-slate-400 text-xs font-normal">{ar ? 'ر.س' : 'SAR'}</span></span>
          </div>
        </Card>

        {/* Revenue & billing */}
        <Card title={ar ? 'الإيرادات والفوترة' : 'Revenue & billing'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {REVENUE_FIELDS.map(([key, arLabel, enLabel]) => (
              <FieldInput key={key} label={ar ? arLabel : enLabel} type="number" value={c.revenue?.[key] ?? 0}
                onSave={(v) => patch({ revenue: { [key]: Number(v) || 0 } })} disabled={!canEdit} />
            ))}
            <FieldInput label={ar ? 'حالة الفاتورة' : 'Invoice status'} value={c.billing?.invoiceStatus} onSave={(v) => patch({ billing: { invoiceStatus: v } })} disabled={!canEdit} />
            <FieldInput label={ar ? 'رقم فاتورتنا' : 'Our invoice no.'} value={c.billing?.ourInvoiceNumber} onSave={(v) => patch({ billing: { ourInvoiceNumber: v } })} disabled={!canEdit} />
            <FieldInput label={ar ? 'تاريخ الفوترة' : 'Invoiced at'} type="date" value={c.billing?.invoicedAt} onSave={(v) => patch({ billing: { invoicedAt: v } })} disabled={!canEdit} />
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3">
            <span className="text-slate-300 text-sm">{ar ? 'إجمالي الفاتورة' : 'Total invoiced'}</span>
            <span className="text-white font-bold text-lg">{sar(invoiced)} <span className="text-slate-400 text-xs font-normal">{ar ? 'ر.س' : 'SAR'}</span></span>
          </div>
          <p className="mt-2 text-slate-500 text-xs">
            {ar ? 'الفاتورة محسوبة: إجمالي المصروفات + بنود الهامش. عدّل البنود يتغيّر الرقم.' : 'Invoice is derived: total costs + margin lines. Edit a line and it follows.'}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-100 px-4 py-3">
              <p className="text-slate-500 text-xs">{ar ? 'صافي الربح' : 'Net profit'}</p>
              <p className={`font-bold text-lg ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{sar(profit)}</p>
            </div>
            <div className="rounded-lg bg-slate-100 px-4 py-3">
              <p className="text-slate-500 text-xs">{ar ? 'هامش الربح' : 'Margin'}</p>
              <p className={`font-bold text-lg ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{margin.toFixed(1)}%</p>
            </div>
          </div>
        </Card>
      </div>

      {/* مرفقات المعاملة — ورقُ كلِّ مرحلةٍ موسومًا بها */}
      <ClearanceAttachments
        clearanceId={c._id}
        items={c.attachments || []}
        stages={STAGE_ORDER}
        stageLabel={(sKey) => T.stages[sKey] || sKey}
        canEdit={canEdit}
        onChange={setC}
      />

      {/* Containers */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold">{ar ? 'الحاويات' : 'Containers'}</h3>
          {canEdit && (
            <button type="button" onClick={() => setContainers([...containers, { containerNumber: '', exitPermit: 0, declaration: '', notes: '' }])}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" /> {ar ? 'إضافة حاوية' : 'Add container'}
            </button>
          )}
        </div>
        {containers.length === 0 ? (
          <p className="text-slate-500 text-sm py-6 text-center">{ar ? 'لا توجد حاويات مسجلة' : 'No containers recorded'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="bg-slate-900">
                  <th className="text-start text-slate-300 font-semibold px-3 py-2">{ar ? 'رقم الحاوية' : 'Container no.'}</th>
                  <th className="text-start text-slate-300 font-semibold px-3 py-2">{ar ? 'تصريح الخروج' : 'Exit permit'}</th>
                  <th className="text-start text-slate-300 font-semibold px-3 py-2">{ar ? 'البيان' : 'Declaration'}</th>
                  <th className="text-start text-slate-300 font-semibold px-3 py-2">{ar ? 'ملاحظات' : 'Notes'}</th>
                  {canEdit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {containers.map((r, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-2"><CellInput value={r.containerNumber} disabled={!canEdit} onSave={(v) => updateContainer(i, 'containerNumber', v)} /></td>
                    <td className="px-3 py-2"><CellInput value={r.exitPermit} type="number" disabled={!canEdit} onSave={(v) => updateContainer(i, 'exitPermit', Number(v) || 0)} /></td>
                    <td className="px-3 py-2"><CellInput value={r.declaration} disabled={!canEdit} onSave={(v) => updateContainer(i, 'declaration', v)} /></td>
                    <td className="px-3 py-2"><CellInput value={r.notes} disabled={!canEdit} onSave={(v) => updateContainer(i, 'notes', v)} /></td>
                    {canEdit && (
                      <td className="px-3 py-2 text-end">
                        <button type="button" onClick={() => setContainers(containers.filter((_, idx) => idx !== i))}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 transition-colors" title={ar ? 'حذف' : 'Remove'}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const MONTH_LABELS: [string, string][] = [
  ['يناير', 'January'], ['فبراير', 'February'], ['مارس', 'March'], ['أبريل', 'April'],
  ['مايو', 'May'], ['يونيو', 'June'], ['يوليو', 'July'], ['أغسطس', 'August'],
  ['سبتمبر', 'September'], ['أكتوبر', 'October'], ['نوفمبر', 'November'], ['ديسمبر', 'December'],
];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

// Compact inline cell for the containers table — same save-on-blur contract.
function CellInput({ value, onSave, type = 'text', disabled }: { value: any; onSave: (v: string) => void; type?: string; disabled?: boolean }) {
  const [v, setV] = useState<string>(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <input type={type} value={v} disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (String(v) !== String(value ?? '')) onSave(v); }}
      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60" />
  );
}

// Inline-editable text/number/date field that saves on blur.
function FieldInput({ label, value, onSave, type = 'text', disabled }: { label: string; value: any; onSave: (v: string) => void; type?: string; disabled?: boolean }) {
  const [v, setV] = useState<string>(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <div>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      <input
        type={type}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (String(v) !== String(value ?? '')) onSave(v); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60 [color-scheme:light]"
      />
    </div>
  );
}

function FieldSelect({ label, value, options, onSave, disabled }: { label: string; value: string; options: [string, string][]; onSave: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      <select value={value} disabled={disabled} onChange={(e) => onSave(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60">
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, on, onToggle, disabled }: { label: string; on?: boolean; onToggle: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onToggle(!on)}
      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-start transition-colors ${disabled ? 'cursor-default' : 'hover:bg-slate-50'}`}>
      <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${on ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'}`}>
        {on && <Check className="w-3.5 h-3.5" />}
      </span>
      <span className={on ? 'text-slate-900' : 'text-slate-600'}>{label}</span>
    </button>
  );
}
