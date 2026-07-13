'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getCustomersTranslations, getCustomersExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import DataTable from '@/components/system/DataTable';
import {
  Plus, X, Users, AlertTriangle, Building2, Filter, ChevronDown, Trash2, Eye, EyeOff, Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

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
  customerNumber?: string;
  grade?: string;
  clientStatus?: string;
  salesManager?: string;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  isStopped?: boolean;
  assignedCollector?: { firstName: string; lastName: string };
}

interface CustomerForm {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  creditTerm: number;
  creditLimit: number;
  office: string;
  customerNumber: string;
  salesManager: string;
  grade: string;
  clientStatus: string;
  clientEmail: string;
  password: string;
}

const emptyForm: CustomerForm = {
  companyName: '',
  contactPerson: '',
  email: '',
  phone: '',
  creditTerm: 30,
  creditLimit: 0,
  office: '',
  customerNumber: '',
  salesManager: '',
  grade: 'A',
  clientStatus: 'new_client',
  clientEmail: '',
  password: '',
};

const riskBadge = (level: string, T: Record<string, string>) => {
  const styles: Record<string, string> = {
    low: 'bg-green-500/20 text-green-600',
    medium: 'bg-yellow-500/20 text-yellow-700',
    high: 'bg-red-500/20 text-red-600',
  };
  const labels: Record<string, string> = { low: T.low, medium: T.medium, high: T.high };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${styles[level] || 'bg-slate-500/20 text-slate-500'}`}>
      {labels[level] || level}
    </span>
  );
};

const gradeBadge = (grade: string) => {
  const styles: Record<string, string> = {
    A: 'bg-green-500/20 text-green-600',
    B: 'bg-blue-500/20 text-blue-600',
    C: 'bg-yellow-500/20 text-yellow-700',
    D: 'bg-red-500/20 text-red-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${styles[grade] || 'bg-slate-500/20 text-slate-500'}`}>
      {grade}
    </span>
  );
};

const getClientStatusLabels = (T: Record<string, string>): Record<string, string> => ({
  good_client: T.activeClient,
  late_payment: T.pending,
  stopped_by_us: T.stopped,
  stopped_by_client: T.stopped,
  under_review: T.onHold,
  legal_action: T.blacklisted,
  write_off: T.closed,
  payment_plan: T.pending,
  new_client: T.newClient,
  vip_client: T.vip,
});

const clientStatusStyles: Record<string, string> = {
  good_client: 'bg-green-500/20 text-green-600',
  late_payment: 'bg-yellow-500/20 text-yellow-700',
  stopped_by_us: 'bg-red-500/20 text-red-600',
  stopped_by_client: 'bg-red-500/20 text-red-600',
  under_review: 'bg-blue-500/20 text-blue-600',
  legal_action: 'bg-purple-500/20 text-purple-600',
  write_off: 'bg-slate-500/20 text-slate-500',
  payment_plan: 'bg-cyan-500/20 text-cyan-700',
  new_client: 'bg-indigo-500/20 text-indigo-600',
  vip_client: 'bg-amber-500/20 text-amber-700',
};

const clientStatusBadge = (status: string, T: Record<string, string>) => {
  const labels = getClientStatusLabels(T);
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${clientStatusStyles[status] || 'bg-slate-500/20 text-slate-500'}`}>
      {labels[status] || status?.replace(/_/g, ' ') || '-'}
    </span>
  );
};

const formatCurrency = (amount: number) =>
  'SAR ' + Math.round(amount || 0).toLocaleString('en-US');

const formatDate = (date: string) =>
  date ? new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

export default function CustomersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getCustomersTranslations(lang);
  const txx = getCustomersExtraTranslations(lang);
  const clientStatusLabels = getClientStatusLabels(T);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [officeFilter, setOfficeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [creditTermFilter, setCreditTermFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CustomerForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showClientPassword, setShowClientPassword] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';

  const fetchCustomers = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams();
      if (officeFilter) params.append('office', officeFilter);
      if (riskFilter) params.append('riskLevel', riskFilter);
      if (creditTermFilter) params.append('creditTerm', creditTermFilter);
      if (gradeFilter) params.append('grade', gradeFilter);
      if (clientStatusFilter) params.append('clientStatus', clientStatusFilter);
      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<{ customers: Customer[] }>(`/api/customers${query}`);
      setCustomers(data.customers || []);
    } catch (err: any) {
      setError(err.message || txx.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [officeFilter, riskFilter, creditTermFilter, gradeFilter, clientStatusFilter]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Real-time updates
  useSocket('customer:created', fetchCustomers);
  useSocket('customer:updated', fetchCustomers);
  useSocket('customer:stopped', fetchCustomers);
  useSocket('customer:deleted', fetchCustomers);

  // Derive unique offices for filter dropdown
  const offices = Array.from(new Set(customers.map((c) => c.office).filter(Boolean))).sort();

  const validateForm = (): boolean => {
    const errors: Partial<Record<keyof CustomerForm, string>> = {};

    if (!form.companyName.trim()) errors.companyName = txx.companyNameRequired;
    if (!form.contactPerson.trim()) errors.contactPerson = txx.contactPersonRequired;
    if (!form.email.trim()) {
      errors.email = txx.emailRequired;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = txx.invalidEmail;
    }
    if (!form.phone.trim()) {
      errors.phone = txx.phoneRequired;
    } else if (!/^[\d\s+\-()]{7,20}$/.test(form.phone)) {
      errors.phone = txx.invalidPhone;
    }
    if (![15, 30, 45, 60].includes(form.creditTerm)) errors.creditTerm = txx.invalidCreditTerm;
    if (!form.creditLimit || form.creditLimit <= 0) errors.creditLimit = txx.creditLimitPositive;

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const openCreateModal = () => {
    setEditingCustomer(null);
    setForm(emptyForm);
    setFormErrors({});
    setSubmitError('');
    setShowClientPassword(false);
    setShowModal(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setForm({
      companyName: customer.companyName,
      contactPerson: customer.contactPerson,
      email: customer.email,
      phone: customer.phone,
      creditTerm: customer.creditTerm,
      creditLimit: customer.creditLimit,
      office: customer.office || '',
      customerNumber: customer.customerNumber || '',
      salesManager: customer.salesManager || '',
      grade: customer.grade || 'A',
      clientStatus: customer.clientStatus || 'new_client',
      clientEmail: '',
      password: '',
    });
    setFormErrors({});
    setSubmitError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setSubmitError('');

    try {
      const payload: any = {
        companyName: form.companyName,
        contactPerson: form.contactPerson,
        email: form.email,
        phone: form.phone,
        creditTerm: form.creditTerm,
        creditLimit: form.creditLimit,
        office: form.office,
        customerNumber: form.customerNumber,
        salesManager: form.salesManager,
        grade: form.grade,
        clientStatus: form.clientStatus,
      };

      if (!editingCustomer && form.clientEmail && form.password) {
        payload.username = form.clientEmail;
        payload.password = form.password;
      }

      if (editingCustomer) {
        await api.put(`/api/customers/${editingCustomer._id}`, payload);
      } else {
        await api.post('/api/customers', payload);
      }
      setShowModal(false);
      fetchCustomers();
    } catch (err: any) {
      setSubmitError(err.message || txx.failedToSave);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStopCustomer = async (customerId: string) => {
    try {
      await api.post(`/api/customers/${customerId}/stop`, {});
      fetchCustomers();
    } catch (err: any) {
      console.error('Failed to stop customer:', err);
    }
  };

  const handleUnstopCustomer = async (customerId: string) => {
    try {
      await api.post(`/api/customers/${customerId}/unstop`, {});
      fetchCustomers();
    } catch (err: any) {
      console.error('Failed to unstop customer:', err);
    }
  };

  const handleDeleteCustomer = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/customers/${deleteTarget._id}`);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      fetchCustomers();
    } catch (err: any) {
      setError(err.message || txx.failedToDelete);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExportCustomers = () => {
    if (customers.length === 0) return;
    const columns = [
      { header: T.customerNumber, key: 'customerNumber', width: 16 },
      { header: T.companyName, key: 'companyName', width: 30 },
      { header: T.contactPerson, key: 'contactPerson', width: 22 },
      { header: T.email, key: 'email', width: 28 },
      { header: T.phone, key: 'phone', width: 18 },
      { header: T.office, key: 'office', width: 16 },
      { header: T.salesManager, key: 'salesManager', width: 20 },
      { header: T.grade, key: 'grade', width: 10 },
      { header: T.clientStatus, key: 'clientStatus', transform: (v: string) => clientStatusLabels[v] || v?.replace(/_/g, ' ') || '', width: 20 },
      { header: T.creditTerm, key: 'creditTerm', width: 18 },
      { header: T.creditLimit, key: 'creditLimit', transform: fmt.money, width: 20 },
      { header: T.currentOutstanding, key: 'currentOutstanding', transform: fmt.money, width: 20 },
      { header: T.riskLevel, key: 'riskLevel', transform: fmt.status, width: 14 },
      { header: T.riskScore, key: 'riskScore', width: 12 },
      { header: T.lastPaymentDate, key: 'lastPaymentDate', transform: fmt.date, width: 18 },
      { header: T.lastPaymentAmount, key: 'lastPaymentAmount', transform: fmt.money, width: 24 },
      { header: T.stopped, key: 'isStopped', transform: fmt.yesNo, width: 10 },
      { header: T.assignedCollector, key: 'assignedCollector', transform: (_: any, row: Customer) => row.assignedCollector ? `${row.assignedCollector.firstName} ${row.assignedCollector.lastName}` : '', width: 22 },
    ];
    const today = new Date().toISOString().split('T')[0];
    exportToExcel(customers, columns, `${T.customers}_${today}`, T.customers);
  };

  const updateField = (field: keyof CustomerForm, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const columns = [
    {
      key: 'customerNumber',
      label: T.customerNumber,
      sortable: true,
      render: (value: string) => (
        <span className="text-slate-900 font-medium">{value || '-'}</span>
      ),
    },
    {
      key: 'companyName',
      label: T.companyName,
      sortable: true,
      render: (value: string) => (
        <span className="text-slate-900 font-medium">{value}</span>
      ),
    },
    {
      key: 'grade',
      label: T.grade,
      sortable: true,
      render: (value: string) => value ? gradeBadge(value) : '-',
    },
    {
      key: 'clientStatus',
      label: T.status,
      sortable: true,
      render: (value: string) => value ? clientStatusBadge(value, T) : '-',
    },
    {
      key: 'salesManager',
      label: T.salesManager,
      sortable: true,
      render: (value: string) => value || '-',
    },
    {
      key: 'office',
      label: T.office,
      sortable: true,
      render: (value: string) => value || '-',
    },
    {
      key: 'creditTerm',
      label: T.creditTerm,
      sortable: true,
      render: (value: number) => <span>{value}</span>,
    },
    {
      key: 'lastPaymentDate',
      label: T.lastPaymentDate,
      sortable: true,
      render: (value: string) => (
        <span className="text-slate-900 text-sm">{value ? formatDate(value) : '-'}</span>
      ),
    },
    {
      key: 'lastPaymentAmount',
      label: T.lastPaymentAmount,
      sortable: true,
      render: (value: number) => (
        <span className="text-slate-900 text-sm">{value !== undefined && value !== null ? formatCurrency(value) : '-'}</span>
      ),
    },
    {
      key: 'currentOutstanding',
      label: T.currentOutstanding,
      sortable: true,
      render: (value: number) => (
        <span className={value > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
          {formatCurrency(value)}
        </span>
      ),
    },
    {
      key: 'riskLevel',
      label: T.riskLevel,
      sortable: true,
      render: (value: string) => riskBadge(value, T),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{customers.length} {T.customers}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCustomers}
            disabled={customers.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 text-sm hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={T.downloadExcel}
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 text-sm hover:bg-slate-100 transition-colors"
          >
            <Filter className="w-4 h-4" />
            {T.search}
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          {isAdmin && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] rounded-lg text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {T.addCustomer}
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{T.office}</label>
                  <select
                    value={officeFilter}
                    onChange={(e) => setOfficeFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.office}</option>
                    {offices.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{T.riskLevel}</label>
                  <select
                    value={riskFilter}
                    onChange={(e) => setRiskFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.riskLevel}</option>
                    <option value="low">{T.low}</option>
                    <option value="medium">{T.medium}</option>
                    <option value="high">{T.high}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{T.creditTerm}</label>
                  <select
                    value={creditTermFilter}
                    onChange={(e) => setCreditTermFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.creditTerm}</option>
                    <option value="15">15</option>
                    <option value="30">30</option>
                    <option value="45">45</option>
                    <option value="60">60</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{T.grade}</label>
                  <select
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.grade}</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{T.clientStatus}</label>
                  <select
                    value={clientStatusFilter}
                    onChange={(e) => setClientStatusFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                  >
                    <option value="">{T.clientStatus}</option>
                    {Object.entries(clientStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(officeFilter || riskFilter || creditTermFilter || gradeFilter || clientStatusFilter) && (
                <button
                  onClick={() => { setOfficeFilter(''); setRiskFilter(''); setCreditTermFilter(''); setGradeFilter(''); setClientStatusFilter(''); }}
                  className="mt-3 text-xs text-[#f37121] hover:text-[#e0611a] transition-colors"
                >
                  {T.search}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Data Table */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-50 border border-slate-200 rounded-xl p-4"
      >
        <DataTable
          columns={columns}
          data={customers}
          searchable
          searchPlaceholder={T.searchCustomers}
          onRowClick={(row) => router.push(`/system/customers/${row._id}`)}
          emptyMessage={T.noCustomers}
          actions={isAdmin ? (row) => (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); openEditModal(row); }}
                className="text-xs text-[#f37121] hover:text-[#e0611a] font-medium transition-colors"
              >
                {T.edit}
              </button>
              {row.isStopped ? (
                <button
                  onClick={(e) => { e.stopPropagation(); handleUnstopCustomer(row._id); }}
                  className="text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
                >
                  {T.notStopped}
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); handleStopCustomer(row._id); }}
                  className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors"
                >
                  {T.stopped}
                </button>
              )}
              {isSuperAdmin && (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); setShowDeleteConfirm(true); }}
                  className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  {T.delete}
                </button>
              )}
            </div>
          ) : undefined}
        />
      </motion.div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="p-6 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.deleteCustomer}</h3>
                  <p className="text-slate-500 text-sm mt-2">
                    {T.deleteConfirmGeneric} <span className="text-slate-900 font-medium">{deleteTarget.companyName}</span>
                  </p>
                </div>
                {error && <p className="text-red-600 text-sm">{error}</p>}
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                    className="px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm hover:bg-slate-100 transition-colors"
                  >
                    {T.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCustomer}
                    disabled={deleteLoading}
                    className="px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {deleteLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {T.delete}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-[#f37121]" />
                  </div>
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-semibold text-white mb-3">
                    {editingCustomer ? T.editCustomer : T.addCustomer}
                  </h2>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-slate-500 hover:text-slate-900 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                {submitError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-red-600 text-sm">{submitError}</p>
                  </div>
                )}

                {/* Company Name & Customer Number */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.companyName}</label>
                    <input
                      type="text"
                      value={form.companyName}
                      onChange={(e) => updateField('companyName', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-lg bg-white border text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${formErrors.companyName ? 'border-red-500' : 'border-slate-200'}`}
                      placeholder={T.companyName}
                    />
                    {formErrors.companyName && <p className="text-red-600 text-xs mt-1">{formErrors.companyName}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.customerNumber}</label>
                    <input
                      type="text"
                      value={form.customerNumber}
                      onChange={(e) => updateField('customerNumber', e.target.value)}
                      disabled={editingCustomer !== null && user?.role !== 'super_admin'}
                      className={`w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-50 disabled:cursor-not-allowed`}
                      placeholder={T.customerNumber}
                    />
                  </div>
                </div>

                {/* Contact Person */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.contactPerson}</label>
                  <input
                    type="text"
                    value={form.contactPerson}
                    onChange={(e) => updateField('contactPerson', e.target.value)}
                    className={`w-full px-3 py-2.5 rounded-lg bg-white border text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${formErrors.contactPerson ? 'border-red-500' : 'border-slate-200'}`}
                    placeholder={T.contactPerson}
                  />
                  {formErrors.contactPerson && <p className="text-red-600 text-xs mt-1">{formErrors.contactPerson}</p>}
                </div>

                {/* Email & Phone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.email}</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-lg bg-white border text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${formErrors.email ? 'border-red-500' : 'border-slate-200'}`}
                      placeholder="email@example.com"
                    />
                    {formErrors.email && <p className="text-red-600 text-xs mt-1">{formErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.phone}</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => updateField('phone', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-lg bg-white border text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${formErrors.phone ? 'border-red-500' : 'border-slate-200'}`}
                      placeholder="+1 234 567 890"
                    />
                    {formErrors.phone && <p className="text-red-600 text-xs mt-1">{formErrors.phone}</p>}
                  </div>
                </div>

                {/* Credit Term & Credit Limit */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.creditTerm}</label>
                    <select
                      value={form.creditTerm}
                      onChange={(e) => updateField('creditTerm', Number(e.target.value))}
                      className={`w-full px-3 py-2.5 rounded-lg bg-white border text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${formErrors.creditTerm ? 'border-red-500' : 'border-slate-200'}`}
                    >
                      <option value={15}>15</option>
                      <option value={30}>30</option>
                      <option value={45}>45</option>
                      <option value={60}>60</option>
                    </select>
                    {formErrors.creditTerm && <p className="text-red-600 text-xs mt-1">{formErrors.creditTerm}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.creditLimit}</label>
                    <input
                      type="number"
                      value={form.creditLimit || ''}
                      onChange={(e) => updateField('creditLimit', Number(e.target.value))}
                      className={`w-full px-3 py-2.5 rounded-lg bg-white border text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${formErrors.creditLimit ? 'border-red-500' : 'border-slate-200'}`}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                    {formErrors.creditLimit && <p className="text-red-600 text-xs mt-1">{formErrors.creditLimit}</p>}
                  </div>
                </div>

                {/* Office & Sales Manager */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.office}</label>
                    <input
                      type="text"
                      value={form.office}
                      onChange={(e) => updateField('office', e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      placeholder={T.office}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.salesManager}</label>
                    <input
                      type="text"
                      value={form.salesManager}
                      onChange={(e) => updateField('salesManager', e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                      placeholder={T.salesManager}
                    />
                  </div>
                </div>

                {/* Grade & Client Status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.grade}</label>
                    <select
                      value={form.grade}
                      onChange={(e) => updateField('grade', e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.clientStatus}</label>
                    <select
                      value={form.clientStatus}
                      onChange={(e) => updateField('clientStatus', e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                    >
                      {Object.entries(clientStatusLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Client Login Section */}
                {!editingCustomer && (
                  <>
                    <div className="border-t border-slate-200 pt-4 mt-4">
                      <h3 className="text-sm font-medium text-slate-700 mb-3">{T.clientEmail}</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.clientEmail}</label>
                          <input
                            type="email"
                            value={form.clientEmail}
                            onChange={(e) => updateField('clientEmail', e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                            placeholder="client@example.com"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">{T.password}</label>
                          <div className="relative">
                            <input
                              type={showClientPassword ? 'text' : 'password'}
                              value={form.password}
                              onChange={(e) => updateField('password', e.target.value)}
                              className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pe-10"
                              placeholder={T.password}
                            />
                            <button
                              type="button"
                              aria-label={showClientPassword ? txx.hidePassword : txx.showPassword}
                              onClick={() => setShowClientPassword(!showClientPassword)}
                              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 transition-colors"
                            >
                              {showClientPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm hover:bg-slate-100 transition-colors"
                  >
                    {T.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {submitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {editingCustomer ? T.editCustomer : T.addCustomer}
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
