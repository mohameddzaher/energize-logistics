'use client';
import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getOperationsTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { ArrowLeft, Upload, Plus, Loader2, FileSpreadsheet, Trash2, CheckCircle2 } from 'lucide-react';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import * as XLSX from 'xlsx';

// ── Field Definitions ──
interface FieldDef {
  key: string;
  label: string;
  labelEn: string;
  type?: string;
  aliases?: string[];
}

// Exact 28 columns matching the Excel sheet, in order
const APP_FIELDS: FieldDef[] = [
  { key: 'reportNumber', label: 'رقم كشف التخريج', labelEn: 'Report Number', aliases: ['رقم الكشف', 'رقم كشف الفئه', 'رقم كشف الفته'] },
  { key: 'loadingTime', label: 'وقت التحميل', labelEn: 'Loading Time' },
  { key: 'fromLocation', label: 'عنوان الشحن', labelEn: 'Shipping Address', aliases: ['من', 'From'] },
  { key: 'toLocation', label: 'عنوان الوصول', labelEn: 'Arrival Address', aliases: ['الي', 'To'] },
  { key: 'branch', label: 'الفرع', labelEn: 'Branch' },
  { key: 'carOwner', label: 'مالك السيارة', labelEn: 'Car Owner', aliases: ['مالك السياره'] },
  { key: 'carNumber', label: 'رقم السيارة', labelEn: 'Car Number', aliases: ['رقم السياره'] },
  { key: 'ownerType', label: 'نوع المالك', labelEn: 'Owner Type' },
  { key: 'executionStatus', label: 'حالة التنفيذ', labelEn: 'Execution Status', aliases: ['حاله التنفيذ'] },
  { key: 'applicationStatus', label: 'الحالة', labelEn: 'Status', aliases: ['حاله الابلكيشن', 'حالة الابلكيشن'] },
  { key: 'driverRentalType', label: 'نوع تأجير السائق', labelEn: 'Driver Rental Type' },
  { key: 'username', label: 'اسم المستخدم', labelEn: 'Username' },
  { key: 'paymentMethod', label: 'طريقة الدفع', labelEn: 'Payment Method', aliases: ['طريقه الدفع'] },
  { key: 'purchaseValue', label: 'سعر الشراء', labelEn: 'Purchase Value', type: 'number', aliases: ['قيمه الشراء', 'قيمة الشراء'] },
  { key: 'sellingValue', label: 'سعر البيع', labelEn: 'Selling Value', type: 'number', aliases: ['قيمه البيع', 'قيمة البيع'] },
  { key: 'reference', label: 'رقم المرجع', labelEn: 'Reference', aliases: ['المرجع'] },
  { key: 'userPhone', label: 'هاتف المستخدم', labelEn: 'User Phone' },
  { key: 'driverName', label: 'اسم السائق', labelEn: 'Driver Name' },
  { key: 'driverPhone', label: 'هاتف السائق', labelEn: 'Driver Phone' },
  { key: 'carName', label: 'اسم السيارة', labelEn: 'Car Name', aliases: ['اسم السياره'] },
  { key: 'plateNumber', label: 'رقم اللوحة', labelEn: 'Plate Number', aliases: ['رقم اللوحه'] },
  { key: 'truckType', label: 'نوع الشاحنة', labelEn: 'Truck Type', aliases: ['نوع الشاحنه'] },
  { key: 'truckSize', label: 'حجم الشاحنة', labelEn: 'Truck Size', aliases: ['حجم الشاحنه'] },
  { key: 'loadType', label: 'نوع الحمولة', labelEn: 'Load Type', aliases: ['نوع الحموله'] },
  { key: 'quantity', label: 'الكمية', labelEn: 'Quantity', aliases: ['الكميه'] },
  { key: 'goodsValue', label: 'قيمة البضائع', labelEn: 'Goods Value', type: 'number', aliases: ['قيمه البضائع'] },
  { key: 'representativeName', label: 'اسم المندوب', labelEn: 'Representative' },
  { key: 'country', label: 'اسم الدولة', labelEn: 'Country', aliases: ['الدوله', 'الدولة', 'اسم الدوله'] },
];

const OPS_FIELDS: FieldDef[] = [
  { key: 'operationsReview', label: 'مراجعه التشغيل', labelEn: 'Operations Review' },
];

const MOD_FIELDS: FieldDef[] = [
  { key: 'paymentDate', label: 'تاريخ السداد', labelEn: 'Payment Date', type: 'date' },
  { key: 'payingBranch', label: 'الفرع المسدد', labelEn: 'Paying Branch' },
  { key: 'finalReportDestination', label: 'وجهه الكشف النهائي', labelEn: 'Final Report Destination' },
  { key: 'documentNumber', label: 'رقم السند', labelEn: 'Document Number' },
  { key: 'sendingDate', label: 'تاريخ الارسال', labelEn: 'Sending Date', type: 'date' },
  { key: 'deliveryDate', label: 'تاريخ التسليم', labelEn: 'Delivery Date', type: 'date' },
  { key: 'accountingReview', label: 'مراجعه الحسابات', labelEn: 'Accounting Review' },
];

const COL_FIELDS: FieldDef[] = [
  { key: 'invoiceNumber', label: 'رقم الفاتوره', labelEn: 'Invoice Number' },
  { key: 'netInvoice', label: 'صافي الفاتوره', labelEn: 'Net Invoice', type: 'number' },
  { key: 'tax', label: 'ضريبه', labelEn: 'Tax', type: 'number' },
  { key: 'totalInvoice', label: 'اجمالى الفاتوره', labelEn: 'Total Invoice', type: 'number' },
  { key: 'invoiceDate', label: 'تاريخ الفاتوره', labelEn: 'Invoice Date', type: 'date' },
  { key: 'invoiceNotes', label: 'ملاحظات الفاتوره', labelEn: 'Invoice Notes' },
  { key: 'collectionDate', label: 'تاريخ التحصيل', labelEn: 'Collection Date', type: 'date' },
];

const SECTIONS = [
  { id: 'application', label: 'Application Details', labelAr: 'بيانات الطلب', fields: APP_FIELDS, color: 'bg-cyan-400' },
  { id: 'operations', label: 'Operations', labelAr: 'التشغيل', fields: OPS_FIELDS, color: 'bg-teal-400' },
  { id: 'manual_moderator', label: 'Manual Moderator', labelAr: 'بيانات المودريتور', fields: MOD_FIELDS, color: 'bg-[#f37121]' },
  { id: 'collections', label: 'Collections', labelAr: 'التحصيل', fields: COL_FIELDS, color: 'bg-blue-400' },
];

// Role -> editable section IDs
const ROLE_EDITABLE: Record<string, string[]> = {
  super_admin: ['application', 'operations_staff', 'manual_moderator', 'collections'],
  moderator: ['application', 'manual_moderator'],
  operations_manager: ['operations_staff'],
  operations: ['application'],
  admin: ['collections'],
  employee: ['collections'],
};

const ALL_FIELDS: FieldDef[] = [...APP_FIELDS, ...OPS_FIELDS, ...MOD_FIELDS, ...COL_FIELDS];

// Build header map: Arabic label, English label, aliases, field key -> field key
const HEADER_MAP: Record<string, string> = {};
ALL_FIELDS.forEach((f) => {
  HEADER_MAP[f.label] = f.key;
  HEADER_MAP[f.label.trim()] = f.key;
  HEADER_MAP[f.labelEn] = f.key;
  HEADER_MAP[f.labelEn.toLowerCase()] = f.key;
  HEADER_MAP[f.key] = f.key;
  if (f.aliases) {
    f.aliases.forEach((alias) => {
      HEADER_MAP[alias] = f.key;
      HEADER_MAP[alias.trim()] = f.key;
    });
  }
});

// Key columns to show in the import preview table
const PREVIEW_COLUMNS: FieldDef[] = [
  APP_FIELDS[0],  // reportNumber
  APP_FIELDS[2],  // fromLocation
  APP_FIELDS[3],  // toLocation
  APP_FIELDS[4],  // branch
  APP_FIELDS[5],  // carOwner
  APP_FIELDS[6],  // carNumber
  APP_FIELDS[13], // purchaseValue
  APP_FIELDS[14], // sellingValue
];

export default function NewOperationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOperationsTranslations(lang);
  const ar = lang === 'ar';
  const fileRef = useRef<HTMLInputElement>(null);

  const isImportMode = searchParams.get('mode') === 'import';
  const [mode, setMode] = useState<'single' | 'import'>(isImportMode ? 'import' : 'single');

  // Single form
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Import
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [unmappedHeaders, setUnmappedHeaders] = useState<string[]>([]);

  const userRole = user?.role || '';
  const editableSections = ROLE_EDITABLE[userRole] || [];

  const updateField = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  // -- Single Create --
  const handleCreate = async () => {
    try {
      setSaving(true);
      setError('');
      await api.post('/api/workflows', formData);
      setSuccess(T.workflowCreatedSuccess);
      setTimeout(() => router.push('/system/operations'), 1000);
    } catch (err: any) {
      setError(err.message || T.failedToCreateWorkflow);
    } finally {
      setSaving(false);
    }
  };

  // -- Excel Import --
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    setUnmappedHeaders([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

        if (jsonData.length === 0) {
          setError(T.excelFileEmpty);
          return;
        }

        const dateFields = ['reportDate', 'paymentDate', 'sendingDate', 'deliveryDate', 'invoiceDate', 'collectionDate'];
        const notMapped: Set<string> = new Set();

        const mapped = jsonData.map((row) => {
          const mappedRow: Record<string, string> = {};
          Object.entries(row).forEach(([header, value]) => {
            const trimmed = header.trim();
            const key = HEADER_MAP[header] || HEADER_MAP[trimmed] || HEADER_MAP[trimmed.toLowerCase()];
            if (key) {
              if (dateFields.includes(key) && typeof value === 'number') {
                const date = XLSX.SSF.parse_date_code(value);
                mappedRow[key] = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
              } else {
                mappedRow[key] = String(value);
              }
            } else if (trimmed && String(value).trim()) {
              notMapped.add(trimmed);
            }
          });
          return mappedRow;
        });

        if (notMapped.size > 0) {
          setUnmappedHeaders(Array.from(notMapped));
        }

        setImportRows(mapped);
      } catch {
        setError(T.failedToParseExcel);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const updateImportRow = (index: number, key: string, value: string) => {
    setImportRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const removeImportRow = (index: number) => {
    setImportRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBulkImport = async () => {
    if (importRows.length === 0) { setError(T.noRowsToImport); return; }
    try {
      setImporting(true);
      setError('');
      const result = await api.post<any>('/api/workflows/bulk-import', { rows: importRows });
      setSuccess(T.successfullyImported.replace('{count}', String(result.imported)));
      setTimeout(() => router.push('/system/operations'), 1500);
    } catch (err: any) {
      setError(err.message || T.failedToImport);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers = APP_FIELDS.map((f) => f.label);
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    // Set column widths
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'operations-import-template.xlsx');
  };

  // الصفوف المعروضة هنا نتيجةُ مطابقةٍ للأعمدة العربية ثم تعديلٍ يدويّ، ولا
  // تُحفَظ في أيّ مكان قبل الضغط على «استيراد» — فالتصدير هو السبيل الوحيد إلى
  // مراجعتها أو حفظ نسخةٍ منها قبل رفعها.
  const exportCols = (defs: FieldDef[]): ExportColumn[] =>
    defs.map((f) => ({ header: ar ? f.label : f.labelEn, key: f.key, width: 18 }));

  // Count how many fields were populated across all rows
  const mappedFieldCount = importRows.length > 0
    ? new Set(importRows.flatMap((r) => Object.keys(r).filter((k) => r[k]))).size
    : 0;

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.push('/system/operations')} title={T.back} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {mode === 'single' ? T.newWorkflowRequest : T.importFromExcel}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {mode === 'single' ? T.fillDetailsBelow : T.uploadExcelDescription}
          </p>
        </div>
        {mode === 'import' && importRows.length > 0 && (
          <div className="ms-auto">
            <ExportMenu
              fileName="operations-import-preview" lang={ar ? 'ar' : 'en'}
              options={[
                { key: 'preview', label: ar ? 'أعمدة المعاينة' : 'Preview columns', sheets: [{ name: ar ? 'المعاينة' : 'Preview', rows: importRows, columns: exportCols(PREVIEW_COLUMNS) }] },
                {
                  key: 'all',
                  // المعاينة تُظهر ثمانية أعمدة فقط بينما الاستيراد يرفع كلَّ
                  // الحقول المُطابَقة، فالتصدير المختصر وحده يُخفي ما سيُرفع.
                  label: ar ? `كل الحقول (${ALL_FIELDS.length} عموداً)` : `All fields (${ALL_FIELDS.length} columns)`,
                  sheets: [{ name: ar ? 'كل الحقول' : 'All fields', rows: importRows, columns: exportCols(ALL_FIELDS) }],
                },
              ]}
            />
          </div>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('single')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'single' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 border border-slate-200 hover:text-slate-900'}`}>
          <Plus className="w-4 h-4 inline me-1.5" />{T.singleRequest}
        </button>
        <button type="button" onClick={() => setMode('import')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'import' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 border border-slate-200 hover:text-slate-900'}`}>
          <Upload className="w-4 h-4 inline me-1.5" />{T.importExcel}
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{error}</div>}
      {success && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-600 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{success}</div>}

      {/* -- Single Request Form -- */}
      {mode === 'single' && (
        <div className="space-y-4">
          {SECTIONS.map((section) => {
            const canEdit = editableSections.includes(section.id);
            return (
              <div key={section.id} className={`bg-white border rounded-xl p-6 ${canEdit ? 'border-slate-200' : 'border-slate-200/70 opacity-60'} shadow-sm`}>
                <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${section.color}`} />
                  {section.label} <span className="text-slate-500 text-xs">({section.labelAr})</span>
                  {!canEdit && <span className="ms-auto text-slate-500 text-xs italic">{T.viewOnly}</span>}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {section.fields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-slate-500 text-xs mb-1.5">
                        {field.label} <span className="text-slate-600">({field.labelEn})</span>
                      </label>
                      <input
                        type={field.type || 'text'}
                        value={formData[field.key] || ''}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        disabled={!canEdit}
                        className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none [color-scheme:light] ${
                          canEdit
                            ? 'bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#f37121]/50'
                            : 'bg-slate-100 border-slate-200/70 text-slate-500 cursor-not-allowed'
                        }`}
                        placeholder={canEdit ? field.label : '\u2014'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => router.push('/system/operations')} className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm hover:bg-slate-200 transition-colors">
              {T.cancel}
            </button>
            <button type="button" onClick={handleCreate} disabled={saving}
              className="px-6 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {T.createRequest}
            </button>
          </div>
        </div>
      )}

      {/* -- Excel Import -- */}
      {mode === 'import' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2 mb-3">
                  <FileSpreadsheet className="w-5 h-5 text-green-600" />
                  {T.uploadExcelFile}
                </h2>
                <p className="text-slate-500 text-xs mt-1">
                  {T.supportsHeaders}
                </p>
              </div>
              <button type="button" onClick={downloadTemplate} className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5" /> {T.downloadTemplate}
              </button>
            </div>

            <div
              role="button" tabIndex={0} aria-label={T.uploadExcelFile}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#f37121]/50 hover:bg-slate-100 transition-all"
            >
              <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
              {fileName ? (
                <div>
                  <p className="text-slate-900 text-sm font-medium">{fileName}</p>
                  <p className="text-green-600 text-xs mt-1">{importRows.length} {T.rowsImported} &middot; {mappedFieldCount} {T.fieldsMapped}</p>
                </div>
              ) : (
                <>
                  <p className="text-slate-500 text-sm">{T.clickToUpload}</p>
                  <p className="text-slate-600 text-xs mt-1">{T.xlsxFiles}</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} title={T.uploadExcelFile} className="hidden" />
          </div>

          {/* Unmapped headers warning */}
          {unmappedHeaders.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-700 text-sm">
              <p className="font-medium mb-1">{T.columnsNotMatched}</p>
              <p className="text-yellow-700/70 text-xs">{unmappedHeaders.join(' \u2022 ')}</p>
            </div>
          )}

          {importRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm mb-3">
                  {T.preview} ({importRows.length})
                </h3>
                <span className="text-slate-500 text-xs">{T.showingKeyColumns} &middot; {T.allFieldsImported.replace('{count}', String(APP_FIELDS.length))}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-200">
                      <th className="px-3 py-2 text-start text-xs text-slate-300 w-10">#</th>
                      {PREVIEW_COLUMNS.map((f) => (
                        <th key={f.key} className="px-3 py-2 text-start text-xs text-slate-300">{f.label}</th>
                      ))}
                      <th className="px-3 py-2 w-10"><span className="sr-only">{T.actions}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {importRows.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-100">
                        <td className="px-3 py-2 text-xs text-slate-800">{i + 1}</td>
                        {PREVIEW_COLUMNS.map((f) => (
                          <td key={f.key} className="px-3 py-1">
                            <input
                              type={f.type || 'text'}
                              value={row[f.key] || ''}
                              onChange={(e) => updateImportRow(i, f.key, e.target.value)}
                              title={f.label}
                              className="w-full px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-[#f37121]/50 [color-scheme:light]"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => removeImportRow(i)} title={T.removeRow} className="p-1 text-slate-700 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-slate-200">
                <button type="button" onClick={() => { setImportRows([]); setFileName(''); setUnmappedHeaders([]); }} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm hover:bg-slate-200 transition-colors">
                  {T.clear}
                </button>
                <button type="button" onClick={handleBulkImport} disabled={importing}
                  className="px-6 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 flex items-center gap-2">
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {T.importCount.replace('{count}', String(importRows.length))}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
