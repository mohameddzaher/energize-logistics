'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import { getB2CTranslations, getB2cRepsPerformanceTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Upload, FileSpreadsheet, X, Check, AlertCircle, RefreshCw, BarChart3, ArrowRight, Trash2, Cloud, Link2, Power, Zap, Copy, Eye, EyeOff, Plus, Edit3, Download } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/context/AuthContext';
import { parseRepsExcel, buildBulkPayload, buildDiagnosticReport, type ExcelParseResult } from '@/lib/b2cExcelParser';
import { exportToExcel } from '@/utils/exportExcel';

interface Project { _id: string; name: string; code?: string; color?: string }
interface Branch { _id: string; name: string; city?: string }
interface Upload {
  _id: string;
  fileName?: string;
  monthsDetected: string[];
  repsDetected: number;
  daysInserted: number;
  daysUpdated: number;
  daysSkipped: number;
  warnings: string[];
  uploadedBy?: { firstName: string; lastName: string };
  createdAt: string;
  mode: string;
}

export default function RepsPerformancePage() {
  const { confirm, notify } = useDialog();
  const { lang } = useLanguage();
  const { user } = useAuth();
  const T = getB2CTranslations(lang);
  const tx = getB2cRepsPerformanceTranslations(lang);
  const canCleanup = user && ['super_admin', 'admin', 'b2c_manager'].includes(user.role);

  const [projects, setProjects] = useState<Project[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);

  // Upload state
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [mode, setMode] = useState<'merge_new_only' | 'overwrite'>('merge_new_only');
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<ExcelParseResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<any | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup state
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupScope, setCleanupScope] = useState<'orders' | 'all'>('orders');
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any | null>(null);

  // Google Sheet sync — list of configs (one per project+branch)
  const [sheetConfigs, setSheetConfigs] = useState<any[]>([]);
  const [sheetError, setSheetError] = useState('');

  // Add-new form
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{
    project: string; branch: string; sheetUrl: string;
    intervalMinutes: number; syncMode: 'overwrite' | 'merge_new_only';
  }>({ project: '', branch: '', sheetUrl: '', intervalMinutes: 1, syncMode: 'overwrite' });
  const [addSaving, setAddSaving] = useState(false);

  // Edit-in-place state — only one row at a time
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    sheetUrl: string;
    intervalMinutes: number;
    syncMode: 'overwrite' | 'merge_new_only';
  }>({ sheetUrl: '', intervalMinutes: 1, syncMode: 'overwrite' });

  // Per-row busy state — only one action at a time per config
  const [busyConfigId, setBusyConfigId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'syncing' | 'saving' | 'deleting' | null>(null);

  // Real-time webhook setup — scoped to a specific config
  const [setupOpenId, setSetupOpenId] = useState<string | null>(null);
  const [setupScript, setSetupScript] = useState('');
  const [setupWebhookUrl, setSetupWebhookUrl] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const refreshSheetConfigs = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/b2c/google-sheet/configs');
      setSheetConfigs(data.configs || []);
    } catch {}
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [projData, branchData, uploadsData, sheetData] = await Promise.all([
        api.get<any>('/api/b2c/projects'),
        api.get<any>('/api/branches?active=true'),
        api.get<any>('/api/b2c/uploads'),
        api.get<any>('/api/b2c/google-sheet/configs').catch(() => ({ configs: [] })),
      ]);
      setProjects(projData.projects || []);
      setBranches(branchData.branches || []);
      setUploads(uploadsData.uploads || []);
      setSheetConfigs(sheetData?.configs || []);
    } catch (err: any) {
      setError(err.message || tx.failedToLoad);
    }
  }, []);

  // Refresh sheet status whenever any backend sync completes
  useSocket('b2c:sheet:synced', refreshSheetConfigs);

  const handleAddSheet = async () => {
    if (!addForm.project || !addForm.branch) {
      setSheetError(lang === 'ar' ? 'اختر المشروع والفرع' : 'Pick a project and a branch');
      return;
    }
    setAddSaving(true); setSheetError('');
    try {
      await api.post<any>('/api/b2c/google-sheet/configs', {
        project: addForm.project,
        branch: addForm.branch,
        sheetUrl: addForm.sheetUrl || undefined,
        intervalMinutes: addForm.intervalMinutes,
        syncMode: addForm.syncMode,
      });
      setAddOpen(false);
      setAddForm({ project: '', branch: '', sheetUrl: '', intervalMinutes: 1, syncMode: 'overwrite' });
      await refreshSheetConfigs();
    } catch (err: any) {
      setSheetError(err.message || tx.failedToAddSheet);
    } finally {
      setAddSaving(false);
    }
  };

  const startEditingConfig = (config: any) => {
    setEditingId(config._id);
    setEditForm({
      sheetUrl: config.sheetUrl || '',
      intervalMinutes: config.intervalMinutes || 15,
      syncMode: config.syncMode || 'overwrite',
    });
  };
  const cancelEditing = () => { setEditingId(null); };

  const handleSaveEdit = async (id: string) => {
    setBusyConfigId(id); setBusyAction('saving'); setSheetError('');
    try {
      await api.put<any>(`/api/b2c/google-sheet/configs/${id}`, editForm);
      setEditingId(null);
      await refreshSheetConfigs();
    } catch (err: any) {
      setSheetError(err.message || tx.failedToSave);
    } finally {
      setBusyConfigId(null); setBusyAction(null);
    }
  };

  const handleToggleEnable = async (id: string, currentEnabled: boolean) => {
    setBusyConfigId(id); setBusyAction('saving'); setSheetError('');
    try {
      await api.put<any>(`/api/b2c/google-sheet/configs/${id}`, { enabled: !currentEnabled });
      await refreshSheetConfigs();
    } catch (err: any) {
      setSheetError(err.message || tx.failedToToggle);
    } finally {
      setBusyConfigId(null); setBusyAction(null);
    }
  };

  const handleDeleteConfig = async (id: string) => {
    if (!(await confirm(lang === 'ar' ? 'تأكيد حذف هذا الـ Sheet config؟' : 'Delete this sheet config?'))) return;
    setBusyConfigId(id); setBusyAction('deleting'); setSheetError('');
    try {
      await api.delete<any>(`/api/b2c/google-sheet/configs/${id}`);
      if (editingId === id) setEditingId(null);
      if (setupOpenId === id) setSetupOpenId(null);
      await refreshSheetConfigs();
    } catch (err: any) {
      setSheetError(err.message || tx.failedToDelete);
    } finally {
      setBusyConfigId(null); setBusyAction(null);
    }
  };

  const handleSyncConfig = async (id: string) => {
    setBusyConfigId(id); setBusyAction('syncing'); setSheetError('');
    try {
      await api.post<any>(`/api/b2c/google-sheet/configs/${id}/sync-now`, {}, { timeoutMs: 180000 });
      await refreshSheetConfigs();
      // Refresh upload history so the latest entry shows up immediately
      const uploadsData = await api.get<any>('/api/b2c/uploads').catch(() => ({ uploads: [] }));
      setUploads(uploadsData.uploads || []);
    } catch (err: any) {
      setSheetError(err.message || tx.syncFailed);
    } finally {
      setBusyConfigId(null); setBusyAction(null);
    }
  };

  const handleOpenSetup = async (id: string) => {
    if (setupOpenId === id) {
      setSetupOpenId(null);
      return;
    }
    setSetupOpenId(id);
    setSetupLoading(true);
    setSetupScript(''); setSetupWebhookUrl(''); setSetupSecret('');
    try {
      const data = await api.get<{ script: string; webhookUrl: string; secret: string }>(`/api/b2c/google-sheet/configs/${id}/setup-script`);
      setSetupScript(data.script || '');
      setSetupWebhookUrl(data.webhookUrl || '');
      setSetupSecret(data.secret || '');
    } catch (err: any) {
      setSheetError(err.message || tx.failedToLoadSetupScript);
    } finally {
      setSetupLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      // Clipboard API can fail in non-HTTPS dev. Silent fallback.
    }
  };

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleFileSelect = async (file: File) => {
    setError(''); setParseResult(null); setUploadResult(null); setFileName(file.name);
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const result = parseRepsExcel(buf);
      result.fileName = file.name;
      if (result.records.length === 0) {
        setError(T.excelParseError);
        setParsing(false);
        return;
      }

      // Dump full diagnostic to console so user can scroll through what we read.
      // Each sheet prints separately; expand groups in DevTools Console.
      console.group(`%c[B2C Excel Parse] ${file.name}`, 'color:#f37121;font-weight:bold;font-size:13px');
      console.log('Records:', result.records.length, '| Reps:', result.uniqueReps, '| Months:', result.monthsDetected);
      console.log('Ignored sheets:', result.ignoredSheets);
      console.log('Warnings:', result.warnings);
      console.log('Duplicates (same ID# in same sheet):', result.duplicates);
      for (const d of result.diagnostics) {
        if (!d.matched) {
          console.log(`%c[skip] "${d.sheetName}" — ${d.reason}`, 'color:#9ca3af');
          continue;
        }
        console.group(`%c📅 ${d.monthLabel}  (sheet: "${d.sheetName}")`, 'color:#10b981;font-weight:bold');
        console.log('Header row:', d.headerRow);
        console.log('Identity columns:', d.identityColumns);
        console.log('Day columns (day → Excel column):', d.dayColumns);
        console.log(`Totals: orders=${d.totalOrders}, off=${d.totalDaysOff}, nulls=${d.totalNullDays}, rows=${d.rowsParsed}`);
        if (d.rows) {
          console.table(d.rows.map((r) => ({
            excelRow: r.excelRow,
            id: r.accountId,
            ar: r.arabicName,
            en: r.englishName,
            rowTotal: r.rowTotal,
            daysOff: r.daysOff,
            nulls: r.nullDays,
          })));
          console.log('Per-row daily values (first 10 rows):',
            d.rows.slice(0, 10).map((r) => ({ row: r.excelRow, en: r.englishName, ...r.daily })));
        }
        console.groupEnd();
      }
      console.groupEnd();
      console.log('%c💡 Click "Download Diagnostic" below to save the full report.',
        'color:#3b82f6');

      setParseResult(result);
    } catch (err: any) {
      setError(err.message || T.excelParseError);
    } finally {
      setParsing(false);
    }
  };

  const handleExportUploads = () => {
    exportToExcel(uploads, [
      { header: lang === 'ar' ? 'التاريخ' : 'Date', key: 'createdAt', width: 20, transform: (v) => v ? new Date(v).toLocaleString() : '' },
      { header: lang === 'ar' ? 'الملف' : 'File', key: 'fileName', width: 28, transform: (v) => v || '—' },
      { header: lang === 'ar' ? 'بواسطة' : 'By', key: 'uploadedBy', width: 22, transform: (v) => v ? `${v.firstName} ${v.lastName}` : '—' },
      { header: T.monthsDetected, key: 'monthsDetected', width: 24, transform: (v) => (v || []).join(', ') },
      { header: T.daysInserted, key: 'daysInserted', width: 12 },
      { header: T.daysUpdated, key: 'daysUpdated', width: 12 },
      { header: T.daysSkipped, key: 'daysSkipped', width: 12 },
    ], 'b2c-upload-history', lang === 'ar' ? 'سجل الرفع' : 'Upload History');
  };

  const handleDownloadDiagnostic = () => {
    if (!parseResult) return;
    const text = buildDiagnosticReport(parseResult);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `b2c-diagnostic-${(parseResult.fileName || 'upload').replace(/\.[^.]+$/, '')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  };

  const handleCleanup = async () => {
    setCleaningUp(true); setError(''); setCleanupResult(null);
    try {
      const result = await api.post<any>('/api/b2c/cleanup', { scope: cleanupScope }, { timeoutMs: 60000 });
      setCleanupResult(result);
      setShowCleanupModal(false);
      // Reset upload UI state after cleanup
      setParseResult(null);
      setFileName('');
      setUploadResult(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchAll();
    } catch (err: any) {
      setError(err.message || tx.cleanupFailed);
      setShowCleanupModal(false);
    } finally {
      setCleaningUp(false);
    }
  };

  const [reconciling, setReconciling] = useState(false);
  const handleReconcileReps = async () => {
    if (!(await confirm(lang === 'ar'
      ? 'هيدمج المناديب المكررين (نفس الاسم في نفس المشروع/الفرع) ويحوّل الأيام للمندوب الأصلي. تأكيد؟'
      : 'This merges duplicate reps (same name in same project/branch) and moves their daily orders into the canonical rep. Continue?'
    ))) return;
    setReconciling(true); setError('');
    try {
      const result = await api.post<{ ok: boolean; mergedGroups: number; repsRemoved: number; ordersRepointed: number }>('/api/b2c/reps/reconcile', {}, { timeoutMs: 300000 });
      const msg = lang === 'ar'
        ? `تم: ${result.mergedGroups} مجموعة متكررة · ${result.repsRemoved} مندوب اتشال · ${result.ordersRepointed} يوم اترحل`
        : `Done: ${result.mergedGroups} groups merged · ${result.repsRemoved} reps removed · ${result.ordersRepointed} orders repointed`;
      notify(msg);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || tx.failedToReconcile);
    } finally {
      setReconciling(false);
    }
  };

  // Match parsed records to existing reps; auto-create missing reps in batch.
  // Uses bulk-resolve + bulk-upsert endpoints. Handles thousands of rows in seconds.
  const handleConfirmUpload = async () => {
    if (!parseResult || parseResult.records.length === 0) return;
    setUploading(true); setError(''); setUploadResult(null);
    try {
      // Step 1: Build unique-rep payload. Send EVERY occurrence (no client-side dedup) —
      // the backend dedups by PERSON name (englishName + arabicName). Account IDs are
      // metadata; the same account can be operated by different people on different shifts.
      const norm = (s: string | null | undefined) =>
        String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const buildRepKey = (rec: { repIdNumber?: string | null; englishName?: string | null; arabicName?: string | null }): string => {
        const en = norm(rec.englishName);
        const ar = norm(rec.arabicName);
        if (en || ar) return `name:${en}|ar:${ar}`;
        return rec.repIdNumber ? `id:${rec.repIdNumber}` : '';
      };

      const uniqueReps: Array<{
        key: string;
        repId?: string | null;
        englishName?: string | null;
        arabicName?: string | null;
        joiningDate?: string | null;
        monthlyTarget?: number;
        dailyTarget?: number;
      }> = [];
      for (const rec of parseResult.records) {
        uniqueReps.push({
          key: buildRepKey(rec),
          repId: rec.repIdNumber,
          englishName: rec.englishName,
          arabicName: rec.arabicName,
          joiningDate: rec.joiningDate,
          monthlyTarget: rec.monthlyTarget,
          dailyTarget: rec.dailyTarget,
        });
      }

      // Step 2: Resolve all reps in ONE backend call (matches existing + creates missing)
      const resolveResp = await api.post<any>('/api/b2c/reps/bulk-resolve', {
        reps: uniqueReps,
        project: selectedProject || undefined,
        branch: selectedBranch || undefined,
      }, { timeoutMs: 120000 });

      const repIdMap = new Map<string, string>();
      (resolveResp.resolved || []).forEach((r: any) => repIdMap.set(r.key, r.repId));
      const createdCount = resolveResp.createdCount || 0;

      // Step 3: Build daily-order entries (using the same key shape as Step 1).
      // Default duplicate mode = first_wins (true duplicates by NAME are data errors;
      // different shifts on the same account ID resolve to different reps by name).
      const entries = buildBulkPayload(parseResult.records, (rec) => {
        return repIdMap.get(buildRepKey(rec)) || null;
      });

      // Step 4: Send entries in chunks (in case file is huge)
      const CHUNK_SIZE = 2000;
      let totalInserted = 0, totalUpdated = 0, totalSkipped = 0;
      let totalOrdersWritten = 0;
      let lastUpload: any = null;

      for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const isLast = i + CHUNK_SIZE >= entries.length;
        const result = await api.post<any>('/api/b2c/daily-orders/bulk', {
          entries: chunk,
          mode,
          source: 'excel',
          // Only attach upload metadata to the LAST chunk so we don't create N upload records
          uploadMeta: isLast ? {
            fileName,
            project: selectedProject || undefined,
            branch: selectedBranch || undefined,
            monthsDetected: parseResult.monthsDetected,
            repsDetected: parseResult.uniqueReps,
            repsCreated: createdCount,
            warnings: parseResult.warnings,
          } : undefined,
        }, { timeoutMs: 180000 });

        totalInserted += result.inserted || 0;
        totalUpdated += result.updated || 0;
        totalSkipped += result.skipped || 0;
        totalOrdersWritten += result.totalOrdersInPayload || 0;
        if (isLast) lastUpload = result;
      }

      const expectedTotal = parseResult.monthSummaries.reduce((s, m) => s + m.totalOrders, 0);
      setUploadResult({
        inserted: totalInserted,
        updated: totalUpdated,
        skipped: totalSkipped,
        repsCreated: createdCount,
        upload: lastUpload?.upload,
        totalOrdersWritten,
        expectedTotal,
      });
      setParseResult(null);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchAll();
    } catch (err: any) {
      setError(err.message || T.excelUploadFailed);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#f37121]" />
            {T.repsPerformanceTitle}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {lang === 'ar'
              ? 'ارفع ملف Excel متعدد الشيتات بأداء كل مندوب شهرياً، أو أدخل البيانات يدوياً من صفحة الإدخال اليومي'
              : 'Upload a multi-sheet Excel of monthly rep performance, or use the Daily Entry page for manual input'}
          </p>
        </div>
        {canCleanup && (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={handleReconcileReps} disabled={reconciling}
              className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 border border-amber-500/30 text-amber-700 rounded-lg text-sm font-medium transition-colors">
              {reconciling
                ? <div className="w-3.5 h-3.5 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {lang === 'ar' ? 'دمج المناديب المكررة' : 'Merge duplicate reps'}
            </button>
            <button type="button" onClick={() => { setCleanupScope('orders'); setShowCleanupModal(true); }}
              className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-600 rounded-lg text-sm font-medium transition-colors">
              <Trash2 className="w-4 h-4" />
              {lang === 'ar' ? 'تنظيف بيانات B2C' : 'Clean B2C Data'}
            </button>
          </div>
        )}
      </div>

      {cleanupResult && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
          className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
          <Check className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-blue-600 font-medium text-sm">
              {lang === 'ar' ? '🧹 تم التنظيف بنجاح' : 'Cleanup successful'}
            </p>
            <p className="text-slate-700 text-xs mt-1">
              {lang === 'ar'
                ? `تم حذف ${cleanupResult.ordersDeleted} يوم، ${cleanupResult.uploadsDeleted} رفعة${cleanupResult.repsDeleted > 0 ? `، ${cleanupResult.repsDeleted} مندوب` : ''}`
                : `Deleted ${cleanupResult.ordersDeleted} days, ${cleanupResult.uploadsDeleted} uploads${cleanupResult.repsDeleted > 0 ? `, ${cleanupResult.repsDeleted} reps` : ''}`}
            </p>
          </div>
          <button type="button" onClick={() => setCleanupResult(null)} className="text-blue-600 hover:text-blue-700" title={tx.close}><X className="w-4 h-4" /></button>
        </motion.div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-600 hover:text-red-700" title={tx.close}><X className="w-4 h-4" /></button>
        </div>
      )}

      {uploadResult && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-600 font-medium text-sm">
                {lang === 'ar' ? '✅ تم الرفع بنجاح!' : 'Upload successful!'}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-700 text-xs">{T.daysInserted}</p>
                  <p className="text-slate-900 font-bold text-lg">{uploadResult.inserted}</p>
                </div>
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-700 text-xs">{T.daysUpdated}</p>
                  <p className="text-slate-900 font-bold text-lg">{uploadResult.updated}</p>
                </div>
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-700 text-xs">{T.daysSkipped}</p>
                  <p className="text-slate-900 font-bold text-lg">{uploadResult.skipped}</p>
                </div>
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-700 text-xs">{T.repCreatedFromExcel}</p>
                  <p className="text-slate-900 font-bold text-lg">{uploadResult.repsCreated || 0}</p>
                </div>
              </div>
              {/* Total reconciliation — written total vs parser expected total */}
              {uploadResult.expectedTotal != null && uploadResult.totalOrdersWritten != null && (
                <div className={`mt-3 p-2.5 rounded-lg text-xs ${
                  Math.abs((uploadResult.totalOrdersWritten || 0) - (uploadResult.expectedTotal || 0)) < 1
                    ? 'bg-green-500/10 text-green-700'
                    : 'bg-amber-500/10 text-amber-700'
                }`}>
                  {lang === 'ar'
                    ? `🧮 إجمالي الطلبات اللي اتسجلت: ${uploadResult.totalOrdersWritten.toLocaleString()} مقابل المتوقع: ${uploadResult.expectedTotal.toLocaleString()}`
                    : `🧮 Orders stored: ${uploadResult.totalOrdersWritten.toLocaleString()} vs expected: ${uploadResult.expectedTotal.toLocaleString()}`}
                  {Math.abs((uploadResult.totalOrdersWritten || 0) - (uploadResult.expectedTotal || 0)) >= 1 && (
                    <span className="block mt-1">
                      {lang === 'ar' ? '⚠️ فرق — راجِع سجلات الخادم' : '⚠️ Mismatch — check backend logs'}
                    </span>
                  )}
                </div>
              )}
              {(uploadResult.inserted > 0 || uploadResult.updated > 0) && (
                <Link href="/system/b2c/dashboard"
                  className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium transition-colors">
                  {lang === 'ar' ? 'افتح لوحة التحكم' : 'Open Dashboard'}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
              {uploadResult.inserted === 0 && uploadResult.updated === 0 && uploadResult.skipped > 0 && (
                <p className="text-amber-700 text-xs mt-2">
                  {lang === 'ar'
                    ? `⚠️ كل الأيام (${uploadResult.skipped}) موجودة بالفعل في النظام. اختر "Overwrite all" من الـ Mode لو عاوز تحدثها.`
                    : `⚠️ All days (${uploadResult.skipped}) already exist. Pick "Overwrite all" mode to update them.`}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Upload section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-[#f37121]" />
          {T.uploadExcel}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{T.chooseProject}</label>
            <select aria-label="Project for upload" value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="">{T.allProjects}</option>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{T.chooseBranch}</label>
            <select aria-label="Branch for upload" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="">{T.allBranches}</option>
              {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{T.mode}</label>
            <select aria-label="Upload mode" value={mode} onChange={(e) => setMode(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="merge_new_only">{T.mergeNewOnly}</option>
              <option value="overwrite">{T.overwrite}</option>
            </select>
          </div>
        </div>


        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer hover:border-[#f37121]/50 hover:bg-slate-100 transition-all"
        >
          <FileSpreadsheet className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{T.dragDropExcel}</p>
          <p className="text-slate-500 text-xs mt-1">{T.excelHint}</p>
          {fileName && <p className="text-[#f37121] text-sm mt-3">📄 {fileName}</p>}
          <input ref={fileInputRef} type="file" aria-label="Excel file"
            accept=".xlsx,.xlsm,.xls"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            className="hidden" />
        </div>

        {parsing && (
          <div className="mt-4 flex items-center gap-2 text-[#f37121] text-sm">
            <div className="w-4 h-4 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
            {T.parsing}
          </div>
        )}

        {parseResult && (
          <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
            className="mt-4 bg-slate-100 rounded-xl p-4 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-slate-900 font-medium text-sm">{T.parsed}: {fileName}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleDownloadDiagnostic}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-700 text-xs font-medium hover:bg-blue-500/30 transition-colors"
                  title={lang === 'ar' ? 'حمّل تقرير تشخيصي كامل' : 'Download full diagnostic report'}>
                  📥 {lang === 'ar' ? 'حمّل تقرير التشخيص' : 'Download Diagnostic'}
                </button>
                <button type="button" onClick={() => { setParseResult(null); setFileName(''); }}
                  className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-slate-100" title={tx.clear}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-slate-500 text-[11px]">
              {lang === 'ar'
                ? '💡 افتح Browser DevTools → Console (F12) لمشاهدة كل تفصيلة من الشيت لحظياً'
                : '💡 Open Browser DevTools → Console (F12) to inspect every parsed value live'}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 text-center">
                <p className="text-slate-500 text-xs">{T.monthsDetected}</p>
                <p className="text-slate-900 font-bold text-lg">{parseResult.monthsDetected.length}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center">
                <p className="text-slate-500 text-xs">{T.repsDetected}</p>
                <p className="text-slate-900 font-bold text-lg">{parseResult.uniqueReps}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center">
                <p className="text-slate-500 text-xs">{lang === 'ar' ? 'سجل بيانات' : 'Data Rows'}</p>
                <p className="text-slate-900 font-bold text-lg">{parseResult.records.length}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center">
                <p className="text-slate-500 text-xs">{T.warnings}</p>
                <p className={`font-bold text-lg ${parseResult.warnings.length > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{parseResult.warnings.length}</p>
              </div>
            </div>

            {parseResult.monthSummaries && parseResult.monthSummaries.length > 0 && (
              <div>
                <p className="text-slate-500 text-xs uppercase mb-2">
                  {lang === 'ar' ? '🔍 تحقق من الأرقام قبل الرفع' : '🔍 Verify per-month totals before upload'}
                </p>
                <div className="bg-white rounded-lg overflow-hidden border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-slate-300 text-xs uppercase">
                      <tr>
                        <th className="text-start py-2 px-3">{lang === 'ar' ? 'الشهر' : 'Month'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'صفوف' : 'Rows'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'مناديب' : 'Reps'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'أيام' : 'Days'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'إجمالي طلبات' : 'Total Orders'}</th>
                        <th className="text-center py-2 px-3 text-slate-300" title={tx.excelHeaderRowIndex}>
                          {lang === 'ar' ? 'صف الترويسة' : 'Header Row'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {parseResult.monthSummaries.map((m) => (
                        <tr key={m.monthLabel}>
                          <td className="py-2 px-3 text-slate-900 font-medium">{m.monthLabel}</td>
                          <td className="py-2 px-3 text-center text-slate-700">{m.recordsCount}</td>
                          <td className="py-2 px-3 text-center text-slate-700">{m.uniqueReps}</td>
                          <td className="py-2 px-3 text-center text-slate-700">{m.daysInMonth}</td>
                          <td className="py-2 px-3 text-center text-[#f37121] font-bold">{m.totalOrders.toLocaleString()}</td>
                          <td className="py-2 px-3 text-center text-slate-800 text-xs">{m.headerRow}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 font-bold">
                        <td className="py-2 px-3 text-slate-900">{lang === 'ar' ? '✓ المجموع' : '✓ Total'}</td>
                        <td className="py-2 px-3 text-center text-slate-900">
                          {parseResult.monthSummaries.reduce((s, m) => s + m.recordsCount, 0)}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-900">{parseResult.uniqueReps}</td>
                        <td className="py-2 px-3"></td>
                        <td className="py-2 px-3 text-center text-[#f37121]">
                          {parseResult.monthSummaries.reduce((s, m) => s + m.totalOrders, 0).toLocaleString()}
                        </td>
                        <td className="py-2 px-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-slate-500 text-xs mt-2">
                  {lang === 'ar'
                    ? 'قارن "إجمالي طلبات" مع الرقم في كل شيت بـ Excel. لو الرقم مختلف، فيه مشكلة في قراءة الأعمدة.'
                    : 'Compare "Total Orders" with the figure shown in each Excel sheet. A mismatch indicates column-detection issues.'}
                </p>
              </div>
            )}

            {parseResult.warnings.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                <p className="text-amber-700 text-xs font-medium mb-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {T.warnings}
                </p>
                <ul className="text-amber-700 text-xs space-y-0.5">
                  {parseResult.warnings.slice(0, 5).map((w, i) => <li key={i}>• {w}</li>)}
                  {parseResult.warnings.length > 5 && <li>• ... +{parseResult.warnings.length - 5} more</li>}
                </ul>
              </div>
            )}

            {/* Duplicate REPS — same person (name) appearing on multiple rows in same sheet.
                Different people sharing an account ID is NOT a duplicate; they're tracked
                separately by name. Only true name-collisions surface here as data issues. */}
            {parseResult.duplicates && parseResult.duplicates.length > 0 && (
              <div className="bg-orange-500/10 border border-orange-500/40 rounded-lg p-3">
                <p className="text-orange-600 text-sm font-semibold mb-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {lang === 'ar'
                    ? `🔁 نفس المندوب على أكتر من صف في نفس الشيت: ${parseResult.duplicates.length}`
                    : `🔁 Same rep on multiple rows in same sheet: ${parseResult.duplicates.length}`}
                </p>
                <p className="text-slate-500 text-xs mb-3">
                  {lang === 'ar'
                    ? 'الخطوة المتبعة: ✋ أول صف فقط (الباقي يتم تجاهله). الأخضر = القيمة اللي هتدخل القاعدة.'
                    : 'Resolution: ✋ first row wins (rest ignored). Green = value stored in DB.'}
                </p>
                <div className="max-h-96 overflow-y-auto space-y-3">
                  {parseResult.duplicates.slice(0, 20).map((d, i) => {
                    const winnerIdx = 0;
                    return (
                      <div key={i} className="bg-slate-100 border border-slate-200 rounded-md p-2.5">
                        <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
                          <span className="text-orange-700 font-mono text-xs">{d.repKey}</span>
                          <span className="text-slate-900 text-sm font-medium">{d.englishName || '—'}</span>
                          {d.arabicName && <span className="text-slate-500 text-xs">({d.arabicName})</span>}
                          <span className="text-slate-500 text-[10px] ms-auto">{d.sheetLabel}</span>
                        </div>
                        <div className="space-y-1.5">
                          {d.details.map((rd, idx) => {
                            const isWinner = idx === winnerIdx;
                            const dayPairs = Object.entries(rd.dailyOrders)
                              .filter(([, v]) => v !== null)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .slice(0, 12); // first 12 days for readability
                            return (
                              <div key={idx}
                                className={`p-2 rounded text-xs ${isWinner ? 'bg-green-500/10 border border-green-500/30' : 'bg-slate-50 border border-slate-200/70'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={isWinner ? 'text-green-600 font-bold' : 'text-slate-500'}>
                                    {lang === 'ar' ? 'الصف' : 'Row'} {rd.row}
                                  </span>
                                  <span className="text-slate-500">•</span>
                                  <span className="text-slate-900">
                                    {lang === 'ar' ? 'إجمالي الصف' : 'Row total'}: <strong>{rd.totalOrders}</strong>
                                  </span>
                                  {isWinner && (
                                    <span className="ms-auto px-1.5 py-0.5 rounded bg-green-500/30 text-green-200 text-[10px] uppercase">
                                      {lang === 'ar' ? '✓ مختار' : '✓ Used'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                  {dayPairs.length === 0 ? (
                                    <span className="text-slate-600">{lang === 'ar' ? '(كل الأيام فاضية أو null)' : '(all days null/empty)'}</span>
                                  ) : dayPairs.map(([day, val]) => (
                                    <span key={day} className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-700">
                                      {lang === 'ar' ? 'يوم' : 'd'}{day}=<strong className="text-slate-900">{val}</strong>
                                    </span>
                                  ))}
                                  {Object.keys(rd.dailyOrders).filter(d => rd.dailyOrders[Number(d)] !== null).length > 12 && (
                                    <span className="text-slate-600">...</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {parseResult.duplicates.length > 20 && (
                    <div className="text-slate-500 text-xs">
                      ... +{parseResult.duplicates.length - 20} {lang === 'ar' ? 'أكتر' : 'more'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {parseResult.ignoredSheets.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-32 overflow-y-auto">
                <p className="text-slate-500 text-xs font-medium mb-1.5">
                  {lang === 'ar'
                    ? `📋 شيتات تم تجاهلها (مش بأسماء شهور): ${parseResult.ignoredSheets.length}`
                    : `📋 Ignored sheets (not month-named): ${parseResult.ignoredSheets.length}`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parseResult.ignoredSheets.map((s, i) => (
                    <span key={i} className="px-2 py-0.5 rounded text-[11px] bg-white text-slate-500">{s}</span>
                  ))}
                </div>
              </div>
            )}

            <button type="button" onClick={handleConfirmUpload} disabled={uploading}
              className="w-full px-4 py-2.5 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2">
              {uploading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {uploading ? (lang === 'ar' ? 'جاري الرفع...' : 'Uploading...') : T.confirmUpload}
            </button>
          </motion.div>
        )}
      </div>

      {/* Google Sheet sync — list of configs, one per project+branch */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
              <Cloud className="w-5 h-5 text-blue-600" />
              {lang === 'ar' ? '🔄 مزامنة من Google Sheets' : '🔄 Google Sheets Auto-Sync'}
            </h2>
            <p className="text-slate-500 text-xs mt-1">
              {lang === 'ar'
                ? 'كل (مشروع + فرع) ليه شيت خاص بيه — اضف اللي تحتاجه'
                : 'Each (project + branch) has its own sheet — add as many as you need'}
            </p>
          </div>
          <button type="button" onClick={() => setAddOpen(!addOpen)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-700 border border-blue-500/40 text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />
            {lang === 'ar' ? 'إضافة شيت جديد' : 'Add new sheet'}
          </button>
        </div>

        {sheetError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm mb-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{sheetError}</span>
            <button type="button" onClick={() => setSheetError('')} className="ms-auto text-red-600 hover:text-red-700" title={tx.close}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Add-new form */}
        <AnimatePresence>
          {addOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-4">
              <div className="bg-slate-100 border border-blue-500/30 rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                      {lang === 'ar' ? 'المشروع' : 'Project'}
                    </label>
                    <select value={addForm.project}
                      onChange={(e) => setAddForm((f) => ({ ...f, project: e.target.value }))}
                      aria-label="Project"
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                      <option value="">{lang === 'ar' ? '— اختر مشروع —' : '— Select project —'}</option>
                      {projects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                      {lang === 'ar' ? 'الفرع' : 'Branch'}
                    </label>
                    <select value={addForm.branch}
                      onChange={(e) => setAddForm((f) => ({ ...f, branch: e.target.value }))}
                      aria-label="Branch"
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                      <option value="">{lang === 'ar' ? '— اختر فرع —' : '— Select branch —'}</option>
                      {branches.map((b: any) => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                    <Link2 className="w-3.5 h-3.5 inline me-1" />
                    {lang === 'ar' ? 'رابط Google Sheet (اختياري — تقدر تضيفه لاحقاً)' : 'Google Sheet URL (optional — can be added later)'}
                  </label>
                  <input type="url" value={addForm.sheetUrl}
                    onChange={(e) => setAddForm((f) => ({ ...f, sheetUrl: e.target.value }))}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    aria-label="Google Sheet URL"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm font-mono" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                      {lang === 'ar' ? 'فترة المزامنة' : 'Sync interval'}
                    </label>
                    <select value={addForm.intervalMinutes}
                      onChange={(e) => setAddForm((f) => ({ ...f, intervalMinutes: Number(e.target.value) }))}
                      aria-label="Sync interval"
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                      <option value={1}>{lang === 'ar' ? 'كل دقيقة' : 'Every minute'}</option>
                      <option value={5}>{lang === 'ar' ? 'كل 5 دقايق' : 'Every 5 min'}</option>
                      <option value={10}>{lang === 'ar' ? 'كل 10 دقايق' : 'Every 10 min'}</option>
                      <option value={15}>{lang === 'ar' ? 'كل 15 دقيقة' : 'Every 15 min'}</option>
                      <option value={30}>{lang === 'ar' ? 'كل 30 دقيقة' : 'Every 30 min'}</option>
                      <option value={60}>{lang === 'ar' ? 'كل ساعة' : 'Every hour'}</option>
                      <option value={180}>{lang === 'ar' ? 'كل 3 ساعات' : 'Every 3 hours'}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                      {lang === 'ar' ? 'تحديثات الشيت' : 'Sheet updates'}
                    </label>
                    <select value={addForm.syncMode}
                      onChange={(e) => setAddForm((f) => ({ ...f, syncMode: e.target.value as any }))}
                      aria-label="Sync mode"
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                      <option value="overwrite">{lang === 'ar' ? '🔄 الشيت هو المصدر (موصى به)' : '🔄 Sheet is source (recommended)'}</option>
                      <option value="merge_new_only">{lang === 'ar' ? '➕ أيام جديدة فقط' : '➕ New days only'}</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button type="button" onClick={() => setAddOpen(false)}
                    className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
                    {T.cancel}
                  </button>
                  <button type="button" onClick={handleAddSheet} disabled={addSaving || !addForm.project || !addForm.branch}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium">
                    {addSaving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    <Plus className="w-4 h-4" />
                    {lang === 'ar' ? 'إضافة' : 'Add'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {sheetConfigs.length === 0 && !addOpen && (
          <div className="text-center py-8 border border-dashed border-slate-200 rounded-lg">
            <Cloud className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">
              {lang === 'ar' ? 'لسه ما فيش شيتات متربوطة. اضغط "إضافة شيت جديد" للبدء.' : 'No sheets connected yet. Click "Add new sheet" to start.'}
            </p>
          </div>
        )}

        {/* List of configs */}
        <div className="space-y-3">
          {sheetConfigs.map((cfg) => {
            const isEditing = editingId === cfg._id;
            const isSyncing = busyConfigId === cfg._id && busyAction === 'syncing';
            const isSaving = busyConfigId === cfg._id && busyAction === 'saving';
            const isDeleting = busyConfigId === cfg._id && busyAction === 'deleting';
            const projectName = cfg.project?.name || (lang === 'ar' ? 'مشروع محذوف' : 'Deleted project');
            const branchName = cfg.branch?.name || (lang === 'ar' ? 'فرع محذوف' : 'Deleted branch');
            return (
              <div key={cfg._id} className="bg-slate-100 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-slate-900 font-medium flex items-center gap-2 text-sm">
                      <span className="text-[#f37121]">{projectName}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-800">{branchName}</span>
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-block w-2 h-2 rounded-full ${cfg.enabled ? 'bg-green-400' : 'bg-slate-300'}`} />
                      <span className={`text-[11px] font-medium ${cfg.enabled ? 'text-green-600' : 'text-slate-500'}`}>
                        {cfg.enabled
                          ? (lang === 'ar' ? 'مزامنة نشطة' : 'Auto-sync ON')
                          : (lang === 'ar' ? 'مزامنة موقوفة' : 'Auto-sync OFF')}
                      </span>
                      {cfg.lastSyncAt && (
                        <span className="text-slate-500 text-[10px]">
                          · {lang === 'ar' ? 'آخر مزامنة' : 'Last sync'}: {new Date(cfg.lastSyncAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {cfg.lastSyncStatus === 'error' && cfg.lastSyncMessage && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 text-amber-700 text-xs">
                    ⚠️ {cfg.lastSyncMessage}
                  </div>
                )}

                {isEditing ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-3">
                      <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                        <Link2 className="w-3.5 h-3.5 inline me-1" />
                        {lang === 'ar' ? 'رابط Google Sheet' : 'Google Sheet URL'}
                      </label>
                      <input type="url" value={editForm.sheetUrl}
                        onChange={(e) => setEditForm((f) => ({ ...f, sheetUrl: e.target.value }))}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        aria-label="Google Sheet URL"
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                        {lang === 'ar' ? 'فترة المزامنة' : 'Sync interval'}
                      </label>
                      <select value={editForm.intervalMinutes}
                        onChange={(e) => setEditForm((f) => ({ ...f, intervalMinutes: Number(e.target.value) }))}
                        aria-label="Sync interval"
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                        <option value={1}>{lang === 'ar' ? 'كل دقيقة' : 'Every minute'}</option>
                      <option value={5}>{lang === 'ar' ? 'كل 5 دقايق' : 'Every 5 min'}</option>
                        <option value={10}>{lang === 'ar' ? 'كل 10 دقايق' : 'Every 10 min'}</option>
                        <option value={15}>{lang === 'ar' ? 'كل 15 دقيقة' : 'Every 15 min'}</option>
                        <option value={30}>{lang === 'ar' ? 'كل 30 دقيقة' : 'Every 30 min'}</option>
                        <option value={60}>{lang === 'ar' ? 'كل ساعة' : 'Every hour'}</option>
                        <option value={180}>{lang === 'ar' ? 'كل 3 ساعات' : 'Every 3 hours'}</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">
                        {lang === 'ar' ? 'تحديثات الشيت' : 'Sheet updates'}
                      </label>
                      <select value={editForm.syncMode}
                        onChange={(e) => setEditForm((f) => ({ ...f, syncMode: e.target.value as any }))}
                        aria-label="Sync mode"
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm">
                        <option value="overwrite">{lang === 'ar' ? '🔄 الشيت هو المصدر (موصى به)' : '🔄 Sheet is source (recommended)'}</option>
                        <option value="merge_new_only">{lang === 'ar' ? '➕ أيام جديدة فقط' : '➕ New days only'}</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <div className="md:col-span-3">
                      <span className="text-slate-500 uppercase me-2">{tx.urlLabel}</span>
                      {cfg.sheetUrl
                        ? <a href={cfg.sheetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline font-mono break-all">{cfg.sheetUrl}</a>
                        : <span className="text-slate-500 italic">{lang === 'ar' ? 'لم يُحدَّد بعد' : 'not set yet'}</span>}
                    </div>
                    <div><span className="text-slate-500 uppercase me-2">{lang === 'ar' ? 'الفترة:' : 'Interval:'}</span><span className="text-slate-700">{cfg.intervalMinutes} {tx.minutesUnit}</span></div>
                    <div className="md:col-span-2"><span className="text-slate-500 uppercase me-2">{lang === 'ar' ? 'الوضع:' : 'Mode:'}</span><span className="text-slate-700">{cfg.syncMode === 'overwrite' ? (lang === 'ar' ? 'إعادة كتابة' : 'overwrite') : (lang === 'ar' ? 'أيام جديدة فقط' : 'new days only')}</span></div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isEditing ? (
                    <>
                      <button type="button" onClick={() => handleSaveEdit(cfg._id)} disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 disabled:opacity-50 text-green-700 border border-green-500/40 text-sm font-medium">
                        {isSaving && <div className="w-3 h-3 border-2 border-green-300 border-t-transparent rounded-full animate-spin" />}
                        <Check className="w-4 h-4" />
                        {lang === 'ar' ? 'حفظ' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelEditing} disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm">
                        <X className="w-4 h-4" />
                        {T.cancel}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => handleToggleEnable(cfg._id, cfg.enabled)}
                        disabled={isSaving || !cfg.sheetId}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          cfg.enabled
                            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 border border-amber-500/40'
                            : 'bg-green-500/20 hover:bg-green-500/30 text-green-700 border border-green-500/40'
                        } disabled:opacity-50`}>
                        <Power className="w-4 h-4" />
                        {cfg.enabled
                          ? (lang === 'ar' ? 'إيقاف' : 'Disable')
                          : (lang === 'ar' ? 'تفعيل' : 'Enable')}
                      </button>
                      <button type="button" onClick={() => handleOpenSetup(cfg._id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-700 border border-purple-500/40 text-sm font-medium">
                        <Zap className="w-4 h-4" />
                        {setupOpenId === cfg._id
                          ? (lang === 'ar' ? 'إخفاء السكربت' : 'Hide setup')
                          : (lang === 'ar' ? 'إعداد المزامنة الفورية' : 'Setup instant sync')}
                      </button>
                      <button type="button" onClick={() => startEditingConfig(cfg)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
                        <Edit3 className="w-4 h-4" />
                        {lang === 'ar' ? 'تعديل' : 'Edit'}
                      </button>
                      <button type="button" onClick={() => handleDeleteConfig(cfg._id)} disabled={isDeleting}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-red-700 border border-red-500/40 text-sm font-medium">
                        {isDeleting && <div className="w-3 h-3 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />}
                        <Trash2 className="w-4 h-4" />
                        {lang === 'ar' ? 'حذف' : 'Delete'}
                      </button>
                      <button type="button" onClick={() => handleSyncConfig(cfg._id)}
                        disabled={isSyncing || !cfg.sheetId}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white text-sm font-medium ms-auto">
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing
                          ? (lang === 'ar' ? 'جاري المزامنة...' : 'Syncing...')
                          : (lang === 'ar' ? 'مزامنة الآن' : 'Sync Now')}
                      </button>
                    </>
                  )}
                </div>

                {cfg.lastSyncStats && cfg.lastSyncStatus === 'ok' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-xs">
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-slate-500 text-[10px]">{lang === 'ar' ? 'الشهور' : 'Months'}</p>
                      <p className="text-slate-900 font-bold">{cfg.lastSyncStats.monthsDetected?.length || 0}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-slate-500 text-[10px]">{lang === 'ar' ? 'صفوف' : 'Records'}</p>
                      <p className="text-slate-900 font-bold">{cfg.lastSyncStats.recordsParsed || 0}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-slate-500 text-[10px]">{lang === 'ar' ? 'مضاف' : 'Inserted'}</p>
                      <p className="text-green-600 font-bold">{cfg.lastSyncStats.daysInserted || 0}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-slate-500 text-[10px]">{lang === 'ar' ? 'محدث' : 'Updated'}</p>
                      <p className="text-blue-600 font-bold">{cfg.lastSyncStats.daysUpdated || 0}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-slate-500 text-[10px]">{lang === 'ar' ? 'وقت' : 'Duration'}</p>
                      <p className="text-slate-700 font-bold">{((cfg.lastSyncStats.durationMs || 0) / 1000).toFixed(1)}{tx.secondsUnit}</p>
                    </div>
                  </div>
                )}

                {/* Setup script panel — only when this config's setup is open */}
                <AnimatePresence>
                  {setupOpenId === cfg._id && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-4 space-y-4 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className="text-purple-700 font-semibold flex items-center gap-2 text-sm">
                          <Zap className="w-4 h-4" />
                          {lang === 'ar' ? '⚡ مزامنة فورية لـ ' : '⚡ Real-time setup — '}
                          {projectName} · {branchName}
                        </h4>
                      </div>
                      {setupLoading ? (
                        <div className="flex items-center justify-center h-20">
                          <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <>
                          <div className="bg-slate-100 rounded-lg p-3 text-xs text-slate-500 leading-relaxed">
                            {lang === 'ar'
                              ? 'هتلصق السكربت ده في الـ Google Sheet (Extensions → Apps Script). كل تعديل في الشيت بيعمل ping للسيرفر، والسيرفر يحدّث الـ dashboard في ثانية أو اتنين. كل شيت ليه secret خاص بيه.'
                              : 'Paste this script into your Google Sheet (Extensions → Apps Script). Every edit pings the server, which updates the dashboard within 1-2 seconds. Each sheet has its own secret.'}
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-slate-900 text-sm font-medium">
                                {lang === 'ar' ? 'السكربت:' : 'Script:'}
                              </p>
                              <button type="button" onClick={() => copyToClipboard(setupScript, 'script')}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/30 hover:bg-purple-500/40 text-purple-200 text-xs font-medium">
                                <Copy className="w-3 h-3" />
                                {copyFeedback === 'script' ? (lang === 'ar' ? '✓ اتنسخ' : '✓ Copied!') : (lang === 'ar' ? 'نسخ السكربت' : 'Copy Script')}
                              </button>
                            </div>
                            <pre className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] text-slate-700 font-mono overflow-x-auto max-h-64">
{setupScript}
                            </pre>
                          </div>

                          <ol className="space-y-2 text-xs text-slate-500 list-decimal list-inside">
                            <li>{lang === 'ar' ? 'افتح Google Sheet → Extensions → Apps Script' : 'Open Google Sheet → Extensions → Apps Script'}</li>
                            <li>{lang === 'ar' ? 'الصق السكربت — احفظ (💾)' : 'Paste script — save (💾)'}</li>
                            <li>{lang === 'ar' ? 'Triggers (الساعة) → Add Trigger' : 'Triggers (clock icon) → Add Trigger'}</li>
                            <li>{tx.functionLabel} <code className="text-purple-700">notifyB2CWebhook</code> · {tx.sourceLabel} <code>From spreadsheet</code> · {tx.typeLabel} <code>On edit</code></li>
                            <li>{lang === 'ar' ? 'احفظ — وامنح الصلاحيات لما يطلب' : 'Save — grant permissions when prompted'}</li>
                          </ol>

                          <details className="bg-slate-100 rounded-lg p-3 border border-slate-200">
                            <summary className="text-slate-700 text-xs cursor-pointer font-medium">
                              {lang === 'ar' ? '🔧 إعدادات متقدمة (Webhook URL + Secret)' : '🔧 Advanced (Webhook URL + Secret)'}
                            </summary>
                            <div className="mt-3 space-y-2">
                              <div>
                                <label className="block text-slate-500 text-[10px] uppercase mb-1">{tx.webhookUrlLabel}</label>
                                <div className="flex items-center gap-2">
                                  <code className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 font-mono break-all">{setupWebhookUrl}</code>
                                  <button type="button" onClick={() => copyToClipboard(setupWebhookUrl, 'url')}
                                    className="p-1.5 rounded bg-white hover:bg-slate-100 text-slate-700" title={tx.copyUrl}>
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                {copyFeedback === 'url' && <p className="text-green-600 text-[10px] mt-0.5">{tx.copiedShort}</p>}
                              </div>
                              <div>
                                <label className="block text-slate-500 text-[10px] uppercase mb-1">{tx.secretLabel}</label>
                                <div className="flex items-center gap-2">
                                  <code className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 font-mono break-all">
                                    {showSecret ? setupSecret : '••••••••••••••••••••••••'}
                                  </code>
                                  <button type="button" onClick={() => setShowSecret(!showSecret)}
                                    className="p-1.5 rounded bg-white hover:bg-slate-100 text-slate-700" title={tx.toggleVisibility}>
                                    {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                  <button type="button" onClick={() => copyToClipboard(setupSecret, 'secret')}
                                    className="p-1.5 rounded bg-white hover:bg-slate-100 text-slate-700" title={tx.copySecret}>
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                {copyFeedback === 'secret' && <p className="text-green-600 text-[10px] mt-0.5">{tx.copiedShort}</p>}
                              </div>
                            </div>
                          </details>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upload history */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-5 h-5 text-[#f37121]" />
            {T.uploadHistory}
          </h2>
          <div className="flex items-center gap-2">
            {uploads.length > 0 && (
              <button type="button" onClick={handleExportUploads}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-700 border border-green-500/30 text-sm font-medium transition-colors">
                <Download className="w-4 h-4" />
                {lang === 'ar' ? 'تصدير Excel' : 'Export Excel'}
              </button>
            )}
            <button type="button" onClick={fetchAll} className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100" title={tx.refresh}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        {uploads.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-6">{T.noUploadsYet}</p>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-xs uppercase border-b border-slate-200">
                  <th className="text-start py-2 px-2">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="text-start py-2 px-2">{lang === 'ar' ? 'الملف' : 'File'}</th>
                  <th className="text-start py-2 px-2">{lang === 'ar' ? 'بواسطة' : 'By'}</th>
                  <th className="text-start py-2 px-2">{T.monthsDetected}</th>
                  <th className="text-center py-2 px-2">{T.daysInserted}</th>
                  <th className="text-center py-2 px-2">{T.daysUpdated}</th>
                  <th className="text-center py-2 px-2">{T.daysSkipped}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {uploads.map((u) => (
                  <tr key={u._id} className="text-sm">
                    <td className="py-2 px-2 text-slate-800 text-xs whitespace-nowrap">{new Date(u.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-2 text-slate-700">{u.fileName || '—'}</td>
                    <td className="py-2 px-2 text-slate-700">{u.uploadedBy ? `${u.uploadedBy.firstName} ${u.uploadedBy.lastName}` : '—'}</td>
                    <td className="py-2 px-2 text-slate-800 text-xs">{(u.monthsDetected || []).join(', ')}</td>
                    <td className="py-2 px-2 text-center text-green-600 font-medium">{u.daysInserted}</td>
                    <td className="py-2 px-2 text-center text-blue-600 font-medium">{u.daysUpdated}</td>
                    <td className="py-2 px-2 text-center text-slate-800">{u.daysSkipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cleanup confirmation modal */}
      <AnimatePresence>
        {showCleanupModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowCleanupModal(false)} className="fixed inset-0 bg-black/60 z-50" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6 text-red-600" />
                    </div>
                    <div>
                      <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">
                        {lang === 'ar' ? 'تنظيف بيانات B2C' : 'Clean B2C Data'}
                      </h3>
                      <p className="text-slate-500 text-xs">
                        {lang === 'ar' ? '⚠️ هذا الإجراء لا يمكن التراجع عنه' : '⚠️ This action cannot be undone'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer">
                      <input type="radio" name="cleanup-scope" checked={cleanupScope === 'orders'}
                        onChange={() => setCleanupScope('orders')}
                        className="mt-0.5 text-[#f37121] focus:ring-[#f37121]/50" />
                      <div className="flex-1">
                        <p className="text-slate-900 text-sm font-medium">
                          {lang === 'ar' ? 'حذف الطلبات + سجل الرفع فقط' : 'Delete orders + upload history only'}
                        </p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {lang === 'ar' ? 'يحتفظ بالمناديب والمشاريع' : 'Keeps reps and projects'}
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer">
                      <input type="radio" name="cleanup-scope" checked={cleanupScope === 'all'}
                        onChange={() => setCleanupScope('all')}
                        className="mt-0.5 text-red-500 focus:ring-red-500/50" />
                      <div className="flex-1">
                        <p className="text-red-700 text-sm font-medium">
                          {lang === 'ar' ? 'حذف الطلبات + المناديب + سجل الرفع' : 'Delete orders + reps + upload history'}
                        </p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {lang === 'ar' ? 'يحتفظ بالمشاريع فقط (بداية نظيفة تماماً)' : 'Keeps projects only (fully clean slate)'}
                        </p>
                      </div>
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowCleanupModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">
                      {T.cancel}
                    </button>
                    <button type="button" onClick={handleCleanup} disabled={cleaningUp}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                      {cleaningUp && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      <Trash2 className="w-4 h-4" />
                      {lang === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
