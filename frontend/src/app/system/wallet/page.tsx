'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, X, Check, Loader2, ArrowUpCircle, ArrowDownCircle,
  ShoppingCart, Lock, Unlock, AlertTriangle, Search,
  Receipt, Download, Pencil,
} from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getWalletTranslations, getWalletExtraTranslations } from '@/lib/translations';

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
  collection: { label: 'Collection', labelAr: 'تحصيل', icon: ArrowUpCircle, color: 'text-green-600', bg: 'bg-green-500/20' },
  expense: { label: 'Expense', labelAr: 'مصروف', icon: ArrowDownCircle, color: 'text-red-600', bg: 'bg-red-500/20' },
  purchase: { label: 'Purchase', labelAr: 'مشتريات', icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-500/20' },
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function WalletPage() {
  const { confirm } = useDialog();
  const { user } = useAuth();
  const isManager = ['super_admin', 'admin', 'operations_manager', 'operations_staff'].includes(user?.role || '');
  const isReadOnly = user?.role === 'moderator';
  const isSuperAdmin = user?.role === 'super_admin';
  const isOpsManager = user?.role === 'operations_manager';
  const canSelectBranch = isSuperAdmin || isOpsManager;

  const { lang } = useLanguage();
  const L = getWalletTranslations(lang);
  const txx = getWalletExtraTranslations(lang);
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

  // List of all branches for the Purchase modal's Branch dropdown
  // (loaded for everyone, not just super admin, so operations can pick a real branch).
  const [branchList, setBranchList] = useState<{ _id: string; name: string }[]>([]);
  useEffect(() => {
    api.get<any>('/api/branches').then((data) => {
      setBranchList(data.branches || data || []);
    }).catch(() => { /* dropdown can stay empty */ });
  }, []);

  // Transaction modal
  const [showTxModal, setShowTxModal] = useState(false);
  const [txType, setTxType] = useState<'collection' | 'expense' | 'purchase'>('collection');
  const [txForm, setTxForm] = useState({
    amount: '', deliveryStatementNumber: '', itemName: '', notes: '',
    collectionSource: 'client' as 'client' | 'company', description: '',
    purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '',
    // Amount-mismatch reason (when entered amount != expected dispatch-sheet value)
    mismatchReason: '' as '' | 'daily' | 'violation' | 'other', mismatchNote: '',
  });
  // Empty form used on open/reset — keeps the three reset sites in sync.
  const EMPTY_TX_FORM = {
    amount: '', deliveryStatementNumber: '', itemName: '', notes: '',
    collectionSource: 'client' as 'client' | 'company', description: '',
    purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '',
    mismatchReason: '' as '' | 'daily' | 'violation' | 'other', mismatchNote: '',
  };
  const [submitting, setSubmitting] = useState(false);
  const [txError, setTxError] = useState('');

  // Edit transaction
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  // Close day modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeForm, setCloseForm] = useState({ actualCash: '', differenceReason: '', differenceNotes: '' });
  const [closing, setClosing] = useState(false);

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMode, setExportMode] = useState<'single' | 'range'>('single');
  const [exportFrom, setExportFrom] = useState(getTodayStr());
  const [exportTo, setExportTo] = useState(getTodayStr());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  // Confirm modal (replaces browser (await confirm()))
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // General error banner
  const [actionError, setActionError] = useState('');


  // Purchase report lookup
  const [purchaseReportSearch, setPurchaseReportSearch] = useState('');
  const [purchaseReportMsg, setPurchaseReportMsg] = useState('');
  const [purchaseReportFound, setPurchaseReportFound] = useState(false);
  const [purchaseInvoiceAmount, setPurchaseInvoiceAmount] = useState<number | null>(null);
  // Expected dispatch-sheet values for the amount-match alert: purchaseValue
  // (سعر الشراء) for purchases, sellingValue (سعر البيع) for collections.
  const [expectedPurchaseValue, setExpectedPurchaseValue] = useState<number | null>(null);
  const [expectedSellingValue, setExpectedSellingValue] = useState<number | null>(null);
  // Collection report lookup (search كشف التخريج to fetch the selling price)
  const [collectionReportMsg, setCollectionReportMsg] = useState('');
  const [collectionReportFound, setCollectionReportFound] = useState(false);

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
    // Clear stale wallet/user immediately so we don't show one user's data
    // under another branch's filter while the new user list loads.
    setWallet(null);
    setTransactions([]);
    setBranchUsers([]);
    setSelectedUser('');
    api.get<any>(`/api/users?branch=${selectedBranch}`).then((data) => {
      const users = (data.users || data || []).filter((u: any) => ['operations_staff', 'operations_manager'].includes(u.role));
      setBranchUsers(users);
      if (users.length > 0) setSelectedUser(users[0]._id);
      else setSelectedUser('');
    }).catch((err: any) => { setActionError(err?.message || 'Failed to load users'); });
  }, [canSelectBranch, selectedBranch]);

  // Clear stale data the moment the user filter flips, before the fetch resolves
  useEffect(() => {
    if (!canSelectBranch) return;
    setWallet(null);
    setTransactions([]);
  }, [selectedUser, canSelectBranch]);

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
      // Clear any stale error banner on successful load
      setActionError('');
    } catch (err: any) {
      // Silently ignore auth-required errors on initial load (auth may still be settling)
      if (err?.message === 'Authentication required') return;
      setWallet(null);
      setTransactions([]);
      if (err?.message?.includes('No branch') || err?.message?.includes('branch')) {
        setActionError(lang === 'ar' ? 'لم يتم تعيين فرع لهذا المستخدم. يرجى تعيين فرع من إعدادات المستخدمين.' : 'No branch assigned to this user. Please assign a branch in User Settings.');
      }
    }
    setLoading(false);
  }, [selectedDate, canSelectBranch, selectedBranch, selectedUser, lang]);

  // Wait for auth before fetching
  useEffect(() => {
    if (!user) return;
    fetchWallet();
  }, [fetchWallet, user]);

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
      // Expected dispatch-sheet value for this transaction type (null = no lookup done).
      const expected = txType === 'purchase' ? expectedPurchaseValue : txType === 'collection' ? expectedSellingValue : null;
      const isMismatch = expected != null && Math.abs(Number(txForm.amount) - expected) > 0.009;
      if (isMismatch) {
        if (!txForm.mismatchReason) {
          setTxError(lang === 'ar' ? 'اختر سبب اختلاف المبلغ' : 'Select a reason for the amount difference');
          setSubmitting(false);
          return;
        }
        if (txForm.mismatchReason === 'other' && !txForm.mismatchNote.trim()) {
          setTxError(lang === 'ar' ? 'اكتب سبب الاختلاف' : 'Write the reason for the difference');
          setSubmitting(false);
          return;
        }
        payload.mismatchReason = txForm.mismatchReason;
        if (txForm.mismatchReason === 'other') payload.mismatchNote = txForm.mismatchNote.trim();
      }
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
      setTxForm(EMPTY_TX_FORM);
      fetchWallet(false);
    } catch (err: any) {
      setTxError(err.message || 'Failed to add transaction');
    }
    setSubmitting(false);
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

  // Search كشف التخريج for PURCHASES — pulls the driver, branch and purchase
  // price straight from the Operations Platform data and auto-fills them.
  const handlePurchaseReportSearch = async () => {
    if (!purchaseReportSearch.trim()) return;
    setPurchaseReportMsg('');
    setPurchaseReportFound(false);
    setPurchaseInvoiceAmount(null);
    setExpectedPurchaseValue(null);
    try {
      const data = await api.get<any>(`/api/wallet/lookup-report?reportNumber=${encodeURIComponent(purchaseReportSearch.trim())}`);
      setTxForm((f) => ({
        ...f,
        purchaseDeliveryStatementNumber: data.reportNumber,
        // Auto-fill from the dispatch sheet (still editable if wrong).
        purchaseDriverName: data.driverName || f.purchaseDriverName,
        purchaseBranch: data.branch || f.purchaseBranch,
      }));
      setPurchaseInvoiceAmount(data.sellingValue || null);
      setExpectedPurchaseValue(data.purchaseValue != null ? Number(data.purchaseValue) : null);
      setPurchaseReportFound(true);
      setPurchaseReportMsg(`${txx.purchasePrice}: ${(data.purchaseValue || 0).toLocaleString()} SAR`);
    } catch (err: any) {
      setPurchaseReportFound(false);
      setPurchaseReportMsg(err.message || txx.reportNotFound);
    }
  };

  // Search كشف التخريج for COLLECTIONS — fetch the expected selling price so we
  // can flag a mismatch. Customer/invoice resolution still happens server-side.
  const handleCollectionReportSearch = async () => {
    const q = txForm.deliveryStatementNumber.trim();
    if (!q) return;
    setCollectionReportMsg('');
    setCollectionReportFound(false);
    setExpectedSellingValue(null);
    try {
      const data = await api.get<any>(`/api/wallet/lookup-report?reportNumber=${encodeURIComponent(q)}`);
      setTxForm((f) => ({ ...f, deliveryStatementNumber: data.reportNumber }));
      setExpectedSellingValue(data.sellingValue != null ? Number(data.sellingValue) : null);
      setCollectionReportFound(true);
      setCollectionReportMsg(`${txx.foundSellingPrice}: ${(data.sellingValue || 0).toLocaleString()} SAR`);
    } catch (err: any) {
      setCollectionReportFound(false);
      setCollectionReportMsg(err.message || txx.reportNotFound);
    }
  };

  // Column definitions shared between single-day and range exports.
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
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Time', key: 'createdAt', transform: (v: any) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '', width: 8 },
    { header: 'Type', key: 'type', transform: (v: any) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '', width: 12 },
    { header: 'Amount (SAR)', key: 'amount', transform: fmt.money, width: 15 },
    { header: 'Customer', key: 'customer', transform: (v: any) => v ? `${v.companyName} (${v.customerNumber})` : '', width: 25 },
    { header: 'Invoice #', key: 'invoice', transform: (v: any) => v?.invoiceNumber || '', width: 15 },
    { header: 'Invoice Amount (SAR)', key: 'invoice', transform: (v: any) => v?.amount != null ? fmt.money(v.amount) : '', width: 18 },
    { header: 'Invoice Balance (SAR)', key: 'invoice', transform: (v: any) => v?.balance != null ? fmt.money(v.balance) : '', width: 18 },
    { header: 'Delivery Statement #', key: 'deliveryStatementNumber', transform: (v: any, row: any) => v || row?.purchaseDeliveryStatementNumber || '', width: 20 },
    { header: 'Branch', key: 'purchaseBranch', transform: (v: any, row: any) => v || row?.operationDetails?.branch || '', width: 16 },
    { header: 'Vendor', key: 'vendor', transform: (v: any, row: any) => v?.name || row?.vendorName || '', width: 18 },
    { header: 'Driver', key: 'driver', transform: (v: any, row: any) => v?.name || row?.driverName || row?.purchaseDriverName || '', width: 18 },
    { header: 'Category', key: 'expenseCategory', transform: (v: any) => v?.name || '', width: 18 },
    { header: 'Item / Description', key: 'itemName', transform: (v: any, row: any) => v || row?.description || '', width: 22 },
    { header: 'Receipt #', key: 'purchaseReceiptNumber', width: 15 },
    { header: 'Reference', key: 'reference', width: 15 },
    { header: 'Notes', key: 'notes', width: 25 },
    { header: 'Flagged', key: 'isFlagged', transform: fmt.yesNo, width: 8 },
  ];

  // Single-day export — uses already-loaded wallet + transactions.
  const exportSingleDay = () => {
    if (!wallet) return;
    const branchName = wallet?.branch?.name || 'wallet';
    exportMultiSheet([
      { name: 'Wallet Summary', data: [wallet], columns: walletSummaryColumns },
      { name: 'Transaction Log', data: transactions, columns: txColumns },
    ], `Wallet_${branchName}_${selectedDate}`);
  };

  // Range export — fetches every wallet + transaction in the range, then exports.
  const exportRange = async () => {
    setExporting(true);
    setExportError('');
    try {
      const targetUserId = canSelectBranch && selectedUser ? selectedUser : (user?._id || '');
      const params = new URLSearchParams({ dateFrom: exportFrom, dateTo: exportTo });
      if (targetUserId) params.set('userId', targetUserId);
      const data = await api.get<any>(`/api/wallet/range?${params.toString()}`);
      const wallets = data.wallets || [];
      const txns = data.transactions || [];
      if (wallets.length === 0 && txns.length === 0) {
        setExportError(L.noDataInRange);
        setExporting(false);
        return;
      }
      const branchName = wallets[0]?.branch?.name || wallet?.branch?.name || 'wallet';
      exportMultiSheet([
        { name: 'Wallet Summary', data: wallets, columns: walletSummaryColumns },
        { name: 'Transaction Log', data: txns, columns: txColumns },
      ], `Wallet_${branchName}_${exportFrom}_to_${exportTo}`);
      setShowExportModal(false);
    } catch (err: any) {
      setExportError(err?.message || 'Failed to export');
    }
    setExporting(false);
  };

  const openExportModal = () => {
    setExportMode('single');
    setExportFrom(selectedDate);
    setExportTo(selectedDate);
    setExportError('');
    setShowExportModal(true);
  };

  const handleExportClick = () => {
    if (exportMode === 'single') {
      exportSingleDay();
      setShowExportModal(false);
    } else {
      exportRange();
    }
  };

  const openTxModal = (type: 'collection' | 'expense' | 'purchase') => {
    setTxType(type);
    setTxForm(EMPTY_TX_FORM);
    setTxError('');
    setPurchaseReportSearch('');
    setPurchaseReportMsg('');
    setPurchaseReportFound(false);
    setPurchaseInvoiceAmount(null);
    setExpectedPurchaseValue(null);
    setExpectedSellingValue(null);
    setCollectionReportMsg('');
    setCollectionReportFound(false);
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
          <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-lg">{L.noBranch}</p>
          <p className="text-slate-500 text-sm mt-1">{L.contactAdmin}</p>
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
            <h1 className="text-2xl font-bold text-slate-900">{L.dailyWallet}</h1>
            <p className="text-slate-500 text-sm">{wallet?.branch?.name || L.selectBranch} — {wallet?.user?.firstName || ''} {wallet?.user?.lastName || ''}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canSelectBranch && (
            <>
              <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} title={L.selectBranch}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {allBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
              <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} title={txx.selectUser}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {branchUsers.length === 0 && <option value="">{L.noUsers}</option>}
                {branchUsers.map((u) => <option key={u._id} value={u._id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </>
          )}
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.selectDate} />
          <button type="button" onClick={() => setSelectedDate(getTodayStr())}
            className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{L.today}</button>
          <button type="button" onClick={openExportModal} disabled={!wallet}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50" title={L.export}>
            <Download className="w-4 h-4" /> {L.export}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-red-600 text-sm">{actionError}</p>
          </div>
          <button type="button" onClick={() => setActionError('')} className="text-red-600 hover:text-red-700 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {!wallet && canSelectBranch && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <Wallet className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500">{L.selectBranchUser}</p>
        </div>
      )}

      {wallet && (<>
      {/* Wallet Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: L.opening, value: wallet.openingBalance.toLocaleString(), color: 'text-slate-900', prefix: '' },
          { label: L.collections, value: wallet.totalCollections.toLocaleString(), color: 'text-green-600', prefix: '+' },
          { label: L.expenses, value: wallet.totalExpenses.toLocaleString(), color: 'text-red-600', prefix: '-' },
          { label: L.purchases, value: wallet.totalPurchases.toLocaleString(), color: 'text-blue-600', prefix: '-' },
          { label: L.closingBalance, value: wallet.closingBalance.toLocaleString(), color: 'text-[#f37121]', prefix: '', border: 'border-[#f37121]/30' },
        ].map((card) => (
          <div key={card.label} className={`bg-white border ${card.border || 'border-slate-200'} rounded-xl p-4 shadow-sm`}>
            <p className="text-slate-500 text-xs mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.prefix}{card.value}</p>
          </div>
        ))}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs mb-1">{L.status}</p>
          <p className={`text-xl font-bold ${wallet.isClosed ? 'text-red-600' : 'text-green-600'}`}>
            {wallet.isClosed ? L.closed : L.open}
          </p>
        </div>
      </div>

      {/* Cash Difference (if day is closed and has difference) — only visible to managers */}
      {isManager && wallet.isClosed && wallet.cashDifference != null && !isNaN(wallet.cashDifference) && wallet.cashDifference !== 0 && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${wallet.cashDifference > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
          <AlertTriangle className={`w-5 h-5 ${wallet.cashDifference > 0 ? 'text-red-600' : 'text-green-600'}`} />
          <div>
            <p className={`text-sm font-medium ${wallet.cashDifference > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {wallet.cashDifference > 0 ? L.deficit : L.surplus}: {Math.abs(wallet.cashDifference).toLocaleString()} SAR
            </p>
            <p className="text-slate-500 text-xs">
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
                className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-600 rounded-lg text-sm font-medium hover:bg-green-500/30 transition-colors border border-green-500/30">
                <ArrowUpCircle className="w-4 h-4" /> {L.collection}
              </button>
              <button type="button" onClick={() => openTxModal('expense')}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors border border-red-500/30">
                <ArrowDownCircle className="w-4 h-4" /> {L.expense}
              </button>
              <button type="button" onClick={() => openTxModal('purchase')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition-colors border border-blue-500/30">
                <ShoppingCart className="w-4 h-4" /> {L.purchase}
              </button>
            </>
          )}
          {!wallet.isClosed && (
            <button type="button" onClick={() => { setCloseForm({ actualCash: '', differenceReason: '', differenceNotes: '' }); setShowCloseModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors ms-auto">
              <Lock className="w-4 h-4" /> {L.closeDay}
            </button>
          )}
          {wallet.isClosed && isManager && (
            <button type="button" onClick={handleReopenDay}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-700 rounded-lg text-sm font-medium hover:bg-yellow-500/30 transition-colors border border-yellow-500/30 ms-auto">
              <Unlock className="w-4 h-4" /> {L.reopenDay}
            </button>
          )}
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-[#f37121]" />
            {L.transactions} ({transactions.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.type}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.amount}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.details}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.deliveryStatementNumber}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.branch}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.client}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.from}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.to}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.carType}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.length}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.carNumber}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.reportDate}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.notes}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.time}</th>
                <th className="text-end text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.actions}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={15} className="text-center text-slate-800 py-12">{L.noTransactions}</td></tr>
              ) : transactions.map((tx) => {
                const cfg = TYPE_CONFIG[tx.type];
                const Icon = cfg.icon;
                return (
                  <tr key={tx._id} className={`border-b border-slate-200/70 hover:bg-slate-100 transition-colors ${tx.isFlagged ? 'bg-red-500/5' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded ${cfg.bg}`}><Icon className={`w-3.5 h-3.5 ${cfg.color}`} /></div>
                        <span className={`text-xs font-medium capitalize ${cfg.color}`}>{typeLabel(tx.type)}</span>
                        {tx.isFlagged && <span title={tx.flagReason}><AlertTriangle className="w-3.5 h-3.5 text-red-600" /></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${tx.type === 'collection' ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.type === 'collection' ? '+' : '-'}{tx.amount.toLocaleString()} SAR
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs">
                      {tx.type === 'collection' && tx.collectionSource === 'company' && <div className="text-blue-600">{L.fromCompany}</div>}
                      {tx.description && <div>{tx.description}</div>}
                      {tx.customer && <div>{tx.customer.companyName} ({tx.customer.customerNumber})</div>}
                      {tx.invoice && <div className="text-slate-700">{txx.invoiceShort}: {tx.invoice.invoiceNumber}</div>}
                      {(tx.vendor || tx.vendorName) && <div>{L.vendor}: {tx.vendor?.name || tx.vendorName}</div>}
                      {(tx.driver || tx.driverName) && <div>{L.driver}: {tx.driver?.name || tx.driverName}</div>}
                      {tx.expenseCategory && <div>{L.category}: {tx.expenseCategory.name}</div>}
                      {tx.itemName && <div>{tx.itemName}</div>}
                      {tx.purchaseDriverName && <div>{L.driver}: {tx.purchaseDriverName}</div>}
                      {tx.purchaseReceiptNumber && <div>{L.receipt}: {tx.purchaseReceiptNumber}</div>}
                    </td>
                    {/* Delivery Statement # — its own column */}
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.deliveryStatementNumber || tx.purchaseDeliveryStatementNumber || '—'}</td>
                    {/* Branch — show typed branch first, fall back to workflow branch */}
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.purchaseBranch || tx.operationDetails?.branch || '—'}</td>
                    {/* Operation Details — each in its own column */}
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.client || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.from || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.to || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.carType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.length || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.carNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.operationDetails?.reportDate ? new Date(tx.operationDetails.reportDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="px-4 py-3 text-slate-800 text-xs max-w-[150px] truncate">{tx.notes || '—'}</td>
                    <td className="px-4 py-3 text-slate-800 text-xs whitespace-nowrap">
                      {new Date(tx.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {!isReadOnly && (!wallet.isClosed || isManager) && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openEditTx(tx)}
                            className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100 transition-colors" title={L.edit}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => handleDeleteTx(tx._id)}
                            className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100 transition-colors" title={L.delete}>
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
              onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg flex items-center gap-2 mb-3">
                  {(() => { const c = TYPE_CONFIG[txType]; const I = c.icon; return <I className={`w-5 h-5 ${c.color}`} />; })()}
                  {L.newTransaction} {typeLabel(txType)}
                </h2>
                <button type="button" onClick={() => setShowTxModal(false)} className="text-slate-500 hover:text-slate-900" aria-label={txx.close}><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                {/* Type Selector */}
                <div className="grid grid-cols-3 gap-2">
                  {(['collection', 'expense', 'purchase'] as const).map((t) => {
                    const c = TYPE_CONFIG[t]; const I = c.icon;
                    return (
                      <button key={t} type="button" onClick={() => setTxType(t)}
                        className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                          txType === t ? `${c.bg} ${c.color} border-current` : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}>
                        <I className="w-4 h-4" /> {lang === 'ar' ? c.labelAr : c.label}
                      </button>
                    );
                  })}
                </div>

                {/* Amount */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.amountSar} *</label>
                  <input type="number" min="0.01" step="0.01" value={txForm.amount}
                    onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder="0.00" />
                  {/* Amount-vs-dispatch-sheet alert. Green when it matches, amber
                      with a required reason dropdown when it differs. */}
                  {(() => {
                    const expected = txType === 'purchase' ? expectedPurchaseValue : txType === 'collection' ? expectedSellingValue : null;
                    if (expected == null || !txForm.amount) return null;
                    const isPurchase = txType === 'purchase';
                    const differs = Math.abs(Number(txForm.amount) - expected) > 0.009;
                    if (!differs) {
                      return <p className="text-xs text-green-600 mt-1">✓ {isPurchase ? txx.amountMatchesPurchase : txx.amountMatchesSelling} ({expected.toLocaleString()} SAR)</p>;
                    }
                    return (
                      <div className="mt-2 rounded-lg border border-amber-400/60 bg-amber-50 p-3 space-y-2">
                        <p className="text-xs text-amber-700 font-medium">⚠ {isPurchase ? txx.amountDiffersPurchase : txx.amountDiffersSelling} ({expected.toLocaleString()} SAR)</p>
                        <div>
                          <label className="text-slate-500 text-xs mb-1 block">{txx.mismatchReasonLabel} *</label>
                          <select value={txForm.mismatchReason} title={txx.mismatchReasonLabel}
                            onChange={(e) => setTxForm((f) => ({ ...f, mismatchReason: e.target.value as '' | 'daily' | 'violation' | 'other' }))}
                            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                            <option value="">—</option>
                            <option value="daily">{txx.reasonDaily}</option>
                            <option value="violation">{txx.reasonViolation}</option>
                            <option value="other">{txx.reasonOther}</option>
                          </select>
                        </div>
                        {txForm.mismatchReason === 'other' && (
                          <textarea value={txForm.mismatchNote} rows={2} placeholder={txx.mismatchNotePlaceholder}
                            onChange={(e) => setTxForm((f) => ({ ...f, mismatchNote: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Collection Fields */}
                {txType === 'collection' && (
                  <>
                    {/* Collection Source Selector */}
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setTxForm((f) => ({ ...f, collectionSource: 'client', description: '' }))}
                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${txForm.collectionSource === 'client' ? 'bg-green-500/20 text-green-600 border-green-500/50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        {L.fromClient}
                      </button>
                      <button type="button" onClick={() => setTxForm((f) => ({ ...f, collectionSource: 'company', deliveryStatementNumber: '', description: '' }))}
                        className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${txForm.collectionSource === 'company' ? 'bg-blue-500/20 text-blue-600 border-blue-500/50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        {L.fromCompanyLabel}
                      </button>
                    </div>

                    {txForm.collectionSource === 'client' && (
                      <div>
                        <label className="text-slate-500 text-xs mb-1 block">{L.deliveryStatementNumber} *</label>
                        <div className="flex gap-2">
                          <input type="text" value={txForm.deliveryStatementNumber}
                            onChange={(e) => { setTxForm((f) => ({ ...f, deliveryStatementNumber: e.target.value })); setCollectionReportFound(false); setCollectionReportMsg(''); setExpectedSellingValue(null); }}
                            onKeyDown={(e) => e.key === 'Enter' && handleCollectionReportSearch()}
                            className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterDeliveryStatement} />
                          <button type="button" onClick={handleCollectionReportSearch} aria-label={txx.searchReport}
                            className="px-3 py-2.5 rounded-lg bg-[#f37121] text-white text-sm hover:bg-[#e06010] transition-colors">
                            <Search className="w-4 h-4" />
                          </button>
                        </div>
                        {collectionReportMsg && (
                          <p className={`text-xs mt-1 ${collectionReportFound ? 'text-green-600' : 'text-red-600'}`}>{collectionReportMsg}</p>
                        )}
                      </div>
                    )}

                    {txForm.collectionSource === 'company' && (
                      <div>
                        <label className="text-slate-500 text-xs mb-1 block">{L.description} *</label>
                        <input type="text" value={txForm.description}
                          onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.collectionPlaceholder} />
                      </div>
                    )}
                  </>
                )}

                {/* Expense Fields (general spending - fuel, supplies, etc.) */}
                {txType === 'expense' && (
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{L.description} *</label>
                    <input type="text" value={txForm.itemName}
                      onChange={(e) => setTxForm((f) => ({ ...f, itemName: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.expensePlaceholder} />
                  </div>
                )}

                {/* Purchase Fields (dispatch sheet related payments) */}
                {txType === 'purchase' && (
                  <>
                    {/* Search by Delivery Statement Number */}
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.deliveryStatementNumber} *</label>
                      <div className="flex gap-2">
                        <input type="text" value={purchaseReportSearch}
                          name="purchaseDeliveryStatementNumber"
                          autoComplete="off"
                          onChange={(e) => { setPurchaseReportSearch(e.target.value); setTxForm((f) => ({ ...f, purchaseDeliveryStatementNumber: e.target.value })); }}
                          onKeyDown={(e) => e.key === 'Enter' && handlePurchaseReportSearch()}
                          className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterDeliveryStatement} />
                        <button type="button" onClick={handlePurchaseReportSearch} aria-label={txx.searchReport}
                          className="px-3 py-2.5 rounded-lg bg-[#f37121] text-white text-sm hover:bg-[#e06010] transition-colors">
                          <Search className="w-4 h-4" />
                        </button>
                      </div>
                      {purchaseReportMsg && (
                        <p className={`text-xs mt-1 ${purchaseReportFound ? 'text-green-600' : 'text-red-600'}`}>{purchaseReportMsg}</p>
                      )}
                    </div>

                    {/* Show invoice selling price if found */}
                    {purchaseInvoiceAmount != null && (
                      <div className="bg-slate-50 border border-blue-500/30 rounded-lg p-3">
                        <p className="text-blue-600 text-sm font-medium">{L.sellingPrice}: {purchaseInvoiceAmount.toLocaleString()} SAR</p>
                      </div>
                    )}

                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.driverName}</label>
                      <input type="text" value={txForm.purchaseDriverName}
                        name="purchaseDriverName"
                        autoComplete="off"
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseDriverName: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterDriverName} />
                    </div>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.receiptNumber}</label>
                      <input type="text" value={txForm.purchaseReceiptNumber}
                        name="purchaseReceiptNumber"
                        autoComplete="off"
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseReceiptNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterReceiptNumber} />
                    </div>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.branch}</label>
                      {/* Auto-filled from the dispatch sheet on search (like driver
                          name). Free text so any branch name the sheet uses fits. */}
                      <input type="text" value={txForm.purchaseBranch}
                        name="purchaseBranch"
                        autoComplete="off"
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseBranch: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterBranchName} />
                    </div>
                  </>
                )}

                {/* Notes */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.notes}</label>
                  <textarea value={txForm.notes} onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2} className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" placeholder={L.addNotes} />
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 shrink-0">
                {txError && (
                  <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-sm">
                    {txError}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setShowTxModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{L.cancel}</button>
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
              className="bg-slate-50 border border-slate-200 rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg mb-3">{L.editTransaction}</h3>
                <button type="button" onClick={() => setEditingTx(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-3">
                <div className="bg-white rounded-lg p-3 text-sm">
                  <span className={`font-medium capitalize ${TYPE_CONFIG[editingTx.type]?.color || 'text-slate-900'}`}>{typeLabel(editingTx.type)}</span>
                  {editingTx.customer && <span className="text-slate-500 ms-2">— {editingTx.customer.companyName}</span>}
                  {(editingTx.vendor || editingTx.vendorName) && <span className="text-slate-500 ms-2">— {editingTx.vendor?.name || editingTx.vendorName}</span>}
                  {(editingTx.driver || editingTx.driverName) && <span className="text-slate-500 ms-2">— {editingTx.driver?.name || editingTx.driverName}</span>}
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.amountSar} *</label>
                  <input type="number" min="0.01" step="0.01" value={editForm.amount}
                    onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                </div>
                {editingTx.type === 'collection' && (
                  <>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.deliveryStatementNumber}</label>
                      <input type="text" value={editForm.deliveryStatementNumber || ''}
                        name="deliveryStatementNumber"
                        autoComplete="off"
                        title={L.deliveryStatementNumber}
                        placeholder={L.deliveryStatementNumber}
                        onChange={(e) => setEditForm((f) => ({ ...f, deliveryStatementNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    {editingTx.collectionSource === 'company' && (
                      <div>
                        <label className="text-slate-500 text-xs mb-1 block">{L.description}</label>
                        <input type="text" value={editForm.description || ''}
                          name="collectionDescription"
                          autoComplete="off"
                          title={L.description}
                          placeholder={L.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                      </div>
                    )}
                  </>
                )}
                {editingTx.type === 'expense' && (
                  <div>
                    <label className="text-slate-500 text-xs mb-1 block">{L.itemDescription}</label>
                    <input type="text" value={editForm.itemName || ''}
                      name="itemName"
                      autoComplete="off"
                      title={L.itemDescription}
                      placeholder={L.itemDescription}
                      onChange={(e) => setEditForm((f) => ({ ...f, itemName: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                  </div>
                )}
                {editingTx.type === 'purchase' && (
                  <>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.deliveryStatementNumber}</label>
                      <input type="text" value={editForm.purchaseDeliveryStatementNumber || ''}
                        name="purchaseDeliveryStatementNumber"
                        autoComplete="off"
                        title={L.deliveryStatementNumber}
                        placeholder={L.deliveryStatementNumber}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseDeliveryStatementNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.driverName}</label>
                      <input type="text" value={editForm.purchaseDriverName || ''}
                        name="purchaseDriverName"
                        autoComplete="off"
                        title={L.driverName}
                        placeholder={L.driverName}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseDriverName: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.receiptNumber}</label>
                      <input type="text" value={editForm.purchaseReceiptNumber || ''}
                        name="purchaseReceiptNumber"
                        autoComplete="off"
                        title={L.receiptNumber}
                        placeholder={L.receiptNumber}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseReceiptNumber: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.branch}</label>
                      <select
                        value={editForm.purchaseBranch || ''}
                        onChange={(e) => setEditForm((f) => ({ ...f, purchaseBranch: e.target.value }))}
                        title={L.branch}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      >
                        <option value="">{L.enterBranchName}</option>
                        {/* Keep the historical free-text value visible even if it doesn't match any branch */}
                        {editForm.purchaseBranch && !branchList.some((b) => b.name === editForm.purchaseBranch) && (
                          <option value={editForm.purchaseBranch}>{editForm.purchaseBranch}</option>
                        )}
                        {branchList.map((b) => (
                          <option key={b._id} value={b.name}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.notes}</label>
                  <textarea value={editForm.notes || ''} rows={2}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setEditingTx(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{L.cancel}</button>
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
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                  <Lock className="w-5 h-5 text-[#f37121]" /> {L.closeDay}
                </h2>
                <button type="button" onClick={() => setShowCloseModal(false)} className="text-slate-300 hover:text-white" aria-label={txx.close}><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-4">
                {isManager && (
                  <div className="bg-white border border-slate-200 rounded-lg p-4">
                    <p className="text-slate-500 text-xs mb-1">{L.expectedCashBalance}</p>
                    <p className="text-2xl font-bold text-[#f37121]">{wallet.closingBalance.toLocaleString()} SAR</p>
                  </div>
                )}

                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.cashInHand} *</label>
                  <input type="number" min="0" step="0.01" value={closeForm.actualCash}
                    onChange={(e) => setCloseForm((f) => ({ ...f, actualCash: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={L.enterAmountHave} />
                </div>

                {closeForm.actualCash && Number(closeForm.actualCash) !== wallet.closingBalance && (() => {
                  const diff = wallet.closingBalance - Number(closeForm.actualCash);
                  const isDeficit = diff > 0;
                  return (
                    <div className={`p-3 rounded-lg border ${isDeficit ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                      <p className={`text-sm font-medium ${isDeficit ? 'text-red-600' : 'text-green-600'}`}>
                        {isDeficit ? L.deficit : L.surplus}: {Math.abs(diff).toLocaleString()} SAR
                      </p>
                    </div>
                  );
                })()}

                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.notesOptional}</label>
                  <textarea value={closeForm.differenceNotes}
                    onChange={(e) => setCloseForm((f) => ({ ...f, differenceNotes: e.target.value }))}
                    rows={2} className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" placeholder={L.addAnyNotes} />
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button type="button" onClick={() => setShowCloseModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{L.cancel}</button>
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

      {/* ─── EXPORT MODAL ────────────────────────────────────── */}
      <AnimatePresence>
        {showExportModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !exporting && setShowExportModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                  <Download className="w-5 h-5 text-[#f37121]" /> {L.exportToExcel}
                </h2>
                <button type="button" onClick={() => !exporting && setShowExportModal(false)} className="text-slate-300 hover:text-white" aria-label={txx.close} disabled={exporting}><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setExportMode('single')}
                    className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${exportMode === 'single' ? 'bg-[#f37121]/20 text-[#f37121] border-[#f37121]/50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    {L.singleDay}
                  </button>
                  <button type="button" onClick={() => setExportMode('range')}
                    className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${exportMode === 'range' ? 'bg-[#f37121]/20 text-[#f37121] border-[#f37121]/50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    {L.dateRange}
                  </button>
                </div>

                {exportMode === 'single' ? (
                  <div className="bg-white border border-slate-200 rounded-lg p-4">
                    <p className="text-slate-500 text-xs mb-1">{L.fromDate}</p>
                    <p className="text-slate-900 font-medium">{selectedDate}</p>
                    <p className="text-slate-500 text-xs mt-2">
                      {wallet?.branch?.name || ''} — {wallet?.user?.firstName || ''} {wallet?.user?.lastName || ''}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.fromDate}</label>
                      <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)}
                        aria-label={L.fromDate}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.toDate}</label>
                      <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)}
                        aria-label={L.toDate}
                        className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </div>
                )}

                {exportError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-sm">
                    {exportError}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button type="button" onClick={() => setShowExportModal(false)} disabled={exporting}
                  className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm disabled:opacity-50">{L.cancel}</button>
                <button type="button" onClick={handleExportClick}
                  disabled={exporting || (exportMode === 'range' && exportFrom > exportTo)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {exporting ? L.exportLoading : L.download}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm Modal (replaces browser (await confirm())) */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[#f37121]/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-[#f37121]" />
                  </div>
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{lang === 'ar' ? 'تأكيد' : 'Confirm'}</h3>
                </div>
                <p className="text-slate-700 text-sm">{confirmModal.message}</p>
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{L.cancel}</button>
                <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
                  {lang === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
