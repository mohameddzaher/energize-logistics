'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { ArrowLeft, ArrowRight, Check, Loader2, Ship, FileText, Ban, RotateCcw, Trash2, Lock, Unlock, Receipt, Container, Mail } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import ExportMenu, { type ExportColumn, type ExportSheet } from '@/components/ls2/ExportMenu';
import { getCustomsTranslations, getCustomsIdExtraTranslations } from '@/lib/translations';
import ClearanceAttachments from '@/components/customs/ClearanceAttachments';
import { SearchableSelect } from '@/components/hr/HRKit';
import ClearanceNotes from '@/components/customs/ClearanceNotes';
import PaymentStages from '@/components/customs/PaymentStages';
import CloseWithInvoice from '@/components/customs/CloseWithInvoice';
import SendFollowUpEmail from '@/components/customs/SendFollowUpEmail';
import TransportInvoiceBanner from '@/components/customs/TransportInvoice';
import ContainerUnits from '@/components/customs/ContainerUnits';
import ClearanceTasks from '@/components/customs/ClearanceTasks';
import LinkedOpsReports from '@/components/customs/LinkedOpsReports';
import { stageName, unitWord, type Pipeline } from '@/lib/customsPipeline';

export default function CustomsDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { notify, confirm } = useDialog();
  const { user } = useAuth();
  const canEdit = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_officer'].includes(user?.role || '') || canEditSection((user as any)?.permissions, 'Customs'); // matrix edit grants count too
  const { lang, isRTL } = useLanguage();
  const T = getCustomsTranslations(lang);
  const txx = getCustomsIdExtraTranslations(lang);

  const [c, setC] = useState<any>(null);
  // Payment stages come from the department settings, and are the attachment list too.
  const [payDefs, setPayDefs] = useState<{ key: string; nameAr: string; nameEn?: string }[]>([]);
  const loadPayDefs = useCallback(() => {
    api.get<{ items: { key: string; nameAr: string; nameEn?: string }[] }>('/api/lookups?type=customs_payment_stage&active=true')
      .then((d) => setPayDefs(d.items || [])).catch(() => {});
  }, []);
  useEffect(() => { loadPayDefs(); }, [loadPayDefs]);
  useSocket('lookup:changed', useCallback((x: any) => { if (x?.type === 'customs_payment_stage') loadPayDefs(); }, [loadPayDefs]));
  const [closing, setClosing] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Every state is declared here, before any early return. This screen returns early twice (while loading and when the transaction is missing), and any useState written after those runs on some renders and not others, crashing the whole component with React error #310 (rendered more hooks than previously), a blank screen with no visible cause.
  const [activating, setActivating] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [stageBusy, setStageBusy] = useState('');
  // Transport stages and later: for all units together, or for a single unit (its slot number).
  const [unitSel, setUnitSel] = useState<'all' | number>('all');

  // Deletion is for the department manager and staff, matching the route guard on the server.
  const canDelete = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'customs_manager', 'customs_officer'].includes(user?.role || '') || canEditSection((user as any)?.permissions, 'Customs');

  const removeClearance = async () => {
    if (!(await confirm({
      title: lang === 'ar' ? `حذف المعاملة ${c?.blNumber || c?.refNumber || ''} نهائيًّا؟` : `Permanently delete clearance ${c?.blNumber || c?.refNumber || ''}?`,
      message: lang === 'ar'
        ? 'تُحذَف معها مراحلُها ومستنداتُها ولا تُستعاد. وإن كانت ملغاةً فحسب فالأصحّ تركُها ملغاة.'
        : 'Its stages and documents go with it and cannot be restored. If it was merely cancelled, leave it cancelled.',
      confirmLabel: lang === 'ar' ? 'حذف' : 'Delete', tone: 'danger',
    }))) return;
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
  // Customer and agent files; chosen from them as in the create form.
  const [parties, setParties] = useState<{ customers: any[]; agents: any[] }>({ customers: [], agents: [] });
  useEffect(() => {
    Promise.all([
      api.get<{ parties: any[] }>('/api/customs-clearance/parties?kind=customer'),
      api.get<{ parties: any[] }>('/api/customs-clearance/parties?kind=agent'),
    ]).then(([cu, ag]) => setParties({ customers: cu.parties || [], agents: ag.parties || [] })).catch(() => {});
  }, []);
  // The customer's active contract and its prices. Read for the from-customer-contract bar in revenues and refetched when the customer or the container count changes (clearance fees are per container). `undefined` means not read yet.
  const [contractInfo, setContractInfo] = useState<any>(undefined);
  const [contractBusy, setContractBusy] = useState(false);
  const custKey = String(c?.customerParty || '');
  const countKey = Number(c?.containerCount) || 0;
  useEffect(() => {
    if (!params?.id || !c?._id) return;
    if (!custKey) { setContractInfo(null); return; }
    let alive = true;
    api.get<{ contract: any }>(`/api/customs-clearance/${params.id}/contract-pricing`)
      .then((d) => { if (alive) setContractInfo(d.contract || null); })
      .catch(() => { if (alive) setContractInfo(null); });
    return () => { alive = false; };
  }, [params?.id, c?._id, custKey, countKey]);
  useSocket('customs:updated', useCallback((d: any) => {
    // A payload without its computed stages (an old server version) is not accepted; it is read again.
    if (d?.clearance?._id === params.id) { if (d.clearance.pipeline) setC(d.clearance); else fetchOne(); }
    // An item name was edited in the department settings: the transaction is re-read so the new name appears.
    else if (d?.renamed) fetchOne();
  }, [params.id, fetchOne]));

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
      // Stages are not written from here (they have `PATCH /stage`), so they are not sent; otherwise a field edit would be rejected because a colleague marked a stage at the same moment.
      const { stage: _s, stagesDone: _d, pipeline: _p, stageLog: _l, ...body } = optimistic;
      const data = await api.put<any>(`/api/customs-clearance/${c._id}`, body);
      if (data?.clearance) setC(data.clearance);
    } catch (e: any) {
      // The page saves silently as you type — a silent revert here means the
      // user walks away believing a value stuck when it didn't. Say it loudly.
      notify(e?.message || (lang === 'ar' ? 'لم يتم الحفظ — رجعنا القيمة السابقة' : 'Not saved — the previous value was restored'), 'error');
      fetchOne();
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!c) return null;

  const Back = isRTL ? ArrowRight : ArrowLeft;
  const ar = lang === 'ar';
  // Stages as the server sees them: which apply to this transaction, which are closed on it, and the percentage are one rule on the server (pipelineOf); the screen draws what it receives and does not recompute it.
  const pipeline: Pipeline = (c as any).pipeline || { route: '', cargoType: 'containers', steps: [], done: 0, total: 0, percent: 0, next: '' };
  const cargo = pipeline.cargoType;
  const sName = (k: string) => stageName(T.stages, k, cargo);
  const invoiceNumber: string = (c as any).saleInvoiceNumber || '';
  // Invoicing request to Finance: the transaction is invoiced when Finance says so.
  const ireq: { status?: string; decisionNote?: string; decidedByName?: string; decidedAt?: string; requestedAt?: string; fileUrl?: string } | undefined = (c as any).invoiceRequest;
  const awaitingTransport = (!!invoiceNumber || ireq?.status === 'pending') && !c.isCompleted && !c.cancelled && !(c as any).transportInvoiceReceived;

  const setStage = async (key: string, done: boolean, unit?: 'all' | number) => {
    if (!canEdit || stageBusy) return;
    setStageBusy(key);
    try {
      const d = await api.patch<any>(`/api/customs-clearance/${c._id}/stage`, { key, done, ...(unit !== undefined ? { unit } : {}) });
      if (d?.clearance) setC(d.clearance);
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر تعليم المرحلة' : 'Could not update the stage'), 'error'); }
    setStageBusy('');
  };

  // Master-spreadsheet field groups. The payment stages list used to be hardcoded here and is now read from the department settings; see `components/customs/PaymentStages`.
  // Costs: amounts paid to third parties and passed to the customer as they are. Their total is the master sheet's total expenses exactly; no margin item is added to or removed from it, or the screen would differ from accounting.
  const COST_FIELDS: [string, string, string][] = [
    ['deliveryOrder', 'قيمة إذن التسليم', 'Delivery order'],
    ['customsDuty', 'الرسوم الجمركية', 'Customs duty'],
    ['portFees', 'أجور الموانى', 'Port fees'],
    ['unloadingFees', 'أجور التفريغ', 'Unloading fees'],
    ['inspection', 'أجور الكشف', 'Inspection'],
    // Transport in its three parts: what we pay the carrier for each part. It is a cost, not revenue, and our selling price for the same part is subtracted from it to show the net in revenues.
    ['transport', 'النقل من الميناء إلى العميل', 'Transport: port → customer'],
    ['transportToYard', 'النقل من الميناء إلى الساحة', 'Transport: port → yard'],
    ['transportYardToCustomer', 'النقل من الساحة إلى العميل', 'Transport: yard → customer'],
    ['appointmentBooking', 'حجز الموعد', 'Appointment booking'],
    ['storage', 'تخزين', 'Storage'],
    ['yardFees', 'أجور الساحة', 'Yard fees'],
    // Floor charges (demurrage) and the exit permit are one item in practice, so the first was merged into the second (scripts/mergeDemurrageIntoExitPermit).
    ['exitPermit', 'تصريح الخروج (الأرضيات)', 'Exit permit (demurrage)'],
    ['extension', 'تمديد', 'Extension'],
    ['consolidator', 'الدامج', 'Consolidator'],
    ['commissions', 'عمولات', 'Commissions'],
    ['labourExpenses', 'مصاريف عمال', 'Labour expenses'],
    ['examFees', 'أجور الكشف', 'Examination fees'],
    ['extraFees', 'أجور إضافية', 'Extra fees'],
    ['returnInvoice', 'فاتورة الإرجاع', 'Return invoice'],
  ];
  // Margin: what is added on top of expenses, and its total is the profit.
  const MARGIN_FIELDS: [string, string, string][] = [
    ['clearanceFee', 'أجور التخليص', 'Clearance fee'],
    // Computed, not written: selling price minus supplier price (recomputeTotals on the server).
    ['transportNet', 'صافي النقل', 'Transport net'],
    ['transportToYardNet', 'صافي النقل إلى الساحة', 'Transport-to-yard net'],
    ['yardNet', 'صافي الساحة', 'Yard net'],
    ['storageNet', 'صافي التخزين', 'Storage net'],
    ['securityScan', 'فحص أمنى', 'Security scan'],
    ['labour', 'عمال', 'Labour'],
    ['transportDailies', 'يوميات نقل', 'Transport per-diems'],
    // Computed, not written: the yard-to-customer transport price minus its cost.
    ['yardToCustomerNet', 'صافي النقل من الساحة إلى العميل', 'Yard-to-customer net'],
  ];
  // Items recorded but not summed directly: the transport price is what we take from the customer (it enters profit through its net), and the yard transport net is a helper column outside the master formula.
  const REVENUE_EXTRA: [string, string, string][] = [
    ['transportSelling', 'سعر النقل من الميناء إلى العميل', 'Price: port → customer'],
    ['transportToYardSelling', 'سعر النقل من الميناء إلى الساحة', 'Price: port → yard'],
    ['yardToCustomerSelling', 'سعر النقل من الساحة إلى العميل', 'Price: yard → customer'],
    ['yardTransportNet', 'صافي نقل الساحة', 'Yard transport net'],
    ['yardPrice', 'سعر الساحة', 'Yard price'],
  ];
  // Each price is followed by its net, shown read-only.
  // Every net is derived (price − cost); an empty price counts as 0.
  const yardSellRaw = c.revenue?.transportToYardSelling;
  const yardPriceRaw = c.revenue?.yardPrice;
  const COMPUTED_REVENUE = new Set(['transportNet', 'yardToCustomerNet', 'yardNet', 'transportToYardNet']);
  // Empty means 'no price yet', not 0.
  const NULLABLE_REVENUE = new Set(['transportToYardSelling', 'yardPrice']);
  const COMPUTED_HINT: Record<string, [string, string]> = {
    transportNet: ['السعر − تكلفة النقل', 'price − cost'],
    transportToYardNet: ['السعر − تكلفة النقل', 'price − cost'],
    yardToCustomerNet: ['السعر − تكلفة النقل', 'price − cost'],
    yardNet: ['سعر الساحة − أجور الساحة', 'yard price − yard fees'],
  };
  const fieldOf = (k: string): [string, string, string] =>
    [...MARGIN_FIELDS, ...REVENUE_EXTRA].find(([x]) => x === k) || [k, k, k];
  const REVENUE_FIELDS: [string, string, string][] = [
    'clearanceFee',
    'transportSelling', 'transportNet',
    'transportToYardSelling', 'transportToYardNet',
    'yardToCustomerSelling', 'yardToCustomerNet',
    'yardPrice', 'yardNet', 'storageNet', 'securityScan', 'labour', 'transportDailies', 'yardTransportNet',
  ].map(fieldOf);

  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const costsTotal = Math.round(COST_FIELDS.reduce((a, [k]) => a + n(c.costs?.[k]), 0) * 100) / 100;
  // Transport net is computed, not written: what we take from the customer minus what we pay the carrier (2000 - 1500 = 500 is our transport profit). Both numbers used to be typed by hand and disagreed, so the rule lives on the server (recomputeTotals) and this mirrors it to show the value before saving.
  const transportNet = Math.round((n(c.revenue?.transportSelling) - n(c.costs?.transport)) * 100) / 100;
  const yardToCustomerNet = Math.round((n(c.revenue?.yardToCustomerSelling) - n(c.costs?.transportYardToCustomer)) * 100) / 100;
  const transportToYardNet = Math.round((n(yardSellRaw) - n(c.costs?.transportToYard)) * 100) / 100;
  const yardNet = Math.round((n(yardPriceRaw) - n(c.costs?.yardFees)) * 100) / 100;
  const revVal = (k: string) => (k === 'transportNet' ? transportNet
    : k === 'yardNet' ? yardNet
    : k === 'yardToCustomerNet' ? yardToCustomerNet
    : k === 'transportToYardNet' ? transportToYardNet
    : n(c.revenue?.[k]));

  // Contract prices to revenues: fill-from-contract writes the contract prices into all revenue fields (even if edited), and choosing a destination writes its price into the port-to-customer transport price.
  const contractRoutes: { from: string; to: string; price: number | null }[] = contractInfo?.pricing?.routes || [];
  const routeIdx = contractInfo?.route
    ? contractRoutes.findIndex((rt) => rt.from === contractInfo.route.from && rt.to === contractInfo.route.to)
    : -1;
  const applyContract = async (route?: { from: string; to: string }) => {
    if (!canEdit || contractBusy) return;
    setContractBusy(true);
    try {
      const d = await api.post<any>(`/api/customs-clearance/${c._id}/apply-contract`, route ? { from: route.from, to: route.to } : {});
      if (d?.contract !== undefined) setContractInfo(d.contract);
      // The reply has no computed stages: re-read so they are not cleared from the screen.
      if (d?.clearance?.pipeline) setC(d.clearance); else fetchOne();
      notify(ar ? 'عُبّئت الإيرادات من العقد' : 'Revenue filled from the contract', 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّرت التعبئة من العقد' : 'Could not fill from the contract'), 'error'); }
    setContractBusy(false);
  };
  // The margin items' total enters the invoice total. It is not shown alone here: net profit and profit margin were removed from the transaction details and live in the department analytics, for management.
  const marginSum = Math.round(MARGIN_FIELDS.reduce((a, [k]) => a + revVal(k), 0) * 100) / 100;
  const invoiced = Math.round((costsTotal + marginSum) * 100) / 100;
  const sar = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

  // An old transaction with a count but no unit slots: slots are opened for display here and saved with the first write (the server does the same on save, syncUnits).
  const containers: any[] = (() => {
    const rows = Array.isArray(c.containers) ? [...c.containers] : [];
    const want = Math.min(300, Math.max(0, Number(c.containerCount) || 0));
    while (rows.length < want) rows.push({ containerNumber: '', returnDate: '', moves: [] });
    return rows;
  })();
  const setContainers = (rows: any[]) => patch({ containers: rows });
  const updateContainer = (i: number, key: string, v: any) =>
    setContainers(containers.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));

  // Excel: one sheet per on-screen card. The page is not one table (data, stages, expenses, revenues, containers), and merging them mixes expenses with revenue in one column and makes the file total meaningless, hence a multi-sheet workbook.
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
      kv(ar ? 'نوع المعاملة' : 'Type', cargo === 'vehicles' ? (ar ? 'سيّارات' : 'Vehicles') : (ar ? 'حاويات' : 'Containers')),
      kv(ar ? `عدد ${unitWord(cargo, true)}` : `${unitWord(cargo, false)} count`, c.containerCount), kv(T.totalWeight, c.totalWeight),
      kv(T.invoiceValue, c.invoiceValue), kv(T.currency, c.currency),
      kv(T.exporterCompany, c.exporterCompany), kv(T.countryOfOrigin, c.countryOfOrigin),
      kv(T.hsCode, c.hsCode), kv(T.saberNumber, c.saberNumber), kv(T.assignedTo, c.assignedTo),
      kv(T.branch, c.branch === 'dammam' ? T.dammam : T.jeddah),
      kv(T.shippingAgent, c.shippingAgent), kv(T.shippingAgentEmail, c.shippingAgentEmail),
      kv(ar ? 'المرحلة الحالية' : 'Current stage', c.cancelled ? T.cancelled : sName(c.stage)),
      kv(ar ? 'رقم البيان' : 'Declaration no.', c.declarationNumber),
      kv(ar ? 'تاريخ البيان' : 'Declaration date', c.declarationDate),
      kv(ar ? 'تاريخ استلام الورق' : 'Papers received', c.papersReceivedDate),
      kv(ar ? 'موعد التفريغ' : 'Unloading appointment', c.unloadingAppointment),
      kv(ar ? 'مكان التفريغ' : 'Unloading location', c.unloadingLocation),
      kv(ar ? 'رقم إذن التسليم' : 'DO number', c.doNumber),
      kv(ar ? 'آخر موعد إرجاع' : 'Return deadline', c.returnDeadline),
      kv(ar ? 'تاريخ تحمّل الأرضيات' : 'Demurrage start date', c.demurrageStartDate),
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
    rows: pipeline.steps.map((st, i) => ({
      index: i + 1,
      stage: sName(st.key),
      state: st.locked ? (ar ? 'غير مطلوبة' : 'Not applicable')
        : st.done ? (ar ? 'مكتملة' : 'Done') : (ar ? 'لم تُنجَز' : 'Pending'),
    })),
  };

  const tick = (v: any) => (v ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No'));

  // Closing is from the header, and the reason is shown as it comes from the server (such as add the transport invoice with a date and attachment), not a generic not allowed.
  /** The upcoming transaction becomes current: it is the same transaction, now that it has happened. */
  const activate = async () => {
    // Conversion is confirmed: a wrong click used to remove the transaction from upcoming immediately.
    if (!(await confirm(ar
      ? `تحويلُ المعاملة ${c?.blNumber || c?.refNumber || ''} إلى معاملةٍ جارية؟ ستخرج من المعاملات القادمة وتدخل قائمةَ الجارية.`
      : `Convert ${c?.blNumber || c?.refNumber || ''} to a current transaction? It leaves the upcoming list and joins the current one.`))) return;
    setActivating(true);
    try {
      const d = await api.patch<any>(`/api/customs-clearance/${params?.id}/activate`, {});
      setC(d.clearance);
      notify(ar ? 'صارت معاملةً جارية' : 'Now a current transaction', 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر التحويل' : 'Failed'), 'error'); }
    setActivating(false);
  };

  // A wrongly converted transaction goes back to upcoming with the same expected date, not deleted and recreated, and what was written in it stays.
  const backToUpcoming = async () => {
    if (!(await confirm(ar
      ? `إرجاعُ المعاملة ${c?.blNumber || c?.refNumber || ''} إلى المعاملات القادمة؟ ستخرج من قائمة الجارية وأعدادها.`
      : `Move ${c?.blNumber || c?.refNumber || ''} back to upcoming? It leaves the current list and its counts.`))) return;
    await patch({ upcoming: true } as any);
    notify(ar ? 'عادت إلى المعاملات القادمة' : 'Back in upcoming', 'success');
  };

  // Closing needs no invoice: it becomes "closed, not invoiced" and can be invoiced from here later.
  const closeClearance = async () => {
    if (!(await confirm(ar
      ? `إغلاقُ المعاملة ${c?.blNumber || c?.refNumber || ''}؟ ستصبح «مغلقة غير مفوترة» حتى يُرسَل طلبُ الفوترة منها وتفوترها الإدارةُ الماليّة.`
      : `Close ${c?.blNumber || c?.refNumber || ''}? It becomes "closed, not invoiced" until an invoice request is sent and Finance invoices it.`))) return;
    setClosing(true);
    try {
      const d = await api.patch<any>(`/api/customs-clearance/${params?.id}/complete`, { completed: true });
      setC(d.clearance);
      notify(ar ? 'أُغلقت المعاملة — مغلقة غير مفوترة' : 'Closed — not invoiced', 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الإغلاق' : 'Failed'), 'error'); }
    setClosing(false);
  };

  const reopen = async () => {
    setClosing(true);
    try {
      const d = await api.patch<any>(`/api/customs-clearance/${params?.id}/complete`, { completed: false });
      setC(d.clearance);
      notify(ar ? 'أُعيد فتحُ المعاملة' : 'Reopened', 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Failed'), 'error'); }
    setClosing(false);
  };
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

  // The export reads what the screen reads. It used to be built from the old eight `stageDates`; stages are now a repeatable list with attachments, so the file kept printing only the eight, without attachments or second payments, and said less than what happened outside the system.
  const milestonesSheet: ExportSheet = {
    name: ar ? 'مراحل السداد' : 'Payments',
    columns: [
      { header: ar ? 'البند' : 'Milestone', key: 'label', width: 32 },
      { header: ar ? 'التاريخ' : 'Date', key: 'date', width: 16 },
      { header: ar ? 'المبلغ' : 'Amount', key: 'amount', width: 14 },
      { header: ar ? 'المرفق' : 'File', key: 'file', width: 30 },
      { header: ar ? 'ملاحظة' : 'Note', key: 'note', width: 26 },
      { header: ar ? 'أضافه' : 'Added by', key: 'by', width: 20 },
    ],
    rows: ((c.paymentStages || []) as any[]).map((e) => ({
      label: e.label || e.key,
      date: e.date || '—',
      amount: e.amount != null ? Number(e.amount).toLocaleString() : '',
      file: e.fileName || (ar ? 'بلا مرفق' : 'no file'),
      note: e.note || '',
      by: e.addedByName || '',
    })),
  };

  const amountCols: ExportColumn[] = [
    { header: ar ? 'البند' : 'Item', key: 'label', width: 32 },
    { header: ar ? 'المبلغ (ر.س)' : 'Amount (SAR)', key: 'amount', width: 16 },
  ];
  // The totals row is part of the on-screen card; dropping it from the file makes the reader sum by hand and get a different number from the page.
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
      ...REVENUE_FIELDS.map(([key, arLabel, enLabel]) => ({ label: ar ? arLabel : enLabel, amount: revVal(key) })),
      { label: ar ? 'إجمالي الفاتورة' : 'Total invoiced', amount: invoiced },
      { label: ar ? 'حالة الفاتورة' : 'Invoice status', amount: c.billing?.invoiceStatus || '—' },
      { label: ar ? 'رقم فاتورتنا' : 'Our invoice no.', amount: c.billing?.ourInvoiceNumber || '—' },
      { label: ar ? 'تاريخ الفوترة' : 'Invoiced at', amount: c.billing?.invoicedAt || '—' },
    ],
  };

  const containersSheet: ExportSheet = {
    name: unitWord(cargo, ar),
    columns: [
      { header: '#', key: 'index', width: 6 },
      { header: cargo === 'vehicles' ? (ar ? 'رقم السيارة' : 'Vehicle no.') : (ar ? 'رقم الحاوية' : 'Container no.'), key: 'containerNumber', width: 20 },
      ...pipeline.steps.filter((st) => st.done && ['transport_to_yard', 'transport_to_customer', 'yard_to_customer'].includes(st.key)).flatMap((st) => [
        { header: `${sName(st.key)} — ${ar ? 'السيّارة' : 'Truck'}`, key: `kind_${st.key}`, width: 22 },
        { header: `${sName(st.key)} — ${ar ? 'رقم الكشف / الفاتورة' : 'Sheet / invoice no.'}`, key: `ref_${st.key}`, width: 22 },
      ]),
      ...(cargo === 'vehicles' ? [] : [
        { header: ar ? 'تاريخ الإرجاع' : 'Return date', key: 'returnDate', width: 16 },
        { header: ar ? 'مكان الإرجاع' : 'Returned to', key: 'returnDepot', width: 20 },
        { header: ar ? 'إيصال الإرجاع' : 'Return receipt', key: 'returnReceipt', width: 18 },
        { header: ar ? 'سيّارة الإرجاع' : 'Return truck', key: 'returnKind', width: 16 },
        { header: ar ? 'رقم الكشف / الفاتورة (الإرجاع)' : 'Return sheet / invoice', key: 'returnRef', width: 22 },
        { header: ar ? 'ملاحظات الإرجاع' : 'Return notes', key: 'returnNotes', width: 28 },
      ]),
    ],
    rows: containers.map((r, i) => ({
      index: i + 1, containerNumber: r.containerNumber || '—', returnDate: r.returnDate || '—',
      returnDepot: r.returnDepot || '—', returnReceipt: r.returnReceipt || '—', returnRef: r.returnRef || '—', returnNotes: r.returnNotes || '—',
      returnKind: r.returnVehicleKind === 'energize' ? (ar ? 'سيّارة تنشيط' : 'Energize') : r.returnVehicleKind === 'external' ? (ar ? 'سيّارة خارجيّة' : 'External') : '—',
      ...Object.fromEntries((r.moves || []).flatMap((m: any) => [
        [`kind_${m.leg}`, m.vehicleKind === 'energize' ? (ar ? 'سيّارة تنشيط' : 'Energize') : m.vehicleKind === 'external' ? (ar ? 'سيّارة خارجيّة' : 'External') : '—'],
        [`ref_${m.leg}`, m.ref || '—'],
      ])),
    })),
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
      stage: a.stage ? sName(a.stage) : (ar ? 'عامّ' : 'General'),
      by: a.uploadedByName || '—',
      at: a.uploadedAt ? String(a.uploadedAt).slice(0, 10) : '—',
    })),
  };

  const exportSheets: ExportSheet[] = [
    infoSheet, pipelineSheet, documentsSheet, agentPapersSheet, attachmentsSheet,
    milestonesSheet, costsSheet, revenueSheet,
    // The containers table is not drawn when no container is registered, so an empty sheet by its name would suggest containers lost from the file rather than a transaction without containers.
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
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-slate-900">
              {/* Waybill number first: it identifies the transaction in the department, then its own number. */}
              <bdi>{c.blNumber || (ar ? 'بلا رقم بوليصة' : 'No BL number')}</bdi>
              <span className="text-[13px] font-semibold text-slate-400"><bdi>{c.refNumber}</bdi></span>
              {c.isCompleted && (
                <span className="rounded-md bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
                  {ar ? 'مغلقة' : 'Closed'}
                </span>
              )}
              {c.isCompleted && !invoiceNumber && !pipeline.steps.some((st) => st.key === 'invoiced' && st.done) && (
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{ar ? 'لم تُفوتَر' : 'Not invoiced'}</span>
              )}
              {!!invoiceNumber && !c.isCompleted && (
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${awaitingTransport ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {ar ? 'مفوترة' : 'Invoiced'} · <bdi>{invoiceNumber}</bdi>
                </span>
              )}
              {/* A transaction that has not happened yet: read in the header before any number is built on it. */}
              {(c as any).upcoming && (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                  {ar ? `قادمة · ${(c as any).expectedDate || '—'}` : `Upcoming · ${(c as any).expectedDate || '—'}`}
                </span>
              )}
            </h1>
            <p className="text-slate-500 text-sm">
              {c.branch === 'dammam' ? T.dammam : T.jeddah} · {cargo === 'vehicles' ? (ar ? 'سيّارات' : 'Vehicles') : (ar ? 'حاويات' : 'Containers')} · {c.cancelled ? T.cancelled : sName(c.stage)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-slate-400 text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /></span>}
          {/* Converted, not recreated: everything written in it stays (customer, agent, port, containers). */}
          {canEdit && (c as any).upcoming && (
            <button type="button" onClick={activate} disabled={activating}
              className="flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e06010] disabled:opacity-60">
              {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {ar ? 'تحويل إلى معاملة جارية' : 'Convert to current'}
            </button>
          )}
          {canEdit && !(c as any).upcoming && !c.isCompleted && !c.cancelled && !!(c as any).expectedDate && (
            <button type="button" onClick={backToUpcoming}
              title={ar ? 'للمعاملة التي حُوِّلت إلى جاريةٍ قبل أوانها' : 'For a transaction converted too early'}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-[#f37121]">
              <RotateCcw className="w-4 h-4" /> {ar ? 'إرجاع إلى القادمة' : 'Back to upcoming'}
            </button>
          )}
          {/* Daily follow-up to the customer on where the shipment stands, from the customs mailbox. */}
          {canEdit && !c.cancelled && (
            <button type="button" onClick={() => setMailOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:text-[#f37121]">
              <Mail className="w-4 h-4" /> {ar ? 'إرسال بريد للعميل' : 'Email the customer'}
            </button>
          )}
          {mailOpen && <SendFollowUpEmail clearanceId={String(c._id)} ar={ar} onClose={() => setMailOpen(false)} />}
          <ExportMenu fileName={`customs-${c.refNumber || c.blNumber || c._id}`} lang={lang as 'ar' | 'en'}
            options={[{ key: 'full', label: ar ? 'ملف المعاملة كاملًا' : 'The whole clearance', sheets: exportSheets }]} />
          {/* Issuing the invoice from the header. It is the same window as under the payment stages, opened from both places because whoever finished the work is at the top of the page. The invoice is issued without waiting for the transport invoice; the transaction is closed when it is attached (see the red bar below). */}
          {canEdit && !c.cancelled && !(c as any).upcoming && (
            c.isCompleted
              ? (
                <>
                  {/* Closed but not invoiced (from the old log): its invoice is issued while it is closed. */}
                  {!invoiceNumber && !pipeline.steps.some((st) => st.key === 'invoiced' && st.done) && (
                    <button type="button" onClick={() => setInvoiceOpen(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-[#e06010]">
                      <Receipt className="w-4 h-4" /> {ireq?.status === 'pending' ? (ar ? 'تعديل طلب الفوترة' : 'Edit invoice request') : (ar ? 'طلب فوترة' : 'Request invoicing')}
                    </button>
                  )}
                  <button type="button" onClick={reopen} disabled={closing}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-[#f37121]">
                    <Unlock className="w-4 h-4" /> {ar ? 'إعادة الفتح' : 'Reopen'}
                  </button>
                </>
              )
              : (
                <>
                <button type="button" onClick={closeClearance} disabled={closing}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-60">
                  {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} {ar ? 'إغلاق المعاملة' : 'Close transaction'}
                </button>
                {!invoiceNumber && (
                <button type="button" onClick={() => setInvoiceOpen(true)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${invoiceNumber
                    ? 'bg-slate-100 text-slate-700 hover:text-[#f37121]' : 'bg-[#f37121] text-white hover:bg-[#e06010]'}`}>
                  <Receipt className="w-4 h-4" />
                  {ireq?.status === 'pending' ? (ar ? 'تعديل طلب الفوترة' : 'Edit invoice request') : (ar ? 'طلب فوترة' : 'Request invoicing')}
                </button>
                )}
                </>
              )
          )}
          {canEdit && (
            c.cancelled
              ? <button type="button" onClick={() => patch({ cancelled: false })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/15 text-green-600 text-sm font-medium hover:bg-green-500/25 transition-colors"><RotateCcw className="w-4 h-4" /> {T.reactivate}</button>
              : <button type="button" onClick={() => patch({ cancelled: true })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 text-red-600 text-sm font-medium hover:bg-red-500/25 transition-colors"><Ban className="w-4 h-4" /> {T.markCancelled}</button>
          )}
          {/* Cancellation is an event that stays in the log; deletion is for a transaction entered by mistake or duplicated, which should not stay as cancelled and be counted. Manager only, with all its details. */}
          {canDelete && (
            <button type="button" onClick={removeClearance} title={ar ? 'حذف المعاملة' : 'Delete clearance'}
              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Invoiced but its transport invoice has not arrived: red at the top of the page until attached. */}
      {/* Invoicing request status. */}
      {!c.cancelled && ireq?.status && (
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${ireq.status === 'invoiced' ? 'border-emerald-200 bg-emerald-50' : ireq.status === 'pending' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
          <Receipt className={`h-5 w-5 shrink-0 ${ireq.status === 'invoiced' ? 'text-emerald-600' : ireq.status === 'pending' ? 'text-amber-600' : 'text-red-600'}`} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-slate-900">
              {ireq.status === 'invoiced' ? `${ar ? 'تمّت الفوترة من الإدارة الماليّة' : 'Invoiced by Finance'} · ${invoiceNumber}`
                : ireq.status === 'pending' ? (ar ? 'طلبُ الفوترة عند الإدارة الماليّة — لم تُفوتَر بعد' : 'Invoice request with Finance — not invoiced yet')
                  : ireq.status === 'returned' ? (ar ? 'أعادت الإدارةُ الماليّة طلبَ الفوترة للتصحيح' : 'Finance returned the invoice request')
                    : (ar ? 'رفضت الإدارةُ الماليّة طلبَ الفوترة' : 'Finance rejected the invoice request')}
            </p>
            {ireq.decisionNote && <p className="text-[12.5px] text-slate-600">«{ireq.decisionNote}»</p>}
            {ireq.decidedByName && <p className="text-[11.5px] text-slate-400">{ireq.decidedByName}{ireq.decidedAt ? ` · ${new Date(ireq.decidedAt).toLocaleDateString('en-GB')}` : ''}</p>}
          </div>
          {ireq.fileUrl && (
            <a href={ireq.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
              <Receipt className="h-4 w-4" />{ar ? 'الفاتورة النهائية' : 'Final invoice'}
            </a>
          )}
          {canEdit && ['returned', 'rejected'].includes(ireq.status) && !invoiceNumber && (
            <button type="button" onClick={() => setInvoiceOpen(true)} className="rounded-lg bg-[#f37121] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#e06010]">
              {ar ? 'تصحيح وإعادة الإرسال' : 'Fix & resend'}
            </button>
          )}
        </div>
      )}
      {awaitingTransport && (
        <TransportInvoiceBanner clearanceId={String(c._id)} invoiceNumber={invoiceNumber} canEdit={canEdit} ar={ar} onChanged={setC} />
      )}

      {/* Clearance stages. The cycle is not one line: after the transport order there are two mutually exclusive paths, to the yard (followed by unloading, storage and transport to the customer) or straight to the customer. Stages not on the transaction's path are closed on it and excluded from its percentage. The rule is on the server; a click here is a request answered with the resulting stages. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center"><Ship className="w-4 h-4" /></span>
            {T.progress}
          </h3>
          <span className="text-[12px] text-slate-500 tabular-nums">
            {pipeline.done}/{pipeline.total} · {pipeline.percent}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pipeline.percent}%` }} />
        </div>
        {(() => {
          const units = pipeline.units || [];
          const perUnit = !!pipeline.perUnit && units.length > 0;
          const sel = perUnit && unitSel !== 'all' && unitSel < units.length ? unitSel : 'all';
          const numberOf = (key: string) => pipeline.steps.findIndex((x) => x.key === key) + 1;
          // A single-stage button: for the transaction, for all units together, or for a single unit.
          const stepButton = (st: typeof pipeline.steps[number], unit?: 'all' | number) => {
            const next = (unit === undefined || unit === 'all' ? pipeline.next : units[unit as number]?.next) === st.key && !c.cancelled;
            // Issue invoice is not marked by hand: it opens the invoice window.
            const auto = st.key === 'invoiced';
            const partial = !!st.perUnit && !st.done && (st.unitsDone || 0) > 0;
            const onClick = () => {
              if (auto) { if (!st.done) setInvoiceOpen(true); return; }
              setStage(st.key, !st.done, unit);
            };
            return (
              <button key={st.key} type="button" disabled={!canEdit || (st.locked && !st.switchable) || stageBusy === st.key || (auto && st.done)} onClick={onClick}
                title={st.switchable ? (ar ? 'اضغط للتحويل إلى هذا الطريق' : 'Click to switch to this route')
                  : st.locked ? (ar ? st.reason : 'Not applicable to this transaction')
                  : auto ? (ar ? 'تُعلَّم بإصدار الفاتورة' : 'Ticked by issuing the invoice')
                    : canEdit ? (ar ? 'اضغط للتعليم أو إلغائه' : 'Click to tick or untick') : ''}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-start border transition-all ${
                  st.switchable
                    ? 'border-slate-200 bg-slate-100 text-slate-400 hover:border-[#f37121]/60 hover:text-slate-700 cursor-pointer'
                    : st.locked
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : st.done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      : partial
                        ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : next
                        ? 'border-[#f37121] bg-[#f37121]/10 text-[#b4471a] ring-1 ring-[#f37121]/40 font-semibold'
                        : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-white'
                } ${canEdit && !st.locked ? 'cursor-pointer' : ''}`}>
                <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  st.locked ? 'bg-slate-200 text-slate-400'
                    : st.done ? 'bg-emerald-500 text-white' : partial ? 'bg-amber-400 text-white' : next ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-400'
                }`}>
                  {stageBusy === st.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : st.locked && !st.switchable ? <Lock className="w-3 h-3" /> : st.done ? <Check className="w-3.5 h-3.5" /> : numberOf(st.key)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{sName(st.key)}</span>
                  {st.locked && (
                    <span className="block truncate text-[10.5px]">
                      {st.switchable ? (ar ? 'اضغط للتحويل إلى هذا الطريق' : 'Click to switch route') : (ar ? st.reason : 'Not applicable')}
                    </span>
                  )}
                </span>
                {/* How many units have completed this stage out of how many require it. */}
                {st.perUnit && !st.locked && (
                  <span className={`ms-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${st.done ? 'bg-emerald-100 text-emerald-700' : partial ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'}`}>
                    {st.unitsDone}/{st.unitsOf}
                  </span>
                )}
                {next && !st.done && !st.perUnit && <span className="ms-auto shrink-0 text-[10px] font-bold text-[#f37121]">{ar ? 'التالية' : 'next'}</span>}
              </button>
            );
          };
          if (!perUnit) {
            return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{pipeline.steps.map((st) => stepButton(st))}</div>;
          }
          const base = pipeline.steps.filter((st) => !st.perUnit && st.key !== 'invoiced');
          const invoice = pipeline.steps.find((st) => st.key === 'invoiced');
          const shown = sel === 'all' ? pipeline.steps.filter((st) => st.perUnit) : units[sel as number].steps;
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{base.map((st) => stepButton(st))}</div>

              {/* From the start of transport each container has its own stages. Containers do not always move together (one to the customer today, two to the yard), so choose here: all together, or a single container whose stages are completed alone. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="me-1 text-[12px] font-bold text-slate-700">
                    {ar ? `النقلُ وما بعده — لكلّ ${cargo === 'vehicles' ? 'سيّارة' : 'حاوية'}:` : `Transport onward — per ${cargo === 'vehicles' ? 'vehicle' : 'container'}:`}
                  </span>
                  <button type="button" onClick={() => setUnitSel('all')}
                    className={`rounded-lg px-2.5 py-1 text-[12px] font-bold transition-colors ${sel === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`}>
                    {ar ? 'الكلّ معًا' : 'All together'}
                  </button>
                  {units.map((u) => {
                    const row = containers[u.index] || {};
                    return (
                      <button key={u.index} type="button" onClick={() => setUnitSel(u.index)}
                        title={row.containerNumber || ''}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                          sel === u.index ? 'bg-[#f37121] text-white' : u.percent >= 100 ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`}>
                        <bdi>{row.containerNumber || `${unitWord(cargo, ar, false)} ${u.index + 1}`}</bdi>
                        <span className={`tabular-nums text-[10.5px] ${sel === u.index ? 'text-white/85' : 'text-slate-400'}`}>{u.percent}%</span>
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{shown.map((st) => stepButton(st, sel))}</div>
                <p className="mt-2 text-[11.5px] text-slate-500">
                  {sel === 'all'
                    ? (ar ? 'التعليمُ هنا يسري على الوحدات كلِّها. والرقمُ بجانب المرحلة: كم وحدةً أنجزتها من كم تَلزمها. اختر وحدةً لتُكمِل مراحلَها وحدَها.'
                      : 'Ticking here applies to every unit. The figure shows how many units have done the stage. Pick a unit to progress it on its own.')
                    : (ar ? 'التعليمُ هنا لهذه الوحدة وحدَها — والطريقُ يُبدَّل بالضغط على الآخر.'
                      : 'Ticking here applies to this unit only — click the other route to switch.')}
                </p>
              </div>

              {invoice && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{stepButton(invoice)}</div>}
            </div>
          );
        })()}
      </section>

      {/* Containers by count: one slot per container. */}
      <Card icon={<Container className="w-4 h-4" />}
        title={`${unitWord(cargo, ar)} (${containers.length})`}>
        <ContainerUnits units={containers} pipeline={pipeline} stages={T.stages} canEdit={canEdit} ar={ar} onSave={setContainers} />
      </Card>

      {/* Operating statements that moved its containers, with their invoicing and collection. */}
      <LinkedOpsReports clearanceId={String(c._id)} ar={ar} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Data and dates first. The two cards were swapped on request: what is followed daily (the declaration and its dates) goes first, and the fixed transaction data below it. */}
        <Card className="lg:col-span-2" icon={<FileText className="w-4 h-4" />}
          title={ar ? 'بيانات البيان والمواعيد' : 'Declaration & scheduling'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldInput label={ar ? 'رقم البيان' : 'Declaration no.'} value={c.declarationNumber} onSave={(v) => patch({ declarationNumber: v })} disabled={!canEdit} />
          <FieldInput label={ar ? 'تاريخ البيان' : 'Declaration date'} type="date" value={c.declarationDate} onSave={(v) => patch({ declarationDate: v })} disabled={!canEdit} />
          <FieldInput label={ar ? 'تاريخ استلام الورق' : 'Papers received'} type="date" value={c.papersReceivedDate} onSave={(v) => patch({ papersReceivedDate: v })} disabled={!canEdit} />
          {/* A date is picked from a calendar like its neighbours: typed text mixes forms such as 15/9, 15-9-2026 and a weekday in one column, which cannot be sorted or reminded. */}
          <FieldInput label={ar ? 'موعد التفريغ' : 'Unloading appointment'} type="date" value={c.unloadingAppointment ? String(c.unloadingAppointment).slice(0, 10) : ''} onSave={(v) => patch({ unloadingAppointment: v })} disabled={!canEdit} />
          <FieldInput label={ar ? 'مكان التفريغ' : 'Unloading location'} value={c.unloadingLocation} onSave={(v) => patch({ unloadingLocation: v })} disabled={!canEdit} />
          <FieldInput label={ar ? 'رقم إذن التسليم' : 'DO number'} value={c.doNumber} onSave={(v) => patch({ doNumber: v })} disabled={!canEdit} />
          <FieldInput label={ar ? 'أيّام السماح للإرجاع' : 'Return free days'} type="number" value={c.returnFreeDays ?? 0} onSave={(v) => patch({ returnFreeDays: Number(v) || 0 })} disabled={!canEdit} />
          <FieldInput label={ar ? 'آخر موعد إرجاع' : 'Return deadline'} type="date" value={c.returnDeadline} onSave={(v) => patch({ returnDeadline: v })} disabled={!canEdit} />
          {/* The day floor charges start on the containers, beside the return date. */}
          <FieldInput label={ar ? 'تاريخ تحمّل الأرضيات' : 'Demurrage start date'} type="date" value={c.demurrageStartDate ? String(c.demurrageStartDate).slice(0, 10) : ''} onSave={(v) => patch({ demurrageStartDate: v })} disabled={!canEdit} />
          <FieldInput label={ar ? 'المدينة' : 'City'} value={c.city} onSave={(v) => patch({ city: v })} disabled={!canEdit} />
          <FieldSelect label={ar ? 'الشهر' : 'Month'} value={String(c.periodMonth || '')} disabled={!canEdit}
            options={[['', '—'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), MONTH_LABELS[i][ar ? 0 : 1]] as [string, string])]}
            onSave={(v) => patch({ periodMonth: v ? Number(v) : null })} />
          <FieldInput label={ar ? 'السنة' : 'Year'} type="number" value={c.periodYear} onSave={(v) => patch({ periodYear: v ? Number(v) : null })} disabled={!canEdit} />
          </div>
        </Card>

        {/* Side column: documents, then notes. Agent papers and email templates were removed at the department's request: the first duplicates the transaction documents and the second is ready text no longer used. */}
        <div className="space-y-6">
          <Card icon={<Check className="w-4 h-4" />} title={T.documentsChecklist}>
            <div className="space-y-1">
              <Toggle label={T.docBl} on={c.documents?.bl} onToggle={(v) => patch({ documents: { bl: v } })} disabled={!canEdit} />
              <Toggle label={T.docCommercialInvoice} on={c.documents?.commercialInvoice} onToggle={(v) => patch({ documents: { commercialInvoice: v } })} disabled={!canEdit} />
              <Toggle label={T.docCertificateOfOrigin} on={c.documents?.certificateOfOrigin} onToggle={(v) => patch({ documents: { certificateOfOrigin: v } })} disabled={!canEdit} />
              <Toggle label={T.docPackingList} on={c.documents?.packingList} onToggle={(v) => patch({ documents: { packingList: v } })} disabled={!canEdit} />
              <Toggle label={T.docSaber} on={c.documents?.saber} onToggle={(v) => patch({ documents: { saber: v } })} disabled={!canEdit} />
            </div>
          </Card>

          <ClearanceNotes clearance={c} canEdit={canEdit} ar={ar} onChanged={fetchOne} notify={notify} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-3" icon={<Ship className="w-4 h-4" />} title={T.transactionData}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Unused fields are not asked for: invoice type, invoice number and currency were three fields in every transaction that nobody filled or read, and the department says they are not its work; a displayed field nobody fills teaches people to skip fields. Numbers saved before remain in the log, only not displayed. */}
          {/* Five fields plus the branch, the same as the create fields. The department kept the waybill number, customer, container count, shipping agent and customs item, and the rest is unnecessary. The branch is written at creation so it does not become a field typed and never corrected. Customer and agent are chosen from their files as in creation, not free text that separates the transaction from its owner's file. Removed fields remain in the log with their values, only not displayed. */}
          <FieldInput label={T.blNumber} value={c.blNumber} onSave={(v) => patch({ blNumber: v })} disabled={!canEdit} />
          <div>
            <label className="text-slate-500 text-xs mb-1 block">{T.customerName}</label>
            <SearchableSelect value={String((c as any).customerParty || '')} searchAfter={0} disabled={!canEdit}
              onChange={(v) => patch({ customerParty: v || null, customerName: (parties.customers.find((p) => p._id === v) || {}).name || (v ? c.customerName : '') })}
              placeholder={c.customerName || (ar ? 'اختر العميل…' : 'Pick customer…')}
              searchPlaceholder={ar ? 'اكتب اسم العميل…' : 'Type customer name…'}
              emptyLabel={ar ? 'لا نتائج — أضِفه من صفحة العملاء' : 'No match — add from customers page'}
              options={parties.customers.map((p) => ({ value: p._id, label: p.name }))} />
          </div>
          {/* Transaction type is chosen at creation and corrected from here: cars have no container return, so that stage is closed on them. */}
          <FieldSelect label={ar ? 'نوع المعاملة' : 'Transaction type'} value={cargo} disabled={!canEdit}
            options={[['containers', ar ? 'حاويات' : 'Containers'], ['vehicles', ar ? 'سيّارات' : 'Vehicles']]}
            onSave={(v) => patch({ cargoType: v } as any)} />
          <FieldInput label={cargo === 'vehicles' ? (ar ? 'عدد السيّارات' : 'Vehicles') : T.containerCount} type="number" value={c.containerCount} onSave={(v) => patch({ containerCount: Number(v) || 0 })} disabled={!canEdit} />
          <div>
            <label className="text-slate-500 text-xs mb-1 block">{T.shippingAgent}</label>
            <SearchableSelect value={String((c as any).agentParty || '')} searchAfter={0} disabled={!canEdit}
              onChange={(v) => {
                const a = parties.agents.find((p) => p._id === v);
                patch({ agentParty: v || null, shippingAgent: a?.name || (v ? c.shippingAgent : ''), shippingAgentEmail: a?.email || '' });
              }}
              placeholder={c.shippingAgent || (ar ? 'اختر الوكيل…' : 'Pick agent…')}
              searchPlaceholder={ar ? 'اكتب اسم الوكيل…' : 'Type agent name…'}
              emptyLabel={ar ? 'لا نتائج — أضِفه من صفحة الوكلاء' : 'No match — add from agents page'}
              options={parties.agents.map((p) => ({ value: p._id, label: p.name }))} />
          </div>
          <FieldInput label={T.hsCode} value={c.hsCode} onSave={(v) => patch({ hsCode: v })} disabled={!canEdit} />
          <FieldSelect label={T.branch} value={c.branch} options={[['jeddah', T.jeddah], ['dammam', T.dammam]]} onSave={(v) => patch({ branch: v })} disabled={!canEdit} />
          {/* The expected date of an upcoming transaction is editable from here too, as from its window. */}
          {(c as any).upcoming && (
            <FieldInput label={ar ? 'تاريخ المعاملة المتوقَّع' : 'Expected date'} type="date" value={(c as any).expectedDate || ''} onSave={(v) => patch({ expectedDate: v })} disabled={!canEdit} />
          )}
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Master-spreadsheet data. */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Declaration & scheduling */}

        {/* Payment stages. They used to be eight rows in code, one date each, with no attachment and no repeats. They are now a list managed from the department settings, each entry with its date and attachment; see `components/customs/PaymentStages`. */}
        <Card title={ar ? 'مراحل السداد' : 'Payment milestones'}>
          <PaymentStages
            clearanceId={String(c._id)}
            refNumber={c.blNumber || c.refNumber}
            invoiceNumber={invoiceNumber}
            awaitingTransport={awaitingTransport}
            onIssueInvoice={() => setInvoiceOpen(true)}
            entries={(c as any).paymentStages || []}
            completed={(c as any).isCompleted}
            completedByName={(c as any).completedByName}
            completedAt={(c as any).completedAt}
            canEdit={canEdit}
            ar={ar}
            onChanged={(cl) => setC(cl)} />
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
          <p className="mt-2 text-slate-500 text-xs">
            {ar ? 'تُملأ البنود تلقائيًّا بمبلغ مرحلة السداد حين تؤكّد الإدارة المالية الدفع، وتبقى قابلة للتعديل.'
              : 'Lines fill automatically with the payment-stage amount once Finance confirms payment, and stay editable.'}
          </p>
        </Card>

        {/* Revenue & billing */}
        <Card title={ar ? 'الإيرادات والفوترة' : 'Revenue & billing'}>
          {/* From the customer contract: contract prices are filled in automatically on creation and when the customer or container count changes, and remain editable. Filling manually is also possible from here. */}
          {contractInfo !== undefined && (
            contractInfo ? (
              <div className="mb-4 rounded-lg border border-[#f37121]/30 bg-[#f37121]/5 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="w-4 h-4 text-[#f37121]" />
                  <span className="text-[12.5px] font-semibold text-slate-800">
                    {ar ? 'من عقد العميل:' : 'From the customer contract:'} <bdi>{contractInfo.title || contractInfo.contractNumber || '—'}</bdi>
                  </span>
                  {canEdit && (
                    <button type="button" onClick={() => applyContract()} disabled={contractBusy}
                      className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-1.5 text-[11.5px] font-bold text-white hover:bg-[#e06010] disabled:opacity-50">
                      {contractBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      {ar ? 'تعبئة من العقد' : 'Fill from contract'}
                    </button>
                  )}
                </div>
                {contractRoutes.length > 0 && (
                  <FieldSelect label={ar ? 'وجهة النقل من الميناء إلى العميل' : 'Port → customer route'}
                    value={routeIdx >= 0 ? String(routeIdx) : ''} disabled={!canEdit || contractBusy}
                    options={[['', '—'], ...contractRoutes.map((rt, i) => [String(i),
                      `${rt.from || '—'} → ${rt.to || '—'} · ${rt.price != null ? sar(Number(rt.price)) : '—'}`] as [string, string])]}
                    onSave={(v) => { if (v !== '') applyContract(contractRoutes[Number(v)]); }} />
                )}
              </div>
            ) : (
              <p className="mb-4 text-[12px] text-slate-400">{ar ? 'لا يوجد عقد ساري بأسعار لهذا العميل' : 'No active contract with prices for this customer'}</p>
            )
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {REVENUE_FIELDS.map(([key, arLabel, enLabel]) => (COMPUTED_REVENUE.has(key) ? (
              <div key={key}>
                <p className="text-[11px] text-slate-500 mb-1">{ar ? arLabel : enLabel}</p>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{sar(revVal(key))}</span>
                  <span className="text-[10px] text-slate-400">
                    {ar ? (COMPUTED_HINT[key] || ['', ''])[0] : (COMPUTED_HINT[key] || ['', ''])[1]}
                  </span>
                </div>
              </div>
            ) : NULLABLE_REVENUE.has(key) ? (
              <FieldInput key={key} label={ar ? arLabel : enLabel} type="number"
                value={c.revenue?.[key] === null || c.revenue?.[key] === undefined ? '' : c.revenue[key]}
                onSave={(v) => patch({ revenue: { [key]: v === '' ? null : (Number(v) || 0) } })} disabled={!canEdit} />
            ) : key === 'clearanceFee' ? (
              <div key={key}>
                <FieldInput label={ar ? arLabel : enLabel} type="number" value={c.revenue?.[key] ?? 0}
                  onSave={(v) => patch({ revenue: { [key]: Number(v) || 0 } })} disabled={!canEdit} />
                <p className="mt-1 text-[10.5px] text-slate-400">
                  {ar ? 'أجور التخليص = سعر الحاوية في العقد × عدد الحاويات' : 'Clearance fee = contract price per container × container count'}
                </p>
              </div>
            ) : (
              <FieldInput key={key} label={ar ? arLabel : enLabel} type="number" value={c.revenue?.[key] ?? 0}
                onSave={(v) => patch({ revenue: { [key]: Number(v) || 0 } })} disabled={!canEdit} />
            )))}
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
        </Card>
      </div>

      {/* Customer, agent and carrier data and attachments are not shown here; they live in each party's own file page (customers, shipping agents, carriers). */}

      {/* Transaction attachments: each stage's papers tagged with the stage. */}
      <ClearanceAttachments
        clearanceId={c._id}
        refNumber={c.blNumber || c.refNumber}
        items={c.attachments || []}
        // The attachment list is the payment stages from the department settings; files uploaded earlier under an old stage stay in their group.
        stages={[...payDefs.map((x) => x.key), ...[...new Set(((c.attachments || []) as any[]).map((a) => a.stage).filter(Boolean))].filter((k) => !payDefs.some((x) => x.key === k))]}
        stageLabel={(k: string) => { const x = payDefs.find((d) => d.key === k); return x ? (ar ? x.nameAr : (x.nameEn || x.nameAr)) : sName(k); }}
        paymentFiles={((c as any).paymentStages || []).map((p: any) => p.fileUrl).filter(Boolean)}
        canEdit={canEdit}
        onChange={setC}
      />

      {/* Work-plan (JP) tasks linked to this transaction; read and added from here. */}
      <ClearanceTasks kind="clearance" refId={String(c._id)} ar={ar} />

      {/* One invoice window, opened from the header, the payment stages and its stage. */}
      <CloseWithInvoice
        open={invoiceOpen} onClose={() => setInvoiceOpen(false)}
        clearanceId={String(c._id)} stages={(c as any).paymentStages || []} ar={ar}
        transportReceived={!!(c as any).transportInvoiceReceived}
        onDone={setC} notify={notify}
      />

    </div>
  );
}

const MONTH_LABELS: [string, string][] = [
  ['يناير', 'January'], ['فبراير', 'February'], ['مارس', 'March'], ['أبريل', 'April'],
  ['مايو', 'May'], ['يونيو', 'June'], ['يوليو', 'July'], ['أغسطس', 'August'],
  ['سبتمبر', 'September'], ['أكتوبر', 'October'], ['نوفمبر', 'November'], ['ديسمبر', 'December'],
];

/** Page card: a light header with an icon and a line under it. Each header used to be a black rectangle inside a white card, six black blotches on a light page that weighed the screen down and signified nothing. See /system theme. */
function Card({ title, icon, right, children, className = '' }: {
  title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          {icon && <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center">{icon}</span>}
          {title}
        </h3>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
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
