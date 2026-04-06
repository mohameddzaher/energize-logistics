'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const isManager = ['super_admin', 'admin', 'operations_manager'].includes(user?.role || '');
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
  const [editForm, setEditForm] = useState({ amount: '', notes: '', itemName: '' });

  // Close day modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeForm, setCloseForm] = useState({ actualCash: '', differenceReason: '', differenceNotes: '' });
  const [closing, setClosing] = useState(false);

  // General error banner
  const [actionError, setActionError] = useState('');

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
      if (err?.message?.includes('No branch')) {
        setWallet(null);
        setTransactions([]);
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

  // ─── DELETE TRANSACTION ────────────────────────────────────
  const handleDeleteTx = async (id: string) => {
    if (!confirm(L.deleteConfirm)) return;
    setActionError('');
    try {
      await api.delete(`/api/wallet/transactions/${id}`);
      fetchWallet(false);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to delete transaction');
    }
  };

  // ─── EDIT TRANSACTION ──────────────────────────────────────
  const openEditTx = (tx: Transaction) => {
    setEditingTx(tx);
    setEditForm({
      amount: String(tx.amount),
      notes: tx.notes || '',
      itemName: tx.itemName || '',
    });
  };

  const handleEditTx = async () => {
    if (!editingTx || !editForm.amount || Number(editForm.amount) <= 0) return;
    setSubmitting(true);
    setActionError('');
    try {
      await api.put(`/api/wallet/transactions/${editingTx._id}`, {
        amount: Number(editForm.amount),
        notes: editForm.notes || undefined,
        itemName: editForm.itemName || undefined,
      });
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
  const handleReopenDay = async () => {
    if (!wallet || !confirm(L.reopenConfirm)) return;
    setActionError('');
    try {
      await api.post(`/api/wallet/reopen/${wallet._id}`);
      fetchWallet(false);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to reopen day');
    }
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
      {isManager && wallet.isClosed && wallet.cashDifference !== null && wallet.cashDifference !== 0 && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${wallet.cashDifference > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
          <AlertTriangle className={`w-5 h-5 ${wallet.cashDifference > 0 ? 'text-red-400' : 'text-green-400'}`} />
          <div>
            <p className={`text-sm font-medium ${wallet.cashDifference > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {wallet.cashDifference > 0 ? L.deficit : L.surplus}: {Math.abs(wallet.cashDifference).toLocaleString()} SAR
            </p>
            <p className="text-gray-400 text-xs">
              {L.expected}: {wallet.closingBalance.toLocaleString()} SAR | {L.actual}: {wallet.actualCash?.toLocaleString()} SAR
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
                {editingTx.type === 'expense' && (
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">{L.itemDescription}</label>
                    <input type="text" value={editForm.itemName}
                      onChange={(e) => setEditForm((f) => ({ ...f, itemName: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                  </div>
                )}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{L.notes}</label>
                  <textarea value={editForm.notes} rows={2}
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
    </div>
  );
}
