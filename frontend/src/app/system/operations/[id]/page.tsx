'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getOperationsTranslations, getOperationsIdExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Edit, Lock, Unlock, Loader2, CheckCircle2,
  ArrowRight, Save, X, Trash2
} from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

interface Workflow {
  _id: string;
  reportNumber: string;
  reportDate: string;
  fromLocation: string;
  toLocation: string;
  branch: string;
  carOwner: string;
  carNumber: string;
  ownerType: string;
  executionStatus: string;
  applicationStatus: string;
  paymentMethod: string;
  username: string;
  taxIndicator: string;
  purchaseValue: number;
  sellingValue: number;
  loadingTime: string;
  driverRentalType: string;
  reference: string;
  userPhone: string;
  driverName: string;
  driverPhone: string;
  carName: string;
  plateNumber: string;
  truckType: string;
  truckSize: string;
  loadType: string;
  quantity: string;
  goodsValue: number;
  representativeName: string;
  country: string;
  operationsReview: string;
  paymentDate: string;
  payingBranch: string;
  finalReportDestination: string;
  documentNumber: string;
  sendingDate: string;
  deliveryDate: string;
  accountingReview: string;
  invoiceNumber: string;
  netInvoice: number;
  tax: number;
  totalInvoice: number;
  invoiceDate: string;
  invoiceNotes: string;
  collectionDate: string;
  stage: string;
  lockedBy: { _id: string; firstName: string; lastName: string } | null;
  lockedByName: string;
  lockedAt: string | null;
  createdBy: { _id: string; firstName: string; lastName: string } | null;
  lastModifiedBy: { _id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-slate-500', bg: 'bg-slate-500/20' },
  submitted_to_ops: { label: 'Submitted to Ops', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  ops_completed: { label: 'Ops Completed', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  submitted_to_collections: { label: 'To Collections', color: 'text-purple-600', bg: 'bg-purple-500/20' },
  completed: { label: 'Completed', color: 'text-green-600', bg: 'bg-green-500/20' },
};

const SECTIONS = [
  {
    title: 'Application Details', titleAr: 'بيانات الطلب', group: 'application', color: 'border-cyan-600', headerColor: 'text-cyan-700',
    fields: [
      { key: 'reportNumber', label: 'رقم كشف التخريج', labelEn: 'Report Number' },
      { key: 'reportDate', label: 'تاريخ الكشف', labelEn: 'Report Date', type: 'date' },
      { key: 'loadingTime', label: 'وقت التحميل', labelEn: 'Loading Time' },
      { key: 'fromLocation', label: 'عنوان الشحن', labelEn: 'Shipping Address' },
      { key: 'toLocation', label: 'عنوان الوصول', labelEn: 'Arrival Address' },
      { key: 'branch', label: 'الفرع', labelEn: 'Branch' },
      { key: 'carOwner', label: 'مالك السيارة', labelEn: 'Car Owner' },
      { key: 'carNumber', label: 'رقم السيارة', labelEn: 'Car Number' },
      { key: 'ownerType', label: 'نوع المالك', labelEn: 'Owner Type' },
      { key: 'executionStatus', label: 'حالة التنفيذ', labelEn: 'Execution Status' },
      { key: 'applicationStatus', label: 'الحالة', labelEn: 'Status' },
      { key: 'driverRentalType', label: 'نوع تأجير السائق', labelEn: 'Driver Rental Type' },
      { key: 'username', label: 'اسم المستخدم', labelEn: 'Username' },
      { key: 'paymentMethod', label: 'طريقة الدفع', labelEn: 'Payment Method' },
      { key: 'purchaseValue', label: 'سعر الشراء', labelEn: 'Purchase Value', type: 'number' },
      { key: 'sellingValue', label: 'سعر البيع', labelEn: 'Selling Value', type: 'number' },
      { key: 'reference', label: 'رقم المرجع', labelEn: 'Reference' },
      { key: 'userPhone', label: 'هاتف المستخدم', labelEn: 'User Phone' },
      { key: 'driverName', label: 'اسم السائق', labelEn: 'Driver Name' },
      { key: 'driverPhone', label: 'هاتف السائق', labelEn: 'Driver Phone' },
      { key: 'carName', label: 'اسم السيارة', labelEn: 'Car Name' },
      { key: 'plateNumber', label: 'رقم اللوحة', labelEn: 'Plate Number' },
      { key: 'truckType', label: 'نوع الشاحنة', labelEn: 'Truck Type' },
      { key: 'truckSize', label: 'حجم الشاحنة', labelEn: 'Truck Size' },
      { key: 'loadType', label: 'نوع الحمولة', labelEn: 'Load Type' },
      { key: 'quantity', label: 'الكمية', labelEn: 'Quantity' },
      { key: 'goodsValue', label: 'قيمة البضائع', labelEn: 'Goods Value', type: 'number' },
      { key: 'representativeName', label: 'اسم المندوب', labelEn: 'Representative' },
      { key: 'country', label: 'اسم الدولة', labelEn: 'Country' },
    ],
  },
  {
    title: 'Operations Review', titleAr: 'مراجعه التشغيل', group: 'operations', color: 'border-teal-600', headerColor: 'text-teal-700',
    fields: [
      { key: 'operationsReview', label: 'مراجعه التشغيل', labelEn: 'Operations Review' },
    ],
  },
  {
    title: 'Manual Moderator', titleAr: 'بيانات المودريتور', group: 'manual_moderator', color: 'border-orange-600', headerColor: 'text-orange-600',
    fields: [
      { key: 'paymentDate', label: 'تاريخ السداد', labelEn: 'Payment Date', type: 'date' },
      { key: 'payingBranch', label: 'الفرع المسدد', labelEn: 'Paying Branch' },
      { key: 'finalReportDestination', label: 'وجهه الكشف النهائي', labelEn: 'Final Report Dest.' },
      { key: 'documentNumber', label: 'رقم السند', labelEn: 'Document Number' },
      { key: 'sendingDate', label: 'تاريخ الارسال', labelEn: 'Sending Date', type: 'date' },
      { key: 'deliveryDate', label: 'تاريخ التسليم', labelEn: 'Delivery Date', type: 'date' },
      { key: 'accountingReview', label: 'مراجعه الحسابات', labelEn: 'Accounting Review' },
    ],
  },
  {
    title: 'Collections', titleAr: 'بيانات التحصيل', group: 'collections', color: 'border-blue-600', headerColor: 'text-blue-600',
    fields: [
      { key: 'invoiceNumber', label: 'رقم الفاتوره', labelEn: 'Invoice Number' },
      { key: 'netInvoice', label: 'صافي الفاتوره', labelEn: 'Net Invoice', type: 'number' },
      { key: 'tax', label: 'ضريبه', labelEn: 'Tax', type: 'number' },
      { key: 'totalInvoice', label: 'اجمالى الفاتوره', labelEn: 'Total Invoice', type: 'number' },
      { key: 'invoiceDate', label: 'تاريخ الفاتوره', labelEn: 'Invoice Date', type: 'date' },
      { key: 'invoiceNotes', label: 'ملاحظات الفاتوره', labelEn: 'Invoice Notes' },
      { key: 'collectionDate', label: 'تاريخ التحصيل', labelEn: 'Collection Date', type: 'date' },
    ],
  },
];

const ROLE_EDITABLE_GROUPS: Record<string, string[]> = {
  super_admin: ['application', 'operations_staff', 'manual_moderator', 'collections'],
  moderator: ['application', 'manual_moderator'],
  operations_manager: ['operations_staff'],
  operations: ['application'],
  admin: ['collections'],
  employee: ['collections'],
};

export default function WorkflowDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOperationsTranslations(lang);
  const txx = getOperationsIdExtraTranslations(lang);

  const stageLabels: Record<string, string> = {
    draft: T.draft,
    submitted_to_ops: T.submittedToOps,
    ops_completed: T.opsCompleted,
    submitted_to_collections: T.toCollections,
    completed: T.completedStage,
  };
  const startInEdit = searchParams.get('edit') === '1';

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [transitioning, setTransitioning] = useState(false);

  const role = user?.role || '';

  const canEditGroup = (group: string) => (ROLE_EDITABLE_GROUPS[role] || []).includes(group);

  const fetchWorkflow = useCallback(async () => {
    try {
      const data = await api.get<Workflow>(`/api/workflows/${id}`);
      setWorkflow(data);
      // Populate form data
      const fd: Record<string, any> = {};
      SECTIONS.forEach((s) => s.fields.forEach((f) => { fd[f.key] = (data as any)[f.key] || ''; }));
      setFormData(fd);
    } catch (err: any) {
      setError(err.message || T.workflowNotFound);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchWorkflow(); }, [fetchWorkflow]);

  // Auto-enter edit if ?edit=1
  useEffect(() => {
    if (startInEdit && workflow && !editing) {
      handleStartEdit();
    }
  }, [workflow, startInEdit]);

  // Real-time updates
  const handleRealTimeUpdate = useCallback((wf: Workflow) => {
    if (wf._id === id) {
      setWorkflow(wf);
      if (!editing) {
        const fd: Record<string, any> = {};
        SECTIONS.forEach((s) => s.fields.forEach((f) => { fd[f.key] = (wf as any)[f.key] || ''; }));
        setFormData(fd);
      }
    }
  }, [id, editing]);

  const handleRealTimeLock = useCallback((d: any) => {
    if (d._id === id) {
      setWorkflow((prev) => prev ? { ...prev, lockedBy: d.lockedBy, lockedByName: d.lockedByName, lockedAt: d.lockedAt } : prev);
    }
  }, [id]);

  const handleRealTimeUnlock = useCallback((d: { _id: string }) => {
    if (d._id === id) {
      setWorkflow((prev) => prev ? { ...prev, lockedBy: null, lockedByName: '', lockedAt: null } : prev);
    }
  }, [id]);

  useSocket('workflow:updated', handleRealTimeUpdate);
  useSocket('workflow:stageChanged', handleRealTimeUpdate);
  useSocket('workflow:locked', handleRealTimeLock);
  useSocket('workflow:unlocked', handleRealTimeUnlock);

  // ── Edit / Lock ──
  const handleStartEdit = async () => {
    if (!workflow) return;
    try {
      await api.post(`/api/workflows/${workflow._id}/lock`);
      setEditing(true);
      setError('');
    } catch (err: any) {
      setError(err.message || T.failedToLock);
    }
  };

  /**
   * حذف الكشف — للمدير الأعلى وحده، وبتأكيدٍ يذكر رقمه.
   * ما يُحذف هنا يختفي من تقارير التشغيل والتحصيل معًا، فالتأكيد يذكر ما
   * يُحذف بالاسم لا «هل أنت متأكد؟».
   */
  const handleDeleteWorkflow = async () => {
    if (!workflow) return;
    if (!window.confirm(lang === 'ar'
      ? `حذف الكشف ${workflow.reportNumber} نهائيًّا؟ يختفي من تقارير التشغيل والتحصيل.`
      : `Permanently delete report ${workflow.reportNumber}? It leaves the operations and collections reports.`)) return;
    try {
      await api.delete(`/api/workflows/${workflow._id}`);
      router.push('/system/operations');
    } catch (e: any) {
      setError(e?.message || 'Failed');
    }
  };

  const handleCancelEdit = async () => {
    if (workflow) {
      try { await api.post(`/api/workflows/${workflow._id}/unlock`); } catch {}
    }
    setEditing(false);
    // Reset form data
    if (workflow) {
      const fd: Record<string, any> = {};
      SECTIONS.forEach((s) => s.fields.forEach((f) => { fd[f.key] = (workflow as any)[f.key] || ''; }));
      setFormData(fd);
    }
  };

  const handleSave = async () => {
    if (!workflow) return;
    try {
      setSaving(true);
      setError('');
      await api.put(`/api/workflows/${workflow._id}`, formData);
      try { await api.post(`/api/workflows/${workflow._id}/unlock`); } catch {}
      setEditing(false);
      setSuccess(T.changesSavedSuccess);
      setTimeout(() => setSuccess(''), 3000);
      fetchWorkflow();
    } catch (err: any) {
      setError(err.message || T.failedToSave);
    } finally {
      setSaving(false);
    }
  };

  // ── Stage Transition ──
  const getTransitions = () => {
    if (!workflow) return [];
    const map: Record<string, { stage: string; label: string; roles: string[] }[]> = {
      // ── «إرسال للتشغيل» أُزيل ──────────────────────────────────────────
      // الكشوفُ تصل من منصّة التشغيل وهي جاريةٌ هناك أصلًا، فلا معنى لإرسالها
      // إليها من عندنا. والزرُّ بقي من زمنٍ كانت تُنشأ فيه الكشوفُ هنا يدويًّا.
      draft: [],
      submitted_to_ops: [
        { stage: 'ops_completed', label: T.markOpsComplete, roles: ['operations_manager', 'super_admin'] },
        { stage: 'draft', label: T.returnToDraft, roles: ['operations_manager', 'super_admin'] },
      ],
      ops_completed: [
        { stage: 'submitted_to_collections', label: T.submitToCollections, roles: ['operations_manager', 'super_admin'] },
        { stage: 'submitted_to_ops', label: T.returnToOps, roles: ['operations_manager', 'super_admin'] },
      ],
      submitted_to_collections: [
        { stage: 'completed', label: T.markComplete, roles: ['admin', 'employee', 'super_admin'] },
        { stage: 'ops_completed', label: T.returnToOps, roles: ['admin', 'employee', 'super_admin'] },
      ],
      completed: [],
    };
    return (map[workflow.stage] || []).filter((t) => t.roles.includes(role));
  };

  const handleTransition = async (stage: string) => {
    if (!workflow) return;
    try {
      setTransitioning(true);
      await api.put(`/api/workflows/${workflow._id}/stage`, { stage });
      setSuccess(T.stageUpdated);
      setTimeout(() => setSuccess(''), 3000);
      fetchWorkflow();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTransitioning(false);
    }
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
  const formatNumber = (v: number) => v ? v.toLocaleString() : '-';

  const isLockedByOther = workflow?.lockedBy && workflow.lockedBy._id !== user?._id &&
    (!workflow.lockedAt || Date.now() - new Date(workflow.lockedAt).getTime() < 5 * 60 * 1000);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!workflow) {
    // ── ورابطٌ قديمٌ ليس كشفًا مفقودًا ──────────────────────────────────────
    // هذا المسار يبتلع كلَّ ما بعد `/system/operations/`، فرابطٌ محفوظٌ لصفحةٍ
    // أُزيلت (كشوف التخريج مثلًا) يصل إلى هنا فيُقال له «الكشف غير موجود» —
    // وهو لم يطلب كشفًا. ومعرّفُ الكشف أربعٌ وعشرون خانةً ستّ عشريّة، فما ليس
    // كذلك ليس رقمَ كشفٍ أصلًا، ويُقال له الصوابُ: هذه الصفحة أُزيلت.
    const looksLikeId = /^[0-9a-f]{24}$/i.test(String(id || ''));
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">
          {looksLikeId
            ? (error || T.workflowNotFound)
            : (lang === 'ar' ? 'هذه الصفحة لم تعد موجودة.' : 'This page no longer exists.')}
        </p>
        <button type="button" onClick={() => router.push('/system/operations')} className="text-[#f37121] mt-2 text-sm hover:underline">{T.goBack}</button>
      </div>
    );
  }

  const sc = STAGE_CONFIG[workflow.stage] || STAGE_CONFIG.draft;
  const transitions = getTransitions();

  // شاشةُ عمليّةٍ واحدة: الملفّ صفٌّ واحد هو هذه العمليّة بحقولها كلّها — لا فلترَ
  // هنا ولا ترقيم، ونطاقٌ ثانٍ سيُخرج الملفَّ نفسه ويوهم بأنّ أمام المصدِّر اختيارًا.
  const exportColumns: ExportColumn[] = SECTIONS.flatMap((sec) => sec.fields).map((f: any) => ({
    header: f.labelEn || f.label,
    key: f.key,
    transform: f.type === 'date' ? fmt.date : f.type === 'number' ? fmt.money : undefined,
    width: 18,
  }));
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: txx.workflowDetailsSheet, rows: [workflow as unknown as Record<string, any>], columns: exportColumns }] },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => router.push('/system/operations')} title={T.back} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{workflow.reportNumber}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.color}`}>{stageLabels[workflow.stage] || sc.label}</span>
              {workflow.carOwner && <span className="text-slate-500 text-sm">{workflow.carOwner}</span>}
              {isLockedByOther && (
                <span className="text-red-600 text-xs flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {T.editingBy.replace('{name}', workflow.lockedByName)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!editing && (
            <ExportMenu fileName={`operation-${workflow.reportNumber || workflow._id}`} lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={T.exportExcel} options={exportOptions} />
          )}
          {editing ? (
            <>
              <button type="button" onClick={handleCancelEdit} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm hover:bg-slate-200 transition-colors">
                {T.cancel}
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {T.save}
              </button>
            </>
          ) : (
            !isLockedByOther && (
              <>
                <button type="button" onClick={handleStartEdit} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm hover:bg-slate-200 transition-colors flex items-center gap-2">
                  <Edit className="w-4 h-4" /> {T.edit}
                </button>
                {/* الحذف للمدير الأعلى وحده: الكشف قيدٌ ماليّ يدخل في تقارير
                    التشغيل والتحصيل، وحذفُه ينقص رقمًا اطّلع عليه غيرُ واحد. */}
                {role === 'super_admin' && (
                  <button type="button" onClick={handleDeleteWorkflow}
                    title={lang === 'ar' ? 'حذف الكشف' : 'Delete report'}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            )
          )}
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{error}</div>}
      {success && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-600 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{success}</div>}

      {/* Stage transitions */}
      {transitions.length > 0 && !editing && (
        <div className="flex flex-wrap gap-2">
          {transitions.map((t) => (
            <button key={t.stage} type="button" onClick={() => handleTransition(t.stage)} disabled={transitioning}
              className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm hover:border-[#f37121]/50 hover:text-slate-900 transition-colors flex items-center gap-2 disabled:opacity-50">
              {transitioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Field sections */}
      {SECTIONS.map((section) => {
        const editable = editing && canEditGroup(section.group);
        return (
          <div key={section.group} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className={`px-6 py-3 border-b border-slate-200 border-l-4 ${section.color} flex items-center justify-between`}>
              <h2 className={`font-semibold text-sm ${section.headerColor}`}>
                {section.title} <span className="text-slate-500 text-xs font-normal">({section.titleAr})</span>
              </h2>
              {editing && !canEditGroup(section.group) && (
                <span className="text-slate-500 text-xs flex items-center gap-1"><Lock className="w-3 h-3" /> {T.readOnlyForRole}</span>
              )}
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.fields.map((field) => {
                  const val = formData[field.key];
                  return (
                    <div key={field.key}>
                      <label className="block text-slate-500 text-xs mb-1.5">
                        {field.label} <span className="text-slate-600">({field.labelEn})</span>
                      </label>
                      {editable ? (
                        <input
                          type={field.type || 'text'}
                          value={field.type === 'date' && val ? String(val).split('T')[0] : val || ''}
                          onChange={(e) => setFormData({ ...formData, [field.key]: field.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
                          title={field.label}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]"
                        />
                      ) : (
                        <p className="text-slate-900 text-sm py-2">
                          {field.type === 'date' ? formatDate(val) : field.type === 'number' ? formatNumber(val) : val || <span className="text-slate-600">-</span>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {/* Meta info */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-slate-500 text-xs uppercase font-medium mb-3">{T.recordInfo}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-slate-500 text-xs">{T.createdBy}</p>
            {/* ── ولا يُنسَب المنقولُ إلى إنسان ──────────────────────────────
                كانت المزامنةُ تختم كلَّ كشفٍ تنشئه باسم أوّلِ سوبر أدمنَ تجده
                في القاعدة، فقرأ أربعةٌ وثلاثون ألفَ كشفٍ «أنشأتها فتون» وهي
                لم تفتح واحدًا منها. والمنقولُ لا مُنشئَ له عندنا — ومصدرُه
                يُقال بدل أن تُترك الخانةُ فارغةً بلا تفسير. */}
            <p className="text-slate-700 mt-0.5">
              {workflow.createdBy
                ? `${workflow.createdBy.firstName} ${workflow.createdBy.lastName}`
                : ((workflow as any).externalSource
                  ? (lang === 'ar' ? 'منصّة التشغيل (تلقائيًّا)' : 'Operations platform (automatic)')
                  : '-')}
            </p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">{T.createdAt}</p>
            <p className="text-slate-700 mt-0.5">{formatDate(workflow.createdAt)}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">{T.lastModifiedBy}</p>
            <p className="text-slate-700 mt-0.5">{workflow.lastModifiedBy ? `${workflow.lastModifiedBy.firstName} ${workflow.lastModifiedBy.lastName}` : '-'}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">{T.updatedAt}</p>
            <p className="text-slate-700 mt-0.5">{formatDate(workflow.updatedAt)}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
