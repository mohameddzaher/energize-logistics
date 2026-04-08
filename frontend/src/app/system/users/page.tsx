'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getUsersTranslations } from '@/lib/translations';
import api from '@/lib/api';
import DataTable from '@/components/system/DataTable';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCog, Plus, X, RefreshCw, Lock, Unlock, KeyRound,
  Trash2, Edit, MoreVertical, Shield, AlertTriangle, Eye, EyeOff, Download
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface UserRecord {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'employee' | 'operations_manager' | 'operations' | 'moderator' | 'client' | 'workshop_manager' | 'workshop_employee' | 'purchasing';
  branch?: { _id: string; name: string };
  status?: 'active' | 'locked' | 'inactive';
  isLocked?: boolean;
  isActive?: boolean;
  lastLogin?: string;
  linkedCustomer?: { _id: string; companyName: string };
  assignedCustomers?: { _id: string; companyName: string }[];
  createdAt: string;
}

interface Customer {
  _id: string;
  companyName: string;
}

const roleConfig: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  admin: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  employee: { bg: 'bg-green-500/20', text: 'text-green-400' },
  operations_manager: { bg: 'bg-teal-500/20', text: 'text-teal-400' },
  operations: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  moderator: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  client: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
};

const statusDot: Record<string, string> = {
  active: 'bg-green-400',
  locked: 'bg-red-400',
  inactive: 'bg-gray-400',
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { lang } = useLanguage();
  const T = getUsersTranslations(lang);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Create/Edit form
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<{ _id: string; name: string }[]>([]);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'employee' as string,
    linkedCustomer: '',
    assignedCustomers: [] as string[],
    branch: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Reset password
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  // Password visibility
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Delete
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setError('');
      const data = await api.get<any>('/api/users');
      setUsers(data.users || data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Real-time updates
  useSocket('user:deleted', fetchUsers);

  const fetchCustomers = async () => {
    try {
      const data = await api.get<any>('/api/customers');
      setCustomers(data.customers || data || []);
    } catch {
      setCustomers([]);
    }
  };

  const fetchBranches = async () => {
    try {
      const data = await api.get<any>('/api/branches?active=true');
      setBranches(data.branches || []);
    } catch {
      setBranches([]);
    }
  };

  const getUserStatus = (u: UserRecord): string => {
    if (u.status) return u.status;
    if (u.isLocked) return 'locked';
    if (u.isActive === false) return 'inactive';
    return 'active';
  };

  // CREATE
  const openCreateModal = async () => {
    setFormData({ email: '', password: '', firstName: '', lastName: '', role: 'employee', linkedCustomer: '', assignedCustomers: [], branch: '' });
    setFormError('');
    setShowFormPassword(false);
    await Promise.all([fetchCustomers(), fetchBranches()]);
    setShowCreateModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');
    try {
      const payload: any = {
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        role: formData.role,
      };
      if (formData.role === 'client' && formData.linkedCustomer) {
        payload.linkedCustomer = formData.linkedCustomer;
      }
      if (formData.role === 'employee') {
        if (formData.assignedCustomers.length > 0) payload.assignedCustomers = formData.assignedCustomers;
      }
      if (formData.role === 'operations' && formData.branch) {
        payload.branch = formData.branch;
      }
      await api.post('/api/users', payload);
      setShowCreateModal(false);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  };

  // EDIT
  const openEditModal = async (u: UserRecord) => {
    setSelectedUser(u);
    setFormData({
      email: u.email,
      password: '',
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      linkedCustomer: u.linkedCustomer?._id || '',
      assignedCustomers: u.assignedCustomers?.map((c: any) => typeof c === 'string' ? c : c._id) || [],
      branch: u.branch?._id || '',
    });
    setFormError('');
    setShowFormPassword(false);
    setActionMenuId(null);
    await Promise.all([fetchCustomers(), fetchBranches()]);
    setShowEditModal(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setFormLoading(true);
    setFormError('');
    try {
      const payload: any = {
        email: formData.email,
        firstName: formData.firstName,
        lastName: formData.lastName,
        role: formData.role,
      };
      if (formData.password) payload.password = formData.password;
      if (formData.role === 'client' && formData.linkedCustomer) {
        payload.linkedCustomer = formData.linkedCustomer;
      }
      if (formData.role === 'employee') {
        payload.assignedCustomers = formData.assignedCustomers;
      }
      if (formData.role === 'operations') {
        payload.branch = formData.branch || null;
      }
      await api.put(`/api/users/${selectedUser._id}`, payload);
      setShowEditModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update user');
    } finally {
      setFormLoading(false);
    }
  };

  // LOCK/UNLOCK
  const handleToggleLock = async (u: UserRecord) => {
    setActionMenuId(null);
    try {
      await api.post(`/api/users/${u._id}/lock`);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to toggle lock');
    }
  };

  // RESET PASSWORD
  const openResetModal = (u: UserRecord) => {
    setSelectedUser(u);
    setNewPassword('');
    setResetError('');
    setShowResetPassword(false);
    setActionMenuId(null);
    setShowResetModal(true);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !newPassword) return;
    setResetLoading(true);
    setResetError('');
    try {
      await api.post(`/api/users/${selectedUser._id}/reset-password`, { password: newPassword });
      setShowResetModal(false);
      setSelectedUser(null);
    } catch (err: any) {
      setResetError(err.message || 'Failed to reset password');
    } finally {
      setResetLoading(false);
    }
  };

  // DELETE
  const openDeleteConfirm = (u: UserRecord) => {
    setSelectedUser(u);
    setActionMenuId(null);
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/users/${selectedUser._id}`);
      setShowDeleteConfirm(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCustomerToggle = (customerId: string) => {
    setFormData((prev) => ({
      ...prev,
      assignedCustomers: prev.assignedCustomers.includes(customerId)
        ? prev.assignedCustomers.filter((id) => id !== customerId)
        : [...prev.assignedCustomers, customerId],
    }));
  };

  const roleLabels: Record<string, string> = {
    super_admin: T.superAdmin, admin: T.admin, employee: T.employee,
    operations_manager: T.operationsManager, operations: T.operationsRole,
    moderator: T.moderator, client: T.clientRole,
    workshop_manager: lang === 'ar' ? 'مدير الورشة' : 'Workshop Manager',
    workshop_employee: lang === 'ar' ? 'موظف الورشة' : 'Workshop Employee',
    purchasing: lang === 'ar' ? 'المشتريات' : 'Purchasing',
  };

  const statusLabels: Record<string, string> = {
    active: T.activeStatus, locked: T.lockedStatus, inactive: T.inactiveStatus,
  };

  const formatDate = (date?: string) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const columns = [
    {
      key: 'name',
      label: T.name,
      render: (_: any, row: UserRecord) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-white">
            {row.firstName?.[0]}{row.lastName?.[0]}
          </div>
          <span className="text-white font-medium">{row.firstName} {row.lastName}</span>
        </div>
      ),
    },
    {
      key: 'email',
      label: T.email,
      render: (_: any, row: UserRecord) => <span className="text-gray-300">{row.email}</span>,
    },
    {
      key: 'role',
      label: T.role,
      render: (_: any, row: UserRecord) => {
        const config = roleConfig[row.role] || roleConfig.employee;
        return (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
            {roleLabels[row.role] || row.role.replace('_', ' ')}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: T.status,
      render: (_: any, row: UserRecord) => {
        const status = getUserStatus(row);
        return (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusDot[status] || statusDot.active}`} />
            <span className="text-gray-300 text-xs capitalize">{statusLabels[status] || status}</span>
          </div>
        );
      },
    },
    {
      key: 'lastLogin',
      label: T.lastLogin,
      render: (_: any, row: UserRecord) => (
        <span className="text-gray-400 text-xs">{formatDate(row.lastLogin)}</span>
      ),
    },
  ];

  // Form fields for create/edit
  const renderFormFields = (isEdit: boolean) => (
    <>
      {formError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {formError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.firstName}</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            required
          />
        </div>
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.lastName}</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.email}</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          required
        />
      </div>
      <div>
        <label className="block text-gray-300 text-sm font-medium mb-1.5">
          {T.password}
        </label>
        <div className="relative">
          <input
            type={showFormPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pr-10"
            {...(!isEdit ? { required: true } : {})}
            minLength={6}
          />
          <button
            type="button"
            aria-label={showFormPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowFormPassword(!showFormPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
          >
            {showFormPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.role}</label>
        <select
          value={formData.role}
          onChange={(e) => setFormData({ ...formData, role: e.target.value, linkedCustomer: '', assignedCustomers: [] })}
          className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
        >
          {Object.entries(roleLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Branch assignment for operations and workshop roles */}
      {['operations', 'operations_manager', 'workshop_manager', 'workshop_employee', 'purchasing'].includes(formData.role) && (
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.branch} *</label>
          <select
            value={formData.branch}
            onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            aria-label="Branch"
          >
            <option value="">{T.selectBranch}...</option>
            {branches.map((b) => (
              <option key={b._id} value={b._id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Client-specific: linked customer */}
      {formData.role === 'client' && (
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.linkedCustomer}</label>
          <select
            value={formData.linkedCustomer}
            onChange={(e) => setFormData({ ...formData, linkedCustomer: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          >
            <option value="">{T.customer}...</option>
            {customers.map((c) => (
              <option key={c._id} value={c._id}>{c.companyName}</option>
            ))}
          </select>
        </div>
      )}

      {/* Employee-specific: assigned customers */}
      {formData.role === 'employee' && (
        <>
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-1.5">
              {T.assignedCustomers} ({formData.assignedCustomers.length})
            </label>
            <div className="max-h-40 overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-2 space-y-1">
              {customers.length === 0 ? (
                <p className="text-gray-500 text-xs p-2">{T.noDataFound}</p>
              ) : (
                customers.map((c) => (
                  <label
                    key={c._id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={formData.assignedCustomers.includes(c._id)}
                      onChange={() => handleCustomerToggle(c._id)}
                      className="rounded border-gray-600 bg-gray-800 text-[#f37121] focus:ring-[#f37121]/50"
                    />
                    <span className="text-gray-300 text-sm">{c.companyName}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{T.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => exportToExcel(users, [
              { header: T.firstName, key: 'firstName', width: 16 },
              { header: T.lastName, key: 'lastName', width: 16 },
              { header: T.email, key: 'email', width: 28 },
              { header: T.role, key: 'role', transform: (v: string) => roleLabels[v] || v?.replace('_', ' '), width: 20 },
              { header: T.branch, key: 'branch.name', width: 16 },
              { header: T.status, key: 'status', transform: (_: any, row: any) => statusLabels[getUserStatus(row)] || getUserStatus(row), width: 10 },
              { header: T.lastLogin, key: 'lastLogin', transform: fmt.datetime, width: 22 },
              { header: T.createdAt, key: 'createdAt', transform: fmt.date, width: 14 },
            ], `users-${new Date().toISOString().split('T')[0]}`, T.title)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
          >
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchUsers(); }}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {T.addUser}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Data Table */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <DataTable
          columns={columns}
          data={users}
          searchable
          searchPlaceholder={T.searchUsers}
          emptyMessage={T.noUsers}
          actions={(row: UserRecord) => {
            const status = getUserStatus(row);
            const isCurrentUser = row._id === currentUser?._id;
            return (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (actionMenuId === row._id) {
                      setActionMenuId(null);
                    } else {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
                      setActionMenuId(row._id);
                    }
                  }}
                  className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                <AnimatePresence>
                  {actionMenuId === row._id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      style={{ top: menuPos.top, left: menuPos.left }}
                      className="fixed w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[100] py-1"
                    >
                      <button
                        type="button"
                        onClick={() => openEditModal(row)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        {T.edit}
                      </button>
                      {!isCurrentUser && (
                        <button
                          type="button"
                          onClick={() => handleToggleLock(row)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        >
                          {status === 'locked' ? (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              {T.unlockUser}
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              {T.lockUser}
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openResetModal(row)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {T.resetPassword}
                      </button>
                      {!isCurrentUser && (
                        <button
                          type="button"
                          onClick={() => openDeleteConfirm(row)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {T.delete}
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          }}
        />
      </motion.div>

      {/* Click-away listener for action menus */}
      {actionMenuId && (
        <div className="fixed inset-0 z-[99]" onClick={() => setActionMenuId(null)} />
      )}

      {/* Create User Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                  <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                    <UserCog className="w-5 h-5 text-[#f37121]" />
                    {T.addUser}
                  </h2>
                  <button type="button" onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  {renderFormFields(false)}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={formLoading}
                      className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {formLoading && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.addUser}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Edit User Modal */}
      <AnimatePresence>
        {showEditModal && selectedUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                  <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                    <Edit className="w-5 h-5 text-[#f37121]" />
                    {T.editUser}
                  </h2>
                  <button type="button" onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleEdit} className="p-5 space-y-4">
                  {renderFormFields(true)}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowEditModal(false)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={formLoading}
                      className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {formLoading && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.save}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {showResetModal && selectedUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowResetModal(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-gray-700">
                  <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-[#f37121]" />
                    {T.resetPassword}
                  </h2>
                  <button type="button" onClick={() => setShowResetModal(false)} className="text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleResetPassword} className="p-5 space-y-4">
                  {resetError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                      {resetError}
                    </div>
                  )}
                  <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                    <p className="text-gray-400 text-xs uppercase font-medium">{T.user}</p>
                    <p className="text-white text-sm font-medium mt-0.5">
                      {selectedUser.firstName} {selectedUser.lastName} ({selectedUser.email})
                    </p>
                  </div>
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.newPassword}</label>
                    <div className="relative">
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pr-10"
                        required
                        minLength={6}
                        placeholder="Enter new password (min 6 chars)"
                      />
                      <button
                        type="button"
                        aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowResetPassword(!showResetPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                      >
                        {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {resetLoading && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.resetPassword}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && selectedUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="fixed inset-0 bg-black/60 z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-lg">{T.deleteUser}</h3>
                    <p className="text-gray-400 text-sm mt-2">
                      {T.deleteConfirmGeneric}{' '}
                      <span className="text-white font-medium">
                        {selectedUser.firstName} {selectedUser.lastName}
                      </span>
                    </p>
                  </div>
                  <div className="flex justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
                    >
                      {T.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleteLoading}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {deleteLoading && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {T.delete}
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
