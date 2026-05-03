'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getB2CTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Upload, FileSpreadsheet, X, Check, AlertCircle, RefreshCw, BarChart3, ArrowRight, Trash2, Cloud, Link2, Power } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/context/AuthContext';
import { parseRepsExcel, buildBulkPayload, buildDiagnosticReport, type ExcelParseResult } from '@/lib/b2cExcelParser';

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
  const { lang } = useLanguage();
  const { user } = useAuth();
  const T = getB2CTranslations(lang);
  const canCleanup = user && ['super_admin', 'admin', 'b2c_head'].includes(user.role);

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

  // Google Sheet sync config
  const [sheetConfig, setSheetConfig] = useState<any>(null);
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [sheetIntervalInput, setSheetIntervalInput] = useState(15);
  const [sheetSavingConfig, setSheetSavingConfig] = useState(false);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [sheetError, setSheetError] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [projData, branchData, uploadsData, sheetData] = await Promise.all([
        api.get<any>('/api/b2c/projects'),
        api.get<any>('/api/branches?active=true'),
        api.get<any>('/api/b2c/uploads'),
        api.get<any>('/api/b2c/google-sheet/config').catch(() => ({ config: null })),
      ]);
      setProjects(projData.projects || []);
      setBranches(branchData.branches || []);
      setUploads(uploadsData.uploads || []);
      if (sheetData?.config) {
        setSheetConfig(sheetData.config);
        setSheetUrlInput(sheetData.config.sheetUrl || '');
        setSheetIntervalInput(sheetData.config.intervalMinutes || 15);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    }
  }, []);

  // Refresh sheet status whenever the backend cron runs a sync
  useSocket('b2c:sheet:synced', useCallback(() => {
    api.get<any>('/api/b2c/google-sheet/config').then((d) => {
      if (d?.config) setSheetConfig(d.config);
    }).catch(() => {});
  }, []));

  const handleSaveSheetConfig = async (overrides: Partial<{ enabled: boolean }> = {}) => {
    setSheetSavingConfig(true); setSheetError('');
    try {
      const payload: any = {
        sheetUrl: sheetUrlInput,
        intervalMinutes: sheetIntervalInput,
      };
      if (overrides.enabled !== undefined) payload.enabled = overrides.enabled;
      const data = await api.put<any>('/api/b2c/google-sheet/config', payload);
      if (data?.config) {
        setSheetConfig(data.config);
        setSheetUrlInput(data.config.sheetUrl || '');
      }
    } catch (err: any) {
      setSheetError(err.message || 'Failed to save sheet config');
    } finally {
      setSheetSavingConfig(false);
    }
  };

  const handleSheetSyncNow = async () => {
    setSheetSyncing(true); setSheetError('');
    try {
      // Save current settings first to make sure URL changes take effect
      if (sheetUrlInput && (!sheetConfig || sheetConfig.sheetUrl !== sheetUrlInput)) {
        await handleSaveSheetConfig();
      }
      await api.post<any>('/api/b2c/google-sheet/sync-now', { mode }, { timeoutMs: 180000 });
      // Refresh config to show updated lastSync stats
      const data = await api.get<any>('/api/b2c/google-sheet/config');
      if (data?.config) setSheetConfig(data.config);
      await fetchAll();
    } catch (err: any) {
      setSheetError(err.message || 'Sync failed');
    } finally {
      setSheetSyncing(false);
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
      setError(err.message || 'Cleanup failed');
      setShowCleanupModal(false);
    } finally {
      setCleaningUp(false);
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
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#f37121]" />
            {T.repsPerformanceTitle}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {lang === 'ar'
              ? 'ارفع ملف Excel متعدد الشيتات بأداء كل مندوب شهرياً، أو أدخل البيانات يدوياً من صفحة الإدخال اليومي'
              : 'Upload a multi-sheet Excel of monthly rep performance, or use the Daily Entry page for manual input'}
          </p>
        </div>
        {canCleanup && (
          <button type="button" onClick={() => { setCleanupScope('orders'); setShowCleanupModal(true); }}
            className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors">
            <Trash2 className="w-4 h-4" />
            {lang === 'ar' ? 'تنظيف بيانات B2C' : 'Clean B2C Data'}
          </button>
        )}
      </div>

      {cleanupResult && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
          className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
          <Check className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-blue-400 font-medium text-sm">
              {lang === 'ar' ? '🧹 تم التنظيف بنجاح' : 'Cleanup successful'}
            </p>
            <p className="text-gray-300 text-xs mt-1">
              {lang === 'ar'
                ? `تم حذف ${cleanupResult.ordersDeleted} يوم، ${cleanupResult.uploadsDeleted} رفعة${cleanupResult.repsDeleted > 0 ? `، ${cleanupResult.repsDeleted} مندوب` : ''}`
                : `Deleted ${cleanupResult.ordersDeleted} days, ${cleanupResult.uploadsDeleted} uploads${cleanupResult.repsDeleted > 0 ? `, ${cleanupResult.repsDeleted} reps` : ''}`}
            </p>
          </div>
          <button type="button" onClick={() => setCleanupResult(null)} className="text-blue-400 hover:text-blue-300" title="Close"><X className="w-4 h-4" /></button>
        </motion.div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-300" title="Close"><X className="w-4 h-4" /></button>
        </div>
      )}

      {uploadResult && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-400 font-medium text-sm">
                {lang === 'ar' ? '✅ تم الرفع بنجاح!' : 'Upload successful!'}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-300 text-xs">{T.daysInserted}</p>
                  <p className="text-white font-bold text-lg">{uploadResult.inserted}</p>
                </div>
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-300 text-xs">{T.daysUpdated}</p>
                  <p className="text-white font-bold text-lg">{uploadResult.updated}</p>
                </div>
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-300 text-xs">{T.daysSkipped}</p>
                  <p className="text-white font-bold text-lg">{uploadResult.skipped}</p>
                </div>
                <div className="bg-green-500/5 rounded-lg p-2 text-center">
                  <p className="text-green-300 text-xs">{T.repCreatedFromExcel}</p>
                  <p className="text-white font-bold text-lg">{uploadResult.repsCreated || 0}</p>
                </div>
              </div>
              {/* Total reconciliation — written total vs parser expected total */}
              {uploadResult.expectedTotal != null && uploadResult.totalOrdersWritten != null && (
                <div className={`mt-3 p-2.5 rounded-lg text-xs ${
                  Math.abs((uploadResult.totalOrdersWritten || 0) - (uploadResult.expectedTotal || 0)) < 1
                    ? 'bg-green-500/10 text-green-300'
                    : 'bg-amber-500/10 text-amber-300'
                }`}>
                  {lang === 'ar'
                    ? `🧮 إجمالي الطلبات اللي اتسجلت: ${uploadResult.totalOrdersWritten.toLocaleString()} مقابل المتوقع: ${uploadResult.expectedTotal.toLocaleString()}`
                    : `🧮 Orders stored: ${uploadResult.totalOrdersWritten.toLocaleString()} vs expected: ${uploadResult.expectedTotal.toLocaleString()}`}
                  {Math.abs((uploadResult.totalOrdersWritten || 0) - (uploadResult.expectedTotal || 0)) >= 1 && (
                    <span className="block mt-1">
                      {lang === 'ar' ? '⚠️ فرق — راجع الـ logs بتاع الباك اند' : '⚠️ Mismatch — check backend logs'}
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
                <p className="text-amber-400 text-xs mt-2">
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
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-[#f37121]" />
          {T.uploadExcel}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.chooseProject}</label>
            <select aria-label="Project for upload" value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="">{T.allProjects}</option>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.chooseBranch}</label>
            <select aria-label="Branch for upload" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="">{T.allBranches}</option>
              {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">{T.mode}</label>
            <select aria-label="Upload mode" value={mode} onChange={(e) => setMode(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="merge_new_only">{T.mergeNewOnly}</option>
              <option value="overwrite">{T.overwrite}</option>
            </select>
          </div>
        </div>


        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-[#f37121]/50 hover:bg-gray-900/30 transition-all"
        >
          <FileSpreadsheet className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-300 font-medium">{T.dragDropExcel}</p>
          <p className="text-gray-500 text-xs mt-1">{T.excelHint}</p>
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
            className="mt-4 bg-gray-900/50 rounded-xl p-4 border border-gray-700 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-white font-medium text-sm">{T.parsed}: {fileName}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleDownloadDiagnostic}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-medium hover:bg-blue-500/30 transition-colors"
                  title={lang === 'ar' ? 'حمّل تقرير تشخيصي كامل' : 'Download full diagnostic report'}>
                  📥 {lang === 'ar' ? 'حمّل تقرير التشخيص' : 'Download Diagnostic'}
                </button>
                <button type="button" onClick={() => { setParseResult(null); setFileName(''); }}
                  className="p-1.5 text-gray-400 hover:text-red-400 rounded hover:bg-gray-700" title="Clear">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-gray-500 text-[11px]">
              {lang === 'ar'
                ? '💡 افتح Browser DevTools → Console (F12) لمشاهدة كل تفصيلة من الشيت لحظياً'
                : '💡 Open Browser DevTools → Console (F12) to inspect every parsed value live'}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <p className="text-gray-400 text-xs">{T.monthsDetected}</p>
                <p className="text-white font-bold text-lg">{parseResult.monthsDetected.length}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <p className="text-gray-400 text-xs">{T.repsDetected}</p>
                <p className="text-white font-bold text-lg">{parseResult.uniqueReps}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <p className="text-gray-400 text-xs">{lang === 'ar' ? 'سجل بيانات' : 'Data Rows'}</p>
                <p className="text-white font-bold text-lg">{parseResult.records.length}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <p className="text-gray-400 text-xs">{T.warnings}</p>
                <p className={`font-bold text-lg ${parseResult.warnings.length > 0 ? 'text-amber-400' : 'text-white'}`}>{parseResult.warnings.length}</p>
              </div>
            </div>

            {parseResult.monthSummaries && parseResult.monthSummaries.length > 0 && (
              <div>
                <p className="text-gray-400 text-xs uppercase mb-2">
                  {lang === 'ar' ? '🔍 تحقق من الأرقام قبل الرفع' : '🔍 Verify per-month totals before upload'}
                </p>
                <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                      <tr>
                        <th className="text-left py-2 px-3">{lang === 'ar' ? 'الشهر' : 'Month'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'صفوف' : 'Rows'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'مناديب' : 'Reps'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'أيام' : 'Days'}</th>
                        <th className="text-center py-2 px-3">{lang === 'ar' ? 'إجمالي طلبات' : 'Total Orders'}</th>
                        <th className="text-center py-2 px-3 text-gray-500" title="Excel header row index">
                          {lang === 'ar' ? 'صف الترويسة' : 'Header Row'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {parseResult.monthSummaries.map((m) => (
                        <tr key={m.monthLabel}>
                          <td className="py-2 px-3 text-white font-medium">{m.monthLabel}</td>
                          <td className="py-2 px-3 text-center text-gray-300">{m.recordsCount}</td>
                          <td className="py-2 px-3 text-center text-gray-300">{m.uniqueReps}</td>
                          <td className="py-2 px-3 text-center text-gray-300">{m.daysInMonth}</td>
                          <td className="py-2 px-3 text-center text-[#f37121] font-bold">{m.totalOrders.toLocaleString()}</td>
                          <td className="py-2 px-3 text-center text-gray-500 text-xs">{m.headerRow}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-900/50 font-bold">
                        <td className="py-2 px-3 text-white">{lang === 'ar' ? '✓ المجموع' : '✓ Total'}</td>
                        <td className="py-2 px-3 text-center text-white">
                          {parseResult.monthSummaries.reduce((s, m) => s + m.recordsCount, 0)}
                        </td>
                        <td className="py-2 px-3 text-center text-white">{parseResult.uniqueReps}</td>
                        <td className="py-2 px-3"></td>
                        <td className="py-2 px-3 text-center text-[#f37121]">
                          {parseResult.monthSummaries.reduce((s, m) => s + m.totalOrders, 0).toLocaleString()}
                        </td>
                        <td className="py-2 px-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  {lang === 'ar'
                    ? 'قارن "إجمالي طلبات" مع الرقم في كل شيت بـ Excel. لو الرقم مختلف، فيه مشكلة في قراءة الأعمدة.'
                    : 'Compare "Total Orders" with the figure shown in each Excel sheet. A mismatch indicates column-detection issues.'}
                </p>
              </div>
            )}

            {parseResult.warnings.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                <p className="text-amber-400 text-xs font-medium mb-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {T.warnings}
                </p>
                <ul className="text-amber-300 text-xs space-y-0.5">
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
                <p className="text-orange-400 text-sm font-semibold mb-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {lang === 'ar'
                    ? `🔁 نفس المندوب على أكتر من صف في نفس الشيت: ${parseResult.duplicates.length}`
                    : `🔁 Same rep on multiple rows in same sheet: ${parseResult.duplicates.length}`}
                </p>
                <p className="text-gray-400 text-xs mb-3">
                  {lang === 'ar'
                    ? 'الخطوة المتبعة: ✋ أول صف فقط (الباقي يتم تجاهله). الأخضر = القيمة اللي هتدخل القاعدة.'
                    : 'Resolution: ✋ first row wins (rest ignored). Green = value stored in DB.'}
                </p>
                <div className="max-h-96 overflow-y-auto space-y-3">
                  {parseResult.duplicates.slice(0, 20).map((d, i) => {
                    const winnerIdx = 0;
                    return (
                      <div key={i} className="bg-gray-900/70 border border-gray-700 rounded-md p-2.5">
                        <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
                          <span className="text-orange-300 font-mono text-xs">{d.repKey}</span>
                          <span className="text-white text-sm font-medium">{d.englishName || '—'}</span>
                          {d.arabicName && <span className="text-gray-500 text-xs">({d.arabicName})</span>}
                          <span className="text-gray-500 text-[10px] ml-auto">{d.sheetLabel}</span>
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
                                className={`p-2 rounded text-xs ${isWinner ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800/50 border border-gray-700/40'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={isWinner ? 'text-green-400 font-bold' : 'text-gray-400'}>
                                    {lang === 'ar' ? 'الصف' : 'Row'} {rd.row}
                                  </span>
                                  <span className="text-gray-500">•</span>
                                  <span className="text-white">
                                    {lang === 'ar' ? 'إجمالي الصف' : 'Row total'}: <strong>{rd.totalOrders}</strong>
                                  </span>
                                  {isWinner && (
                                    <span className="ml-auto px-1.5 py-0.5 rounded bg-green-500/30 text-green-200 text-[10px] uppercase">
                                      {lang === 'ar' ? '✓ مختار' : '✓ Used'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                  {dayPairs.length === 0 ? (
                                    <span className="text-gray-600">{lang === 'ar' ? '(كل الأيام فاضية أو null)' : '(all days null/empty)'}</span>
                                  ) : dayPairs.map(([day, val]) => (
                                    <span key={day} className="px-1.5 py-0.5 rounded bg-gray-900 text-gray-300">
                                      {lang === 'ar' ? 'يوم' : 'd'}{day}=<strong className="text-white">{val}</strong>
                                    </span>
                                  ))}
                                  {Object.keys(rd.dailyOrders).filter(d => rd.dailyOrders[Number(d)] !== null).length > 12 && (
                                    <span className="text-gray-600">...</span>
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
                    <div className="text-gray-500 text-xs">
                      ... +{parseResult.duplicates.length - 20} {lang === 'ar' ? 'أكتر' : 'more'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {parseResult.ignoredSheets.length > 0 && (
              <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 max-h-32 overflow-y-auto">
                <p className="text-gray-400 text-xs font-medium mb-1.5">
                  {lang === 'ar'
                    ? `📋 شيتات تم تجاهلها (مش بأسماء شهور): ${parseResult.ignoredSheets.length}`
                    : `📋 Ignored sheets (not month-named): ${parseResult.ignoredSheets.length}`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parseResult.ignoredSheets.map((s, i) => (
                    <span key={i} className="px-2 py-0.5 rounded text-[11px] bg-gray-800 text-gray-500">{s}</span>
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

      {/* Google Sheet sync — third option alongside file upload and manual entry */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-400" />
              {lang === 'ar' ? '🔄 مزامنة من Google Sheet' : '🔄 Google Sheet Auto-Sync'}
            </h2>
            <p className="text-gray-500 text-xs mt-1">
              {lang === 'ar'
                ? 'الصق رابط Google Sheet (مفتوح للجميع بصلاحية القراءة) — السيستم بيسحبه ويحدث البيانات تلقائياً'
                : 'Paste a Google Sheet share link (anyone-with-link can view) — system fetches and updates automatically'}
            </p>
          </div>
          {sheetConfig && (
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className={`inline-block w-2 h-2 rounded-full ${sheetConfig.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className={`text-xs font-medium ${sheetConfig.enabled ? 'text-green-400' : 'text-gray-400'}`}>
                  {sheetConfig.enabled
                    ? (lang === 'ar' ? 'مزامنة نشطة' : 'Auto-sync ON')
                    : (lang === 'ar' ? 'مزامنة موقوفة' : 'Auto-sync OFF')}
                </span>
              </div>
              {sheetConfig.lastSyncAt && (
                <p className="text-gray-500 text-[10px] mt-0.5">
                  {lang === 'ar' ? 'آخر مزامنة' : 'Last sync'}: {new Date(sheetConfig.lastSyncAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>

        {sheetError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{sheetError}</span>
            <button type="button" onClick={() => setSheetError('')} className="ml-auto text-red-400 hover:text-red-300" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {sheetConfig?.lastSyncStatus === 'error' && sheetConfig.lastSyncMessage && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-300 text-xs mb-3">
            ⚠️ {lang === 'ar' ? 'آخر محاولة مزامنة فشلت:' : 'Last sync attempt failed:'} {sheetConfig.lastSyncMessage}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div className="md:col-span-2">
            <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">
              <Link2 className="w-3.5 h-3.5 inline mr-1" />
              {lang === 'ar' ? 'رابط Google Sheet' : 'Google Sheet URL'}
            </label>
            <input type="url" value={sheetUrlInput} onChange={(e) => setSheetUrlInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              aria-label="Google Sheet URL"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono" />
          </div>
          <div>
            <label className="block text-gray-400 text-xs uppercase font-medium mb-1.5">
              {lang === 'ar' ? 'فترة المزامنة' : 'Sync interval'}
            </label>
            <select aria-label="Sync interval" value={sheetIntervalInput} onChange={(e) => setSheetIntervalInput(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50">
              <option value={5}>{lang === 'ar' ? 'كل 5 دقايق' : 'Every 5 min'}</option>
              <option value={10}>{lang === 'ar' ? 'كل 10 دقايق' : 'Every 10 min'}</option>
              <option value={15}>{lang === 'ar' ? 'كل 15 دقيقة' : 'Every 15 min'}</option>
              <option value={30}>{lang === 'ar' ? 'كل 30 دقيقة' : 'Every 30 min'}</option>
              <option value={60}>{lang === 'ar' ? 'كل ساعة' : 'Every hour'}</option>
              <option value={180}>{lang === 'ar' ? 'كل 3 ساعات' : 'Every 3 hours'}</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => handleSaveSheetConfig()} disabled={sheetSavingConfig || !sheetUrlInput}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {sheetSavingConfig && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {lang === 'ar' ? 'حفظ الإعدادات' : 'Save Config'}
          </button>
          <button type="button"
            onClick={() => handleSaveSheetConfig({ enabled: !sheetConfig?.enabled })}
            disabled={sheetSavingConfig || !sheetConfig?.sheetId}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              sheetConfig?.enabled
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                : 'bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/40'
            } disabled:opacity-50`}>
            <Power className="w-4 h-4" />
            {sheetConfig?.enabled
              ? (lang === 'ar' ? 'إيقاف المزامنة التلقائية' : 'Disable Auto-Sync')
              : (lang === 'ar' ? 'تفعيل المزامنة التلقائية' : 'Enable Auto-Sync')}
          </button>
          <button type="button" onClick={handleSheetSyncNow} disabled={sheetSyncing || !sheetUrlInput}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white text-sm font-medium transition-colors ml-auto">
            <RefreshCw className={`w-4 h-4 ${sheetSyncing ? 'animate-spin' : ''}`} />
            {sheetSyncing
              ? (lang === 'ar' ? 'جاري المزامنة...' : 'Syncing...')
              : (lang === 'ar' ? 'مزامنة الآن' : 'Sync Now')}
          </button>
        </div>

        {sheetConfig?.lastSyncStats && sheetConfig.lastSyncStatus === 'ok' && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="bg-gray-900 rounded-lg p-2 text-center">
              <p className="text-gray-500 text-[10px]">{lang === 'ar' ? 'الشهور' : 'Months'}</p>
              <p className="text-white text-sm font-bold">{sheetConfig.lastSyncStats.monthsDetected?.length || 0}</p>
            </div>
            <div className="bg-gray-900 rounded-lg p-2 text-center">
              <p className="text-gray-500 text-[10px]">{lang === 'ar' ? 'صفوف' : 'Records'}</p>
              <p className="text-white text-sm font-bold">{sheetConfig.lastSyncStats.recordsParsed || 0}</p>
            </div>
            <div className="bg-gray-900 rounded-lg p-2 text-center">
              <p className="text-gray-500 text-[10px]">{lang === 'ar' ? 'مضاف' : 'Inserted'}</p>
              <p className="text-green-400 text-sm font-bold">{sheetConfig.lastSyncStats.daysInserted || 0}</p>
            </div>
            <div className="bg-gray-900 rounded-lg p-2 text-center">
              <p className="text-gray-500 text-[10px]">{lang === 'ar' ? 'محدث' : 'Updated'}</p>
              <p className="text-blue-400 text-sm font-bold">{sheetConfig.lastSyncStats.daysUpdated || 0}</p>
            </div>
            <div className="bg-gray-900 rounded-lg p-2 text-center">
              <p className="text-gray-500 text-[10px]">{lang === 'ar' ? 'وقت' : 'Duration'}</p>
              <p className="text-gray-300 text-sm font-bold">{((sheetConfig.lastSyncStats.durationMs || 0) / 1000).toFixed(1)}s</p>
            </div>
          </div>
        )}
      </div>

      {/* Upload history */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#f37121]" />
            {T.uploadHistory}
          </h2>
          <button type="button" onClick={fetchAll} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {uploads.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">{T.noUploadsYet}</p>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="text-left py-2 px-2">{lang === 'ar' ? 'الملف' : 'File'}</th>
                  <th className="text-left py-2 px-2">{lang === 'ar' ? 'بواسطة' : 'By'}</th>
                  <th className="text-left py-2 px-2">{T.monthsDetected}</th>
                  <th className="text-center py-2 px-2">{T.daysInserted}</th>
                  <th className="text-center py-2 px-2">{T.daysUpdated}</th>
                  <th className="text-center py-2 px-2">{T.daysSkipped}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {uploads.map((u) => (
                  <tr key={u._id} className="text-sm">
                    <td className="py-2 px-2 text-gray-400 text-xs whitespace-nowrap">{new Date(u.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-2 text-gray-300">{u.fileName || '—'}</td>
                    <td className="py-2 px-2 text-gray-300">{u.uploadedBy ? `${u.uploadedBy.firstName} ${u.uploadedBy.lastName}` : '—'}</td>
                    <td className="py-2 px-2 text-gray-400 text-xs">{(u.monthsDetected || []).join(', ')}</td>
                    <td className="py-2 px-2 text-center text-green-400 font-medium">{u.daysInserted}</td>
                    <td className="py-2 px-2 text-center text-blue-400 font-medium">{u.daysUpdated}</td>
                    <td className="py-2 px-2 text-center text-gray-500">{u.daysSkipped}</td>
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-lg">
                        {lang === 'ar' ? 'تنظيف بيانات B2C' : 'Clean B2C Data'}
                      </h3>
                      <p className="text-gray-400 text-xs">
                        {lang === 'ar' ? '⚠️ هذا الإجراء لا يمكن التراجع عنه' : '⚠️ This action cannot be undone'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer">
                      <input type="radio" name="cleanup-scope" checked={cleanupScope === 'orders'}
                        onChange={() => setCleanupScope('orders')}
                        className="mt-0.5 text-[#f37121] focus:ring-[#f37121]/50" />
                      <div className="flex-1">
                        <p className="text-white text-sm font-medium">
                          {lang === 'ar' ? 'حذف الطلبات + سجل الرفع فقط' : 'Delete orders + upload history only'}
                        </p>
                        <p className="text-gray-400 text-xs mt-0.5">
                          {lang === 'ar' ? 'يحتفظ بالمناديب والمشاريع' : 'Keeps reps and projects'}
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer">
                      <input type="radio" name="cleanup-scope" checked={cleanupScope === 'all'}
                        onChange={() => setCleanupScope('all')}
                        className="mt-0.5 text-red-500 focus:ring-red-500/50" />
                      <div className="flex-1">
                        <p className="text-red-300 text-sm font-medium">
                          {lang === 'ar' ? 'حذف الطلبات + المناديب + سجل الرفع' : 'Delete orders + reps + upload history'}
                        </p>
                        <p className="text-gray-400 text-xs mt-0.5">
                          {lang === 'ar' ? 'يحتفظ بالمشاريع فقط (بداية نظيفة تماماً)' : 'Keeps projects only (fully clean slate)'}
                        </p>
                      </div>
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowCleanupModal(false)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm">
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
