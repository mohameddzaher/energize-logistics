'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { canPickWalletBranch } from '@/lib/wallet';
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
import ExportMenu, { exportScopeLabels } from '@/components/ls2/ExportMenu';

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
  // كشوفُ التخريج المستلَمة في قيد الاستلام. و`receivedDocNumber` للقيود
  // التي كُتبت قبل أن يُسمح بأكثرَ من كشفٍ في القيد الواحد.
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
  // ── قيدُ استلام، لا حركةُ مال ────────────────────────────────────────────
  // يُسجَّل ليُعرَف أنّ الموظّف استلم فاتورةً أو كشفًا بيده. وهو **خارج** رصيد
  // العهدة تمامًا: لا يُجمَع ولا يُطرَح — ولذلك لونُه محايدٌ لا أخضرُ ولا أحمر،
  // فاللونُ في هذه الشاشة يقول اتّجاهَ المال.
  // ── واسمُ الزرّ يقول الفعلَ لا الشيء ──────────────────────────────────────
  // «فاتورة ضريبية» تُقرأ كأنّها إصدارُ فاتورةٍ أو دفعُ قيمتها؛ والفعلُ استلامٌ.
  tax_invoice: { label: 'Tax invoices received', labelAr: 'استلام فاتورة ضريبية', icon: Receipt, color: 'text-slate-600', bg: 'bg-slate-200/70' },
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
  // ── ومَن لا يُقفَل على فرعٍ يختار الفرعَ الذي ينظر فيه ────────────────────
  // كان الشرطُ «سوبر أدمن أو مدير عمليات» — قائمةٌ موجبةٌ تُنسى كلَّما دخل
  // دورٌ جديد. فالمحاسبُ يفتح الصفحةَ فيقع على مسار «استعمل فرعَ حسابك»،
  // وحسابُه بلا فرعٍ (والخمسةُ كلُّهم كذلك، وهو صواب: المحاسبةُ ليست في فرع)
  // فيُقال له «لا فرعَ لحسابك — كلّم الإدارة»، ويقف عمله.
  //
  // فالسؤالُ صار عكسَه: مَن **يُقفَل** على فرعه؟ موظّفُ العمليات وحدَه.
  const canSelectBranch = canPickWalletBranch(user?.role);

  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const L = getWalletTranslations(lang);
  const txx = getWalletExtraTranslations(lang);
  const typeLabel = (type: 'collection' | 'expense' | 'purchase' | 'tax_invoice') => lang === 'ar' ? TYPE_CONFIG[type].labelAr : TYPE_CONFIG[type].label;

  const [wallet, setWallet] = useState<DailyWallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getTodayStr());

  // Super admin: branch & user selectors
  const [allBranches, setAllBranches] = useState<{ _id: string; name: string }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branchUsers, setBranchUsers] = useState<{ _id: string; firstName: string; lastName: string }[]>([]);

  // قائمة الفروع — تُقرأ **مرّة واحدة** وتخدم الغرضين: قائمة فرع نافذة الشراء،
  // ومحدِّد الفرع لمن يملك اختياره. كانت تُطلب مرّتين من الخادم في كل فتحة،
  // فتصل الاستجابتان في لحظتين مختلفتين ويعيد كلٌّ منهما رسم الصفحة.
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
    // قيدُ استلام فاتورةٍ أو كشف — معلومةٌ خارج الرصيد.
    receivedDocType: 'invoice' as 'invoice' | 'report', receivedDocNumber: '',
    receivedReportNumbers: [] as string[],
    // كلُّ كشفٍ وسندُه معًا — لا قائمتان تتزحزحان عن بعضهما عند أوّل حذف.
    receivedReports: [] as { reportNumber: string; documentNumber: string }[],
    receivedDocSand: '',
  });
  // Empty form used on open/reset — keeps the three reset sites in sync.
  const EMPTY_TX_FORM = {
    amount: '', deliveryStatementNumber: '', itemName: '', notes: '',
    collectionSource: 'client' as 'client' | 'company', description: '',
    purchaseDeliveryStatementNumber: '', purchaseDriverName: '', purchaseReceiptNumber: '', purchaseBranch: '',
    mismatchReason: '' as '' | 'daily' | 'violation' | 'other', mismatchNote: '',
    // قيدُ استلام فاتورةٍ أو كشف — معلومةٌ خارج الرصيد.
    receivedDocType: 'invoice' as 'invoice' | 'report', receivedDocNumber: '',
    receivedReportNumbers: [] as string[],
    // كلُّ كشفٍ وسندُه معًا — لا قائمتان تتزحزحان عن بعضهما عند أوّل حذف.
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
  /** شراءٌ سابقٌ على الكشف نفسِه — يُعرَف من البحث قبل ملء الاستمارة. */
  const [purchaseAlready, setPurchaseAlready] = useState<null | { amount: number; date: string; by: string; receipt: string }>(null);
  const [purchaseInvoiceAmount, setPurchaseInvoiceAmount] = useState<number | null>(null);
  // Expected dispatch-sheet values for the amount-match alert: purchaseValue
  // (سعر الشراء) for purchases, sellingValue (سعر البيع) for collections.
  const [expectedPurchaseValue, setExpectedPurchaseValue] = useState<number | null>(null);
  const [expectedSellingValue, setExpectedSellingValue] = useState<number | null>(null);
  // Collection report lookup (search كشف التخريج to fetch the selling price)
  const [collectionReportMsg, setCollectionReportMsg] = useState('');
  const [collectionReportFound, setCollectionReportFound] = useState(false);

  // ─── LOAD USERS FOR BRANCH ─────────────────────────────────
  //
  // تفريغ المحفظة هنا وحده. كان يُفرَّغ مرّتين — مرّة عند تبدُّل الفرع ومرّة عند
  // تبدُّل المستخدم الذي يتبعه — فتومض الشاشة فارغةً مرّتين قبل أن تمتلئ، وهو
  // ما يبدو للمستخدم «تفتح وتلغبط وتفتح». والشاشة تبقى على حالة التحميل حتى
  // تصل البيانات فعلًا بدل أن تعرض فراغًا ثم تعرض غيره.
  useEffect(() => {
    if (!canSelectBranch || !selectedBranch) return;
    setLoading(true);
    setWallet(null);
    setTransactions([]);
    setBranchUsers([]);
    api.get<any>(`/api/users?branch=${selectedBranch}`).then((data) => {
      // يُقرأ موظّفو الفرع للعرض وحدَه — «مَن يعمل على هذه المحفظة» — لا
      // لاختيار محفظةٍ منهم.
      const users = (data.users || data || []).filter((u: any) => ['operations_staff', 'operations_manager'].includes(u.role));
      setBranchUsers(users);
    }).catch(() => {
      // ── وتعذُّرُ قراءةٍ للزينة لا يُقال خطأً ─────────────────────────────
      // هذا السطرُ يعرض «مَن يعمل على هذه المحفظة» ولا شيءَ يتوقّف عليه.
      // والمحاسبُ لا يملك قراءةَ المستخدمين، فكان يُردّ ٤٠٣ فيُرفَع شريطُ
      // خطأٍ أحمرُ فوق عهدةٍ فُتحت وعُرضت كاملةً — يُقرأ «الصفحة فشلت» وهي
      // لم تفشل. وأسوأُ منه أنّه كان يُطفئ رايةَ التحميل قبل أوانها.
      setBranchUsers([]);
    });
  }, [canSelectBranch, selectedBranch]);

  // ─── FETCH WALLET ──────────────────────────────────────────
  const fetchWallet = useCallback(async (showSpinner = true) => {
    // ── يُختار الفرعُ وحدَه ─────────────────────────────────────────────────
    // كان يُختار الفرعُ ثمّ الموظّف، فلا تُقرأ محفظةٌ حتّى يُختار شخصٌ بعينه —
    // والنقدُ نقدُ الفرع يعمل عليه أكثرُ من موظّف. فالفرعُ يكفي.
    if (canSelectBranch && !selectedBranch) {
      setLoading(false);
      setWallet(null);
      setTransactions([]);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      let url = `/api/wallet/daily?date=${selectedDate}`;
      if (canSelectBranch && selectedBranch) url += `&branchId=${selectedBranch}`;
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
  }, [selectedDate, canSelectBranch, selectedBranch, lang]);

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
   * ── ما يكفي لتسجيل الحركة، في تعريفٍ واحد ─────────────────────────────────
   *
   * كان الشرطُ «لها مبلغٌ أكبرُ من صفر» مكتوبًا في ثلاثة مواضع: خانةُ المبلغ،
   * وتعطيلُ الزرّ، وحارسٌ صامتٌ في أوّل الدالّة. وقيدُ استلام الفواتير بلا
   * مبلغٍ بطبيعته — فصُحّح موضعان وبقي الثالث، فكان الزرُّ يعمل ولا يحدث شيء
   * عند الضغط: لا طلبَ ولا خطأَ ولا سبب.
   *
   * فالسؤالُ يُجاب مرّةً هنا، ويقرؤه الزرُّ والحارسُ معًا. ونوعٌ رابعٌ يُضاف
   * غدًا يُعرَّف شرطُه في سطرٍ واحدٍ لا في ثلاثة.
   */
  const canSubmitTx = txType === 'tax_invoice'
    ? (txForm.receivedReports.length > 0 || !!String(txForm.receivedDocNumber || '').trim())
    // ── والمشترياتُ لكشفٍ وُجد فعلًا، ولم يُشترَ من قبل ──────────────────────
    // لا يكفي أن يُكتب رقمٌ في الخانة: كُتب فيها رقمُ سيّارةٍ ورقمٌ عاديٌّ فمرّا،
    // فصار في الدفتر شراءٌ لكشفٍ لا وجودَ له. فالزرُّ لا يعمل حتى يُبحَث عن
    // الرقم ويظهر الكشف. والخادمُ يمنع أيضًا — الشاشةُ تُرشد وهو يمنع.
    : txType === 'purchase'
      ? (!!txForm.amount && Number(txForm.amount) > 0 && purchaseReportFound && !purchaseAlready)
      : (!!txForm.amount && Number(txForm.amount) > 0);

  /** يُضيف الكشفَ وسندَه زوجًا — ويُستدعى من الزرّ ومن مفتاح الإدخال معًا. */
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
        // ── وتُقيَّد الحركةُ على الفرع المعروض ──────────────────────────────
        // كانت الصفحةُ **تقرأ** عهدةَ الفرع المختار و**تكتب** بلا فرع، فيقع
        // القيدُ على فرع صاحب الحساب. ومَن لا فرعَ له — المحاسبةُ كلُّها — يُردّ
        // «لا يوجد فرع محدَّد لهذه الحركة» بعد أن ملأ النموذج كلَّه.
        //
        // ويُقرأ ويُكتب على الفرع نفسِه: ما تراه هو ما تكتب فيه.
        ...(selectedBranch ? { branchId: selectedBranch } : {}),
      };
      // Expected dispatch-sheet value for this transaction type (null = no lookup done).
      // ما بقي في خانة الكتابة ولم يُضَف بعد يُحسب: مَن كتب رقمًا وضغط «حفظ»
      // مباشرةً قصد إضافتَه — وإسقاطُه بصمتٍ يفقده كشفًا ظنّ أنّه سجّله.
      const pendingReport = String(txForm.receivedDocNumber || '').trim();
      const allPairs = [...txForm.receivedReports];
      if (pendingReport && !allPairs.some((x) => x.reportNumber === pendingReport)) {
        allPairs.push({ reportNumber: pendingReport, documentNumber: String(txForm.receivedDocSand || '').trim() });
      }
      if (txType === 'tax_invoice' && !allPairs.length) {
        setTxError(lang === 'ar' ? 'اكتب رقم كشف تخريج واحدًا على الأقل' : 'Enter at least one dispatch report number');
        setSubmitting(false);
        return;
      }
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
      if (txType === 'tax_invoice') {
        // بلا مبلغ: القيدُ يقول «استلمتُ»، ولا مالَ دخل ولا خرج.
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
      // ── ورقمٌ لم يُعرَف يُقال قبل إغلاق النافذة ──────────────────────────
      // القيدُ يُحفظ بكلّ ما كُتب، لكنّ رقمًا لا كشفَ له عندنا قد يكون خطأً
      // مطبعيًّا. وإغلاقُ النافذة بصمتٍ يجعل الموظّفَ يظنّ أنّ السبعةَ خُتمت
      // وقد خُتم منها خمسة.
      if (res?.unknownReports?.length) {
        setTxError(lang === 'ar'
          ? `حُفظ القيد — ولم نجد كشوفًا بهذه الأرقام: ${res.unknownReports.join('، ')}`
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

  // Search كشف التخريج for PURCHASES — pulls the driver, branch and purchase
  // price straight from the Operations Platform data and auto-fills them.
  const handlePurchaseReportSearch = async () => {
    if (!purchaseReportSearch.trim()) return;
    setPurchaseReportMsg('');
    setPurchaseReportFound(false);
    setPurchaseAlready(null);
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
      setPurchaseAlready(data.alreadyPurchased || null);
      setPurchaseReportMsg(`${txx.purchasePrice}: ${(data.purchaseValue || 0).toLocaleString()}`);
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
      setCollectionReportMsg(`${txx.foundSellingPrice}: ${(data.sellingValue || 0).toLocaleString()}`);
    } catch (err: any) {
      setCollectionReportFound(false);
      setCollectionReportMsg(err.message || txx.reportNotFound);
    }
  };

  // ── الملفُّ صورةُ الشاشة ───────────────────────────────────────────────────
  //
  // كان الجدولُ على الشاشة يعرض ستَّ عشرة خانة، والملفُّ يخرج بسبعٍ منها: لا
  // العميل ولا «من» و«إلى» ولا نوعُ السيّارة وطولُها ورقمُها ولا تاريخُ الكشف.
  // ومن يصدّر إنّما يصدّر ليُرسل أو ليراجع، فيرسل نصفَ ما رأى وهو يحسبه كلَّه.
  // فترويسةُ كلِّ عمودٍ هنا تُقرأ من `L` نفسِها التي تكتب ترويسةَ الشاشة، فلا
  // يفترقان بعدها لا في العدد ولا في التسمية.
  //
  // وهما كتلتان في ورقةٍ واحدة لا ورقتان: الملخّصُ فوق والحركاتُ تحته، كما
  // تُقرأ الصفحة. ورقتان في ملفٍّ تعنيان أنّ من يفتحه يرى نصفَ الصورة ولا
  // يدري أنّ نصفَها الآخرَ في لسانٍ ثانٍ.
  const dash = (v: any) => (v === 0 ? 0 : (v || ''));
  const opDetail = (k: 'client' | 'from' | 'to' | 'carType' | 'length' | 'carNumber') =>
    ({ header: L[k], key: 'operationDetails', transform: (v: any) => dash(v?.[k]), width: 18 });

  const walletSummaryColumns = [
    // المحفظةُ صارت للفرع: «المستخدم» لم يعد وصفًا ليوميّةٍ بل لحركة. راجع
    // models/DailyWallet.
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

  // «التفاصيل» على الشاشة سطورٌ مركَّبة في خانةٍ واحدة، فتُكتب كما تُعرض —
  // ومعها أعمدتُها المفردة، لأنّ الملفَّ يُفلتَر ويُجمَع والسطرُ المركَّب لا
  // يُفلتَر عليه.
  const detailsText = (tx: any) => {
    const parts: string[] = [];
    if (tx.type === 'collection' && tx.collectionSource === 'company') parts.push(L.fromCompany);
    if (tx.description) parts.push(tx.description);
    if (tx.customer) parts.push(`${tx.customer.companyName} (${tx.customer.customerNumber})`);
    if (tx.invoice) parts.push(`${txx.invoiceShort}: ${tx.invoice.invoiceNumber}`);
    if (tx.vendor || tx.vendorName) parts.push(`${L.vendor}: ${tx.vendor?.name || tx.vendorName}`);
    if (tx.driver || tx.driverName) parts.push(`${L.driver}: ${tx.driver?.name || tx.driverName}`);
    if (tx.expenseCategory) parts.push(`${L.category}: ${tx.expenseCategory.name}`);
    if (tx.itemName) parts.push(tx.itemName);
    if (tx.purchaseDriverName) parts.push(`${L.driver}: ${tx.purchaseDriverName}`);
    if (tx.purchaseReceiptNumber) parts.push(`${L.receipt}: ${tx.purchaseReceiptNumber}`);
    if (tx.type === 'tax_invoice') {
      const nums = (tx.receivedReportNumbers?.length ? tx.receivedReportNumbers : [tx.receivedDocNumber]).filter(Boolean);
      if (nums.length) parts.push(nums.join(' , '));
    }
    return parts.join(' | ');
  };

  const txColumns = [
    { header: ar ? 'التاريخ' : 'Date', key: 'date', transform: fmt.date, width: 12 },
    { header: L.time, key: 'createdAt', transform: (v: any) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''), width: 8 },
    { header: L.type, key: 'type', transform: (v: any) => (v ? typeLabel(v) : ''), width: 14 },
    // قيدُ الفاتورة الضريبيّة لا يمسّ الرصيد، والرقمُ فيه صفرٌ لا مبلغ —
    // فيُكتب كما يُقرأ على الشاشة لا كصفرٍ يُجمَع مع المال.
    { header: `${L.amount} (SAR)`, key: 'amount', transform: (v: any, row: any) => (row?.type === 'tax_invoice' ? (ar ? 'خارج الرصيد' : 'off-balance') : fmt.money(v)), width: 15 },
    { header: L.details, key: '_details', transform: (_v: any, row: any) => detailsText(row), width: 40 },
    { header: L.deliveryStatementNumber, key: 'deliveryStatementNumber', transform: (v: any, row: any) => dash(v || row?.purchaseDeliveryStatementNumber), width: 20 },
    { header: L.branch, key: 'purchaseBranch', transform: (v: any, row: any) => dash(v || row?.operationDetails?.branch), width: 16 },
    opDetail('client'),
    opDetail('from'),
    opDetail('to'),
    opDetail('carType'),
    opDetail('length'),
    opDetail('carNumber'),
    { header: L.reportDate, key: 'operationDetails', transform: (v: any) => (v?.reportDate ? new Date(v.reportDate).toLocaleDateString('en-GB') : ''), width: 14 },
    { header: L.notes, key: 'notes', width: 25 },
    // مَن سجّلها: المحفظةُ للفرع يعمل عليها أكثرُ من موظّف، فالملفُّ بلا اسمِ
    // الفاعل يقول ماذا جرى ولا يقول من فعل.
    { header: ar ? 'سجّلها' : 'Recorded by', key: 'user', transform: (v: any) => (v ? `${v.firstName || ''} ${v.lastName || ''}`.trim() : ''), width: 20 },
    // وما لا تسعه الشاشةُ عرضًا يسعه الملفّ — تفكيكُ «التفاصيل» إلى أعمدةٍ
    // يُفلتَر عليها ويُجمَع.
    { header: ar ? 'العميل (سجلّ)' : 'Customer (record)', key: 'customer', transform: (v: any) => (v ? `${v.companyName} (${v.customerNumber})` : ''), width: 25 },
    { header: ar ? 'رقم الفاتورة' : 'Invoice #', key: 'invoice', transform: (v: any) => v?.invoiceNumber || '', width: 15 },
    { header: ar ? 'قيمة الفاتورة (SAR)' : 'Invoice Amount (SAR)', key: 'invoice', transform: (v: any) => (v?.amount != null ? fmt.money(v.amount) : ''), width: 18 },
    { header: ar ? 'رصيد الفاتورة (SAR)' : 'Invoice Balance (SAR)', key: 'invoice', transform: (v: any) => (v?.balance != null ? fmt.money(v.balance) : ''), width: 18 },
    { header: ar ? 'كشوف الفاتورة الضريبيّة' : 'Received reports', key: 'receivedReportNumbers', transform: (v: any, row: any) => ((v?.length ? v : [row?.receivedDocNumber]).filter(Boolean).join(' , ')), width: 24 },
    { header: L.vendor, key: 'vendor', transform: (v: any, row: any) => v?.name || row?.vendorName || '', width: 18 },
    { header: L.driver, key: 'driver', transform: (v: any, row: any) => v?.name || row?.driverName || row?.purchaseDriverName || '', width: 18 },
    { header: L.category, key: 'expenseCategory', transform: (v: any) => v?.name || '', width: 18 },
    { header: L.itemDescription, key: 'itemName', transform: (v: any, row: any) => v || row?.description || '', width: 22 },
    { header: L.receipt, key: 'purchaseReceiptNumber', width: 15 },
    { header: ar ? 'مرجع' : 'Reference', key: 'reference', width: 15 },
    { header: ar ? 'مُعلَّمة' : 'Flagged', key: 'isFlagged', transform: fmt.yesNo, width: 10 },
  ];

  // ── التصديرُ بالزرّ الموحَّد ونطاقين ──────────────────────────────────────
  // كانت لهذه الشاشة نافذتُها الخاصّة: شكلٌ آخرُ لزرٍّ يحمل في تسعين شاشةً شكلًا
  // واحدًا، وخطوةٌ زائدةٌ قبل كلّ تصدير. والنطاقان هما ما يُطلب فعلًا: يومُ
  // الشاشة، أو الدفترُ كلُّه.
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
  const exportOptions = [
    {
      key: 'day',
      label: `${scope.shown} — ${selectedDate}`,
      sheets: oneSheet(selectedDate, (wallet ? [wallet] : []) as Record<string, any>[], transactions as unknown as Record<string, any>[]),
    },
    {
      key: 'all',
      label: scope.all,
      // يُجلب عند الضغط لا قبله — لا يُحمَّل الدفترُ كلُّه لمن لن يصدّر.
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
            <p className="text-slate-500 text-sm">
              {wallet?.branch?.name || L.selectBranch}
              {branchUsers.length > 0 && (
                <span className="text-slate-400"> — {lang === 'ar' ? `${branchUsers.length} موظفًا على هذه المحفظة` : `${branchUsers.length} staff on this wallet`}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canSelectBranch && (
            <>
              <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} title={L.selectBranch}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {allBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
              {/* منتقي الموظّف أُزيل: المحفظةُ للفرع. ومَن سجّل كلَّ حركةٍ
                  يظهر في سطرها — «نعرف مين الموظّف» تبقى، والرصيدُ يصير واحدًا. */}
            </>
          )}
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.selectDate} />
          <button type="button" onClick={() => setSelectedDate(getTodayStr())}
            className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{L.today}</button>
          <ExportMenu fileName={`Wallet_${branchNameForFile}_${selectedDate}`}
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
              {/* ── واسمُ الزرّ من موضعٍ واحد ────────────────────────────────
                  كان مكتوبًا هنا بيده وفي `TYPE_CONFIG` مرّةً أخرى. فلمّا
                  صُحّح الاسمُ في الخريطة بقي الزرُّ يقول «فاتورة ضريبية» —
                  والاسمُ في موضعين يُصحَّح في أحدهما ويُنسى في الآخر. */}
              <button type="button" onClick={() => openTxModal('tax_invoice')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-200/70 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300/70 transition-colors border border-slate-300">
                <Receipt className="w-4 h-4" /> {typeLabel('tax_invoice')}
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
                {/* ── ومَن سجّلها ────────────────────────────────────────────
                    المحفظةُ صارت للفرع يعمل عليها أكثرُ من موظّف، فالسطرُ هو
                    ما يقول مَن فعل. وبدونه يصير النقدُ المشتركُ بلا مسؤول. */}
                <th className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{lang === 'ar' ? 'سجّلها' : 'Recorded by'}</th>
                <th className="text-end text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{L.actions}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={16} className="text-center text-slate-800 py-12">{L.noTransactions}</td></tr>
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
                      <span className={`font-bold ${tx.type === 'tax_invoice' ? 'text-slate-500' : tx.type === 'collection' ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.type === 'tax_invoice' ? '' : tx.type === 'collection' ? '+' : '-'}
                        {tx.type === 'tax_invoice'
                          ? (lang === 'ar' ? 'خارج الرصيد' : 'off-balance')
                          : tx.amount.toLocaleString()}
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
                      {/* الكشوفُ المستلَمة في هذا القيد — وهي كلُّ محتواه. */}
                      {tx.type === 'tax_invoice' && (
                        <div className="flex flex-wrap gap-1">
                          {(tx.receivedReportNumbers?.length ? tx.receivedReportNumbers : [tx.receivedDocNumber]).filter((n): n is string => !!n).map((n) => (
                            <span key={n} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px]">{n}</span>
                          ))}
                        </div>
                      )}
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
                    {/* مَن سجّل الحركة — المحفظةُ للفرع والمسؤوليّةُ للشخص. */}
                    <td className="px-4 py-3 text-slate-800 text-xs whitespace-nowrap">
                      {(tx as any).user
                        ? `${(tx as any).user.firstName || ''} ${(tx as any).user.lastName || ''}`.trim() || '—'
                        : '—'}
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
                {/* ── والأنواعُ أربعةٌ في المختار كما هي في الأزرار ────────
                    كان الاستلامُ يُفتح من زرِّه وحدَه ولا يظهر بين الثلاثة في
                    النافذة، فمن فتحها على «تحصيل» لم يجد طريقًا إليه وأغلق
                    وبحث عنه في الصفحة. */}
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

                {/* ── والمبلغُ لا يُسأل عنه في قيد الاستلام ────────────────
                    لا مالَ في هذا القيد. وكانت الخانةُ تُعرَض مطلوبةً بنجمة،
                    فيقف الموظّفُ أمام سؤالٍ لا جوابَ له ويكتب صفرًا ليمرّ. */}
                {txType !== 'tax_invoice' && (
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

                {/* ── قيدُ استلام فاتورةٍ أو كشف ────────────────────────────
                    معلومةٌ لا حركةُ مال: تُقال صراحةً في الشاشة كي لا يظنّها
                    أحدٌ تحصيلًا ناقصًا. */}
                {txType === 'tax_invoice' && (
                  <>
                    <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-[12.5px] text-slate-600">
                      {lang === 'ar'
                        ? 'تسجيلُ استلام — تقول به إنّ كشوف هذه الفواتير صارت بيدك. لا مبلغَ فيه، ولا يدخل رصيدَ العهدة ولا إقفالَ اليوم.'
                        : 'A receipt record — it says these reports are now in your hands. No amount, and it does not touch the wallet balance or the day’s close.'}
                    </div>
                    {/* ── أرقامُ الكشوف، حزمةً ──────────────────────────────
                        المندوبُ يأتي بسبعةٍ فيسجّلها دفعةً. وقيدٌ لكلّ كشفٍ
                        يعني تكرارَ التاريخ والفرع سبعَ مرّات، ومَن يملّ يترك
                        الباقيَ بلا تسجيل. */}
                    <div>
                      <label className="text-slate-500 text-xs mb-1 block">
                        {lang === 'ar' ? 'أرقام كشوف التخريج' : 'Dispatch report numbers'} *
                      </label>
                      {/* ── ولكلّ كشفٍ سندُه ────────────────────────────────
                          يُكتبان معًا فيُحفظان زوجًا، ويصل السندُ عمودَه في
                          سير عمل التشغيل. وسندٌ واحدٌ يُنسَخ على الحزمة كلِّها
                          كان سيُنسَب سندَ كشفٍ إلى ستّةٍ غيره. */}
                      <div className="flex gap-2">
                        <input type="text" value={txForm.receivedDocNumber}
                          onChange={(e) => setTxForm((f) => ({ ...f, receivedDocNumber: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReceivedReport(); } }}
                          className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                          placeholder={lang === 'ar' ? 'رقم الكشف' : 'report number'} />
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
                          ? (lang === 'ar' ? `${txForm.receivedReports.length} كشفًا في هذا القيد` : `${txForm.receivedReports.length} reports in this record`)
                          : (lang === 'ar' ? 'يمكنك إضافة أكثر من كشف في القيد الواحد — ولكل كشف رقم سنده' : 'Add more than one report — each with its own voucher number')}
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
                      {purchaseAlready && (
                        <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                          <p className="text-[12.5px] font-bold text-red-800">
                            {lang === 'ar' ? 'هذا الكشف سُجِّلت له مشترياتٌ من قبل' : 'This report already has a purchase'}
                          </p>
                          <p className="text-[11.5px] text-red-700 mt-0.5">
                            {lang === 'ar'
                              ? `${purchaseAlready.amount.toLocaleString()} ريال بتاريخ ${purchaseAlready.date}`
                                + `${purchaseAlready.by ? ` — بواسطة ${purchaseAlready.by}` : ''}`
                                + `${purchaseAlready.receipt ? ` — سند ${purchaseAlready.receipt}` : ''}`
                              : `${purchaseAlready.amount.toLocaleString()} SAR on ${purchaseAlready.date}`
                                + `${purchaseAlready.by ? ` by ${purchaseAlready.by}` : ''}`}
                          </p>
                          <p className="text-[11px] text-red-600 mt-1">
                            {lang === 'ar' ? 'الكشف الواحد لا يُشترى مرّتين.' : 'A report cannot be purchased twice.'}
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
                      {/* يأتي من كشف التخريج، فلا يُعدَّل: بيانات الكشف مرتبطة برقمه،
                          وتعديلها هنا يجعل السجل يقول شيئًا والكشف يقول غيره — ولا
                          أحد يعرف أيّهما الصحيح بعد شهر. */}
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
                      {/* ── وخانةٌ واحدةٌ لرقم السند ──────────────────────────
                          هذه هي «رقم السند» وكانت موجودةً من قبل — تُحفظ في
                          العهدة ولا تخرج منها. فأُضيفت خانةٌ ثانيةٌ بالاسم
                          نفسِه لتصل الكشف، فصار في النموذج سؤالان متطابقان.
                          والصوابُ أن تصل هذه، لا أن تُستنسَخ. */}
                      <label className="text-slate-500 text-xs mb-1 block">
                        {L.receiptNumber}
                        <span className="text-slate-400 ms-1">{lang === 'ar' ? '— يُكتب في الكشف تلقائيًّا' : '— written onto the report'}</span>
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
                          ? 'اسم السائق والفرع مأخوذان من كشف التخريج ولا يُعدَّلان — إن كانا خطأً فالتصحيح في الكشف نفسه.'
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
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setShowTxModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{L.cancel}</button>
                  {/* ── ولا يُعطَّل الحفظُ بمبلغٍ لا يُطلَب ────────────────────
                      كان الشرطُ `!txForm.amount` على الأنواع كلِّها، وقيدُ
                      الاستلام بلا مبلغ — فكان الزرُّ مطفأً أبدًا ولا سبيلَ إلى
                      حفظه. يُختبَر ما يطلبه كلُّ نوعٍ لا ما يطلبه أكثرُها. */}
                  <button type="button" onClick={handleAddTransaction} disabled={submitting || !canSubmitTx}
                    className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
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
        {/* نافذةُ التصدير الخاصّة أُزيلت: صار الزرُّ الموحَّد الذي تحمله
            تسعون شاشةً، وبنطاقين — يومُ الشاشة أو الدفترُ كلُّه. راجع
            `exportOptions` أعلاه. */}
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
