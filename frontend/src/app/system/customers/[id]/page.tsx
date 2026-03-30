'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import StatCard from '@/components/system/StatCard';
import DataTable from '@/components/system/DataTable';
import {
  ArrowLeft, Building2, Mail, Phone, CreditCard, Shield, MapPin,
  FileText, DollarSign, Clock, AlertTriangle, TrendingUp, X,
  Calendar, CheckCircle, Activity, Lightbulb, Edit3, User, Download, FileSpreadsheet,
} from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getCustomersTranslations } from '@/lib/translations';

interface Customer {
  _id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  creditTerm: number;
  creditLimit: number;
  currentOutstanding: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  office: string;
  createdAt: string;
  customerNumber?: string;
  grade?: string;
  clientStatus?: string;
  salesManager?: string;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  isStopped?: boolean;
  assignedCollector?: { firstName: string; lastName: string };
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  amount: number;
  paidAmount: number;
  balance: number;
  status: string;
  dueDate: string;
  issueDate: string;
}

interface Payment {
  _id: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  invoice?: { _id: string; invoiceNumber: string };
  receivedBy?: { firstName: string; lastName: string };
  notes?: string;
}

interface CollectionActivity {
  _id: string;
  type: string;
  notes: string;
  date: string;
  result: string;
  collectedBy?: { firstName: string; lastName: string };
  contactType?: string;
  status?: string;
  amountCollected?: number;
  nextFollowUpDate?: string;
}

interface RiskAnalysis {
  riskScore: number;
  riskLevel: string;
  factors: { factor: string; score: number; weight: number; description: string }[];
}

interface FollowUpSuggestion {
  suggestedDate: string;
  priority: string;
  reason: string;
  recommendedAction: string;
}

interface CustomerSummary {
  totalInvoices: number;
  totalAmount: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueCount: number;
}

const riskBadge = (level: string, score?: number) => {
  const styles: Record<string, string> = {
    low: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    high: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize border ${styles[level] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {level}{score !== undefined ? ` (${score}%)` : ''}
    </span>
  );
};

const gradeBadge = (grade: string) => {
  const styles: Record<string, string> = {
    A: 'bg-green-500/20 text-green-400 border-green-500/30',
    B: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    C: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    D: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold capitalize border ${styles[grade] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      Grade {grade}
    </span>
  );
};

const clientStatusLabels: Record<string, string> = {
  good_client: 'Good Client',
  late_payment: 'Late Payment',
  stopped_by_us: 'Stopped by Us',
  stopped_by_client: 'Stopped by Client',
  under_review: 'Under Review',
  legal_action: 'Legal Action',
  write_off: 'Write Off',
  payment_plan: 'Payment Plan',
  new_client: 'New Client',
  vip_client: 'VIP Client',
};

const clientStatusStyles: Record<string, string> = {
  good_client: 'bg-green-500/20 text-green-400 border-green-500/30',
  late_payment: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  stopped_by_us: 'bg-red-500/20 text-red-400 border-red-500/30',
  stopped_by_client: 'bg-red-500/20 text-red-400 border-red-500/30',
  under_review: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  legal_action: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  write_off: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  payment_plan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  new_client: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  vip_client: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const clientStatusBadge = (status: string) => {
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${clientStatusStyles[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {clientStatusLabels[status] || status?.replace(/_/g, ' ') || '-'}
    </span>
  );
};

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    paid: 'bg-green-500/20 text-green-400',
    partial: 'bg-yellow-500/20 text-yellow-400',
    pending: 'bg-blue-500/20 text-blue-400',
    overdue: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${styles[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  );
};

const formatCurrency = (amount: number) =>
  'SAR ' + Math.round(amount || 0).toLocaleString('en-US');

const formatDate = (date: string) =>
  date ? new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getCustomersTranslations(lang);
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [collections, setCollections] = useState<CollectionActivity[]>([]);
  const [riskAnalysis, setRiskAnalysis] = useState<RiskAnalysis | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpSuggestion | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'collections'>('invoices');

  // Credit Term Edit Modal
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [newCreditTerm, setNewCreditTerm] = useState(30);
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditError, setCreditError] = useState('');

  // Statement date range
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');

  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  const fetchCustomer = useCallback(async () => {
    try {
      setError('');
      const data = await api.get<{ customer: Customer }>(`/api/customers/${customerId}`);
      setCustomer(data.customer);
      setNewCreditTerm(data.customer.creditTerm);
    } catch (err: any) {
      setError(err.message || 'Failed to load customer');
    }
  }, [customerId]);

  const fetchRelatedData = useCallback(async () => {
    try {
      const [invoiceRes, paymentRes, collectionRes] = await Promise.all([
        api.get<{ invoices: Invoice[] }>(`/api/invoices?customer=${customerId}`),
        api.get<{ payments: Payment[] }>(`/api/payments/customer/${customerId}`),
        api.get<{ collections: CollectionActivity[] }>(`/api/collections?customer=${customerId}`),
      ]);

      const invList = invoiceRes.invoices || [];
      setInvoices(invList);
      setPayments(paymentRes.payments || []);
      setCollections(collectionRes.collections || []);

      // Calculate summary from invoices
      const totalInvoices = invList.length;
      const totalAmount = invList.reduce((sum: number, inv: Invoice) => sum + (inv.amount || 0), 0);
      const totalPaid = invList.reduce((sum: number, inv: Invoice) => sum + (inv.paidAmount || 0), 0);
      const totalOutstanding = invList.reduce((sum: number, inv: Invoice) => sum + (inv.balance || 0), 0);
      const overdueCount = invList.filter((inv: Invoice) => inv.status === 'overdue').length;
      setSummary({ totalInvoices, totalAmount, totalPaid, totalOutstanding, overdueCount });
    } catch (err) {
      console.error('Failed to load related data:', err);
    }
  }, [customerId]);

  const fetchRiskAndFollowUp = useCallback(async () => {
    try {
      const [riskRes, followUpRes] = await Promise.allSettled([
        api.get<RiskAnalysis>(`/api/analytics/risk/${customerId}`),
        api.get<FollowUpSuggestion>(`/api/analytics/predictions/follow-up/${customerId}`),
      ]);

      if (riskRes.status === 'fulfilled') setRiskAnalysis(riskRes.value);
      if (followUpRes.status === 'fulfilled') setFollowUp(followUpRes.value);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  }, [customerId]);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await fetchCustomer();
      await Promise.all([fetchRelatedData(), fetchRiskAndFollowUp()]);
      setLoading(false);
    };
    loadAll();
  }, [fetchCustomer, fetchRelatedData, fetchRiskAndFollowUp]);

  // Real-time updates
  useSocket('customer:updated', fetchCustomer);
  useSocket('invoice:created', fetchRelatedData);
  useSocket('invoice:updated', fetchRelatedData);
  useSocket('payment:logged', fetchRelatedData);
  useSocket('invoice:deleted', fetchRelatedData);
  useSocket('payment:deleted', fetchRelatedData);

  const handleCreditTermUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (![15, 30, 45, 60].includes(newCreditTerm)) return;

    setCreditSubmitting(true);
    setCreditError('');

    try {
      await api.put(`/api/customers/${customerId}/credit-term`, { creditTerm: newCreditTerm });
      setShowCreditModal(false);
      fetchCustomer();
    } catch (err: any) {
      setCreditError(err.message || 'Failed to update credit term');
    } finally {
      setCreditSubmitting(false);
    }
  };

  const handleExportCustomerDetails = () => {
    if (!customer) return;

    const customerInfoColumns = [
      { header: 'Field', key: 'field', width: 22 },
      { header: 'Value', key: 'value', width: 35 },
    ];
    const customerInfoData = [
      { field: 'Customer Number', value: customer.customerNumber || '-' },
      { field: 'Company Name', value: customer.companyName },
      { field: 'Contact Person', value: customer.contactPerson },
      { field: 'Email', value: customer.email },
      { field: 'Phone', value: customer.phone },
      { field: 'Office', value: customer.office || '-' },
      { field: 'Sales Manager', value: customer.salesManager || '-' },
      { field: 'Grade', value: customer.grade || '-' },
      { field: 'Client Status', value: customer.clientStatus ? (clientStatusLabels[customer.clientStatus] || customer.clientStatus.replace(/_/g, ' ')) : '-' },
      { field: 'Credit Term', value: `${customer.creditTerm} days` },
      { field: 'Credit Limit (SAR)', value: fmt.money(customer.creditLimit) },
      { field: 'Outstanding (SAR)', value: fmt.money(customer.currentOutstanding) },
      { field: 'Risk Level', value: `${customer.riskLevel} (${customer.riskScore}%)` },
      { field: 'Stopped', value: customer.isStopped ? 'Yes' : 'No' },
      { field: 'Customer Since', value: fmt.date(customer.createdAt) },
      { field: 'Last Payment Date', value: fmt.date(customer.lastPaymentDate || '') },
      { field: 'Last Payment Amount (SAR)', value: customer.lastPaymentAmount != null ? fmt.money(customer.lastPaymentAmount) : '-' },
      { field: 'Assigned Collector', value: customer.assignedCollector ? `${customer.assignedCollector.firstName} ${customer.assignedCollector.lastName}` : '-' },
    ];

    const invoiceExportColumns = [
      { header: 'Invoice #', key: 'invoiceNumber', width: 16 },
      { header: 'Amount (SAR)', key: 'amount', transform: fmt.money, width: 16 },
      { header: 'Paid (SAR)', key: 'paidAmount', transform: fmt.money, width: 16 },
      { header: 'Balance (SAR)', key: 'balance', transform: fmt.money, width: 16 },
      { header: 'Status', key: 'status', transform: fmt.status, width: 14 },
      { header: 'Issue Date', key: 'issueDate', transform: fmt.date, width: 14 },
      { header: 'Due Date', key: 'dueDate', transform: fmt.date, width: 14 },
    ];

    const paymentExportColumns = [
      { header: 'Payment Date', key: 'paymentDate', transform: fmt.date, width: 16 },
      { header: 'Amount (SAR)', key: 'amount', transform: fmt.money, width: 16 },
      { header: 'Method', key: 'paymentMethod', transform: (v: string) => v?.replace(/_/g, ' ') || '-', width: 18 },
      { header: 'Invoice #', key: 'invoice', transform: (_: any, row: Payment) => row.invoice?.invoiceNumber || '-', width: 16 },
      { header: 'Collected By', key: 'receivedBy', transform: (_: any, row: Payment) => row.receivedBy ? `${row.receivedBy.firstName} ${row.receivedBy.lastName}` : '-', width: 22 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];

    const safeName = customer.companyName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 30);
    const today = new Date().toISOString().split('T')[0];

    exportMultiSheet(
      [
        { name: 'Customer Info', data: customerInfoData, columns: customerInfoColumns },
        { name: 'Invoices', data: invoices, columns: invoiceExportColumns },
        { name: 'Payments', data: payments, columns: paymentExportColumns },
      ],
      `Customer_${safeName}_Details_${today}`
    );
  };

  const handleDownloadStatement = async () => {
    try {
      const dateQuery = statementFrom && statementTo
        ? `?dateFrom=${statementFrom}&dateTo=${statementTo}`
        : '';
      const res = await fetch(`/api/customers/${customerId}/statement${dateQuery}`, { credentials: 'include' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${customer?.companyName || customerId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silent fail for download
    }
  };

  const invoiceColumns = [
    { key: 'invoiceNumber', label: 'Invoice #', sortable: true },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (value: number) => <span className="text-white font-medium">{formatCurrency(value)}</span>,
    },
    {
      key: 'paidAmount',
      label: 'Paid',
      sortable: true,
      render: (value: number) => <span className="text-green-400">{formatCurrency(value)}</span>,
    },
    {
      key: 'balance',
      label: 'Balance',
      sortable: true,
      render: (value: number) => (
        <span className={value > 0 ? 'text-red-400 font-medium' : 'text-green-400'}>{formatCurrency(value)}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (value: string) => statusBadge(value),
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      sortable: true,
      render: (value: string) => formatDate(value),
    },
  ];

  const paymentColumns = [
    {
      key: 'paymentDate',
      label: 'Date',
      sortable: true,
      render: (value: string) => formatDate(value),
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (value: number) => <span className="text-green-400 font-medium">{formatCurrency(value)}</span>,
    },
    {
      key: 'paymentMethod',
      label: 'Method',
      sortable: true,
      render: (value: string) => (
        <span className="capitalize">{value?.replace(/_/g, ' ') || '-'}</span>
      ),
    },
    {
      key: 'invoice',
      label: 'Invoice #',
      sortable: false,
      render: (_: any, row: Payment) => row.invoice?.invoiceNumber || '-',
    },
    {
      key: 'receivedBy',
      label: 'Collected By',
      sortable: false,
      render: (_: any, row: Payment) =>
        row.receivedBy ? `${row.receivedBy.firstName} ${row.receivedBy.lastName}` : '-',
    },
    {
      key: 'notes',
      label: 'Notes',
      sortable: false,
      render: (value: string) => value || '-',
    },
  ];

  const collectionColumns = [
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      render: (value: string) => formatDate(value),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      render: (value: string) => (
        <span className="capitalize">{value?.replace(/_/g, ' ') || '-'}</span>
      ),
    },
    { key: 'notes', label: 'Notes', sortable: false },
    {
      key: 'result',
      label: 'Result',
      sortable: true,
      render: (value: string) => (
        <span className="capitalize">{value?.replace(/_/g, ' ') || '-'}</span>
      ),
    },
    {
      key: 'collectedBy',
      label: 'Agent',
      sortable: false,
      render: (_: any, row: CollectionActivity) =>
        row.collectedBy ? `${row.collectedBy.firstName} ${row.collectedBy.lastName}` : '-',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !customer) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/system/customers')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {T.back} {T.title}
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Back Button & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/system/customers')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#f37121]/20 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-[#f37121]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{customer.companyName}</h1>
                {customer.customerNumber && (
                  <span className="text-sm text-gray-400">({customer.customerNumber})</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <span className="text-gray-400 text-sm flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {customer.office || 'No office'}
                </span>
                <span className="text-gray-600">|</span>
                {riskBadge(customer.riskLevel, customer.riskScore)}
                {customer.grade && (
                  <>
                    <span className="text-gray-600">|</span>
                    {gradeBadge(customer.grade)}
                  </>
                )}
                {customer.clientStatus && (
                  <>
                    <span className="text-gray-600">|</span>
                    {clientStatusBadge(customer.clientStatus)}
                  </>
                )}
                {customer.isStopped && (
                  <>
                    <span className="text-gray-600">|</span>
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-red-500/20 text-red-400 border-red-500/30">
                      STOPPED
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            aria-label="Statement from date"
            value={statementFrom}
            onChange={(e) => setStatementFrom(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:dark]"
          />
          <input
            type="date"
            aria-label="Statement to date"
            value={statementTo}
            onChange={(e) => setStatementTo(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:dark]"
          />
          <button
            type="button"
            onClick={handleDownloadStatement}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-sm hover:bg-gray-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
          <button
            type="button"
            onClick={handleExportCustomerDetails}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-sm hover:bg-gray-700 transition-colors"
            title="Export to Excel"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {T.downloadExcel}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setNewCreditTerm(customer.creditTerm); setCreditError(''); setShowCreditModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-sm hover:bg-gray-700 transition-colors"
            >
              <Edit3 className="w-4 h-4" />
              {T.edit} {T.creditTerm}
            </button>
          )}
        </div>
      </div>

      {/* Customer Info Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-gray-800 border border-gray-700 rounded-xl p-6"
      >
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-[#f37121]" />
          {T.title}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-start gap-3">
            <User className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.contactPerson}</p>
              <p className="text-sm text-white">{customer.contactPerson}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Mail className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.email}</p>
              <p className="text-sm text-white break-all">{customer.email}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.phone}</p>
              <p className="text-sm text-white">{customer.phone}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.office}</p>
              <p className="text-sm text-white">{customer.office || '-'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CreditCard className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.creditTerm}</p>
              <p className="text-sm text-white">{customer.creditTerm} days</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Shield className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.creditLimit}</p>
              <p className="text-sm text-white">{formatCurrency(customer.creditLimit)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.createdAt}</p>
              <p className="text-sm text-white">{formatDate(customer.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{T.riskLevel}</p>
              <div className="mt-0.5">{riskBadge(customer.riskLevel, customer.riskScore)}</div>
            </div>
          </div>
          {customer.customerNumber && (
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{T.customerNumber}</p>
                <p className="text-sm text-white">{customer.customerNumber}</p>
              </div>
            </div>
          )}
          {customer.salesManager && (
            <div className="flex items-start gap-3">
              <User className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{T.salesManager}</p>
                <p className="text-sm text-white">{customer.salesManager}</p>
              </div>
            </div>
          )}
          {customer.grade && (
            <div className="flex items-start gap-3">
              <TrendingUp className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{T.grade}</p>
                <div className="mt-0.5">{gradeBadge(customer.grade)}</div>
              </div>
            </div>
          )}
          {customer.clientStatus && (
            <div className="flex items-start gap-3">
              <Activity className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{T.clientStatus}</p>
                <div className="mt-0.5">{clientStatusBadge(customer.clientStatus)}</div>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Summary Cards */}
      {summary && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4"
        >
          <StatCard title={T.invoices} value={summary.totalInvoices} icon={FileText} />
          <StatCard title={T.amount} value={formatCurrency(summary.totalAmount)} icon={DollarSign} color="#6366f1" />
          <StatCard title={T.totalPaid} value={formatCurrency(summary.totalPaid)} icon={CheckCircle} color="#10b981" />
          <StatCard title={T.currentOutstanding} value={formatCurrency(summary.totalOutstanding)} icon={Clock} color="#ef4444" />
          <StatCard title={T.overdueDays} value={summary.overdueCount} icon={AlertTriangle} color="#f59e0b" />
          {customer?.creditLimit > 0 && (
            <StatCard
              title={T.creditLimit}
              value={`${Math.round(((customer?.currentOutstanding || 0) / customer.creditLimit) * 100)}%`}
              icon={Shield}
              color={(customer?.currentOutstanding || 0) > customer.creditLimit ? '#ef4444' : (customer?.currentOutstanding || 0) / customer.creditLimit >= 0.8 ? '#f59e0b' : '#10b981'}
            />
          )}
        </motion.div>
      )}

      {/* Follow-up Suggestion */}
      {followUp && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-[#f37121]/5 border border-[#f37121]/30 rounded-xl p-5"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#f37121]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Lightbulb className="w-4 h-4 text-[#f37121]" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm">{T.overview}</h3>
              <p className="text-gray-300 text-sm mt-1">{followUp.recommendedAction}</p>
              <div className="flex flex-wrap gap-4 mt-3">
                <span className="text-xs text-gray-400">
                  Suggested Date: <span className="text-white">{formatDate(followUp.suggestedDate)}</span>
                </span>
                <span className="text-xs text-gray-400">
                  Priority: <span className={`font-medium capitalize ${followUp.priority === 'high' ? 'text-red-400' : followUp.priority === 'medium' ? 'text-yellow-400' : 'text-green-400'}`}>{followUp.priority}</span>
                </span>
                <span className="text-xs text-gray-400">
                  Reason: <span className="text-white">{followUp.reason}</span>
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-xl p-1 w-fit">
          {[
            { key: 'invoices' as const, label: T.invoices, icon: FileText, count: invoices.length },
            { key: 'payments' as const, label: T.payments, icon: DollarSign, count: payments.length },
            { key: 'collections' as const, label: T.collections, icon: Activity, count: collections.length },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-[#f37121] text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-700 text-gray-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <AnimatePresence mode="wait">
            {activeTab === 'invoices' && (
              <motion.div
                key="invoices"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <DataTable
                  columns={invoiceColumns}
                  data={invoices}
                  searchable
                  searchPlaceholder="Search invoices..."
                  onRowClick={(row) => router.push(`/system/invoices/${row._id}`)}
                  emptyMessage={T.noInvoices}
                />
              </motion.div>
            )}
            {activeTab === 'payments' && (
              <motion.div
                key="payments"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <DataTable
                  columns={paymentColumns}
                  data={payments}
                  searchable
                  searchPlaceholder="Search payments..."
                  emptyMessage={T.noPayments}
                />
              </motion.div>
            )}
            {activeTab === 'collections' && (
              <motion.div
                key="collections"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <DataTable
                  columns={collectionColumns}
                  data={collections}
                  searchable
                  searchPlaceholder="Search collection activities..."
                  emptyMessage={T.noActivity}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Risk Analysis Section */}
      {riskAnalysis && riskAnalysis.factors && riskAnalysis.factors.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-gray-800 border border-gray-700 rounded-xl p-6"
        >
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#f37121]" />
            {T.riskLevel}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Overall Risk Score</p>
              <p className="text-3xl font-bold text-white mt-1">{riskAnalysis.riskScore}%</p>
              <div className="mt-1">{riskBadge(riskAnalysis.riskLevel)}</div>
            </div>
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Risk Factors</p>
              <p className="text-3xl font-bold text-white mt-1">{riskAnalysis.factors.length}</p>
              <p className="text-xs text-gray-400 mt-1">Contributing factors</p>
            </div>
          </div>

          <div className="space-y-3">
            {riskAnalysis.factors.map((factor, index) => (
              <div key={index} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-white font-medium capitalize">
                    {factor.factor.replace(/_/g, ' ')}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      Weight: {(factor.weight * 100).toFixed(0)}%
                    </span>
                    <span className={`text-sm font-bold ${
                      factor.score >= 70 ? 'text-red-400' :
                      factor.score >= 40 ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {factor.score}%
                    </span>
                  </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      factor.score >= 70 ? 'bg-red-500' :
                      factor.score >= 40 ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(factor.score, 100)}%` }}
                  />
                </div>
                {factor.description && (
                  <p className="text-xs text-gray-400 mt-2">{factor.description}</p>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Edit Credit Term Modal */}
      <AnimatePresence>
        {showCreditModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreditModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-[#f37121]" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">{T.edit} {T.creditTerm}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreditModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleCreditTermUpdate} className="p-6 space-y-4">
                {creditError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-red-400 text-sm">{creditError}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Current Credit Term: <span className="text-[#f37121] font-bold">{customer.creditTerm} days</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">{T.creditTerm}</label>
                  <select
                    value={newCreditTerm}
                    onChange={(e) => setNewCreditTerm(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value={15}>15 Days</option>
                    <option value={30}>30 Days</option>
                    <option value={45}>45 Days</option>
                    <option value={60}>60 Days</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                  <button
                    type="button"
                    onClick={() => setShowCreditModal(false)}
                    className="px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
                  >
                    {T.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={creditSubmitting || newCreditTerm === customer.creditTerm}
                    className="px-6 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {creditSubmitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {T.save}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
