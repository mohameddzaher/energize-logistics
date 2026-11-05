'use client';

import { hasFinancePowers, FINANCE_FULL_ROLES } from '@/lib/financeAuthority';
import { useState, useEffect, useCallback } from 'react';
import MonthPicker from '@/components/system/MonthPicker';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { canEditSection } from '@/lib/sections';
import { canPickWalletBranch, WALLET_START_DATE, WALLET_VIEW_ONLY_ROLES } from '@/lib/wallet';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, X, Check, Loader2, ArrowUpCircle, ArrowDownCircle,
  ShoppingCart, Lock, Unlock, AlertTriangle, Search,
  Receipt, Download, Pencil, ArrowLeftRight, ClipboardCopy, Truck,
} from 'lucide-react';
import Link from 'next/link';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getWalletTranslations, getWalletExtraTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters } from '@/hooks/useColumnFilters';

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
  type: 'collection' | 'expense' | 'purchase' | 'tax_invoice';
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
  // Dispatch reports received in the receipt entry; receivedDocNumber is for entries written before more than one report per entry was allowed.
  receivedReportNumbers?: string[];
  receivedDocNumber?: string;
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
  // A receipt entry, not a money movement. It records that the employee received an invoice or report in hand and is outside the custody balance (neither added nor subtracted), so its color is neutral: color on this screen means money direction.
  // The button names the action, receipt, since a tax invoice label reads as issuing or paying one.
  tax_invoice: { label: 'Tax invoices received', labelAr: 'استلام فاتورة ضريبية', icon: Receipt, color: 'text-slate-600', bg: 'bg-slate-200/70' },
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Today, and not before the ledger start; the server rejects earlier dates so they are not offered. */
const startOfBook = (d: string) => (d < WALLET_START_DATE ? WALLET_START_DATE : d);

/**
 * Last day that can be opened: tomorrow. Mirrors lastWritableDay on the server.
 * Tomorrow is allowed because work crosses midnight: a branch day is closed and then an entry arrives at 1 am, which is tomorrow by calendar. Blocking it forces a wrong date or no record.
 */
const endOfBook = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function WalletPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  // The matrix is computed like the list: a role granted edit on this section can edit; otherwise the screen opens for a custom role while its buttons stay unavailable (see operations team).
  const isManager = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', ...FINANCE_FULL_ROLES].includes(user?.role || '')
    || canEditSection((user as any)?.permissions, 'Operations');
  // role-only: supervisor and collections view branches, filter and export but record nothing. The server rejects their writes by role whatever they are granted (config/walletViewOnly).
  const isReadOnly = user?.role === 'moderator' || WALLET_VIEW_ONLY_ROLES.includes(user?.role || '');
  /**
   * Only the system admin works outside the ledger window. The two limits (ledger start, tomorrow) guard against everyday mistakes such as a typo date or a screen opened on a future month, not accounting rules. A real correction needs a door, and a door closed to everyone gets bypassed by writing the movement on another day, making the ledger falsely consistent.
   * The server enforces it (mayWorkOutsideBook); this only lifts the limit on the pickers.
   */
  const freeDates = hasFinancePowers(user as any);
  // System admin, or a role given full powers from the permissions screen; the server sends them as superAdminPowers. They show the open-day and edit buttons.
  // System admin and finance: edit, delete, move and reopen. See lib/financeAuthority.
  const isSuperAdmin = hasFinancePowers(user as any);
  const isOpsManager = user?.role === 'operations_manager';
  /**
   * Who writes into a closed day. Closing counts cash and fixes a balance carried forward; an entry added to a closed day recomputes its balance and every later day and invalidates the explained difference. Buttons were shown on isManager, which includes operations staff, the most frequent recorders, so writing into a closed day means asking for a reopen, which is system admin only.
   * The server enforces it (mayWriteIntoClosedDay); hiding is no substitute.
   */
  // role-only: writing into a closed day is a financial authority the server guards by the same role names.
  const canWriteClosedDay = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', ...FINANCE_FULL_ROLES].includes(user?.role || '')
    || !!(user as any)?.superAdminPowers;
  // Who is locked to a branch vs. who picks the branch to view. The old rule (super admin or operations manager) was a positive list forgotten whenever a role was added, so accountants, who have no branch by design, hit a no-branch dead end. The question is inverted: only operations staff are locked to their branch.
  const canSelectBranch = canPickWalletBranch(user?.role);

  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const L = getWalletTranslations(lang);
  const txx = getWalletExtraTranslations(lang);
  const typeLabel = (type: 'collection' | 'expense' | 'purchase' | 'tax_invoice') => lang === 'ar' ? TYPE_CONFIG[type].labelAr : TYPE_CONFIG[type].label;

  const [wallet, setWallet] = useState<DailyWallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => startOfBook(getTodayStr()));
  /**
   * Day, period or month. The wallet is daily by nature, and the screen showed only that, so a month's spending had to be exported and summed.
   * Period and month are read-only on purpose: movements belong to a day and closing is a day action, so write buttons are hidden there rather than shown and rejected.
   */
  const [mode, setMode] = useState<'day' | 'range' | 'month'>('day');
  // If the screen opens before the ledger start (device clock set in the past), the view would start on a date the server rejects, so the limit applies to the first value too.
  const [rangeFrom, setRangeFrom] = useState(() => startOfBook(getTodayStr()));
  const [rangeTo, setRangeTo] = useState(getTodayStr());
  const [monthKey, setMonthKey] = useState(() => getTodayStr().slice(0, 7));
  const [rangeSummary, setRangeSummary] = useState<null | {
    totalCollections: number; totalExpenses: number; totalPurchases: number;
    days: number; openingFirst: number; closingLast: number;
  }>(null);

  // Super admin: branch & user selectors
  const [allBranches, setAllBranches] = useState<{ _id: string; name: string }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branchUsers, setBranchUsers] = useState<{ _id: string; firstName: string; lastName: string }[]>([]);

  // Branch list, read once for both uses: the purchase dialog's branch list and the branch picker. It was requested twice per open and the two responses landed at different times, each redrawing the page.
  const [branchList, setBranchList] = useState<{ _id: string; name: string }[]>([]);
  useEffect(() => {
    api.get<any>('/api/branches').then((data) => {
      const list = data.branches || data || [];
      setBranchList(list);
      if (canSelectBranch) {
        setAllBranches(list);
        setSelectedBranch((cur) => cur || (list[0]?._id ?? ''));
      }
    }).catch((err: any) => {
      if (canSelectBranch) setActionError(err?.message || 'Failed to load branches');
    });
  }, [canSelectBranch]);

  // Transaction modal
  const [showTxModal, setShowTxModal] = useState(false);
  const [txType, setTxType] = useState<'collection' | 'expense' | 'purchase' | 'tax_invoice'>('collection');
  const [txForm, setTxForm] = useState({
    amount: '', deliveryStatementNumber: '', itemName: '', notes: '',
    collectionSource: 'client' as 'client' | 'company', description: '',
    purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '',
    // Amount-mismatch reason (when entered amount != expected dispatch-sheet value)
    mismatchReason: '' as '' | 'daily' | 'violation' | 'other', mismatchNote: '',
    // Receipt entry of an invoice or report: information outside the balance.
    receivedDocType: 'invoice' as 'invoice' | 'report', receivedDocNumber: '',
    receivedReportNumbers: [] as string[],
    // Each report with its voucher together: not two lists that drift apart at the first delete.
    receivedReports: [] as { reportNumber: string; documentNumber: string }[],
    receivedDocSand: '',
  });
  // Empty form used on open/reset — keeps the three reset sites in sync.
  const EMPTY_TX_FORM = {
    amount: '', deliveryStatementNumber: '', itemName: '', notes: '',
    collectionSource: 'client' as 'client' | 'company', description: '',
    purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '',
    mismatchReason: '' as '' | 'daily' | 'violation' | 'other', mismatchNote: '',
    // Receipt entry of an invoice or report: information outside the balance.
    receivedDocType: 'invoice' as 'invoice' | 'report', receivedDocNumber: '',
    receivedReportNumbers: [] as string[],
    // Each report with its voucher together: not two lists that drift apart at the first delete.
    receivedReports: [] as { reportNumber: string; documentNumber: string }[],
    receivedDocSand: '',
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

  // Confirm modal (replaces browser (await confirm()))
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // General error banner
  const [actionError, setActionError] = useState('');


  // Purchase report lookup
  const [purchaseReportSearch, setPurchaseReportSearch] = useState('');
  const [purchaseReportMsg, setPurchaseReportMsg] = useState('');
  const [purchaseReportFound, setPurchaseReportFound] = useState(false);
  /** An earlier purchase on the same report, found by search before the form is filled. */
  const [purchaseAlready, setPurchaseAlready] = useState<null | { amount: number; date: string; by: string; receipt: string; branch?: string }>(null);
  /** Report request status; no purchases are recorded before the voucher is received. */
  const [purchaseBond, setPurchaseBond] = useState<null | { ok: boolean; status: string }>(null);
  const [purchaseInvoiceAmount, setPurchaseInvoiceAmount] = useState<number | null>(null);
  // Expected dispatch-sheet values for the amount-match alert: purchaseValue (purchase price) for purchases, sellingValue (selling price) for collections.
  const [expectedPurchaseValue, setExpectedPurchaseValue] = useState<number | null>(null);
  // Collection report lookup: search the dispatch report to fetch the selling price.
  const [collectionReportMsg, setCollectionReportMsg] = useState('');
  const [collectionReportFound, setCollectionReportFound] = useState(false);

  // Load users for the branch.
  // The wallet is cleared here only. It used to be cleared on branch change and again on the dependent user change, flashing the screen empty twice. The screen stays loading until data arrives instead of showing an empty state and then another.
  useEffect(() => {
    if (!canSelectBranch || !selectedBranch) return;
    setLoading(true);
    setWallet(null);
    setTransactions([]);
    setBranchUsers([]);
    api.get<any>(`/api/users?branch=${selectedBranch}`).then((data) => {
      // Branch employees are read for display only (who works on this wallet), not to pick a wallet from them.
      const users = (data.users || data || []).filter((u: any) => ['operations_staff', 'operations_manager'].includes(u.role));
      setBranchUsers(users);
    }).catch(() => {
      // A failed read for decoration is not shown as an error. This line only shows who works on the wallet; accountants cannot read users, so the 403 raised a red error bar over a fully loaded custody page and also cleared the loading flag early.
      setBranchUsers([]);
    });
  }, [canSelectBranch, selectedBranch]);

  // ─── FETCH WALLET ──────────────────────────────────────────
  const fetchWallet = useCallback(async (showSpinner = true) => {
    // Only the branch is chosen. Picking a branch then an employee meant no wallet was read until a person was chosen, but the cash is the branch's and several employees work on it.
    if (canSelectBranch && !selectedBranch) {
      setLoading(false);
      setWallet(null);
      setTransactions([]);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      if (mode === 'day') {
        let url = `/api/wallet/daily?date=${selectedDate}`;
        if (canSelectBranch && selectedBranch) url += `&branchId=${selectedBranch}`;
        const data = await api.get<any>(url);
        setWallet(data.wallet);
        setTransactions(data.transactions || []);
        setRangeSummary(null);
      } else {
        // The current month ends at the ledger limit, not its last day: September on the 12th means what has happened, not thirty days of which eighteen have not come. The server limits the range too; the limit here makes the request match the display from the first call.
        const monthEnd = `${monthKey}-${String(new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
        const cap = endOfBook();
        const [from, to] = mode === 'month'
          ? [`${monthKey}-01`, (!freeDates && monthEnd > cap) ? cap : monthEnd]
          : [rangeFrom, rangeTo];
        const p = new URLSearchParams({ dateFrom: from, dateTo: to });
        if (canSelectBranch && selectedBranch) p.set('branchId', selectedBranch);
        const data = await api.get<any>(`/api/wallet/range?${p.toString()}`);
        const days: any[] = data.wallets || [];
        setTransactions(data.transactions || []);
        // Balances are not summed. Summing daily closing balances counts the same money repeatedly, since yesterday's closing is today's opening. A period balance is the first day's opening and the last day's closing.
        setRangeSummary({
          totalCollections: days.reduce((a, w) => a + (w.totalCollections || 0), 0),
          totalExpenses: days.reduce((a, w) => a + (w.totalExpenses || 0), 0),
          totalPurchases: days.reduce((a, w) => a + (w.totalPurchases || 0), 0),
          days: days.length,
          openingFirst: days.length ? (days[0].openingBalance || 0) : 0,
          closingLast: days.length ? (days[days.length - 1].closingBalance || 0) : 0,
        });
        // No day wallet in this view, so day cards and write buttons are hidden.
        setWallet(null);
      }
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
  }, [selectedDate, canSelectBranch, selectedBranch, lang, mode, rangeFrom, rangeTo, monthKey, freeDates]);

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
  /**
   * What is enough to record a movement, in one definition. The amount-greater-than-zero rule was written in three places (amount field, button disabling, a silent guard in the function). The invoice receipt entry has no amount, so two were fixed and the third left the button doing nothing on click.
   * It is answered once here and read by both button and guard; a new type needs one line.
   */
  const canSubmitTx = txType === 'tax_invoice'
    ? (txForm.receivedReports.length > 0 || !!String(txForm.receivedDocNumber || '').trim())
    // Purchases need a report that exists and was not bought before. A typed number is not enough: a plate number and an ordinary number passed, leaving a purchase for a nonexistent report. The button stays off until the number is searched and the report appears. The server also blocks; the screen guides.
    : txType === 'purchase'
      // No purchase before the voucher is received: the same condition applied to the payment date in the operations workflow, because recording the purchase is what writes that date.
      ? (!!txForm.amount && Number(txForm.amount) > 0 && purchaseReportFound
         && !purchaseAlready && purchaseBond?.ok !== false)
      : (!!txForm.amount && Number(txForm.amount) > 0);

  /**
   * State why the button is disabled at the button itself. The messages exist but sit at the search field at the top while the button is ten fields below, so a user reads missing permission or system down when the report just has no received voucher.
   * applicationStatus mirrors the operations platform and is written on every sync, so a blocked report may be accepted an hour later.
   */
  const blockReason: string | null = canSubmitTx ? null : (() => {
    const t = (a: string, e: string) => (lang === 'ar' ? a : e);
    if (txType === 'tax_invoice') {
      return t('اكتب رقم أمر نقل واحدًا على الأقل', 'Enter at least one dispatch report number');
    }
    if (txType === 'purchase') {
      if (!purchaseReportFound) return t('ابحث عن رقم أمر النقل أوّلًا — الزرّ لا يعمل حتى يظهر أمر النقل', 'Search for the dispatch report first — the button stays off until it is found');
      if (purchaseAlready) {
        // The custody paid from matters more than the payer name. Paying from another branch's custody is the common case, so the name alone does not say where the money went.
        const where = purchaseAlready.branch ? t(` من عهدة ${purchaseAlready.branch}`, ` from the ${purchaseAlready.branch} wallet`) : '';
        const who = purchaseAlready.by ? t(` بواسطة ${purchaseAlready.by}`, ` by ${purchaseAlready.by}`) : '';
        const when = purchaseAlready.date ? t(` يوم ${purchaseAlready.date}`, ` on ${purchaseAlready.date}`) : '';
        return t(
          `هذا أمر النقل مدفوعٌ بالفعل: ${Number(purchaseAlready.amount || 0).toLocaleString()} ريال${where}${who}${when}. لا يُدفَع أمر النقل مرّتين — راجعه مع الفرع الذي دفعه إن كان هناك خطأ.`,
          `This report is already paid: ${Number(purchaseAlready.amount || 0).toLocaleString()} SAR${where}${who}${when}. A report is not paid twice — take it up with the branch that paid it if this is wrong.`);
      }
      // Voucher status no longer blocks saving. It used to reject until the status was received, but whoever paid has received the paper, so recording is the declaration: the status is written after saving, here and on the platform. The screen says so before saving (blue card below).
      if (!txForm.amount || Number(txForm.amount) <= 0) return t('اكتب مبلغ الشراء', 'Enter the purchase amount');
      return null;
    }
    if (!txForm.amount || Number(txForm.amount) <= 0) return t('اكتب المبلغ', 'Enter the amount');
    return null;
  })();

  /** Adds the report and its voucher as a pair; called from both the button and the Enter key. */
  const addReceivedReport = () => {
    const n = String(txForm.receivedDocNumber || '').trim();
    if (!n) return;
    setTxForm((f) => ({
      ...f,
      receivedDocNumber: '',
      receivedDocSand: '',
      receivedReports: f.receivedReports.some((x) => x.reportNumber === n)
        ? f.receivedReports
        : [...f.receivedReports, { reportNumber: n, documentNumber: String(f.receivedDocSand || '').trim() }],
    }));
  };

  const handleAddTransaction = async () => {
    if (!canSubmitTx) return;
    setSubmitting(true);
    setTxError('');
    try {
      const payload: any = {
        date: selectedDate,
        type: txType,
        amount: Number(txForm.amount),
        notes: txForm.notes || undefined,
        // Restrict the movement to the displayed branch. The page read the selected branch's custody but wrote without a branch, so the entry fell on the account holder's branch, and accounting, which has none, got a no-branch error after filling the whole form.
        // Read and write on the same branch: what is seen is what is written.
        ...(selectedBranch ? { branchId: selectedBranch } : {}),
      };
      // Expected dispatch-sheet value for this transaction type (null = no lookup done).
      // Whatever remains in the input but was not yet added is counted: someone who typed a number and pressed save meant to add it, and dropping it silently loses a report they thought was recorded.
      const pendingReport = String(txForm.receivedDocNumber || '').trim();
      const allPairs = [...txForm.receivedReports];
      if (pendingReport && !allPairs.some((x) => x.reportNumber === pendingReport)) {
        allPairs.push({ reportNumber: pendingReport, documentNumber: String(txForm.receivedDocSand || '').trim() });
      }
      if (txType === 'tax_invoice' && !allPairs.length) {
        setTxError(lang === 'ar' ? 'اكتب رقم أمر نقل واحدًا على الأقل' : 'Enter at least one dispatch report number');
        setSubmitting(false);
        return;
      }
      // Collections are not compared with the report value: the collected amount differs by nature, so it is recorded as is with no alert or reason.
      const expected = txType === 'purchase' ? expectedPurchaseValue : null;
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
      if (txType === 'tax_invoice') {
        // No amount: the entry says received; no money came in or out.
        payload.amount = 0;
        payload.receivedReports = allPairs;
      }
      if (txType === 'purchase') {
        payload.purchaseDeliveryStatementNumber = txForm.purchaseDeliveryStatementNumber || undefined;
        payload.purchaseDriverName = txForm.purchaseDriverName || undefined;
        payload.purchaseReceiptNumber = txForm.purchaseReceiptNumber || undefined;
        payload.purchaseBranch = txForm.purchaseBranch || undefined;

      }
      const res = await api.post<{ unknownReports?: string[] }>('/api/wallet/transactions', payload);
      // An unrecognized number is reported before the dialog closes. The entry saves everything typed, but a number with no report here may be a typo, and closing silently makes the employee think all seven were stamped when only five were.
      if (res?.unknownReports?.length) {
        setTxError(lang === 'ar'
          ? `حُفظ القيد — ولم نجد أوامر نقل بهذه الأرقام: ${res.unknownReports.join('، ')}`
          : `Saved — but no reports found for: ${res.unknownReports.join(', ')}`);
        setTxForm(EMPTY_TX_FORM);
        fetchWallet(false);
        return;
      }
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

  // Search the dispatch report for purchases: pulls driver, branch and purchase price straight from the operations platform data and auto-fills them.
  const handlePurchaseReportSearch = async () => {
    if (!purchaseReportSearch.trim()) return;
    setPurchaseReportMsg('');
    setPurchaseReportFound(false);
    setPurchaseAlready(null);
    setPurchaseBond(null);
    setPurchaseInvoiceAmount(null);
    setExpectedPurchaseValue(null);
    try {
      // The branch decides what a purchase costs: heavy transport pays the truck rent (server, purchaseBasis).
      const branchQs = canSelectBranch && selectedBranch ? `&branchId=${selectedBranch}` : '';
      const data = await api.get<any>(`/api/wallet/lookup-report?reportNumber=${encodeURIComponent(purchaseReportSearch.trim())}${branchQs}`);
      setTxForm((f) => ({
        ...f,
        purchaseDeliveryStatementNumber: data.reportNumber,
        // Auto-fill from the dispatch sheet (still editable if wrong).
        purchaseDriverName: data.driverName || f.purchaseDriverName,
        purchaseBranch: data.branch || f.purchaseBranch,
        // The amount is filled from the report too. The amount field is first in the dialog with the report search below it; recording a purchase starts from the bottom, so the amount stayed empty and the button looked like missing permission. The purchase value is in the report itself, so it is filled like driver and branch and stays editable if the amount paid differs.
        amount: (f.amount && String(f.amount).trim() !== '')
          ? f.amount
          : (data.purchaseValue != null && Number(data.purchaseValue) > 0 ? String(data.purchaseValue) : f.amount),
      }));
      setPurchaseInvoiceAmount(data.sellingValue || null);
      setExpectedPurchaseValue(data.purchaseValue != null ? Number(data.purchaseValue) : null);
      setPurchaseReportFound(true);
      setPurchaseAlready(data.alreadyPurchased || null);
      setPurchaseBond({ ok: !!data.bondReceived, status: data.applicationStatus || '' });
      setPurchaseReportMsg(`${data.heavy ? (lang === 'ar' ? 'الإيجار' : 'Rent') : txx.purchasePrice}: ${(data.purchaseValue || 0).toLocaleString()}`);
    } catch (err: any) {
      setPurchaseReportFound(false);
      setPurchaseReportMsg(err.message || txx.reportNotFound);
    }
  };

  // Search the dispatch report for collections: confirms the report exists; the amount collected is typed freely (no expected value, no mismatch reason).
  const handleCollectionReportSearch = async () => {
    const q = txForm.deliveryStatementNumber.trim();
    if (!q) return;
    setCollectionReportMsg('');
    setCollectionReportFound(false);
    try {
      const data = await api.get<any>(`/api/wallet/lookup-report?reportNumber=${encodeURIComponent(q)}`);
      setTxForm((f) => ({ ...f, deliveryStatementNumber: data.reportNumber }));
      setCollectionReportFound(true);
      setCollectionReportMsg(ar ? 'أمر النقل موجود ✓' : 'Report found ✓');
    } catch (err: any) {
      setCollectionReportFound(false);
      setCollectionReportMsg(err.message || txx.reportNotFound);
    }
  };

  // The file mirrors the screen. The table showed sixteen columns and the file exported seven (no customer, from/to, vehicle type, length, number, report date), so the sender sent half of what they saw. Each header is read from the same L that writes the screen header, so they cannot differ in count or naming.
  // Summary and movements are two blocks on one sheet, as the page reads, not two sheets.
  const dash = (v: any) => (v === 0 ? 0 : (v || ''));
  const opDetail = (k: 'client' | 'from' | 'to' | 'carType' | 'length' | 'carNumber') =>
    ({ header: L[k], key: 'operationDetails', transform: (v: any) => dash(v?.[k]), width: 18 });

  const walletSummaryColumns = [
    // The wallet now belongs to the branch: user describes a movement, not a daily ledger. See models/DailyWallet.
    { header: L.branch, key: 'branch.name', width: 20 },
    { header: ar ? 'التاريخ' : 'Date', key: 'date', width: 12 },
    { header: `${L.opening} (SAR)`, key: 'openingBalance', transform: fmt.money, width: 18 },
    { header: `${L.collections} (SAR)`, key: 'totalCollections', transform: fmt.money, width: 18 },
    { header: `${L.expenses} (SAR)`, key: 'totalExpenses', transform: fmt.money, width: 18 },
    { header: `${L.purchases} (SAR)`, key: 'totalPurchases', transform: fmt.money, width: 18 },
    { header: `${L.closingBalance} (SAR)`, key: 'closingBalance', transform: fmt.money, width: 20 },
    { header: L.status, key: 'isClosed', transform: (v: any) => (v ? L.closed : L.open), width: 12 },
    { header: `${L.actual} (SAR)`, key: 'actualCash', transform: (v: any, row: any) => (v != null ? fmt.money(v) : (row?.isClosed ? fmt.money(0) : L.open)), width: 18 },
    { header: ar ? 'فرق النقد (SAR)' : 'Cash Difference (SAR)', key: 'cashDifference', transform: (v: any, row: any) => (v != null ? fmt.money(v) : (row?.isClosed ? fmt.money(0) : L.open)), width: 20 },
  ];

  // Details on screen are lines composed into one cell, so they are written as displayed, together with their separate columns, since a composed line cannot be filtered or summed.
  /** No column named details. It merged eight sources into one dashed paragraph (description, customer, invoice, supplier, expense item, item name, driver, voucher number). Measured, it did not work: 821 of 940 rows had it empty (87%), 799 of them purchases, whose data lives in their own columns (report, voucher, driver, branch), and four of the eight sources never had a single row written. */
  const statementOf = (tx: any) => tx?.description || tx?.itemName || '';
  const customerOf = (tx: any) => (tx?.customer ? `${tx.customer.companyName} (${tx.customer.customerNumber})` : '');

  // One driver source read in three places. A driver appears as a linked record (driver), a free name in an expense (driverName), or a name in the purchase form (purchaseDriverName). They mean one thing to the reader, so a single function is used by the column, the file and print.
  const driverOf = (tx: any) => tx?.driver?.name || tx?.driverName || tx?.purchaseDriverName || '';

  /** Excel-style column funnel. The wallet table has nineteen columns and the daily question is show this driver's purchases or this branch's movements, previously done by exporting to Excel. The filtered value is the one read in the row (same functions above). See hooks/useColumnFilters. */
  const cf = useColumnFilters<Transaction>({
    day: (tx) => (tx as any).date || '',
    type: (tx) => typeLabel(tx.type),
    amount: (tx) => (tx.type === 'tax_invoice' ? '' : String(tx.amount ?? '')),
    statement: (tx) => statementOf(tx) || '',
    customer: (tx) => customerOf(tx) || '',
    report: (tx) => tx.deliveryStatementNumber || tx.purchaseDeliveryStatementNumber || '',
    receipt: (tx) => tx.purchaseReceiptNumber || '',
    driver: (tx) => driverOf(tx) || '',
    branch: (tx) => tx.purchaseBranch || tx.operationDetails?.branch || '',
    client: (tx) => tx.operationDetails?.client || '',
    from: (tx) => tx.operationDetails?.from || '',
    to: (tx) => tx.operationDetails?.to || '',
    carType: (tx) => tx.operationDetails?.carType || '',
    length: (tx) => tx.operationDetails?.length || '',
    carNumber: (tx) => tx.operationDetails?.carNumber || '',
    recordedBy: (tx) => `${(tx as any).user?.firstName || ''} ${(tx as any).user?.lastName || ''}`.trim(),
  }, transactions, ar ? 'ar' : 'en');
  const shownTx = cf.apply(transactions);

  /** All of a day's reports in one copy. Numbers are copied from what is displayed, not from everything: filtering by branch or driver copies only that filter's reports, which is usually what is meant. They are sorted, deduplicated, and the count copied is shown. */
  const dayReportNumbers = () => {
    const nums = new Set<string>();
    for (const tx of shownTx) {
      for (const n of [tx.deliveryStatementNumber, tx.purchaseDeliveryStatementNumber, ...(tx.receivedReportNumbers || [])]) {
        const v = String(n || '').trim();
        if (v) nums.add(v);
      }
    }
    return [...nums].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  };
  const copyDayReports = async (sep: string) => {
    const nums = dayReportNumbers();
    if (!nums.length) { notify(ar ? 'لا أوامر نقل في المعروض' : 'No report numbers in view', 'error'); return; }
    try {
      await navigator.clipboard.writeText(nums.join(sep));
      notify(ar ? `نُسِخ ${nums.length} أمر نقل` : `Copied ${nums.length} report numbers`, 'success');
    } catch {
      // The browser blocks the clipboard without a direct interaction: the text is shown to copy by hand.
      window.prompt(ar ? 'انسخ الأرقام:' : 'Copy the numbers:', nums.join(sep));
    }
  };

  // Move a transaction to another branch or day. Both ledgers are recomputed and their balances roll on the server (see moveTransaction); the screen listens to wallet:transaction and refreshes itself.
  // The two targets are independent: both fields open on the current values, so another day on the same branch changes only the date. The button stays off until one changes, since moving to where it already is is a server error.
  const [moving, setMoving] = useState<any | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [moveDate, setMoveDate] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const openMove = (t: any) => {
    setMoving(t);
    setMoveTo(String(t?.branch || ''));
    setMoveDate(String(t?.date || selectedDate || ''));
  };
  const moveChanged = !!moving
    && (moveTo !== String(moving.branch || '') || moveDate !== String(moving.date || selectedDate || ''));
  const doMove = async () => {
    if (!moving || !moveChanged) return;
    setMoveBusy(true);
    try {
      const r = await api.patch<any>(`/api/wallet/transactions/${moving._id}/move`, { branch: moveTo, date: moveDate });
      notify(r.message || (ar ? 'نُقلت الحركة' : 'Moved'), 'success');
      setMoving(null); setMoveTo(''); setMoveDate('');
      // The displayed day may no longer contain the entry since it moved, so the displayed ledger is re-read to show the reduction, and the destination is read when opened.
      await fetchWallet(false);
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر النقل' : 'Could not move'), 'error'); }
    setMoveBusy(false);
  };


  const txColumns = [
    { header: ar ? 'التاريخ' : 'Date', key: 'date', transform: fmt.date, width: 12 },
    { header: L.time, key: 'createdAt', transform: (v: any) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''), width: 8 },
    { header: L.type, key: 'type', transform: (v: any) => (v ? typeLabel(v) : ''), width: 14 },
    // A tax invoice entry does not touch the balance and its number is a zero, not an amount, so it is written as read on screen and not as a zero summed with money.
    { header: `${L.amount} (SAR)`, key: 'amount', transform: (v: any, row: any) => (row?.type === 'tax_invoice' ? (ar ? 'خارج الرصيد' : 'off-balance') : fmt.money(v)), width: 15 },
    { header: ar ? 'البيان' : 'Statement', key: '_statement', transform: (_v: any, row: any) => dash(statementOf(row)), width: 34 },
    { header: ar ? 'العميل' : 'Customer', key: '_customer', transform: (_v: any, row: any) => dash(customerOf(row)), width: 26 },
    // From the company is a yes/no field that is summed, not a word inside text.
    { header: ar ? 'من الشركة' : 'From company', key: 'collectionSource',
      transform: (v: any) => (v === 'company' ? (ar ? 'نعم' : 'Yes') : ''), width: 12 },
    { header: L.deliveryStatementNumber, key: 'deliveryStatementNumber', transform: (v: any, row: any) => dash(v || row?.purchaseDeliveryStatementNumber), width: 20 },
    // The voucher number sits beside its report in the file as on screen, so which voucher belongs to which report reads in adjacent cells.
    { header: L.receipt, key: 'purchaseReceiptNumber', transform: (v: any) => dash(v), width: 15 },
    // The driver sits beside the voucher and report in the file, as on screen.
    { header: L.driver, key: 'driver', transform: (_v: any, row: any) => dash(driverOf(row)), width: 18 },
    { header: L.branch, key: 'purchaseBranch', transform: (v: any, row: any) => dash(v || row?.operationDetails?.branch), width: 16 },
    opDetail('client'),
    opDetail('from'),
    opDetail('to'),
    opDetail('carType'),
    opDetail('length'),
    opDetail('carNumber'),
    { header: L.reportDate, key: 'operationDetails', transform: (v: any) => (v?.reportDate ? new Date(v.reportDate).toLocaleDateString('en-GB') : ''), width: 14 },
    { header: L.notes, key: 'notes', width: 25 },
    // Who recorded it: the branch wallet is worked on by several employees, and a file without the actor says what happened but not who did it.
    { header: ar ? 'سجّلها' : 'Recorded by', key: 'user', transform: (v: any) => (v ? `${v.firstName || ''} ${v.lastName || ''}`.trim() : ''), width: 20 },
    // What is never written is not exported. Eight columns here unpacked details; those never written in any of 940 entries were removed (supplier, expense item, linked invoice number, value and balance). An empty column in every row is unread, shifts the rest and lengthens the file. Customer and statement became two columns near what they belong to, so are not repeated.
    { header: ar ? 'أوامر نقل الفاتورة الضريبيّة' : 'Received reports', key: 'receivedReportNumbers', transform: (v: any, row: any) => ((v?.length ? v : [row?.receivedDocNumber]).filter(Boolean).join(' , ')), width: 24 },
    { header: ar ? 'مرجع' : 'Reference', key: 'reference', width: 15 },
    { header: ar ? 'مُعلَّمة' : 'Flagged', key: 'isFlagged', transform: fmt.yesNo, width: 10 },
  ];

  // Export through the unified button with two scopes. This screen had its own dialog, a different button from the one on ninety screens and an extra step. The two scopes are what is asked for: the screen's day, or the whole ledger.
  const scope = exportScopeLabels(ar);
  const branchNameForFile = wallet?.branch?.name || 'wallet';
  const sheetName = ar ? 'المحفظة اليومية' : 'Daily Wallet';
  const summaryTitle = (label: string) => (ar ? `ملخّص المحفظة — ${label}` : `Wallet summary — ${label}`);
  const txTitle = (n: number) => (ar ? `الحركات (${n})` : `Transactions (${n})`);
  const oneSheet = (label: string, wallets: Record<string, any>[], txs: Record<string, any>[]) => ([
    {
      name: sheetName,
      title: txTitle(txs.length),
      rows: txs,
      columns: txColumns,
      above: [{ title: summaryTitle(label), rows: wallets, columns: walletSummaryColumns }],
    },
  ]);

  const rangeSheets = async (from: string, to: string) => {
    const targetBranchId = canSelectBranch && selectedBranch ? selectedBranch : ((user as any)?.branch || '');
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (targetBranchId) params.set('branchId', String(targetBranchId));
    const d = await api.get<any>(`/api/wallet/range?${params.toString()}`);
    return oneSheet(scope.all, (d.wallets || []) as Record<string, any>[], (d.transactions || []) as Record<string, any>[]);
  };
  // The displayed range is the exported range. Export had two options (one day or the whole ledger), so someone viewing a month found no month option and exported everything then deleted by hand.
  const shownLabel = mode === 'day' ? selectedDate
    : mode === 'month' ? monthKey : `${rangeFrom} → ${rangeTo}`;

  const exportOptions = [
    mode === 'day'
      ? {
        key: 'day',
        label: `${scope.shown} — ${selectedDate}`,
        // The export is what is displayed, including column funnels: a column filter is part of what is on screen, and someone who filtered by driver expects that driver's file, not the whole ledger.
        sheets: oneSheet(selectedDate, (wallet ? [wallet] : []) as Record<string, any>[], shownTx as unknown as Record<string, any>[]),
      }
      : {
        key: 'shown',
        label: `${scope.shown} — ${shownLabel}`,
        // What is on screen is already loaded, so the server is not asked again.
        sheets: oneSheet(shownLabel, [] as Record<string, any>[], shownTx as unknown as Record<string, any>[]),
      },
    {
      key: 'all',
      label: scope.all,
      // Fetched on click, not before: the whole ledger is not loaded for someone who will not export.
      resolve: () => rangeSheets('2000-01-01', '2100-12-31'),
    },
  ];


  const openTxModal = (type: 'collection' | 'expense' | 'purchase' | 'tax_invoice') => {
    setTxType(type);
    setTxForm(EMPTY_TX_FORM);
    setTxError('');
    setPurchaseReportSearch('');
    setPurchaseReportMsg('');
    setPurchaseReportFound(false);
    setPurchaseAlready(null);
    setPurchaseBond(null);
    setPurchaseInvoiceAmount(null);
    setExpectedPurchaseValue(null);
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

  // No wallet is not no branch in the period view. Period and month have no day wallet (setWallet(null)), so with the old condition a branch employee, the most frequent user, would land on the no-branch-assigned page just by choosing month.
  if (mode === 'day' && !wallet && !canSelectBranch) {
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
            <p className="text-slate-500 text-sm">
              {wallet?.branch?.name || L.selectBranch}
              {branchUsers.length > 0 && (
                <span className="text-slate-400"> — {lang === 'ar' ? `${branchUsers.length} موظفًا على هذه المحفظة` : `${branchUsers.length} staff on this wallet`}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Staff move between the wallet and the loads board all day. */}
          {user?.pageAccess?.['/system/operations/loads'] === true && (
            <Link href="/system/operations/loads" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[#12325C] text-white hover:bg-[#0e2849]">
              <Truck className="w-4 h-4" />{lang === 'ar' ? 'متابعة الحمولات والشحنات' : 'Loads & Shipments'}
            </Link>
          )}
          {canSelectBranch && (
            <>
              <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} title={L.selectBranch}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {allBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
              {/* The employee picker was removed: the wallet belongs to the branch. Each movement shows who recorded it, so the actor is still known and the balance is single. */}
            </>
          )}
          {/* Day, period or month */}
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {([
              ['day', lang === 'ar' ? 'يوم' : 'Day'],
              ['range', lang === 'ar' ? 'فترة' : 'Period'],
              ['month', lang === 'ar' ? 'شهر' : 'Month'],
            ] as const).map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setMode(k)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                {lbl}
              </button>
            ))}
          </div>

          {mode === 'day' && (
            <>
              {/* Do not offer what will be rejected. The ledger starts at WALLET_START_DATE and the server rejects any call before it; an open picker on the past let a month be chosen and then fail with a red error, a block found after the click instead of before. */}
              <input type="date" value={selectedDate} min={freeDates ? undefined : WALLET_START_DATE} max={freeDates ? undefined : endOfBook()} onChange={(e) => setSelectedDate(e.target.value)}
                title={lang === 'ar' ? `دفتر العهدة يبدأ ${WALLET_START_DATE}` : `The wallet starts ${WALLET_START_DATE}`}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.selectDate} />
              <button type="button" onClick={() => setSelectedDate(startOfBook(getTodayStr()))}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{L.today}</button>
            </>
          )}

          {mode === 'range' && (
            <>
              <input type="date" value={rangeFrom} max={rangeTo || (freeDates ? undefined : endOfBook())} min={freeDates ? undefined : WALLET_START_DATE} onChange={(e) => setRangeFrom(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light]" aria-label={lang === 'ar' ? 'من' : 'From'} />
              <span className="text-slate-400 text-sm">→</span>
              <input type="date" value={rangeTo} max={freeDates ? undefined : endOfBook()} min={freeDates ? (rangeFrom || undefined) : (rangeFrom > WALLET_START_DATE ? rangeFrom : WALLET_START_DATE)} onChange={(e) => setRangeTo(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light]" aria-label={lang === 'ar' ? 'إلى' : 'To'} />
              <button type="button" onClick={() => {
                const t = getTodayStr();
                setRangeFrom(startOfBook(t.slice(0, 8) + '01')); setRangeTo(t);
              }}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200">
                {lang === 'ar' ? 'هذا الشهر' : 'This month'}
              </button>
            </>
          )}

          {mode === 'month' && (
            <MonthPicker value={monthKey} onChange={setMonthKey} ar={lang === 'ar'} allowEmpty={false}
              fromYear={freeDates ? 2023 : Number(WALLET_START_DATE.slice(0, 4))}
              toYear={freeDates ? undefined : Number(endOfBook().slice(0, 4))} />
          )}
          <ExportMenu fileName={`Wallet_${branchNameForFile}_${shownLabel.replace(/[^0-9A-Za-z-]/g, '_')}`}
            lang={lang === 'ar' ? 'ar' : 'en'} options={exportOptions} />
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

      {mode === 'day' && !wallet && canSelectBranch && (
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
              {wallet.cashDifference > 0 ? L.deficit : L.surplus}: {Math.abs(wallet.cashDifference).toLocaleString()}
            </p>
            <p className="text-slate-500 text-xs">
              {L.expected}: {wallet.closingBalance.toLocaleString()} | {L.actual}: {(wallet.actualCash ?? 0).toLocaleString()}
              {wallet.differenceReason && ` | ${L.reason}: ${wallet.differenceReason}`}
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!isReadOnly && (
        <div className="flex flex-wrap gap-2">
          {(!wallet.isClosed || canWriteClosedDay) && (
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
              {/* The button name comes from one place. It was written here by hand and again in TYPE_CONFIG, so fixing the name in the map left the button saying tax invoice; a name in two places gets fixed in one. */}
              <button type="button" onClick={() => openTxModal('tax_invoice')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-200/70 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300/70 transition-colors border border-slate-300">
                <Receipt className="w-4 h-4" /> {typeLabel('tax_invoice')}
              </button>
            </>
          )}
          {/* The empty space is explained: whoever closed their day needs to know why the buttons disappeared and what to do. */}
          {wallet.isClosed && !canWriteClosedDay && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px]">
              <Lock className="w-4 h-4 shrink-0" />
              {ar
                ? 'اليوم مُقفل — لا تُسجَّل فيه حركة. اطلب من مدير النظام إعادة فتحه إن كان هناك قيدٌ ناقص.'
                : 'The day is closed — no entries can be recorded. Ask a system administrator to reopen it.'}
            </div>
          )}
          {!wallet.isClosed && (
            <button type="button" onClick={() => { setCloseForm({ actualCash: '', differenceReason: '', differenceNotes: '' }); setShowCloseModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors ms-auto">
              <Lock className="w-4 h-4" /> {L.closeDay}
            </button>
          )}
          {/* Reopening is for the system admin only. A closed day is a number in an approved ledger; opening it rewrites its balance and every later day. The button was for three roles, now only those who answer for the ledger. See maySettle on the server, the actual guard; this hiding is no substitute. */}
          {wallet.isClosed && isSuperAdmin && (
            <button type="button" onClick={handleReopenDay}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-700 rounded-lg text-sm font-medium hover:bg-yellow-500/30 transition-colors border border-yellow-500/30 ms-auto">
              <Unlock className="w-4 h-4" /> {L.reopenDay}
            </button>
          )}
        </div>
      )}

      </>)}

      {/* Period cards, shown in period and month views in place of the day cards. Opening and closing are endpoints, not a sum; see the setRangeSummary comment. They sit outside the wallet block: those views have no day wallet (setWallet(null) in fetchWallet), so inside it choosing period or month wiped the whole page content, leaving only the header over blank space. */}
      {rangeSummary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <RangeCard label={lang === 'ar' ? 'عدد الأيام' : 'Days'} value={rangeSummary.days} />
          <RangeCard label={lang === 'ar' ? 'عدد الحركات' : 'Transactions'} value={transactions.length} />
          <RangeCard label={lang === 'ar' ? 'إجمالي التحصيل' : 'Collections'} value={rangeSummary.totalCollections} money tone="text-emerald-700" />
          <RangeCard label={lang === 'ar' ? 'إجمالي المصروفات' : 'Expenses'} value={rangeSummary.totalExpenses} money tone="text-red-600" />
          <RangeCard label={lang === 'ar' ? 'إجمالي المشتريات' : 'Purchases'} value={rangeSummary.totalPurchases} money tone="text-violet-700" />
          <RangeCard label={lang === 'ar' ? 'رصيد أول يوم ← آخر يوم' : 'Opening → closing'}
            value={`${rangeSummary.openingFirst.toLocaleString()} ← ${rangeSummary.closingLast.toLocaleString()}`} tone="text-slate-800" />
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-[#f37121]" />
            {L.transactions} ({shownTx.length}{shownTx.length !== transactions.length ? ` / ${transactions.length}` : ''})
            {/* Displayed reports copy in one click. Transport orders for a chosen day are gathered from the displayed rows (filtering by branch or driver copies only that filter's orders), sorted and deduplicated. */}
            <span className="ms-auto flex items-center gap-1.5">
              <button type="button" onClick={() => copyDayReports('\n')}
                title={ar ? 'نسخ أوامر النقل المعروضة — كلٌّ في سطر (للصقها في إكسل)' : 'Copy the shown report numbers — one per line'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11.5px] font-semibold">
                <ClipboardCopy className="w-3.5 h-3.5" />
                {ar ? `نسخ أوامر النقل (${dayReportNumbers().length})` : `Copy reports (${dayReportNumbers().length})`}
              </button>
              <button type="button" onClick={() => copyDayReports(', ')}
                title={ar ? 'نسخها مفصولةً بفواصل' : 'Copy comma-separated'}
                className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11.5px]">
                {ar ? 'بفواصل' : ', '}
              </button>
              {cf.activeCount > 0 && (
                <button type="button" onClick={cf.clear}
                  className="px-2 py-1.5 rounded-lg bg-[#f37121] text-white text-[11.5px] font-semibold">
                  {ar ? `مسح فلاتر الأعمدة (${cf.activeCount})` : `Clear column filters (${cf.activeCount})`}
                </button>
              )}
            </span>
          </h3>
        </div>
        <ScrollX>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                {/* Day is a column when the day is not the screen. In day view the date is in the header, so a column repeating it is noise; in month view thirty days of movements share one table and without it you cannot tell which movement is from which day. */}
                {mode !== 'day' && (
                  <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('day', lang === 'ar' ? 'اليوم' : 'Day')}</th>
                )}
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('type', L.type)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('amount', L.amount)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('statement', ar ? 'البيان' : 'Statement')}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('customer', ar ? 'العميل' : 'Customer')}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('report', L.deliveryStatementNumber)}</th>
                {/* Voucher number is a column beside its report. It was buried in the details column with driver, description and customer, forcing a paragraph read per row to match vouchers to transport orders. It is matched like any number, so it sorts, filters and exports as its own Excel cell. */}
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('receipt', L.receipt)}</th>
                {/* Driver is a column like the voucher number. It was buried in details between description, supplier and expense item; it is a name to filter and sum on, so it has its own column and file cell beside what it relates to. */}
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('driver', L.driver)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('branch', L.branch)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('client', L.client)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('from', L.from)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('to', L.to)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('carType', L.carType)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('length', L.length)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('carNumber', L.carNumber)}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.reportDate}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.notes}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.time}</th>
                {/* Who recorded it. The wallet belongs to the branch and several employees work on it, so this line says who acted; without it shared cash has no owner. */}
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{cf.head('recordedBy', lang === 'ar' ? 'سجّلها' : 'Recorded by')}</th>
                <th className="text-end text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.actions}</th>
              </tr>
            </thead>
            <tbody>
              {shownTx.length === 0 ? (
                <tr><td colSpan={mode === 'day' ? 19 : 20} className="text-center text-slate-800 py-12">{L.noTransactions}</td></tr>
              ) : shownTx.map((tx) => {
                const cfg = TYPE_CONFIG[tx.type];
                const Icon = cfg.icon;
                return (
                  <tr key={tx._id} className={`border-b border-slate-200/70 hover:bg-slate-100 transition-colors ${tx.isFlagged ? 'bg-red-500/5' : ''}`}>
                    {mode !== 'day' && (
                      <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap font-medium">{(tx as any).date || '—'}</td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded ${cfg.bg}`}><Icon className={`w-3.5 h-3.5 ${cfg.color}`} /></div>
                        <span className={`text-xs font-medium capitalize ${cfg.color}`}>{typeLabel(tx.type)}</span>
                        {/* From the company is an attribute of the collection, not a detail in it, so it is a tag on it. */}
                        {tx.type === 'collection' && tx.collectionSource === 'company' && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold whitespace-nowrap">{L.fromCompany}</span>
                        )}
                        {tx.isFlagged && <span title={tx.flagReason}><AlertTriangle className="w-3.5 h-3.5 text-red-600" /></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${tx.type === 'tax_invoice' ? 'text-slate-500' : tx.type === 'collection' ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.type === 'tax_invoice' ? '' : tx.type === 'collection' ? '+' : '-'}
                        {tx.type === 'tax_invoice'
                          ? (lang === 'ar' ? 'خارج الرصيد' : 'off-balance')
                          : tx.amount.toLocaleString()}
                      </span>
                    </td>
                    {/* The statement is one line saying what the entry is. Tax invoice reports are tags under it: they are the whole content of that entry and it has no other text. */}
                    <td className="px-4 py-3 text-slate-700 text-xs">
                      {statementOf(tx) ? <div>{statementOf(tx)}</div> : null}
                      {tx.type === 'tax_invoice' && (
                        <div className="flex flex-wrap gap-1">
                          {(tx.receivedReportNumbers?.length ? tx.receivedReportNumbers : [tx.receivedDocNumber]).filter((n): n is string => !!n).map((n) => (
                            <span key={n} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px]">{n}</span>
                          ))}
                        </div>
                      )}
                      {!statementOf(tx) && tx.type !== 'tax_invoice' && <span className="text-slate-300">—</span>}
                    </td>
                    {/* Customer: its own column. See customerOf. */}
                    <td className="px-4 py-3 text-slate-700 text-xs">
                      {customerOf(tx) || <span className="text-slate-300">—</span>}
                    </td>
                    {/* Delivery Statement # — its own column */}
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.deliveryStatementNumber || tx.purchaseDeliveryStatementNumber || '—'}</td>
                    {/* Voucher number: its own column. See the header. */}
                    <td className="px-4 py-3 text-xs whitespace-nowrap font-mono">
                      {tx.purchaseReceiptNumber
                        ? <span className="text-slate-800">{tx.purchaseReceiptNumber}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Driver: its own column. See driverOf. */}
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {driverOf(tx)
                        ? <span className="text-slate-700">{driverOf(tx)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
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
                    {/* Who recorded the movement: the wallet is the branch's and responsibility is personal. */}
                    <td className="px-4 py-3 text-slate-800 text-xs whitespace-nowrap">
                      {(tx as any).user
                        ? `${(tx as any).user.firstName || ''} ${(tx as any).user.lastName || ''}`.trim() || '—'
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {/* Period and month views are read-only: a movement belongs to a day, so it cannot be edited or deleted from a screen with no day, and wallet is empty there so its state is not read. */}
                      {/* Correcting a recorded movement is for the system admin only. Recording is daily work by whoever holds the cash box; changing a record rewrites it, moving that day's balance and every later day and recomputing count differences on closed days. See maySettle; the server rejects regardless. */}
                      {wallet && isSuperAdmin && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openEditTx(tx)}
                            className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100 transition-colors" title={L.edit}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          {/* Move a movement to another branch. Purchases recorded on the Jeddah wallet that belong to Dammam used to be fixed by delete and rewrite, losing who recorded it and when. The move attributes it to the new branch's ledger on the same day and recomputes both branches and their later balances. See moveTransactionBranch. */}
                          <button type="button" onClick={() => openMove(tx)}
                            className="p-1.5 rounded-lg text-slate-700 hover:text-sky-600 hover:bg-slate-100 transition-colors"
                            title={ar ? 'نقل إلى فرع آخر' : 'Move to another branch'}>
                            <ArrowLeftRight className="w-4 h-4" />
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
        </ScrollX>
      </div>

      {/* Dialog for moving a movement to another branch, opened from row actions. The date does not change: the move corrects place, not time, and changing the day too would hide two mistakes in one action. */}
      <AnimatePresence>
        {moving && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setMoving(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-sky-600" />
                <h3 className="font-bold text-slate-900">{ar ? 'نقل الحركة' : 'Move transaction'}</h3>
                <button type="button" onClick={() => setMoving(null)} className="ms-auto text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-3">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[12.5px] text-slate-700 space-y-0.5">
                  <p><span className="text-slate-500">{ar ? 'النوع: ' : 'Type: '}</span><span className="font-semibold">{typeLabel(moving.type)}</span></p>
                  <p><span className="text-slate-500">{ar ? 'المبلغ: ' : 'Amount: '}</span><span className="font-semibold tabular-nums">{Number(moving.amount || 0).toLocaleString()}</span></p>
                  <p><span className="text-slate-500">{ar ? 'التاريخ: ' : 'Date: '}</span><span className="font-semibold tabular-nums">{moving.date || selectedDate}</span></p>
                  <p><span className="text-slate-500">{ar ? 'الفرع الحالي: ' : 'Current branch: '}</span>
                    <span className="font-semibold">{moving.purchaseBranch || moving.operationDetails?.branch || (branchList.find((b) => b._id === String(moving.branch))?.name) || '—'}</span></p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[12px] font-semibold text-slate-600 mb-1">{ar ? 'الفرع' : 'Branch'}</span>
                    <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                      {/* The current branch stays in the list since the move may be for the date alone. */}
                      {branchList.map((b) => (
                        <option key={b._id} value={b._id}>{b.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-[12px] font-semibold text-slate-600 mb-1">{ar ? 'التاريخ' : 'Date'}</span>
                    <input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500">
                  {ar ? 'غيّر الفرعَ أو التاريخَ أو كليهما. تُعاد اليوميّتان: ترتفع يوميّةُ المصدر بما خرج منها وتنقص الوجهةُ بما دخل فيها — وتتدحرج الأرصدةُ على أيّامهما التالية. ويُقيَّد النقلُ في سجلّ المراجعة.'
                      : 'Change the branch, the date, or both. Both days are recalculated and their later days roll forward. The move is written to the audit log.'}
                </p>
              </div>
              <div className="px-5 py-3.5 border-t border-slate-200 flex items-center gap-2">
                <button type="button" onClick={() => setMoving(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
                <button type="button" onClick={doMove} disabled={!moveChanged || moveBusy}
                  className="ms-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-sm font-bold">
                  {moveBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
                  {ar ? 'نقل' : 'Move'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All dialogs are actions on a specific day (add, edit, close). None apply to a month view, so they stay conditional on the day wallet existing. */}
      {wallet && (<>
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
                {/* The four types in the picker match the buttons. Receipt used to open from its own button and was missing among the three in the dialog, so someone who opened it on collection found no way to it. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['collection', 'expense', 'purchase', 'tax_invoice'] as const).map((t) => {
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

                {/* The amount is not asked for in a receipt entry. There is no money in it, and the field was shown as required, so the employee typed zero to get past a question with no answer. */}
                {txType !== 'tax_invoice' && (
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{L.amountSar} *</label>
                  <input type="number" min="0.01" step="0.01" value={txForm.amount}
                    onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder="0.00" />
                  {/* Amount-vs-dispatch-sheet alert. Green when it matches, amber
                      with a required reason dropdown when it differs. */}
                  {(() => {
                    const expected = txType === 'purchase' ? expectedPurchaseValue : null;
                    if (expected == null || !txForm.amount) return null;
                    const isPurchase = txType === 'purchase';
                    const differs = Math.abs(Number(txForm.amount) - expected) > 0.009;
                    if (!differs) {
                      return <p className="text-xs text-green-600 mt-1">✓ {isPurchase ? txx.amountMatchesPurchase : txx.amountMatchesSelling} ({expected.toLocaleString()})</p>;
                    }
                    return (
                      <div className="mt-2 rounded-lg border border-amber-400/60 bg-amber-50 p-3 space-y-2">
                        <p className="text-xs text-amber-700 font-medium">⚠ {isPurchase ? txx.amountDiffersPurchase : txx.amountDiffersSelling} ({expected.toLocaleString()})</p>
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
                )}

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
                            onChange={(e) => { setTxForm((f) => ({ ...f, deliveryStatementNumber: e.target.value })); setCollectionReportFound(false); setCollectionReportMsg(''); }}
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

                {/* Receipt entry of an invoice or report: information, not a money movement. It is stated on screen so nobody takes it for an incomplete collection. */}
                {txType === 'tax_invoice' && (
                  <>
                    <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-[12.5px] text-slate-600">
                      {lang === 'ar'
                        ? 'تسجيلُ استلام — تقول به إنّ أوامر نقل هذه الفواتير صارت بيدك. لا مبلغَ فيه، ولا يدخل رصيدَ العهدة ولا إقفالَ اليوم.'
                        : 'A receipt record — it says these reports are now in your hands. No amount, and it does not touch the wallet balance or the day’s close.'}
                    </div>
                    {/* Report numbers as a batch. A representative brings seven and records them together; one entry per transport order repeats the date and branch seven times, and someone tired leaves the rest unrecorded. */}
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">
                        {lang === 'ar' ? 'أرقام أوامر النقل' : 'Dispatch report numbers'} *
                      </label>
                      {/* Each report has its voucher. They are written together and saved as a pair, and the voucher reaches its column in the operations workflow. One voucher copied across the batch would attribute a transport order's voucher to six others. */}
                      <div className="flex gap-2">
                        <input type="text" value={txForm.receivedDocNumber}
                          onChange={(e) => setTxForm((f) => ({ ...f, receivedDocNumber: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReceivedReport(); } }}
                          className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                          placeholder={lang === 'ar' ? 'رقم أمر النقل' : 'report number'} />
                        <input type="text" value={txForm.receivedDocSand}
                          onChange={(e) => setTxForm((f) => ({ ...f, receivedDocSand: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReceivedReport(); } }}
                          className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                          placeholder={lang === 'ar' ? 'رقم السند (اختياري)' : 'voucher no (optional)'} />
                        <button type="button" onClick={addReceivedReport}
                          className="px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm hover:bg-[#e06010] transition-colors shrink-0">
                          {lang === 'ar' ? 'إضافة' : 'Add'}
                        </button>
                      </div>
                      {txForm.receivedReports.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {txForm.receivedReports.map((r) => (
                            <span key={r.reportNumber} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono">
                              {r.reportNumber}
                              {r.documentNumber
                                ? <span className="text-slate-400">· {lang === 'ar' ? 'سند' : 'vch'} {r.documentNumber}</span>
                                : <span className="text-slate-300">· {lang === 'ar' ? 'بلا سند' : 'no vch'}</span>}
                              <button type="button" title={lang === 'ar' ? 'إزالة' : 'Remove'}
                                onClick={() => setTxForm((f) => ({ ...f, receivedReports: f.receivedReports.filter((x) => x.reportNumber !== r.reportNumber) }))}
                                className="text-slate-400 hover:text-red-600">×</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        {txForm.receivedReports.length > 0
                          ? (lang === 'ar' ? `${txForm.receivedReports.length} أمر نقل في هذا القيد` : `${txForm.receivedReports.length} reports in this record`)
                          : (lang === 'ar' ? 'يمكنك إضافة أكثر من أمر نقل في القيد الواحد — ولكل أمر نقل رقم سنده' : 'Add more than one report — each with its own voucher number')}
                      </p>
                    </div>
                  </>
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
                      {/* Inform, do not block. A purchase used to be blocked until status became voucher received, yet the employee receives the voucher and pays at the same moment, so they had to open another screen to declare what they did before recording it. Saving is now the declaration, and the user is told what will happen. */}
                      {purchaseBond && !purchaseBond.ok && (
                        <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                          <p className="text-[12.5px] font-bold text-blue-900">
                            {lang === 'ar' ? 'بالحفظ تصير حالةُ الطلب «استُلم السند»' : 'Saving sets the order to "bond received"'}
                          </p>
                          <p className="text-[11.5px] text-blue-800 mt-0.5">
                            {lang === 'ar'
                              ? `حالتُه الآن: ${({ requesting: 'قيد الطلب', loading: 'جارٍ التحميل', uploaded: 'تم التحميل', on_way: 'في الطريق', arrived: 'وصلت', bond_sent: 'أُرسل السند', late: 'متأخرة', invoiced: 'تمت الفوترة', cancelled: 'ملغاة' } as Record<string, string>)[purchaseBond.status] || purchaseBond.status || 'غير محدَّدة'}`
                              : `Current status: ${purchaseBond.status || 'unknown'}`}
                          </p>
                          <p className="text-[11px] text-blue-700 mt-1">
                            {lang === 'ar'
                              ? 'مَن سجّل شراءً فقد استلم السند — فتُكتب الحالةُ عندنا وفي منصّة التشغيل معًا بعد الحفظ.'
                              : 'Recording a purchase means the bond is in hand — the status is written here and on the operations platform after saving.'}
                          </p>
                        </div>
                      )}
                      {purchaseAlready && (
                        <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                          <p className="text-[12.5px] font-bold text-red-800">
                            {lang === 'ar' ? 'هذا أمر النقل سُجِّلت له مشترياتٌ من قبل' : 'This report already has a purchase'}
                          </p>
                          {/* The custody paid from: two thirds of purchases are paid from another branch's custody, so the payer name alone does not say where the money went. */}
                          <p className="text-[11.5px] text-red-700 mt-0.5">
                            {lang === 'ar'
                              ? `${purchaseAlready.amount.toLocaleString()} ريال بتاريخ ${purchaseAlready.date}`
                                + `${purchaseAlready.branch ? ` — من عهدة ${purchaseAlready.branch}` : ''}`
                                + `${purchaseAlready.by ? ` — بواسطة ${purchaseAlready.by}` : ''}`
                                + `${purchaseAlready.receipt ? ` — سند ${purchaseAlready.receipt}` : ''}`
                              : `${purchaseAlready.amount.toLocaleString()} SAR on ${purchaseAlready.date}`
                                + `${purchaseAlready.branch ? ` — from the ${purchaseAlready.branch} wallet` : ''}`
                                + `${purchaseAlready.by ? ` by ${purchaseAlready.by}` : ''}`}
                          </p>
                          <p className="text-[11px] text-red-600 mt-1">
                            {lang === 'ar' ? 'أمر النقل الواحد لا يُشترى مرّتين.' : 'A report cannot be purchased twice.'}
                          </p>
                        </div>
                      )}
                      {purchaseReportMsg && !purchaseAlready && (
                        <p className={`text-xs mt-1 ${purchaseReportFound ? 'text-green-600' : 'text-red-600'}`}>{purchaseReportMsg}</p>
                      )}
                    </div>

                    {/* Show invoice selling price if found */}
                    {purchaseInvoiceAmount != null && (
                      <div className="bg-slate-50 border border-blue-500/30 rounded-lg p-3">
                        <p className="text-blue-600 text-sm font-medium">{L.sellingPrice}: {purchaseInvoiceAmount.toLocaleString()}</p>
                      </div>
                    )}

                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">{L.driverName}</label>
                      {/* Comes from the dispatch report, so not editable: report data is tied to its number, and editing here makes the record say one thing and the transport order another, with no one knowing which is right a month later. */}
                      <input type="text" value={txForm.purchaseDriverName}
                        name="purchaseDriverName"
                        autoComplete="off"
                        readOnly={purchaseReportFound}
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseDriverName: e.target.value }))}
                        className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${
                          purchaseReportFound
                            ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed'
                            : 'bg-white border-slate-200 text-slate-900'}`}
                        placeholder={L.enterDriverName} />
                    </div>
                    <div>
                      {/* One field for the voucher number. This one already existed and was saved in the custody without leaving it; a second field with the same name was added to reach the report, leaving two identical questions. The right fix is for this one to reach it, not to duplicate it. */}
                      <label className="text-slate-500 text-xs mb-1 block">
                        {L.receiptNumber}
                        <span className="text-slate-400 ms-1">{lang === 'ar' ? '— يُكتب في أمر النقل تلقائيًّا' : '— written onto the report'}</span>
                      </label>
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
                        readOnly={purchaseReportFound}
                        onChange={(e) => setTxForm((f) => ({ ...f, purchaseBranch: e.target.value }))}
                        className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${
                          purchaseReportFound
                            ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed'
                            : 'bg-white border-slate-200 text-slate-900'}`}
                        placeholder={L.enterBranchName} />
                    </div>
                    {purchaseReportFound && (
                      <p className="text-[11.5px] text-slate-600 sm:col-span-2">
                        {lang === 'ar'
                          ? 'اسم السائق والفرع مأخوذان من أمر النقل ولا يُعدَّلان — إن كانا خطأً فالتصحيح في أمر النقل نفسه.'
                          : 'Driver and branch come from the dispatch sheet and cannot be edited — correct them on the sheet itself.'}
                      </p>
                    )}
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
                {/* Why the button is disabled, at the button. The explanatory messages sit at the search field at the top, ten fields above, so a user who filled the amount and voucher number reached a pale button saying nothing and read it as missing permission. See blockReason. */}
                {blockReason && !submitting && (
                  <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-amber-900 text-[12.5px] leading-relaxed">{blockReason}</p>
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setShowTxModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{L.cancel}</button>
                  {/* Do not disable save for an amount not asked for. The !txForm.amount condition applied to all types, and the receipt entry has no amount, so its button stayed off forever. Test what each type requires, not what most types require. */}
                  <button type="button" onClick={handleAddTransaction} disabled={submitting || !canSubmitTx}
                    title={blockReason || undefined}
                    className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {txType === 'tax_invoice'
                      ? (lang === 'ar' ? 'تسجيل الاستلام' : 'Record receipt')
                      : `${L.add} ${typeLabel(txType)}`}
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
                    <p className="text-2xl font-bold text-[#f37121]">{wallet.closingBalance.toLocaleString()}</p>
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
                        {isDeficit ? L.deficit : L.surplus}: {Math.abs(diff).toLocaleString()}
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
        {/* The dedicated export dialog was removed in favor of the unified button used on ninety screens with two scopes (the screen's day or the whole ledger). See exportOptions above. */}
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

/** Number card in the period view. See rangeSummary. */
const RangeCard = ({ label, value, money, tone }: { label: string; value: number | string; money?: boolean; tone?: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <p className={`text-lg font-extrabold ${tone || 'text-slate-900'}`}>
      {money && typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}
    </p>
    <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
  </div>
);
