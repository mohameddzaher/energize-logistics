'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, X, Check, Loader2, ArrowUpCircle, ArrowDownCircle,
  ShoppingCart, Lock, Unlock, AlertTriangle, Search,
  Receipt, Download, Pencil, Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getWalletTranslations } from '@/lib/translations';

interface DailyWallet {
  _id: string;
  user: { _id: string; firstName: string; lastName: string };
  branch: { _id: string; name: string };
  date: string;
  openingBalance: number;
  closingBalance: number;
  totalCollections: number;
  totalExpenses: number;
  totalPurchases: number;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: { firstName: string; lastName: string } | null;
  actualCash: number | null;
  cashDifference: number | null;
  differenceReason: string;
  differenceNotes: string;
}

interface Transaction {
  _id: string;
  type: 'collection' | 'expense' | 'purchase';
  amount: number;
  customer: { _id: string; companyName: string; customerNumber: string } | null;
  invoice: { invoiceNumber: string; amount: number; balance: number } | null;
  collectionSource: 'client' | 'company';
  deliveryStatementNumber: string;
  description: string;
  vendor: { _id: string; name: string } | null;
  vendorName: string;
  driver: { _id: string; name: string } | null;
  driverName: string;
  expenseCategory: { _id: string; name: string } | null;
  itemName: string;
  purchaseDeliveryStatementNumber: string;
  purchaseInvoiceAmount: number | null;
  purchaseDriverName: string;
  purchaseReceiptNumber: string;
  purchaseBranch: string;
  reference: string;
  notes: string;
  isFlagged: boolean;
  flagReason: string;
  createdAt: string;
  operationDetails?: {
    client: string;
    from: string;
    to: string;
    carType: string;
    length: string;
    carNumber: string;
    reportDate: string | null;
    branch: string;
  };
}


// Translations are now in @/lib/translations

const TYPE_CONFIG = {
  collection: { label: 'Collection', labelAr: 'تحصيل', icon: ArrowUpCircle, color: 'text-green-400', bg: 'bg-green-500/20' },
  expense: { label: 'Expense', labelAr: 'مصروف', icon: ArrowDownCircle, color: 'text-red-400', bg: 'bg-red-500/20' },
  purchase: { label: 'Purchase', labelAr: 'مشتريات', icon: ShoppingCart, color: 'text-blue-400', bg: 'bg-blue-500/20' },
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function WalletPage() {
  const { user } = useAuth();
  const isManager = ['super_admin', 'admin', 'operations_manager', 'operations'].includes(user?.role || '');
  const isReadOnly = user?.role === 'moderator';
  const isSuperAdmin = user?.role === 'super_admin';
  const isOpsManager = user?.role === 'operations_manager';
  const canSelectBranch = isSuperAdmin || isOpsManager;

  const { lang } = useLanguage();
  const L = getWalletTranslations(lang);
  const typeLabel = (type: 'collection' | 'expense' | 'purchase') => lang === 'ar' ? TYPE_CONFIG[type].labelAr : TYPE_CONFIG[type].label;

  const [wallet, setWallet] = useState<DailyWallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getTodayStr());

  // Super admin: branch & user selectors
  const [allBranches, setAllBranches] = useState<{ _id: string; name: string }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branchUsers, setBranchUsers] = useState<{ _id: string; firstName: string; lastName: string }[]>([]);
  const [selectedUser, setSelectedUser] = useState('');

  // Transaction modal
  const [showTxModal, setShowTxModal] = useState(false);
  const [txType, setTxType] = useState<'collection' | 'expense' | 'purchase'>('collection');
  const [txForm, setTxForm] = useState({
    amount: '', deliveryStatementNumber: '', itemName: '', notes: '',
    collectionSource: 'client' as 'client' | 'company', description: '',
    purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [txError, setTxError] = useState('');

  // Edit transaction
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  // Close day modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeForm, setCloseForm] = useState({ actualCash: '', differenceReason: '', differenceNotes: '' });
  const [closing, setClosing] = useState(false);

  // Confirm modal (replaces browser confirm())
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // General error banner
  const [actionError, setActionError] = useState('');

  // Bulk upload purchases
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkRows, setBulkRows] = useState<any[]>([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkUploading, setBulkUploading] = useState(false);
  // Manual column mapping (when auto-detection fails)
  const [bulkRawPreview, setBulkRawPreview] = useState<{ sheetName: string; rows: any[][] } | null>(null);
  const [bulkWorkbook, setBulkWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [manualDeliveryCol, setManualDeliveryCol] = useState<number>(-1);
  const [manualValueCol, setManualValueCol] = useState<number>(-1);
  const [manualBranchCol, setManualBranchCol] = useState<number>(-1);
  const [manualDataStart, setManualDataStart] = useState<number>(0);

  // Purchase report lookup
  const [purchaseReportSearch, setPurchaseReportSearch] = useState('');
  const [purchaseReportMsg, setPurchaseReportMsg] = useState('');
  const [purchaseInvoiceAmount, setPurchaseInvoiceAmount] = useState<number | null>(null);

  // ─── LOAD BRANCHES (super_admin & operations_manager) ───────
  useEffect(() => {
    if (!canSelectBranch) return;
    api.get<any>('/api/branches').then((data) => {
      const list = data.branches || data || [];
      setAllBranches(list);
      if (list.length > 0 && !selectedBranch) setSelectedBranch(list[0]._id);
    }).catch((err: any) => { setActionError(err?.message || 'Failed to load branches'); });
  }, [canSelectBranch]);

  // ─── LOAD USERS FOR BRANCH ─────────────────────────────────
  useEffect(() => {
    if (!canSelectBranch || !selectedBranch) return;
    api.get<any>(`/api/users?branch=${selectedBranch}`).then((data) => {
      const users = (data.users || data || []).filter((u: any) => ['operations', 'operations_manager'].includes(u.role));
      setBranchUsers(users);
      if (users.length > 0) setSelectedUser(users[0]._id);
      else setSelectedUser('');
    }).catch((err: any) => { setActionError(err?.message || 'Failed to load users'); });
  }, [canSelectBranch, selectedBranch]);

  // ─── FETCH WALLET ──────────────────────────────────────────
  const fetchWallet = useCallback(async (showSpinner = true) => {
    if (canSelectBranch && (!selectedBranch || !selectedUser)) {
      setLoading(false);
      setWallet(null);
      setTransactions([]);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      let url = `/api/wallet/daily?date=${selectedDate}`;
      if (canSelectBranch && selectedUser) url += `&userId=${selectedUser}`;
      const data = await api.get<any>(url);
      setWallet(data.wallet);
      setTransactions(data.transactions || []);
    } catch (err: any) {
      setWallet(null);
      setTransactions([]);
      if (err?.message?.includes('No branch') || err?.message?.includes('branch')) {
        setActionError(lang === 'ar' ? 'لم يتم تعيين فرع لهذا المستخدم. يرجى تعيين فرع من إعدادات المستخدمين.' : 'No branch assigned to this user. Please assign a branch in User Settings.');
      }
    }
    setLoading(false);
  }, [selectedDate, canSelectBranch, selectedBranch, selectedUser]);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  // WebSocket
  const handleWalletEvent = useCallback(() => { fetchWallet(false); }, [fetchWallet]);
  useSocket('wallet:transaction', handleWalletEvent);
  useSocket('wallet:transactionDeleted', handleWalletEvent);
  useSocket('wallet:dayClosed', handleWalletEvent);
  useSocket('wallet:dayReopened', handleWalletEvent);

  // ─── ADD TRANSACTION ───────────────────────────────────────
  const handleAddTransaction = async () => {
    if (!txForm.amount || Number(txForm.amount) <= 0) return;
    setSubmitting(true);
    setTxError('');
    try {
      const payload: any = {
        date: selectedDate,
        type: txType,
        amount: Number(txForm.amount),
        notes: txForm.notes || undefined,
      };
      if (txType === 'collection') {
        payload.collectionSource = txForm.collectionSource;
        if (txForm.collectionSource === 'client') {
          payload.deliveryStatementNumber = txForm.deliveryStatementNumber || undefined;
        } else {
          payload.description = txForm.description || undefined;
        }
      }
      if (txType === 'expense') {
        payload.itemName = txForm.itemName || undefined;
      }
      if (txType === 'purchase') {
        payload.purchaseDeliveryStatementNumber = txForm.purchaseDeliveryStatementNumber || undefined;
        payload.purchaseDriverName = txForm.purchaseDriverName || undefined;
        payload.purchaseReceiptNumber = txForm.purchaseReceiptNumber || undefined;
        payload.purchaseBranch = txForm.purchaseBranch || undefined;
      }
      await api.post('/api/wallet/transactions', payload);
      setShowTxModal(false);
      setTxForm({ amount: '', deliveryStatementNumber: '', itemName: '', notes: '', collectionSource: 'client', description: '', purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '' });
      fetchWallet(false);
    } catch (err: any) {
      setTxError(err.message || 'Failed to add transaction');
    }
    setSubmitting(false);
  };

  // ─── BULK UPLOAD PURCHASES ─────────────────────────────────
  // Detect Arabic month name → month number (1-12)
  const detectMonthFromName = (name: string): number | null => {
    const n = name.toLowerCase();
    const months: Record<string, number> = {
      'يناير': 1, 'january': 1, 'jan': 1,
      'فبراير': 2, 'february': 2, 'feb': 2,
      'مارس': 3, 'march': 3, 'mar': 3,
      'ابريل': 4, 'أبريل': 4, 'april': 4, 'apr': 4,
      'مايو': 5, 'may': 5,
      'يونيو': 6, 'june': 6, 'jun': 6,
      'يوليو': 7, 'july': 7, 'jul': 7,
      'اغسطس': 8, 'أغسطس': 8, 'august': 8, 'aug': 8,
      'سبتمبر': 9, 'september': 9, 'sep': 9,
      'اكتوبر': 10, 'أكتوبر': 10, 'october': 10, 'oct': 10,
      'نوفمبر': 11, 'november': 11, 'nov': 11,
      'ديسمبر': 12, 'december': 12, 'dec': 12,
    };
    for (const [key, m] of Object.entries(months)) {
      if (n.includes(key)) return m;
    }
    return null;
  };

  // Smart parser: scans ALL rows to find headers, then detects delivery/value/branch columns
  // Very flexible - works regardless of header position or column order
  const parseSheetSmart = (ws: XLSX.WorkSheet, sheetName: string = ''): Array<{ delivery: string; value: number; branch: string }> => {
    const ref = ws['!ref'];
    if (!ref) return [];

    // Read with full range preserved (no blank row skipping, all cells)
    const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
    if (raw.length === 0) return [];

    // Keywords to match (longer/more specific first)
    const deliveryKeywords = ['رقم التخريج', 'كشف التخريج', 'تخريج', 'كشف', 'delivery', 'statement', 'رقم كشف'];
    const valueKeywords = ['القيمه', 'القيمة', 'قيمه', 'قيمة', 'المبلغ', 'value', 'amount'];
    const branchKeywords = ['الفرع', 'فرع', 'branch'];

    const matchesAny = (cell: string, keywords: string[]): boolean => {
      const c = cell.toLowerCase().replace(/\s+/g, ' ').trim();
      return keywords.some(k => c.includes(k.toLowerCase()));
    };

    // Scan ALL rows to find the best header row
    let headerRowIdx = -1;
    let deliveryCol = -1;
    let valueCol = -1;
    let branchCol = -1;

    for (let i = 0; i < raw.length; i++) {
      const row = raw[i] as any[];
      if (!row || !Array.isArray(row)) continue;

      let foundInThisRow = 0;
      const thisRowDelivery = -1;
      const thisRowValue = -1;
      const thisRowBranch = -1;
      let rowDelivery = -1, rowValue = -1, rowBranch = -1;

      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] || '').trim();
        if (!cell) continue;
        if (rowDelivery < 0 && matchesAny(cell, deliveryKeywords)) { rowDelivery = c; foundInThisRow++; }
        if (rowValue < 0 && matchesAny(cell, valueKeywords)) { rowValue = c; foundInThisRow++; }
        if (rowBranch < 0 && matchesAny(cell, branchKeywords)) { rowBranch = c; foundInThisRow++; }
      }

      // Prefer row that has the most matches. If this row beats the current best, use it.
      const currentBest = (deliveryCol >= 0 ? 1 : 0) + (valueCol >= 0 ? 1 : 0) + (branchCol >= 0 ? 1 : 0);
      if (foundInThisRow > currentBest) {
        headerRowIdx = i;
        deliveryCol = rowDelivery;
        valueCol = rowValue;
        branchCol = rowBranch;
      }

      // If we found all 3, stop
      if (deliveryCol >= 0 && valueCol >= 0 && branchCol >= 0) break;
    }

    console.log(`[BulkUpload][${sheetName}] Header row: ${headerRowIdx}, Cols: delivery=${deliveryCol}, value=${valueCol}, branch=${branchCol}`);
    if (headerRowIdx >= 0) {
      console.log(`[BulkUpload][${sheetName}] Header content:`, raw[headerRowIdx]);
    }

    const out: Array<{ delivery: string; value: number; branch: string }> = [];

    // Strategy A: If we found a header, use detected columns
    if (deliveryCol >= 0 && valueCol >= 0 && headerRowIdx >= 0) {
      for (let i = headerRowIdx + 1; i < raw.length; i++) {
        const row = raw[i] as any[];
        if (!row || !Array.isArray(row) || row.length === 0) continue;

        const deliveryRaw = row[deliveryCol];
        const valueRaw = row[valueCol];
        const branchRaw = branchCol >= 0 ? row[branchCol] : '';

        if (deliveryRaw === '' || deliveryRaw === null || deliveryRaw === undefined) continue;
        const delivery = String(deliveryRaw).trim();
        if (!delivery || delivery.toLowerCase() === 'nan') continue;
        if (/^(total|إجمالي|اجمالي|المجموع|sum)/i.test(delivery)) continue;

        const cleanValue = String(valueRaw).replace(/[^\d.-]/g, '');
        const value = Number(cleanValue);
        if (!value || isNaN(value) || value <= 0) continue;

        const branch = String(branchRaw || '').trim();
        out.push({ delivery, value, branch });
      }

      if (out.length > 0) {
        console.log(`[BulkUpload][${sheetName}] Strategy A (headers) found ${out.length} rows`);
        return out;
      }
    }

    // Strategy B: Brute-force scan every row for a pattern:
    // look for any cell that is a non-empty short string (delivery-like) followed by
    // a cell that is a positive number (value-like), with an optional city name nearby (branch)
    console.log(`[BulkUpload][${sheetName}] Falling back to Strategy B (pattern scan)`);
    const cityHints = ['جده', 'جدة', 'الرياض', 'الدمام', 'ينبع', 'مكة', 'مكه', 'المدينة', 'المدينه', 'الخبر', 'الطائف', 'تبوك', 'ابها', 'أبها', 'حائل', 'نجران', 'جازان', 'بريدة', 'بريده', 'الخرج'];

    for (let i = 0; i < raw.length; i++) {
      const row = raw[i] as any[];
      if (!row || !Array.isArray(row) || row.length === 0) continue;

      // Find a numeric cell > 0 and a non-numeric short cell (possibly delivery)
      let foundDelivery: string | null = null;
      let foundValue: number | null = null;
      let foundBranch = '';

      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell === '' || cell === null || cell === undefined) continue;
        const str = String(cell).trim();

        // Try to parse as number
        const cleanNum = str.replace(/[^\d.-]/g, '');
        const num = cleanNum ? Number(cleanNum) : NaN;
        const isPureNumber = !isNaN(num) && /^[\d.,\s-]+$/.test(str);

        if (isPureNumber && num > 0) {
          // Largest positive number in the row = likely the value (but also delivery number could be pure digits)
          // We'll pick the biggest one as value, the other pure-digit cells could be delivery
          if (foundValue === null || num > foundValue) {
            // Save previous as candidate delivery if it was different
            if (foundValue !== null && foundDelivery === null) {
              foundDelivery = String(foundValue);
            }
            foundValue = num;
          } else if (foundDelivery === null) {
            foundDelivery = str;
          }
        } else if (!isPureNumber && str.length <= 50) {
          // Non-numeric: could be delivery ID or branch
          if (cityHints.some(city => str.includes(city))) {
            foundBranch = str;
          } else if (!foundDelivery && /[a-zA-Z\d]/.test(str)) {
            foundDelivery = str;
          }
        }
      }

      if (foundDelivery && foundValue && foundValue > 0 && !/^(total|إجمالي|اجمالي|المجموع|sum|رقم|القيمه|القيمة|الفرع|date|التاريخ)/i.test(foundDelivery)) {
        out.push({ delivery: foundDelivery, value: foundValue, branch: foundBranch });
      }
    }

    console.log(`[BulkUpload][${sheetName}] Strategy B found ${out.length} rows`);
    return out;
  };

  const handleBulkFile = (file: File) => {
    setBulkError('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        // Determine base month/year (from file name, fallback to selectedDate)
        const selectedD = new Date(selectedDate);
        const baseYear = selectedD.getFullYear();
        let baseMonth = selectedD.getMonth() + 1;
        const detectedMonth = detectMonthFromName(file.name.replace(/\.xlsx?$/i, ''));
        if (detectedMonth) baseMonth = detectedMonth;

        const allRows: Array<{ deliveryStatement: string; value: number; branch: string; date: string; sheet?: string }> = [];

        // Go through every sheet. For each sheet:
        // 1. If sheet name is numeric (1-31) → use positional columns (10/13/14) and date from sheet name
        // 2. Otherwise → try positional columns first; if no data found, fall back to header-based
        // 3. Skip sheets named DATA or similar metadata sheets unless they contain data
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;

          const isDaySheet = /^\d{1,2}$/.test(sheetName);
          const day = isDaySheet ? parseInt(sheetName, 10) : null;
          if (isDaySheet && (day! < 1 || day! > 31)) continue;

          // Smart parser: auto-detects headers and columns
          const parsed = parseSheetSmart(ws, sheetName);

          // Determine date for each row
          const dateStr = isDaySheet
            ? `${baseYear}-${String(baseMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            : selectedDate;

          for (const r of parsed) {
            allRows.push({
              deliveryStatement: r.delivery,
              value: r.value,
              branch: r.branch,
              date: dateStr,
              sheet: sheetName,
            });
          }
        }

        if (allRows.length === 0) {
          // Auto-detection failed - show manual column picker
          const firstSheet = wb.Sheets[wb.SheetNames[0]];
          const rawSample = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1, defval: '' });

          console.log('[BulkUpload] Sheets:', wb.SheetNames);
          console.log('[BulkUpload] All rows of first sheet:');
          rawSample.forEach((r, i) => console.log(`  Row ${i}:`, r));

          // Store workbook and show manual picker UI
          setBulkWorkbook(wb);
          setBulkRawPreview({ sheetName: wb.SheetNames[0], rows: rawSample });
          setBulkFileName(file.name);
          // Suggest defaults based on fixed layout (columns 10/13/14, data from row 4)
          setManualDeliveryCol(10);
          setManualValueCol(13);
          setManualBranchCol(14);
          setManualDataStart(4);
          setBulkError('');
          return;
        }

        setBulkRows(allRows);
        setBulkFileName(file.name);
      } catch (err: any) {
        setBulkError(err.message || 'Failed to parse Excel file');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Apply manual column selection and extract rows from ALL sheets in workbook
  const handleManualExtract = () => {
    if (!bulkWorkbook) return;
    if (manualDeliveryCol < 0 || manualValueCol < 0) {
      setBulkError(lang === 'ar' ? 'يجب اختيار عمود رقم التخريج وعمود القيمة' : 'You must pick delivery and value columns');
      return;
    }

    const selectedD = new Date(selectedDate);
    const baseYear = selectedD.getFullYear();
    let baseMonth = selectedD.getMonth() + 1;
    const detectedMonth = detectMonthFromName((bulkFileName || '').replace(/\.xlsx?$/i, ''));
    if (detectedMonth) baseMonth = detectedMonth;

    const allRows: Array<{ deliveryStatement: string; value: number; branch: string; date: string; sheet?: string }> = [];

    for (const sheetName of bulkWorkbook.SheetNames) {
      const ws = bulkWorkbook.Sheets[sheetName];
      if (!ws) continue;

      const isDaySheet = /^\d{1,2}$/.test(sheetName);
      const day = isDaySheet ? parseInt(sheetName, 10) : null;
      if (isDaySheet && (day! < 1 || day! > 31)) continue;

      const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
      if (raw.length === 0) continue;

      const dateStr = isDaySheet
        ? `${baseYear}-${String(baseMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        : selectedDate;

      for (let i = manualDataStart; i < raw.length; i++) {
        const row = raw[i] as any[];
        if (!row || !Array.isArray(row) || row.length === 0) continue;

        const deliveryRaw = row[manualDeliveryCol];
        const valueRaw = row[manualValueCol];
        const branchRaw = manualBranchCol >= 0 ? row[manualBranchCol] : '';

        if (deliveryRaw === '' || deliveryRaw === null || deliveryRaw === undefined) continue;
        const delivery = String(deliveryRaw).trim();
        if (!delivery || delivery.toLowerCase() === 'nan') continue;
        if (/^(total|إجمالي|اجمالي|المجموع|sum|رصيد الخزينه|اجمال)/i.test(delivery)) continue;

        const cleanValue = String(valueRaw).replace(/[^\d.-]/g, '');
        const value = Number(cleanValue);
        if (!value || isNaN(value) || value <= 0) continue;

        const branch = String(branchRaw || '').trim();
        allRows.push({ deliveryStatement: delivery, value, branch, date: dateStr, sheet: sheetName });
      }
    }

    if (allRows.length === 0) {
      setBulkError(lang === 'ar' ? 'لم يتم العثور على بيانات بالأعمدة المختارة' : 'No data found with selected columns');
      return;
    }

    setBulkRows(allRows);
    setBulkRawPreview(null);
    setBulkError('');
  };

  const handleBulkSubmit = async () => {
    if (bulkRows.length === 0) return;
    setBulkUploading(true);
    setBulkProgress(0);
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < bulkRows.length; i++) {
      const row = bulkRows[i];
      try {
        await api.post('/api/wallet/transactions', {
          date: row.date || selectedDate,
          type: 'purchase',
          amount: row.value,
          purchaseDeliveryStatementNumber: row.deliveryStatement,
          purchaseBranch: row.branch,
        });
        succeeded++;
      } catch {
        failed++;
      }
      setBulkProgress(Math.round(((i + 1) / bulkRows.length) * 100));
    }

    setBulkUploading(false);
    if (succeeded > 0) {
      setShowBulkUpload(false);
      setBulkRows([]);
      setBulkFileName('');
      fetchWallet(false);
      setActionError('');
    }
    if (failed > 0) {
      setActionError((lang === 'ar' ? `فشل في ${failed} معاملة. نجح ${succeeded}` : `${failed} failed, ${succeeded} succeeded`));
    }
  };

  // ─── DELETE TRANSACTION ────────────────────────────────────
  const handleDeleteTx = async (id: string) => {
    setConfirmModal({
      message: L.deleteConfirm,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionError('');
        try {
          await api.delete(`/api/wallet/transactions/${id}`);
          fetchWallet(false);
        } catch (err: any) {
          setActionError(err?.message || 'Failed to delete transaction');
        }
      },
    });
  };

  // ─── EDIT TRANSACTION ──────────────────────────────────────
  const openEditTx = (tx: Transaction) => {
    setEditingTx(tx);
    setEditForm({
      amount: String(tx.amount),
      notes: tx.notes || '',
      itemName: tx.itemName || '',
      deliveryStatementNumber: tx.deliveryStatementNumber || '',
      description: tx.description || '',
      purchaseDeliveryStatementNumber: (tx as any).purchaseDeliveryStatementNumber || '',
      purchaseDriverName: (tx as any).purchaseDriverName || '',
      purchaseReceiptNumber: (tx as any).purchaseReceiptNumber || '',
      purchaseBranch: (tx as any).purchaseBranch || '',
    });
  };

  const handleEditTx = async () => {
    if (!editingTx || !editForm.amount || Number(editForm.amount) <= 0) return;
    setSubmitting(true);
    setActionError('');
    try {
      const payload: Record<string, any> = {
        amount: Number(editForm.amount),
        notes: editForm.notes || undefined,
      };
      if (editingTx.type === 'expense') {
        payload.itemName = editForm.itemName || undefined;
      }
      if (editingTx.type === 'collection') {
        payload.deliveryStatementNumber = editForm.deliveryStatementNumber || undefined;
        payload.description = editForm.description || undefined;
      }
      if (editingTx.type === 'purchase') {
        payload.purchaseDeliveryStatementNumber = editForm.purchaseDeliveryStatementNumber || undefined;
        payload.purchaseDriverName = editForm.purchaseDriverName || undefined;
        payload.purchaseReceiptNumber = editForm.purchaseReceiptNumber || undefined;
        payload.purchaseBranch = editForm.purchaseBranch || undefined;
      }
      await api.put(`/api/wallet/transactions/${editingTx._id}`, payload);
      setEditingTx(null);
      fetchWallet(false);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update transaction');
    }
    setSubmitting(false);
  };

  // ─── CLOSE DAY ─────────────────────────────────────────────
  const handleCloseDay = async () => {
    setClosing(true);
    try {
      await api.post('/api/wallet/close-day', {
        date: selectedDate,
        actualCash: closeForm.actualCash ? Number(closeForm.actualCash) : undefined,
        differenceReason: closeForm.differenceReason,
        differenceNotes: closeForm.differenceNotes,
      });
      setShowCloseModal(false);
      // Auto-navigate to next day (which was auto-created by backend)
      if (!isManager) {
        const nextDate = new Date(selectedDate + 'T00:00:00');
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
        setSelectedDate(nextDateStr);
      } else {
        fetchWallet(false);
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to close day');
    }
    setClosing(false);
  };

  // ─── REOPEN DAY ────────────────────────────────────────────
  const handleReopenDay = () => {
    if (!wallet) return;
    setConfirmModal({
      message: L.reopenConfirm,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionError('');
        try {
          await api.post(`/api/wallet/reopen/${wallet._id}`);
          fetchWallet(false);
        } catch (err: any) {
          setActionError(err?.message || 'Failed to reopen day');
        }
      },
    });
  };

  // Search by report number for purchases
  const handlePurchaseReportSearch = async () => {
    if (!purchaseReportSearch.trim()) return;
    setPurchaseReportMsg('');
    setPurchaseInvoiceAmount(null);
    try {
      const data = await api.get<any>(`/api/wallet/lookup-report?reportNumber=${encodeURIComponent(purchaseReportSearch.trim())}`);
      setTxForm((f) => ({
        ...f,
        purchaseDeliveryStatementNumber: data.reportNumber,
      }));
      setPurchaseInvoiceAmount(data.sellingValue || null);
      setPurchaseReportMsg(`Found — Selling Price: ${(data.sellingValue || 0).toLocaleString()} SAR`);
    } catch (err: any) {
      setPurchaseReportMsg(err.message || 'Report not found');
    }
  };

  const handleExportExcel = () => {
    if (!wallet) return;
    const walletSummaryColumns = [
      { header: 'Branch', key: 'branch.name', width: 20 },
      { header: 'User', key: 'user', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 20 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Opening Balance (SAR)', key: 'openingBalance', transform: fmt.money, width: 20 },
      { header: 'Collections (SAR)', key: 'totalCollections', transform: fmt.money, width: 18 },
      { header: 'Expenses (SAR)', key: 'totalExpenses', transform: fmt.money, width: 18 },
      { header: 'Purchases (SAR)', key: 'totalPurchases', transform: fmt.money, width: 18 },
      { header: 'Closing Balance (SAR)', key: 'closingBalance', transform: fmt.money, width: 20 },
      { header: 'Status', key: 'isClosed', transform: (v: any) => v ? 'Closed' : 'Open', width: 10 },
      { header: 'Actual Cash (SAR)', key: 'actualCash', transform: (v: any, row: any) => v != null ? fmt.money(v) : (row?.isClosed ? fmt.money(0) : 'Not Closed'), width: 18 },
      { header: 'Cash Difference (SAR)', key: 'cashDifference', transform: (v: any, row: any) => v != null ? fmt.money(v) : (row?.isClosed ? fmt.money(0) : 'Not Closed'), width: 20 },
    ];
    const txColumns = [
      { header: 'Date', key: 'createdAt', transform: fmt.date, width: 12 },
      { header: 'Time', key: 'createdAt', transform: (v: any) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '', width: 8 },
      { header: 'Type', key: 'type', transform: (v: any) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '', width: 12 },
      { header: 'Amount (SAR)', key: 'amount', transform: fmt.money, width: 15 },
      { header: 'Customer', key: 'customer', transform: (v: any) => v ? `${v.companyName} (${v.customerNumber})` : '', width: 25 },
      { header: 'Invoice #', key: 'invoice', transform: (v: any) => v?.invoiceNumber || '', width: 15 },
      { header: 'Invoice Amount (SAR)', key: 'invoice', transform: (v: any) => v?.amount != null ? fmt.money(v.amount) : '', width: 18 },
      { header: 'Invoice Balance (SAR)', key: 'invoice', transform: (v: any) => v?.balance != null ? fmt.money(v.balance) : '', width: 18 },
      { header: 'Delivery Statement #', key: 'deliveryStatementNumber', width: 20 },
      { header: 'Vendor', key: 'vendor', transform: (v: any) => v?.name || '', width: 18 },
      { header: 'Driver', key: 'driver', transform: (v: any) => v?.name || '', width: 18 },
      { header: 'Category', key: 'expenseCategory', transform: (v: any) => v?.name || '', width: 18 },
      { header: 'Item / Description', key: 'itemName', width: 22 },
      { header: 'Reference', key: 'reference', width: 15 },
      { header: 'Notes', key: 'notes', width: 25 },
      { header: 'Flagged', key: 'isFlagged', transform: fmt.yesNo, width: 8 },
    ];
    const branchName = wallet?.branch?.name || 'wallet';
    exportMultiSheet([
      { name: 'Wallet Summary', data: [wallet], columns: walletSummaryColumns },
      { name: 'Transaction Log', data: transactions, columns: txColumns },
    ], `Wallet_${branchName}_${selectedDate}`);
  };

  const openTxModal = (type: 'collection' | 'expense' | 'purchase') => {
    setTxType(type);
    setTxForm({ amount: '', deliveryStatementNumber: '', itemName: '', notes: '', collectionSource: 'client', description: '', purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '' });
    setTxError('');
    setPurchaseReportSearch('');
    setPurchaseReportMsg('');
    setPurchaseInvoiceAmount(null);
    setShowTxModal(true);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!wallet && !canSelectBranch) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-lg">{L.noBranch}</p>
          <p className="text-gray-500 text-sm mt-1">{L.contactAdmin}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{L.dailyWallet}</h1>
            <p className="text-gray-400 text-sm">{wallet?.branch?.name || L.selectBranch} — {wallet?.user?.firstName || ''} {wallet?.user?.lastName || ''}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canSelectBranch && (
            <>
              <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} title="Select branch"
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {allBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
              <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} title="Select user"
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {branchUsers.length === 0 && <option value="">{L.noUsers}</option>}
                {branchUsers.map((u) => <option key={u._id} value={u._id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </>
          )}
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label="Select date" />
          <button type="button" onClick={() => setSelectedDate(getTodayStr())}
            className="px-3 py-2 rounded-lg bg-gray-700 text-[#f37121] text-sm font-medium hover:bg-gray-600 transition-colors">{L.today}</button>
          <button type="button" onClick={handleExportExcel} disabled={transactions.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50" title={L.export}>
            <Download className="w-4 h-4" /> {L.export}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{actionError}</p>
          </div>
          <button type="button" onClick={() => setActionError('')} className="text-red-400 hover:text-red-300 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {!wallet && canSelectBranch && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
          <Wallet className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">{L.selectBranchUser}</p>
        </div>
      )}

      {wallet && (<>
      {/* Wallet Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: L.opening, value: wallet.openingBalance.toLocaleString(), color: 'text-white', prefix: '' },
          { label: L.collections, value: wallet.totalCollections.toLocaleString(), color: 'text-green-400', prefix: '+' },
          { label: L.expenses, value: wallet.totalExpenses.toLocaleString(), color: 'text-red-400', prefix: '-' },
          { label: L.purchases, value: wallet.totalPurchases.toLocaleString(), color: 'text-blue-400', prefix: '-' },
          { label: L.closingBalance, value: wallet.closingBalance.toLocaleString(), color: 'text-[#f37121]', prefix: '', border: 'border-[#f37121]/30' },
        ].map((card) => (
          <div key={card.label} className={`bg-gray-800 border ${card.border || 'border-gray-700'} rounded-xl p-4`}>
            <p className="text-gray-400 text-xs mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.prefix}{card.value}</p>
          </div>
        ))}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">{L.status}</p>
          <p className={`text-xl font-bold ${wallet.isClosed ? 'text-red-400' : 'text-green-400'}`}>
            {wallet.isClosed ? L.closed : L.open}
          </p>
        </div>
      </div>

      {/* Cash Difference (if day is closed and has difference) — only visible to managers */}
      {isManager && wallet.isClosed && wallet.cashDifference != null && !isNaN(wallet.cashDifference) && wallet.cashDifference !== 0 && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${wallet.cashDifference > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
          <AlertTriangle className={`w-5 h-5 ${wallet.cashDifference > 0 ? 'text-red-400' : 'text-green-400'}`} />
          <div>
            <p className={`text-sm font-medium ${wallet.cashDifference > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {wallet.cashDifference > 0 ? L.deficit : L.surplus}: {Math.abs(wallet.cashDifference).toLocaleString()} SAR
            </p>
            <p className="text-gray-400 text-xs">
              {L.expected}: {wallet.closingBalance.toLocaleString()} SAR | {L.actual}: {(wallet.actualCash ?? 0).toLocaleString()} SAR
              {wallet.differenceReason && ` | ${L.reason}: ${wallet.differenceReason}`}
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!isReadOnly && (
        <div className="flex flex-wrap gap-2">
          {(!wallet.isClosed || isManager) && (
            <>
              <button type="button" onClick={() => openTxModal('collection')}
                className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 transition-colors border border-green-500/30">
                <ArrowUpCircle className="w-4 h-4" /> {L.collection}
              </button>
              <button type="button" onClick={() => openTxModal('expense')}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors border border-red-500/30">
                <ArrowDownCircle className="w-4 h-4" /> {L.expense}
              </button>
              <button type="button" onClick={() => openTxModal('purchase')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition-colors border border-blue-500/30">
                <ShoppingCart className="w-4 h-4" /> {L.purchase}
              </button>
            </>
          )}
          {!wallet.isClosed && (
            <button type="button" onClick={() => { setCloseForm({ actualCash: '', differenceReason: '', differenceNotes: '' }); setShowCloseModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors ml-auto">
              <Lock className="w-4 h-4" /> {L.closeDay}
            </button>
          )}
          {wallet.isClosed && isManager && (
            <button type="button" onClick={handleReopenDay}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium hover:bg-yellow-500/30 transition-colors border border-yellow-500/30 ml-auto">
              <Unlock className="w-4 h-4" /> {L.reopenDay}
            </button>
          )}
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#f37121]" />
            {L.transactions} ({transactions.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.type}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.amount}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.details}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.deliveryStatementNumber}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.client}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.from}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.to}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.carType}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.length}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.carNumber}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.reportDate}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.notes}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.time}</th>
                <th className="text-right text-gray-400 font-medium px-4 py-3 whitespace-nowrap">{L.actions}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={14} className="text-center text-gray-400 py-12">{L.noTransactions}</td></tr>
              ) : transactions.map((tx) => {
                const cfg = TYPE_CONFIG[tx.type];
                const Icon = cfg.icon;
                return (
                  <tr key={tx._id} className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${tx.isFlagged ? 'bg-red-500/5' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded ${cfg.bg}`}><Icon className={`w-3.5 h-3.5 ${cfg.color}`} /></div>
                        <span className={`text-xs font-medium capitalize ${cfg.color}`}>{typeLabel(tx.type)}</span>
                        {tx.isFlagged && <span title={tx.flagReason}><AlertTriangle className="w-3.5 h-3.5 text-red-400" /></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${tx.type === 'collection' ? 'text-green-400' : 'text-red-400'}`}>
                        {tx.type === 'collection' ? '+' : '-'}{tx.amount.toLocaleString()} SAR
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 text-xs">
                      {tx.type === 'collection' && tx.collectionSource === 'company' && <div className="text-blue-400">{L.fromCompany}</div>}
                      {tx.description && <div>{tx.description}</div>}
                      {tx.customer && <div>{tx.customer.companyName} ({tx.customer.customerNumber})</div>}
                      {tx.invoice && <div className="text-gray-500">Inv: {tx.invoice.invoiceNumber}</div>}
                      {(tx.vendor || tx.vendorName) && <div>{L.vendor}: {tx.vendor?.name || tx.vendorName}</div>}
                      {(tx.driver || tx.driverName) && <div>{L.driver}: {tx.driver?.name || tx.driverName}</div>}
                      {tx.expenseCategory && <div>{L.category}: {tx.expenseCategory.name}</div>}
                      {tx.itemName && <div>{tx.itemName}</div>}
                      {tx.purchaseDriverName && <div>{L.driver}: {tx.purchaseDriverName}</div>}
                      {tx.purchaseReceiptNumber && <div>{L.receipt}: {tx.purchaseReceiptNumber}</div>}
                      {tx.purchaseBranch && <div>{L.branch}: {tx.purchaseBranch}</div>}
                    </td>
                    {/* Delivery Statement # — its own column */}
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.deliveryStatementNumber || tx.purchaseDeliveryStatementNumber || '—'}</td>
                    {/* Operation Details — each in its own column */}
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.client || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.from || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.to || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.carType || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.length || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.carNumber || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{tx.operationDetails?.reportDate ? new Date(tx.operationDetails.reportDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate">{tx.notes || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(tx.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isReadOnly && (!wallet.isClosed || isManager) && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openEditTx(tx)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-[#f37121] hover:bg-gray-700 transition-colors" title={L.edit}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => handleDeleteTx(tx._id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors" title={L.delete}>
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── NEW TRANSACTION MODAL ────────────────────────────── */}
      <AnimatePresence>
        {showTxModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowTxModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                  {(() => { const c = TYPE_CONFIG[txType]; const I = c.icon; return <I className={`w-5 h-5 ${c.color}`} />; })()}
                  {L.newTransaction} {typeLabel(txType)}
                </h2>
                <button type="button" onClick={() => setShowTxModal(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                {/* Type Selector */}
                <div className="grid grid-cols-3 gap-2">
                  {(['collection', 'expense', 'purchase'] as const).map((t) => {
                    const c = TYPE_CONFIG[t]; const I = c.icon;
                    return (
                      <button key={t} type="button" onClick={() => setTxType(t)}
                        className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                          txType === t ? `${c.bg} ${c.color} border-current` : 'border-gray-700 text-gray-400 hover:border-gray-600'
                        }`}>
                        <I className="w-4 h-4" /> {lang === 'ar' ? c.labelAr : c.label}
                      </button>
                    );
                  })}
                </div>

                {/* Amount */}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.amountSar} *</label>
                  <input type="number" min="0.01" step="0.01" value={txForm.amount}
                    onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder="0.00" />
                </div>

                {/* Collection Fields */}
                {txType === 'collection' && (
                  <>
                    {/* Collection Source Selector */}
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setTxForm((f) => ({ ...f, collectionSource: 'client', description: '' }))}
                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${txForm.collectionSource === 'client' ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                        {L.fromClient}
                      </button>
                      <button type="button" onClick={() => setTxForm((f) => ({ ...f, collectionSource: 'company', deliveryStatementNumber: '', description: '' }))}
                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${txForm.collectionSource === 'company' ? 'bg-blue-500/20 text-blue-400 border-blue-500/50' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                        {L.fromCompanyLabel}
                      </button>
                    </div>

                    {txForm.collectionSource === 'client' && (
                      <div>
                        <label className="text-gray-400 text-xs mb-1 block">{L.deliveryStatementNumber} *</label>
                        <input type="text" value={txForm.deliveryStatementNumber}
                          onChange={(e) => setTxForm((f) => ({ ...f, deliveryStatementNumber: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterDeliveryStatement} />
                      </div>
                    )}

                    {txForm.collectionSource === 'company' && (
                      <div>
                        <label className="text-gray-400 text-xs mb-1 block">{L.description} *</label>
                        <input type="text" value={txForm.description}
                          onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.collectionPlaceholder} />
                      </div>
                    )}
                  </>
                )}

                {/* Expense Fields (general spending - fuel, supplies, etc.) */}
                {txType === 'expense' && (
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">{L.description} *</label>
                    <input type="text" value={txForm.itemName}
                      onChange={(e) => setTxForm((f) => ({ ...f, itemName: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.expensePlaceholder} />
                  </div>
                )}

                {/* Purchase Fields (dispatch sheet related payments) */}
                {txType === 'purchase' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setShowTxModal(false); setShowBulkUpload(true); }}
                      className="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-sm font-medium hover:bg-blue-500/30"
                    >
                      <Upload className="w-4 h-4" />
                      {lang === 'ar' ? 'رفع ملف اكسل جماعي' : 'Bulk Upload Excel'}
                    </button>
                    {/* Search by Delivery Statement Number */}
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.deliveryStatementNumber} *</label>
                      <div className="flex gap-2">
                        <input type="text" value={purchaseReportSearch}
                          onChange={(e) => { setPurchaseReportSearch(e.target.value); setTxForm((f) => ({ ...f, purchaseDeliveryStatementNumber: e.target.value })); }}
                          onKeyDown={(e) => e.key === 'Enter' && handlePurchaseReportSearch()}
                          className="flex-1 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterDeliveryStatement} />
                        <button type="button" onClick={handlePurchaseReportSearch} aria-label="Search report"
                          className="px-3 py-2.5 rounded-lg bg-[#f37121] text-white text-sm hover:bg-[#e06010] transition-colors">
                          <Search className="w-4 h-4" />
                        </button>
                      </div>
                      {purchaseReportMsg && (
                        <p className={`text-xs mt-1 ${purchaseReportMsg.startsWith('Found') ? 'text-green-400' : 'text-red-400'}`}>{purchaseReportMsg}</p>
                      )}
                    </div>

                    {/* Show invoice selling price if found */}
                    {purchaseInvoiceAmount != null && (
                      <div className="bg-gray-800/50 border border-blue-500/30 rounded-lg p-3">
                        <p className="text-blue-400 text-sm font-medium">{L.sellingPrice}: {purchaseInvoiceAmount.toLocaleString()} SAR</p>
                      </div>
                    )}

                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.driverName}</label>
                      <input type="text" value={txForm.purchaseDriverName}
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseDriverName: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterDriverName} />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.receiptNumber}</label>
                      <input type="text" value={txForm.purchaseReceiptNumber}
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseReceiptNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterReceiptNumber} />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.branch}</label>
                      <input type="text" value={txForm.purchaseBranch}
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseBranch: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterBranchName} />
                    </div>
                  </>
                )}

                {/* Notes */}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.notes}</label>
                  <textarea value={txForm.notes} onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2} className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" placeholder={L.addNotes} />
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-700 shrink-0">
                {txError && (
                  <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    {txError}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setShowTxModal(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{L.cancel}</button>
                  <button type="button" onClick={handleAddTransaction} disabled={submitting || !txForm.amount}
                    className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {L.add} {typeLabel(txType)}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── EDIT TRANSACTION MODAL ─────────────────────────── */}
      <AnimatePresence>
        {editingTx && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setEditingTx(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold text-lg">{L.editTransaction}</h3>
                <button type="button" onClick={() => setEditingTx(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-3">
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  <span className={`font-medium capitalize ${TYPE_CONFIG[editingTx.type]?.color || 'text-white'}`}>{typeLabel(editingTx.type)}</span>
                  {editingTx.customer && <span className="text-gray-400 ml-2">— {editingTx.customer.companyName}</span>}
                  {(editingTx.vendor || editingTx.vendorName) && <span className="text-gray-400 ml-2">— {editingTx.vendor?.name || editingTx.vendorName}</span>}
                  {(editingTx.driver || editingTx.driverName) && <span className="text-gray-400 ml-2">— {editingTx.driver?.name || editingTx.driverName}</span>}
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.amountSar} *</label>
                  <input type="number" min="0.01" step="0.01" value={editForm.amount}
                    onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                </div>
                {editingTx.type === 'collection' && (
                  <>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.deliveryStatement}</label>
                      <input type="text" value={editForm.deliveryStatementNumber || ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, deliveryStatementNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    {editingTx.collectionSource === 'company' && (
                      <div>
                        <label className="text-gray-400 text-xs mb-1 block">{L.description}</label>
                        <input type="text" value={editForm.description || ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                      </div>
                    )}
                  </>
                )}
                {editingTx.type === 'expense' && (
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">{L.itemDescription}</label>
                    <input type="text" value={editForm.itemName || ''}
                      onChange={(e) => setEditForm((f) => ({ ...f, itemName: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                  </div>
                )}
                {editingTx.type === 'purchase' && (
                  <>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.deliveryStatement}</label>
                      <input type="text" value={editForm.purchaseDeliveryStatementNumber || ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseDeliveryStatementNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.driverName}</label>
                      <input type="text" value={editForm.purchaseDriverName || ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseDriverName: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.receiptNumber}</label>
                      <input type="text" value={editForm.purchaseReceiptNumber || ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseReceiptNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs mb-1 block">{L.branch}</label>
                      <input type="text" value={editForm.purchaseBranch || ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseBranch: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.notes}</label>
                  <textarea value={editForm.notes || ''} rows={2}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingTx(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{L.cancel}</button>
                <button type="button" onClick={handleEditTx} disabled={submitting || !editForm.amount}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {L.saveChanges}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── CLOSE DAY MODAL ──────────────────────────────────── */}
      <AnimatePresence>
        {showCloseModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCloseModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                  <Lock className="w-5 h-5 text-[#f37121]" /> {L.closeDay}
                </h2>
                <button type="button" onClick={() => setShowCloseModal(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-4">
                {isManager && (
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                    <p className="text-gray-400 text-xs mb-1">{L.expectedCashBalance}</p>
                    <p className="text-2xl font-bold text-[#f37121]">{wallet.closingBalance.toLocaleString()} SAR</p>
                  </div>
                )}

                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.cashInHand} *</label>
                  <input type="number" min="0" step="0.01" value={closeForm.actualCash}
                    onChange={(e) => setCloseForm((f) => ({ ...f, actualCash: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterAmountHave} />
                </div>

                {closeForm.actualCash && Number(closeForm.actualCash) !== wallet.closingBalance && (() => {
                  const diff = wallet.closingBalance - Number(closeForm.actualCash);
                  const isDeficit = diff > 0;
                  return (
                    <div className={`p-3 rounded-lg border ${isDeficit ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                      <p className={`text-sm font-medium ${isDeficit ? 'text-red-400' : 'text-green-400'}`}>
                        {isDeficit ? L.deficit : L.surplus}: {Math.abs(diff).toLocaleString()} SAR
                      </p>
                    </div>
                  );
                })()}

                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.notesOptional}</label>
                  <textarea value={closeForm.differenceNotes}
                    onChange={(e) => setCloseForm((f) => ({ ...f, differenceNotes: e.target.value }))}
                    rows={2} className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" placeholder={L.addAnyNotes} />
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
                <button type="button" onClick={() => setShowCloseModal(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{L.cancel}</button>
                <button type="button" onClick={handleCloseDay} disabled={closing}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {L.closeDay}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </>)}

      {/* Confirm Modal (replaces browser confirm()) */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm shadow-xl">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[#f37121]/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-[#f37121]" />
                  </div>
                  <h3 className="text-white font-semibold">{lang === 'ar' ? 'تأكيد' : 'Confirm'}</h3>
                </div>
                <p className="text-gray-300 text-sm">{confirmModal.message}</p>
              </div>
              <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
                <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{L.cancel}</button>
                <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
                  {lang === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showBulkUpload && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !bulkUploading && setShowBulkUpload(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-lg">
                  {lang === 'ar' ? 'رفع مشتريات جماعية من اكسل' : 'Bulk Upload Purchases'}
                </h3>
                {!bulkUploading && (
                  <button type="button" aria-label={lang === 'ar' ? 'إغلاق' : 'Close'} title={lang === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setShowBulkUpload(false)} className="text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="text-gray-400 text-sm mb-3 space-y-1">
                <p>{lang === 'ar'
                  ? '✓ شكل 1: ملف فيه شيت واحد ب 3 أعمدة (رقم كشف التخريج - القيمة - الفرع)'
                  : '✓ Format 1: Single sheet with 3 columns (Delivery # / Value / Branch)'}</p>
                <p>{lang === 'ar'
                  ? '✓ شكل 2: ملف شهري فيه 31 شيت (1 إلى 31 = أيام الشهر) + شيت DATA'
                  : '✓ Format 2: Monthly file with 31 sheets (1-31 = days) + DATA sheet'}</p>
                <p className="text-gray-500 text-xs">
                  {lang === 'ar'
                    ? 'للشكل الشهري: الشهر هيتحدد من اسم الملف (مثلاً "ابريل"), والتاريخ لكل معاملة هيكون من رقم الشيت'
                    : 'Monthly: month detected from filename (e.g. "ابريل"=April), each transaction dated by its sheet number'}
                </p>
              </div>

              {bulkRawPreview ? (
                <div className="space-y-3">
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
                    {lang === 'ar'
                      ? '⚠️ مش قادر أكتشف الأعمدة تلقائياً. اختار الأعمدة يدوياً من الجدول تحت:'
                      : '⚠️ Auto-detection failed. Pick columns manually from the preview below:'}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">{lang === 'ar' ? 'عمود رقم التخريج' : 'Delivery Column'}</label>
                      <select aria-label="delivery column" value={manualDeliveryCol} onChange={(e) => setManualDeliveryCol(Number(e.target.value))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-2 py-2 text-sm">
                        {bulkRawPreview.rows[0]?.map((_: any, i: number) => <option key={i} value={i}>Col {i}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">{lang === 'ar' ? 'عمود القيمة' : 'Value Column'}</label>
                      <select aria-label="value column" value={manualValueCol} onChange={(e) => setManualValueCol(Number(e.target.value))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-2 py-2 text-sm">
                        {bulkRawPreview.rows[0]?.map((_: any, i: number) => <option key={i} value={i}>Col {i}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">{lang === 'ar' ? 'عمود الفرع (اختياري)' : 'Branch Column (optional)'}</label>
                      <select aria-label="branch column" value={manualBranchCol} onChange={(e) => setManualBranchCol(Number(e.target.value))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-2 py-2 text-sm">
                        <option value={-1}>{lang === 'ar' ? '— بدون —' : '— None —'}</option>
                        {bulkRawPreview.rows[0]?.map((_: any, i: number) => <option key={i} value={i}>Col {i}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">{lang === 'ar' ? 'البيانات تبدأ من صف' : 'Data starts at row'}</label>
                      <input type="number" min="0" aria-label="data start row" title="Data starts at row" placeholder="0"
                        value={manualDataStart} onChange={(e) => setManualDataStart(Number(e.target.value) || 0)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">
                    {lang === 'ar' ? 'شوف البيانات تحت واعرف كل عمود رقمه كام:' : 'Look at the preview to identify column indices:'}
                  </div>
                  <div className="max-h-72 overflow-auto bg-gray-900 rounded-lg border border-gray-700">
                    <table className="text-xs">
                      <thead className="bg-gray-800 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-gray-500">Row</th>
                          {bulkRawPreview.rows[0]?.map((_: any, i: number) => (
                            <th key={i} className={`px-2 py-1 whitespace-nowrap ${
                              i === manualDeliveryCol ? 'bg-orange-500/30 text-orange-300' :
                              i === manualValueCol ? 'bg-green-500/30 text-green-300' :
                              i === manualBranchCol ? 'bg-blue-500/30 text-blue-300' :
                              'text-gray-400'
                            }`}>
                              Col {i}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRawPreview.rows.slice(0, 25).map((row: any[], ri: number) => (
                          <tr key={ri} className={`border-t border-gray-800 ${ri === manualDataStart ? 'bg-gray-800/50' : ''}`}>
                            <td className="px-2 py-1 text-gray-500">{ri}</td>
                            {row.map((cell: any, ci: number) => (
                              <td key={ci} className={`px-2 py-1 whitespace-nowrap max-w-[150px] truncate ${
                                ci === manualDeliveryCol ? 'bg-orange-500/10 text-orange-300' :
                                ci === manualValueCol ? 'bg-green-500/10 text-green-300' :
                                ci === manualBranchCol ? 'bg-blue-500/10 text-blue-300' :
                                'text-gray-300'
                              }`}>
                                {cell === '' || cell === null ? '' : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setBulkRawPreview(null); setBulkWorkbook(null); setBulkFileName(''); }}
                      className="px-4 py-2 text-gray-400 hover:text-white text-sm">
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="button" onClick={handleManualExtract}
                      className="px-4 py-2 bg-[#f37121] hover:bg-[#e06010] text-white rounded-lg text-sm font-medium">
                      {lang === 'ar' ? 'استخراج البيانات' : 'Extract Data'}
                    </button>
                  </div>
                </div>
              ) : bulkRows.length === 0 ? (
                <label className="block border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-[#f37121]/50 transition-colors">
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleBulkFile(e.target.files[0])} />
                  <Upload className="w-10 h-10 text-gray-500 mx-auto mb-2" />
                  <p className="text-gray-300 text-sm">{lang === 'ar' ? 'اضغط لاختيار ملف اكسل' : 'Click to select Excel file'}</p>
                  <p className="text-gray-500 text-xs mt-1">.xlsx .xls .csv</p>
                </label>
              ) : (
                <div>
                  <div className="bg-gray-900 rounded-lg p-3 mb-3 flex items-center justify-between">
                    <span className="text-white text-sm">{bulkFileName}</span>
                    <span className="text-[#f37121] text-sm font-medium">{bulkRows.length} {lang === 'ar' ? 'سطر' : 'rows'}</span>
                  </div>

                  {bulkUploading && (
                    <div className="mb-3">
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-[#f37121] transition-all" style={{ width: `${bulkProgress}%` }} />
                      </div>
                      <p className="text-center text-gray-400 text-sm mt-2">{bulkProgress}%</p>
                    </div>
                  )}

                  <div className="max-h-60 overflow-y-auto bg-gray-900 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-800 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-400">#</th>
                          <th className="px-3 py-2 text-left text-gray-400">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                          <th className="px-3 py-2 text-left text-gray-400">{lang === 'ar' ? 'رقم كشف التخريج' : 'Delivery Statement'}</th>
                          <th className="px-3 py-2 text-left text-gray-400">{lang === 'ar' ? 'القيمة' : 'Value'}</th>
                          <th className="px-3 py-2 text-left text-gray-400">{lang === 'ar' ? 'الفرع' : 'Branch'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((r: any, i: number) => (
                          <tr key={i} className="border-t border-gray-800">
                            <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                            <td className="px-3 py-2 text-gray-400">{r.date}</td>
                            <td className="px-3 py-2 text-white">{r.deliveryStatement}</td>
                            <td className="px-3 py-2 text-green-400">{r.value.toLocaleString()}</td>
                            <td className="px-3 py-2 text-gray-300">{r.branch}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {bulkError && (
                <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-2 text-red-400 text-sm">
                  {bulkError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
              {bulkRows.length > 0 && !bulkUploading && (
                <button type="button" onClick={() => { setBulkRows([]); setBulkFileName(''); }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm">
                  {lang === 'ar' ? 'إعادة التحديد' : 'Reset'}
                </button>
              )}
              {!bulkUploading && (
                <button type="button" onClick={() => setShowBulkUpload(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm">
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              )}
              {bulkRows.length > 0 && (
                <button type="button" onClick={handleBulkSubmit} disabled={bulkUploading}
                  className="px-4 py-2 bg-[#f37121] hover:bg-[#e06010] text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                  {bulkUploading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {bulkUploading ? (lang === 'ar' ? 'جاري الرفع...' : 'Uploading...') : (lang === 'ar' ? `رفع ${bulkRows.length} معاملة` : `Upload ${bulkRows.length} transactions`)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
