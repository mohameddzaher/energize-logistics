'use client';
import UserSectionAccess from '@/components/system/UserSectionAccess';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getUsersTranslations, getUsersExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import DataTable from '@/components/system/DataTable';
import RowMenu from '@/components/system/RowMenu';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCog, Plus, X, RefreshCw, Lock, Unlock, KeyRound,
  Trash2, Edit, MoreVertical, Shield, AlertTriangle, Eye, EyeOff
} from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { ALL_ROLE_DEFS, rolesGroupedBySection } from '@/lib/roles';
import { getSectionLabel } from '@/lib/translations';
import { SearchableSelect } from '@/components/hr/HRKit';
import HrQuickFilters from '@/components/hr/HrQuickFilters';

interface UserRecord {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  // Roles come from the generated lib/roles.ts; a hand-written list here would go stale.
  role: string;
  branch?: { _id: string; name: string };
  remoteAccess?: string[];
  status?: 'active' | 'locked' | 'inactive';
  isLocked?: boolean;
  isActive?: boolean;
  lastLogin?: string;
  linkedCustomer?: { _id: string; companyName: string };
  assignedCustomers?: { _id: string; companyName: string }[];
  assignedProjects?: { _id: string; name: string; code?: string }[];
  assignedBranches?: { _id: string; name: string; code?: string; city?: string }[];
  shipmentBranches?: string[];
  accessSections?: Record<string, string>;
  accessPages?: Record<string, boolean>;
  manager?: { _id: string; firstName: string; lastName: string; email: string; role: string };
  linkedEmployee?: { _id: string; firstName: string; lastName: string; employeeNumber?: string; iqamaNumber?: string; jobTitle?: string };
  // Staff vs outside partner. Accounts created before this field existed have
  // none — they are staff, so `undefined` reads as 'employee' everywhere below.
  accountType?: 'employee' | 'customer' | 'vendor';
  partner?: { source: string; refId: string; name: string; kind: string };
  createdAt: string;
}

// One row of the unified customer/supplier picker — every register in the
// company, flattened, with the register's own name beside each row.
interface PartnerOption {
  source: string;
  kind: 'customer' | 'vendor';
  refId: string;
  name: string;
  registerAr: string;
  registerEn: string;
  detail: string;
  email: string;
  phone: string;
  account: { _id: string; email: string } | null;
}

interface Customer {
  _id: string;
  companyName: string;
}

interface B2CProject {
  _id: string;
  name: string;
  code?: string;
}

interface BranchOpt {
  _id: string;
  name: string;
  code?: string;
  city?: string;
}

interface ManagerOpt {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

const roleConfig: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: 'bg-purple-500/20', text: 'text-purple-600' },
  admin: { bg: 'bg-blue-500/20', text: 'text-blue-600' },
  employee: { bg: 'bg-green-500/20', text: 'text-green-600' },
  operations_manager: { bg: 'bg-teal-500/20', text: 'text-teal-700' },
  operations: { bg: 'bg-amber-500/20', text: 'text-amber-700' },
  moderator: { bg: 'bg-cyan-500/20', text: 'text-cyan-700' },
  client: { bg: 'bg-orange-500/20', text: 'text-orange-600' },
  b2c_head: { bg: 'bg-pink-500/20', text: 'text-pink-600' },
  b2c_project_manager: { bg: 'bg-rose-500/20', text: 'text-rose-600' },
  remote_employee: { bg: 'bg-indigo-500/20', text: 'text-indigo-600' },
  remote_manager: { bg: 'bg-violet-500/20', text: 'text-violet-600' },
  it_manager: { bg: 'bg-slate-800/10', text: 'text-slate-800' },
  it_specialist: { bg: 'bg-sky-500/20', text: 'text-sky-700' },
  marketing_manager: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-700' },
  marketing_specialist: { bg: 'bg-pink-500/20', text: 'text-pink-700' },
  bd_manager: { bg: 'bg-emerald-500/20', text: 'text-emerald-700' },
  bd_specialist: { bg: 'bg-lime-500/20', text: 'text-lime-700' },
  administrator: { bg: 'bg-violet-500/20', text: 'text-violet-700' },
  contracts_manager: { bg: 'bg-cyan-500/20', text: 'text-cyan-700' },
  fleet_manager: { bg: 'bg-amber-500/20', text: 'text-amber-700' },
  fleet_supervisor: { bg: 'bg-yellow-500/20', text: 'text-yellow-700' },
};

// Pages inside the Remote section a remote_employee can be granted access to.
const REMOTE_PAGE_OPTIONS: { key: string; en: string; ar: string }[] = [
  { key: 'attendance', en: 'Attendance', ar: 'الحضور والانصراف' },
  { key: 'dashboard', en: 'My Dashboard', ar: 'لوحتي' },
  { key: 'leave', en: 'Leave', ar: 'الإجازات' },
  { key: 'chat', en: 'Messages', ar: 'الرسائل' },
  { key: 'tasks', en: 'My Tasks', ar: 'مهامي' },
  { key: 'report', en: 'Daily Report', ar: 'التقرير اليومي' },
  { key: 'announcements', en: 'Announcements', ar: 'الإعلانات' },
];

const statusDot: Record<string, string> = {
  active: 'bg-green-400',
  locked: 'bg-red-400',
  inactive: 'bg-slate-300',
};

const loginFormatters: Record<string, Intl.DateTimeFormat> = {};
const loginFormatter = (ar: boolean) => (loginFormatters[ar ? 'ar' : 'en'] ||= new Intl.DateTimeFormat(ar ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}));

const SHIPMENT_BRANCH_ROLES = ['data_entry', 'data_analyst', 'shipment_orders_followup'];

/** The operations team (workflow, vendors, follow-up) under the operations manager. */
const OPS_TEAM_ROLES = ['operations_manager', 'operations_team_leader', 'operations_staff'];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { lang } = useLanguage();
  const T = getUsersTranslations(lang);
  const txx = getUsersExtraTranslations(lang);
  const [users, setUsers] = useState<UserRecord[]>([]);
  // Quick filters (role, department, manager, HR file, status, account type, branch); values are comma lists.
  const [qf, setQf] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const closeMenu = useCallback(() => setActionMenuId(null), []);

  // Create/Edit form
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [shipBranches, setShipBranches] = useState<{ key: string; ar: string; en: string }[]>([]);
  const [b2cProjects, setB2cProjects] = useState<B2CProject[]>([]);
  const [b2cHeads, setB2cHeads] = useState<ManagerOpt[]>([]);
  const [remoteManagers, setRemoteManagers] = useState<ManagerOpt[]>([]);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'employee' as string,
    linkedCustomer: '',
    assignedCustomers: [] as string[],
    branch: '',
    assignedProjects: [] as string[],
    assignedBranches: [] as string[],
    // Per-user permission exceptions (works on vendors or not, which pages).
    accessSections: {} as Record<string, string>,
    accessPages: {} as Record<string, boolean>,
    shipmentBranches: [] as string[],
    manager: '',
    remoteAccess: [] as string[],
    linkedEmployee: '',
    isTopManagement: false,
    isChairman: false,
    leaveSheetSigner: '',
    // 'employee' = one of our people; 'customer'/'vendor' = an outside partner
    // whose login opens the portal instead of the system.
    accountType: 'employee' as 'employee' | 'customer' | 'vendor',
    partnerSource: '',
    partnerRefId: '',
  });

  // Partner picker
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnerLabel, setPartnerLabel] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // HR: link this login to an employee profile (search by name / iqama / number)
  const [empSearch, setEmpSearch] = useState('');
  const [empResults, setEmpResults] = useState<{ _id: string; firstName: string; lastName: string; iqamaNumber?: string; employeeNumber?: string; jobTitle?: string }[]>([]);
  const [linkedEmployeeLabel, setLinkedEmployeeLabel] = useState('');

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
      setError(err.message || txx.failedLoadUsers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const exportColumns: ExportColumn[] = [
    { header: T.firstName, key: 'firstName', width: 16 },
    { header: T.lastName, key: 'lastName', width: 16 },
    { header: T.email, key: 'email', width: 28 },
    { header: T.role, key: 'role', transform: (v: string) => roleLabels[v] || v?.replace('_', ' '), width: 20 },
    { header: lang === 'ar' ? 'المدير المباشر' : 'Direct manager', key: 'manager', transform: (_: any, row: any) => (row.manager ? `${row.manager.firstName} ${row.manager.lastName}` : ''), width: 22 },
    { header: lang === 'ar' ? 'ملف الموظف' : 'HR file', key: 'linkedEmployee', transform: (_: any, row: any) => (row.linkedEmployee ? `${row.linkedEmployee.firstName} ${row.linkedEmployee.lastName}${row.linkedEmployee.employeeNumber ? ` (${row.linkedEmployee.employeeNumber})` : ''}` : (lang === 'ar' ? 'غير مرتبط' : 'Not linked')), width: 26 },
    { header: T.branch, key: 'branch.name', width: 16 },
    { header: T.status, key: 'status', transform: (_: any, row: any) => statusLabels[getUserStatus(row)] || getUserStatus(row), width: 10 },
    { header: T.lastLogin, key: 'lastLogin', transform: fmt.datetime, width: 22 },
    { header: T.createdAt, key: 'createdAt', transform: fmt.date, width: 14 },
  ];
  // /api/users has no paging or filtering and the screen shows everything returned, so the in-memory list is the full set.
  const scope = exportScopeLabels(lang === 'ar');
  const exportAll = { key: 'all', label: scope.all, sheets: [{ name: T.title, rows: users, columns: exportColumns }] };

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

  // The unified customer/supplier list. Refetched whenever the kind or the
  // search text changes — every register is searched server-side at once.
  const fetchPartners = useCallback(async (kind: 'customer' | 'vendor', q: string) => {
    setPartnersLoading(true);
    try {
      const d = await api.get<{ items: PartnerOption[] }>(`/api/partners?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ''}&limit=400`);
      setPartners(d.items || []);
    } catch {
      setPartners([]);
    }
    setPartnersLoading(false);
  }, []);

  useEffect(() => {
    if (formData.accountType === 'employee') return;
    const t = setTimeout(() => fetchPartners(formData.accountType as 'customer' | 'vendor', partnerQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [formData.accountType, partnerQuery, fetchPartners]);

  const fetchBranches = async () => {
    try {
      // role-only: same editors as the permissions page.
      if (['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader'].includes(currentUser?.role || '')) {
        api.get<any>('/api/shipment-orders/branch-access').then((d) => setShipBranches(d.branches || [])).catch(() => {});
      }
      const data = await api.get<any>('/api/branches?active=true');
      setBranches(data.branches || []);
    } catch {
      setBranches([]);
    }
  };

  const fetchB2CProjects = async () => {
    try {
      const data = await api.get<any>('/api/b2c/projects?active=true');
      setB2cProjects(data.projects || []);
    } catch {
      setB2cProjects([]);
    }
  };

  const fetchB2CHeads = async () => {
    try {
      // Role key renamed from b2c_head to b2c_manager; the old key matched nothing and the list always came back empty.
      const data = await api.get<any>('/api/users?role=b2c_manager');
      setB2cHeads(data.users || []);
    } catch {
      setB2cHeads([]);
    }
  };

  const fetchRemoteManagers = async () => {
    try {
      const data = await api.get<any>('/api/users?role=remote_manager');
      setRemoteManagers(data.users || []);
    } catch {
      setRemoteManagers([]);
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
    setFormData({ email: '', password: '', firstName: '', lastName: '', role: 'employee', linkedCustomer: '', assignedCustomers: [], branch: '', assignedProjects: [], assignedBranches: [], accessSections: {}, accessPages: {}, shipmentBranches: [], manager: '', remoteAccess: REMOTE_PAGE_OPTIONS.map((p) => p.key), linkedEmployee: '', isTopManagement: false, isChairman: false, leaveSheetSigner: '', accountType: 'employee', partnerSource: '', partnerRefId: '' });
    setPartnerLabel(''); setPartnerQuery(''); setPartners([]);
    setEmpSearch(''); setEmpResults([]); setLinkedEmployeeLabel('');
    setFormError('');
    setShowFormPassword(false);
    await Promise.all([fetchCustomers(), fetchBranches(), fetchB2CProjects(), fetchB2CHeads(), fetchRemoteManagers()]);
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
        accountType: formData.accountType,
      };
      // A partner account carries its register link and nothing staff-specific;
      // the backend forces it onto the external `client` role.
      if (formData.accountType !== 'employee') {
        if (!formData.partnerRefId) throw new Error(lang === 'ar' ? 'اختر العميل أو المورد المرتبط بهذا الحساب' : 'Pick the customer or supplier this account belongs to');
        payload.partner = { source: formData.partnerSource, refId: formData.partnerRefId };
        await api.post('/api/users', payload);
        setShowCreateModal(false);
        fetchUsers();
        return;
      }
      if (formData.role === 'client' && formData.linkedCustomer) {
        payload.linkedCustomer = formData.linkedCustomer;
      }
      if (SHIPMENT_BRANCH_ROLES.includes(formData.role)) payload.shipmentBranches = formData.shipmentBranches;
      if (formData.role === 'employee') {
        if (formData.assignedCustomers.length > 0) payload.assignedCustomers = formData.assignedCustomers;
      }
      if (formData.branch) {
        payload.branch = formData.branch;
      }
      if (formData.role === 'b2c_project_lead' || formData.role === 'b2c_manager') {
        payload.assignedProjects = formData.assignedProjects;
        payload.assignedBranches = formData.assignedBranches;
        if (formData.role === 'b2c_project_lead' && formData.manager) {
          payload.manager = formData.manager;
        }
      }
      if (formData.role === 'remote_employee') {
        payload.remoteAccess = formData.remoteAccess;
      }
      // Direct manager applies to every role (drives the HR leave-approval chain)
      // unless already set above for the B2C/remote special cases.
      if (formData.manager && payload.manager === undefined) payload.manager = formData.manager;
      // HR: link this login to an employee profile.
      if (formData.linkedEmployee) payload.linkedEmployee = formData.linkedEmployee;
      await api.post('/api/users', payload);
      setShowCreateModal(false);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || txx.failedCreateUser);
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
      assignedProjects: u.assignedProjects?.map((p: any) => typeof p === 'string' ? p : p._id) || [],
      assignedBranches: u.assignedBranches?.map((b: any) => typeof b === 'string' ? b : b._id) || [],
      accessSections: { ...(u.accessSections || {}) },
      accessPages: { ...(u.accessPages || {}) },
      shipmentBranches: u.shipmentBranches || [],
      manager: u.manager?._id || '',
      remoteAccess: u.remoteAccess && u.remoteAccess.length ? u.remoteAccess : REMOTE_PAGE_OPTIONS.map((p) => p.key),
      linkedEmployee: u.linkedEmployee?._id || '',
      isTopManagement: !!(u as any).isTopManagement,
      isChairman: !!(u as any).isChairman,
      leaveSheetSigner: (u as any).leaveSheetSigner || '',
      accountType: u.accountType || (u.role === 'client' ? 'customer' : 'employee'),
      partnerSource: u.partner?.source || (u.role === 'client' && u.linkedCustomer ? 'customer' : ''),
      partnerRefId: u.partner?.refId || (u.role === 'client' && u.linkedCustomer ? u.linkedCustomer._id : ''),
    });
    setPartnerLabel(u.partner?.name || u.linkedCustomer?.companyName || '');
    setPartnerQuery('');
    setEmpSearch(''); setEmpResults([]);
    setLinkedEmployeeLabel(u.linkedEmployee ? `${u.linkedEmployee.firstName} ${u.linkedEmployee.lastName}${u.linkedEmployee.iqamaNumber ? ` (${u.linkedEmployee.iqamaNumber})` : ''}` : '');
    setFormError('');
    setShowFormPassword(false);
    setActionMenuId(null);
    await Promise.all([fetchCustomers(), fetchBranches(), fetchB2CProjects(), fetchB2CHeads(), fetchRemoteManagers()]);
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
        accountType: formData.accountType,
      };
      if (formData.password) payload.password = formData.password;
      if (formData.accountType !== 'employee') {
        if (!formData.partnerRefId) throw new Error(lang === 'ar' ? 'اختر العميل أو المورد المرتبط بهذا الحساب' : 'Pick the customer or supplier this account belongs to');
        payload.partner = { source: formData.partnerSource, refId: formData.partnerRefId };
        await api.put(`/api/users/${selectedUser._id}`, payload);
        setShowEditModal(false);
        setSelectedUser(null);
        fetchUsers();
        return;
      }
      if (formData.role === 'client' && formData.linkedCustomer) {
        payload.linkedCustomer = formData.linkedCustomer;
      }
      if (formData.role === 'employee') {
        payload.assignedCustomers = formData.assignedCustomers;
      }
      payload.branch = formData.branch || null;
      if (SHIPMENT_BRANCH_ROLES.includes(formData.role)) payload.shipmentBranches = formData.shipmentBranches;
      if (formData.role === 'b2c_project_lead' || formData.role === 'b2c_manager') {
        payload.assignedProjects = formData.assignedProjects;
        payload.assignedBranches = formData.assignedBranches;
        payload.manager = formData.manager || null;
        payload.remoteAccess = [];
      } else if (formData.role === 'remote_employee') {
        payload.assignedProjects = [];
        payload.assignedBranches = [];
        payload.manager = formData.manager || null;
        payload.remoteAccess = formData.remoteAccess;
      } else {
        payload.assignedProjects = [];
        // Operations staff may work on several branches: the assigned one plus extra ones.
        payload.assignedBranches = OPS_TEAM_ROLES.includes(formData.role) ? formData.assignedBranches.filter((b) => b !== formData.branch) : [];
        // Direct manager applies to every role (drives the HR leave-approval chain).
        payload.manager = formData.manager || null;
        payload.remoteAccess = [];
      }
      // HR: link/unlink this login to an employee profile.
      payload.linkedEmployee = formData.linkedEmployee || null;
      payload.isTopManagement = !!formData.isTopManagement;
      if (['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(currentUser?.role || '')) { payload.accessSections = formData.accessSections; payload.accessPages = formData.accessPages; }
      if (['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(currentUser?.role || '')) payload.isChairman = !!formData.isChairman;
      // Sent only for the eligible roles, so editing anyone else never clears or moves a box.
      if (['hr_manager', 'cfo', 'accounting_manager'].includes(formData.role)) payload.leaveSheetSigner = formData.leaveSheetSigner || '';
      await api.put(`/api/users/${selectedUser._id}`, payload);
      setShowEditModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || txx.failedUpdateUser);
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
      setError(err.message || txx.failedToggleLock);
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
      await api.post(`/api/users/${selectedUser._id}/reset-password`, { newPassword });
      setShowResetModal(false);
      setSelectedUser(null);
    } catch (err: any) {
      setResetError(err.message || txx.failedResetPassword);
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
      setError(err.message || txx.failedDeleteUser);
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

  const handleProjectToggle = (projectId: string) => {
    setFormData((prev) => ({
      ...prev,
      assignedProjects: prev.assignedProjects.includes(projectId)
        ? prev.assignedProjects.filter((id) => id !== projectId)
        : [...prev.assignedProjects, projectId],
    }));
  };

  const handleBranchAssignToggle = (branchId: string) => {
    setFormData((prev) => ({
      ...prev,
      assignedBranches: prev.assignedBranches.includes(branchId)
        ? prev.assignedBranches.filter((id) => id !== branchId)
        : [...prev.assignedBranches, branchId],
    }));
  };

  const handleRemoteAccessToggle = (key: string) => {
    setFormData((prev) => ({
      ...prev,
      remoteAccess: prev.remoteAccess.includes(key)
        ? prev.remoteAccess.filter((k) => k !== key)
        : [...prev.remoteAccess, key],
    }));
  };

  // Roles come from the server. The hard-coded list drifted both ways: it showed roles that do not exist (server rejects them) and hid valid ones, so they could not be assigned.
  const [serverRoles, setServerRoles] = useState<{ key: string; ar: string; en: string; section: string; isManager: boolean; distinct?: string }[]>([]);
  useEffect(() => {
    api.get<{ roles: typeof serverRoles }>('/api/users/roles')
      .then((r) => setServerRoles(r.roles || []))
      .catch(() => { /* Keep the legacy list visible rather than a screen with no roles. */ });
  }, []);

  const legacyRoleLabels: Record<string, string> = {
    super_admin: T.superAdmin, admin: T.admin, employee: T.employee,
    operations_manager: T.operationsManager, operations: T.operationsRole,
    moderator: T.moderator, client: T.clientRole,
    purchasing: lang === 'ar' ? 'المشتريات' : 'Purchasing',
    b2c_manager: lang === 'ar' ? 'مدير B2C' : 'B2C Manager',
    b2c_deputy: lang === 'ar' ? 'نائب مدير قطاع الأفراد' : 'B2C Deputy Manager',
    b2c_project_lead: lang === 'ar' ? 'مدير مشروع B2C' : 'B2C Project Lead',
    b2c_rep_supervisor: lang === 'ar' ? 'مشرف المناديب التشغيلي' : 'B2C Ops Rep Supervisor',
    b2c_inspection_supervisor: lang === 'ar' ? 'مشرف المناديب التفقدي' : 'B2C Inspection Supervisor',
    remote_employee: lang === 'ar' ? 'موظف عن بُعد' : 'Remote Employee',
    remote_manager: lang === 'ar' ? 'مدير العمل عن بُعد' : 'Remote Manager',
    hr_manager: lang === 'ar' ? 'مدير الموارد البشرية' : 'HR Manager',
    hr_specialist: lang === 'ar' ? 'أخصائي موارد بشرية' : 'HR Specialist',
    crm_manager: lang === 'ar' ? 'مدير علاقات العملاء' : 'CRM Manager',
    crm_team_lead: lang === 'ar' ? 'مشرف فريق علاقات العملاء' : 'CRM Team Lead',
    crm_specialist: lang === 'ar' ? 'أخصائي علاقات العملاء' : 'CRM Specialist',
    crm_agent: lang === 'ar' ? 'مندوب علاقات العملاء' : 'CRM Agent',
    cfo: lang === 'ar' ? 'المدير المالي' : 'Chief Financial Officer',
    accounting_manager: lang === 'ar' ? 'مدير الحسابات' : 'Accounting Manager',
    accountant: lang === 'ar' ? 'محاسب' : 'Accountant',
    sales_manager: lang === 'ar' ? 'مدير المبيعات' : 'Sales Manager',
    sales_rep: lang === 'ar' ? 'مندوب مبيعات' : 'Sales Rep',
    procurement_manager: lang === 'ar' ? 'مدير المشتريات' : 'Procurement Manager',
    customs_manager: lang === 'ar' ? 'مدير التخليص الجمركي' : 'Customs Manager',
    customs_officer: lang === 'ar' ? 'مخلّص جمركي' : 'Customs Officer',
    it_manager: lang === 'ar' ? 'مدير التقنية والبرمجيات' : 'Head of IT & Software',
    it_specialist: lang === 'ar' ? 'أخصائي تقنية وبرمجيات' : 'IT & Software Specialist',
    marketing_manager: lang === 'ar' ? 'مدير التسويق' : 'Marketing Manager',
    marketing_specialist: lang === 'ar' ? 'أخصائي تسويق' : 'Marketing Specialist',
    bd_manager: lang === 'ar' ? 'مدير تطوير الأعمال' : 'Business Development Manager',
    bd_specialist: lang === 'ar' ? 'أخصائي تطوير أعمال' : 'Business Development Specialist',
    administrator: lang === 'ar' ? 'موظف شؤون إدارية (سكرتارية)' : 'Administrator',
    contracts_manager: lang === 'ar' ? 'مدير إدارة العقود' : 'Contracts Manager',
    fleet_manager: lang === 'ar' ? 'مدير قسم الأسطول' : 'Fleet Manager',
    fleet_supervisor: lang === 'ar' ? 'مشرف أسطول' : 'Fleet Supervisor',
  };

  // Display name: server first, then the legacy list for removed roles still on accounts, then the raw key, so no blank label appears.
  const roleLabels: Record<string, string> = Object.fromEntries([
    ...Object.entries(legacyRoleLabels),
    ...serverRoles.map((r) => [r.key, lang === 'ar' ? r.ar : r.en]),
  ]);

  // Role options: UI-language name plus its department name, both searchable.
  const roleOptions = (serverRoles.length
    ? serverRoles.filter((r) => r.key !== 'client')
    : Object.entries(legacyRoleLabels).filter(([v]) => v !== 'client')
      .map(([key]) => ({ key, ar: legacyRoleLabels[key], en: legacyRoleLabels[key], section: '', isManager: false }))
  ).map((r) => ({
    value: r.key,
    label: `${lang === 'ar' ? r.ar : r.en}${r.section ? ` — ${getSectionLabel(r.section, lang)}` : ''}`,
    // `distinct` in config/roles is an internal reason for the role (manager and staff per department), not a description for the user creator.
  }));

  /** The direct manager is suggested from the role's department, not enforced: the org structure is sometimes bypassed, so the suggestion covers the common case. */
  const suggestManagerFor = (roleKey: string): string => {
    const def = serverRoles.find((r) => r.key === roleKey);
    if (!def || !def.section || def.isManager) return '';
    const managerKeys = serverRoles.filter((r) => r.section === def.section && r.isManager).map((r) => r.key);
    const found = users.find((u) => managerKeys.includes(u.role));
    return found ? found._id : '';
  };

  const statusLabels: Record<string, string> = {
    active: T.activeStatus, locked: T.lockedStatus, inactive: T.inactiveStatus,
  };

  // In the reader's language with Latin digits, in company time. One formatter per language: toLocaleDateString built a new one for every row on every render.
  const formatDate = (date?: string) => (date ? loginFormatter(lang === 'ar').format(new Date(date)) : txx.never);

  // Per-column search text. Columns show composed values (two-field name, role label from a map, computed status) and search used to read the raw field by column name; row.name does not exist.
  const columns = [
    {
      key: 'name',
      label: T.name,
      search: (row: UserRecord) => `${row.firstName || ''} ${row.lastName || ''}`,
      render: (_: any, row: UserRecord) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-900">
            {row.firstName?.[0]}{row.lastName?.[0]}
          </div>
          <span className="text-slate-900 font-medium">{row.firstName} {row.lastName}</span>
        </div>
      ),
    },
    {
      key: 'email',
      label: T.email,
      render: (_: any, row: UserRecord) => <span className="text-slate-700">{row.email}</span>,
    },
    {
      key: 'role',
      label: T.role,
      // Search by the displayed label, the key, and the partner name for portal accounts, so users can type the label they see.
      search: (row: UserRecord) => [
        roleLabels[row.role], row.role,
        row.partner?.name, row.linkedCustomer?.companyName,
      ].filter(Boolean).join(' '),
      render: (_: any, row: UserRecord) => {
        // A partner login's "role" is meaningless to a reader — what matters is
        // WHICH customer or supplier it is. Show that instead.
        const partnerName = row.partner?.name || row.linkedCustomer?.companyName;
        if (row.accountType === 'customer' || row.accountType === 'vendor' || row.role === 'client') {
          const isVendor = row.accountType === 'vendor';
          return (
            <div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${isVendor ? 'bg-teal-500/20 text-teal-700' : 'bg-orange-500/20 text-orange-600'}`}>
                {isVendor ? (lang === 'ar' ? 'مورد' : 'Supplier') : (lang === 'ar' ? 'عميل' : 'Customer')}
              </span>
              {partnerName && <p className="text-slate-500 text-[11px] mt-0.5 truncate max-w-[180px]">{partnerName}</p>}
            </div>
          );
        }
        const config = roleConfig[row.role] || roleConfig.employee;
        return (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
            {roleLabels[row.role] || row.role.replace('_', ' ')}
          </span>
        );
      },
    },
    {
      key: 'manager',
      label: lang === 'ar' ? 'المدير المباشر' : 'Direct manager',
      search: (row: UserRecord) => (row.manager ? `${row.manager.firstName} ${row.manager.lastName}` : ''),
      render: (_: any, row: UserRecord) => (row.manager
        ? (
          <div>
            <p className="text-slate-900 text-sm font-medium">{row.manager.firstName} {row.manager.lastName}</p>
            <p className="text-slate-500 text-[11px]">{roleLabels[row.manager.role] || row.manager.role}</p>
          </div>
        )
        : <span className="text-slate-400 text-xs">—</span>),
    },
    {
      // Whether the login is tied to an HR employee file; a click opens the file.
      key: 'hrFile',
      label: lang === 'ar' ? 'ملف الموظف' : 'HR file',
      search: (row: UserRecord) => (row.linkedEmployee
        ? `${lang === 'ar' ? 'مرتبط' : 'linked'} ${row.linkedEmployee.firstName} ${row.linkedEmployee.lastName} ${row.linkedEmployee.employeeNumber || ''}`
        : (lang === 'ar' ? 'غير مرتبط' : 'not linked')),
      render: (_: any, row: UserRecord) => {
        if (row.accountType === 'customer' || row.accountType === 'vendor' || row.role === 'client') return <span className="text-slate-400 text-xs">—</span>;
        return row.linkedEmployee
          ? (
            <a href={`/system/hr/employees/${row.linkedEmployee._id}`} onClick={(e) => e.stopPropagation()}
              className="inline-flex flex-col rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 hover:border-emerald-400">
              <span className="text-[11px] font-bold text-emerald-700">{lang === 'ar' ? 'مرتبط' : 'Linked'}</span>
              <span className="text-[11.5px] text-slate-800">{row.linkedEmployee.firstName} {row.linkedEmployee.lastName}{row.linkedEmployee.employeeNumber ? ` · ${row.linkedEmployee.employeeNumber}` : ''}</span>
            </a>
          )
          : <span className="inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">{lang === 'ar' ? 'غير مرتبط' : 'Not linked'}</span>;
      },
    },
    {
      key: 'status',
      label: T.status,
      search: (row: UserRecord) => {
        const st = getUserStatus(row);
        return `${statusLabels[st] || ''} ${st}`;
      },
      render: (_: any, row: UserRecord) => {
        const status = getUserStatus(row);
        return (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusDot[status] || statusDot.active}`} />
            <span className="text-slate-700 text-xs capitalize">{statusLabels[status] || status}</span>
          </div>
        );
      },
    },
    {
      key: 'lastLogin',
      label: T.lastLogin,
      search: (row: UserRecord) => formatDate(row.lastLogin),
      render: (_: any, row: UserRecord) => (
        <span className="text-slate-500 text-xs">{formatDate(row.lastLogin)}</span>
      ),
    },
  ];

  // Form fields for create/edit
  const renderFormFields = (isEdit: boolean) => (
    <>
      {formError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">
          {formError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.firstName}</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            required
          />
        </div>
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.lastName}</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.email}</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          required
        />
      </div>
      <div>
        <label className="block text-slate-700 text-sm font-medium mb-1.5">
          {T.password}
          <span className="text-slate-400 text-xs font-normal ms-2">
            {isEdit ? txx.leaveBlankToKeep : txx.min8Chars}
          </span>
        </label>
        <div className="relative">
          <input
            type={showFormPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pe-10"
            {...(!isEdit ? { required: true } : {})}
            minLength={8}
            placeholder={isEdit ? txx.leaveBlankToKeep : undefined}
          />
          <button
            type="button"
            aria-label={showFormPassword ? txx.hidePassword : txx.showPassword}
            onClick={() => setShowFormPassword(!showFormPassword)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 transition-colors"
          >
            {showFormPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {/* User type: internal employee or external customer/supplier. Picking a partner swaps the rest of the form: no role, no manager, no employee link, only which customer or supplier the login belongs to. */}
      <div>
        <label className="block text-slate-700 text-sm font-medium mb-1.5">
          {lang === 'ar' ? 'نوع المستخدم' : 'User type'}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { key: 'employee', ar: 'موظف', en: 'Employee', hint: lang === 'ar' ? 'يدخل النظام' : 'Uses the system' },
            { key: 'customer', ar: 'عميل', en: 'Customer', hint: lang === 'ar' ? 'بوابة العميل' : 'Customer portal' },
            { key: 'vendor', ar: 'مورد', en: 'Supplier', hint: lang === 'ar' ? 'بوابة المورد' : 'Supplier portal' },
          ] as const).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                setFormData((prev) => ({
                  ...prev,
                  accountType: o.key,
                  role: o.key === 'employee' ? (prev.role === 'client' ? 'employee' : prev.role) : 'client',
                  partnerSource: '', partnerRefId: '',
                  linkedCustomer: '', assignedCustomers: [], assignedProjects: [], assignedBranches: [],
                  manager: '', linkedEmployee: '', branch: '',
                }));
                setPartnerLabel(''); setPartnerQuery('');
              }}
              className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                formData.accountType === o.key
                  ? 'bg-[#f37121] text-white border-[#f37121]'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="block">{lang === 'ar' ? o.ar : o.en}</span>
              <span className={`block text-[10px] font-normal ${formData.accountType === o.key ? 'text-white/80' : 'text-slate-400'}`}>{o.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Partner picker: every customer/supplier register in one dropdown, each row labelled with its source register (e.g. a customs-clearance customer). */}
      {formData.accountType !== 'employee' && (
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">
            {formData.accountType === 'vendor'
              ? (lang === 'ar' ? 'المورد المرتبط *' : 'Linked supplier *')
              : (lang === 'ar' ? 'العميل المرتبط *' : 'Linked customer *')}
          </label>
          {formData.partnerRefId ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-slate-50 border border-[#f37121]/40">
              <span className="text-slate-900 text-sm">{partnerLabel}</span>
              <button
                type="button"
                onClick={() => { setFormData({ ...formData, partnerSource: '', partnerRefId: '' }); setPartnerLabel(''); }}
                className="text-slate-500 hover:text-red-600 text-xs"
              >
                {lang === 'ar' ? 'تغيير' : 'Change'}
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={partnerQuery}
                onChange={(e) => setPartnerQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث بالاسم…' : 'Search by name…'}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
              />
              <div className="mt-1 max-h-56 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-200">
                {partnersLoading && <p className="px-3 py-2.5 text-slate-400 text-xs">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>}
                {!partnersLoading && partners.length === 0 && (
                  <p className="px-3 py-2.5 text-slate-400 text-xs">{lang === 'ar' ? 'لا توجد نتائج' : 'No matches'}</p>
                )}
                {partners.slice(0, 200).map((o) => (
                  <button
                    key={`${o.source}|${o.refId}`}
                    type="button"
                    disabled={!!o.account && o.account._id !== selectedUser?._id}
                    onClick={() => {
                      setFormData({ ...formData, partnerSource: o.source, partnerRefId: o.refId });
                      setPartnerLabel(`${o.name} — ${lang === 'ar' ? o.registerAr : o.registerEn}`);
                      if (!formData.firstName) setFormData((prev) => ({ ...prev, partnerSource: o.source, partnerRefId: o.refId, firstName: o.name }));
                      if (o.email && !formData.email) setFormData((prev) => ({ ...prev, partnerSource: o.source, partnerRefId: o.refId, email: o.email }));
                    }}
                    className="w-full text-start px-3 py-2 hover:bg-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-slate-900">{o.name}</span>
                    <span className="text-[#f37121] text-xs ms-2">{lang === 'ar' ? o.registerAr : o.registerEn}</span>
                    {o.detail && <span className="text-slate-400 text-xs ms-2">· {o.detail}</span>}
                    {o.account && (
                      <span className="block text-[10px] text-red-500 mt-0.5">
                        {lang === 'ar' ? `له حساب بالفعل: ${o.account.email}` : `Already has a login: ${o.account.email}`}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-slate-400 text-[11px] mt-1">
                {lang === 'ar'
                  ? 'تجمع القائمة كل سجلات العملاء والموردين في الشركة — وبجانب كل اسم القسم المسجَّل فيه.'
                  : 'This list merges every customer/supplier register in the company — each row shows which one it came from.'}
              </p>
            </>
          )}
        </div>
      )}

      {formData.accountType === 'employee' && (
      <div>
        <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.role}</label>
        {/* Searchable instead of scrollable: dozens of roles in a dropdown. Search matches role name and department name together. */}
        <SearchableSelect
          value={formData.role}
          onChange={(role) => {
            setFormData({ ...formData, role, linkedCustomer: '', assignedCustomers: [] });
            // Auto-suggest a manager by org chart when creating a new user.
            if (!selectedUser && !['super_admin', 'admin', 'client'].includes(role)) {
              api.get<{ manager: { _id: string } | null }>(`/api/users/suggest-manager?role=${role}`)
                .then((d) => { if (d.manager) setFormData((prev) => ({ ...prev, manager: d.manager!._id })); })
                .catch(() => {});
            } else if (['super_admin', 'admin', 'client'].includes(role)) {
              setFormData((prev) => ({ ...prev, manager: '' }));
            }
          }}
          searchAfter={6}
          placeholder={lang === 'ar' ? '— اختر الدور —' : '— pick a role —'}
          searchPlaceholder={lang === 'ar' ? 'ابحث باسم الدور أو القسم…' : 'role or section…'}
          options={roleOptions}
        />
      </div>
      )}

      {/* Direct manager. Hidden for super_admin/admin (the company heads) and roles with their own pickers below; IT shares super-admin powers but still reports to a manager. */}
      {!['client', 'super_admin', 'admin', 'b2c_project_lead', 'remote_employee'].includes(formData.role) && (
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">
            {lang === 'ar' ? 'المدير المباشر' : 'Direct Manager'}
            <span className="text-slate-500 text-xs font-normal ms-2">{lang === 'ar' ? '(اختياري — يُقترح تلقائيًا حسب القسم)' : '(optional — auto-suggested by role)'}</span>
          </label>
          {/* Search by name or by role label. */}
          <SearchableSelect
            value={formData.manager}
            onChange={(v) => setFormData({ ...formData, manager: v })}
            searchAfter={6}
            placeholder={lang === 'ar' ? 'بدون مدير (تروح للموارد البشرية مباشرة)' : 'No manager (goes straight to HR)'}
            searchPlaceholder={lang === 'ar' ? 'ابحث بالاسم أو الدور…' : 'name or role…'}
            options={[
              { value: '', label: lang === 'ar' ? 'بدون مدير (تروح للموارد البشرية مباشرة)' : 'No manager (goes straight to HR)' },
              ...users.filter((u) => u._id !== selectedUser?._id && u.role !== 'client')
                .map((u) => ({ value: u._id, label: `${u.firstName} ${u.lastName} — ${roleLabels[u.role] || u.role}` })),
            ]}
          />
        </div>
      )}

      {/* Top management signs its leave stage (after HR, before the chairman) and opens its own section; it keeps the account's role and permissions. */}
      {selectedUser && formData.role !== 'client' && (
        <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-[#f37121]" checked={!!formData.isTopManagement}
            onChange={(e) => setFormData({ ...formData, isTopManagement: e.target.checked })} />
          <span className="text-sm font-semibold text-slate-800">{lang === 'ar' ? 'الإدارة العليا' : 'Top management'}</span>
          <span className="text-xs text-slate-500">{lang === 'ar' ? '— موافقة الإدارة العليا على الإجازات (بعد الموارد البشرية)، وقسم الإدارة العليا' : '— top management leave approval (after HR) and its section'}</span>
        </label>
      )}

      {/* The chairman is a super admin account with the final leave stage; only a super admin can tick it, and ticking it makes the account super admin. */}
      {selectedUser && formData.role !== 'client' && ['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(currentUser?.role || '') && (
        <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-[#f37121]" checked={!!formData.isChairman}
            onChange={(e) => setFormData({ ...formData, isChairman: e.target.checked, ...(e.target.checked ? { role: 'super_admin' } : {}) })} />
          <span className="text-sm font-semibold text-slate-800">{lang === 'ar' ? 'رئيس مجلس الإدارة' : 'Chairman of the board'}</span>
          <span className="text-xs text-slate-500">{lang === 'ar' ? '— نفس صلاحيات السوبر أدمن، والاعتماد النهائي للإجازات' : '— super admin permissions and the final leave approval'}</span>
        </label>
      )}

      {/* The finance and HR boxes of the leave sheet carry this account's name and signature once the stage approves, whoever in the department clicked. */}
      {/* Only a department head can hold its box (the server checks the same): HR manager for HR, financial or accounts manager for finance. */}
      {selectedUser && ['hr_manager', 'cfo', 'accounting_manager'].includes(formData.role) && (
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">{lang === 'ar' ? 'يوقّع ورقة الإجازة عن' : 'Signs the leave sheet as'}</label>
          <select value={formData.leaveSheetSigner || ''} onChange={(e) => setFormData({ ...formData, leaveSheetSigner: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
            <option value="">{lang === 'ar' ? '— لا يوقّع عن قسم —' : '— none —'}</option>
            {formData.role !== 'hr_manager' && <option value="finance">{lang === 'ar' ? 'المدير المالي' : 'Finance Manager'}</option>}
            {formData.role === 'hr_manager' && <option value="hr">{lang === 'ar' ? 'مدير الموارد البشرية' : 'HR Manager'}</option>}
          </select>
          <p className="mt-1 text-xs text-slate-500">{lang === 'ar' ? 'حساب واحد لكل خانة؛ اختياره هنا يرفعه عن الحساب السابق.' : 'One account per box; choosing it here clears the previous one.'}</p>
        </div>
      )}

      {/* HR: link this login to an existing employee profile (search by name / iqama / number) */}
      {formData.role !== 'client' && (
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">
            {lang === 'ar' ? 'ربط بملف موظف (الموارد البشرية)' : 'Link to Employee Profile (HR)'}
          </label>
          {formData.linkedEmployee ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-slate-50 border border-[#f37121]/40">
              <span className="text-slate-900 text-sm">{linkedEmployeeLabel || (lang === 'ar' ? 'موظف مرتبط' : 'Linked employee')}</span>
              <button type="button" onClick={() => { setFormData({ ...formData, linkedEmployee: '' }); setLinkedEmployeeLabel(''); }} className="text-slate-500 hover:text-red-600 text-xs">{lang === 'ar' ? 'إلغاء الربط' : 'Unlink'}</button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={empSearch}
                placeholder={lang === 'ar' ? 'ابحث بالاسم أو رقم الإقامة أو رقم الموظف...' : 'Search by name, iqama, or employee #...'}
                onChange={async (e) => {
                  const q = e.target.value;
                  setEmpSearch(q);
                  if (q.trim().length < 2) { setEmpResults([]); return; }
                  try { const d = await api.get<{ employees: any[] }>(`/api/hr/employees-search?q=${encodeURIComponent(q.trim())}`); setEmpResults(d.employees || []); } catch { setEmpResults([]); }
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
              />
              {empResults.length > 0 && (
                <div className="mt-1 max-h-44 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-200">
                  {empResults.map((emp) => (
                    <button
                      key={emp._id}
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, linkedEmployee: emp._id });
                        setLinkedEmployeeLabel(`${emp.firstName} ${emp.lastName}${emp.iqamaNumber ? ` (${emp.iqamaNumber})` : emp.employeeNumber ? ` (#${emp.employeeNumber})` : ''}`);
                        setEmpResults([]); setEmpSearch('');
                      }}
                      className="w-full text-start px-3 py-2 hover:bg-slate-50 text-sm"
                    >
                      <span className="text-slate-900">{emp.firstName} {emp.lastName}</span>
                      <span className="text-slate-500 text-xs ms-2">{emp.iqamaNumber || emp.employeeNumber || ''} {emp.jobTitle ? `· ${emp.jobTitle}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Branch assignment for operations roles */}
      {['operations_staff', 'operations_manager', 'operations_team_leader', 'procurement_staff'].includes(formData.role) && (
        <div className="space-y-3">
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.branch} *</label>
          <select
            value={formData.branch}
            onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            aria-label={T.branch}
          >
            <option value="">{T.selectBranch}...</option>
            {branches.map((b) => (
              <option key={b._id} value={b._id}>{b.name}</option>
            ))}
          </select>
        </div>
        {OPS_TEAM_ROLES.includes(formData.role) && (
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">{lang === 'ar' ? 'فروع إضافية يعمل عليها' : 'Extra branches'} ({formData.assignedBranches.filter((x) => x !== formData.branch).length})</label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2 grid sm:grid-cols-2 gap-1">
              {branches.filter((b) => b._id !== formData.branch).map((b) => (
                <label key={b._id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white cursor-pointer">
                  <input type="checkbox" checked={formData.assignedBranches.includes(b._id)} onChange={() => handleBranchAssignToggle(b._id)}
                    className="rounded border-slate-300 bg-white text-[#f37121] focus:ring-[#f37121]/50" />
                  <span className="text-slate-700 text-sm">{b.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {isEdit && ['operations_staff', 'operations_team_leader'].includes(formData.role) && ['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(currentUser?.role || '') && (
          <UserSectionAccess ar={lang === 'ar'} section="Vendors Management"
            title={lang === 'ar' ? 'يعمل على الموردين' : 'Works on vendors'}
            hint={lang === 'ar' ? 'إن أُغلق لا يظهر له قسم الموردين. وإن فُتح تختار الصفحات التي تظهر له.' : 'Off hides the vendors section; on lets you pick its pages.'}
            sections={formData.accessSections} pages={formData.accessPages}
            onChange={(v) => setFormData({ ...formData, accessSections: v.sections, accessPages: v.pages })} />
        )}
        </div>
      )}

      {/* Legacy client-specific picker — only reachable for accounts still on the
          old shape. New partner accounts use the picker above. */}
      {formData.accountType === 'employee' && formData.role === 'client' && (
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.linkedCustomer}</label>
          <select
            value={formData.linkedCustomer}
            onChange={(e) => setFormData({ ...formData, linkedCustomer: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          >
            <option value="">{T.customer}...</option>
            {customers.map((c) => (
              <option key={c._id} value={c._id}>{c.companyName}</option>
            ))}
          </select>
        </div>
      )}

      {/* B2C-specific: assigned projects + assigned branches + manager */}
      {(formData.role === 'b2c_manager' || formData.role === 'b2c_project_lead') && (
        <>
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">
              {lang === 'ar' ? 'المشاريع المعينة' : 'Assigned Projects'} ({formData.assignedProjects.length})
              {formData.role === 'b2c_manager' && (
                <span className="text-slate-500 text-xs font-normal ms-2">
                  {lang === 'ar' ? '(اختياري — له صلاحية كل المشاريع)' : '(optional — has access to all)'}
                </span>
              )}
            </label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
              {b2cProjects.length === 0 ? (
                <p className="text-slate-500 text-xs p-2">{lang === 'ar' ? 'لا توجد مشاريع — أنشئ مشاريع B2C أولاً' : 'No projects yet — create B2C projects first'}</p>
              ) : (
                b2cProjects.map((p) => (
                  <label key={p._id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.assignedProjects.includes(p._id)}
                      onChange={() => handleProjectToggle(p._id)}
                      className="rounded border-slate-300 bg-white text-[#f37121] focus:ring-[#f37121]/50"
                    />
                    <span className="text-slate-700 text-sm">{p.name}{p.code ? ` (${p.code})` : ''}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">
              {lang === 'ar' ? 'الفروع المعينة' : 'Assigned Branches'} ({formData.assignedBranches.length})
            </label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
              {branches.length === 0 ? (
                <p className="text-slate-500 text-xs p-2">{lang === 'ar' ? 'لا توجد فروع' : 'No branches'}</p>
              ) : (
                branches.map((b) => (
                  <label key={b._id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.assignedBranches.includes(b._id)}
                      onChange={() => handleBranchAssignToggle(b._id)}
                      className="rounded border-slate-300 bg-white text-[#f37121] focus:ring-[#f37121]/50"
                    />
                    <span className="text-slate-700 text-sm">{b.name}{b.city ? ` — ${b.city}` : ''}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          {formData.role === 'b2c_project_lead' && (
            <div>
              <label className="block text-slate-700 text-sm font-medium mb-1.5">
                {lang === 'ar' ? 'المدير المباشر (مدير B2C)' : 'Direct Manager (B2C Manager)'}
              </label>
              <select
                aria-label={txx.manager}
                value={formData.manager}
                onChange={(e) => setFormData({ ...formData, manager: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
              >
                <option value="">{lang === 'ar' ? 'بدون' : 'None'}</option>
                {b2cHeads.map((h) => (
                  <option key={h._id} value={h._id}>{h.firstName} {h.lastName} — {h.email}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {/* Employee-specific: assigned customers */}
      {formData.role === 'employee' && (
        <>
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">
              {T.assignedCustomers} ({formData.assignedCustomers.length})
            </label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
              {customers.length === 0 ? (
                <p className="text-slate-500 text-xs p-2">{T.noDataFound}</p>
              ) : (
                customers.map((c) => (
                  <label
                    key={c._id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={formData.assignedCustomers.includes(c._id)}
                      onChange={() => handleCustomerToggle(c._id)}
                      className="rounded border-slate-300 bg-white text-[#f37121] focus:ring-[#f37121]/50"
                    />
                    <span className="text-slate-700 text-sm">{c.companyName}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Remote-employee-specific: manager + which pages they can access */}
      {SHIPMENT_BRANCH_ROLES.includes(formData.role) && shipBranches.length > 0 && (
        <div>
          <label className="block text-slate-700 text-sm font-medium mb-1.5">
            {lang === 'ar' ? 'فروع صفحة الشحنات' : 'Shipments page branches'}
            <span className="text-slate-500 text-xs font-normal ms-2">{lang === 'ar' ? '(بدون اختيار = كل الفروع)' : '(none = all branches)'}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {shipBranches.map((b) => {
              const on = formData.shipmentBranches.includes(b.key);
              return (
                <button key={b.key} type="button" aria-pressed={on}
                  onClick={() => setFormData((prev) => ({ ...prev, shipmentBranches: on ? prev.shipmentBranches.filter((k) => k !== b.key) : [...prev.shipmentBranches, b.key] }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${on ? 'bg-[#f37121] border-[#f37121] text-white' : 'bg-white border-slate-300 text-slate-700'}`}>
                  {lang === 'ar' ? b.ar : b.en}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {formData.role === 'remote_employee' && (
        <>
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">
              {lang === 'ar' ? 'المدير المباشر (مدير العمل عن بُعد)' : 'Direct Manager (Remote Manager)'}
            </label>
            <select
              aria-label={txx.remoteManager}
              value={formData.manager}
              onChange={(e) => setFormData({ ...formData, manager: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            >
              <option value="">{lang === 'ar' ? 'بدون (السوبر أدمن فقط)' : 'None (super admin only)'}</option>
              {remoteManagers.map((m) => (
                <option key={m._id} value={m._id}>{m.firstName} {m.lastName} — {m.email}</option>
              ))}
            </select>
            {remoteManagers.length === 0 && (
              <p className="text-slate-500 text-xs mt-1">
                {lang === 'ar' ? 'لا يوجد مديرو عمل عن بُعد بعد — أنشئ مستخدمًا بدور "مدير العمل عن بُعد" أولاً.' : 'No remote managers yet — create a "Remote Manager" user first.'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">
              {lang === 'ar' ? 'الصفحات المسموح بها' : 'Allowed Pages'} ({formData.remoteAccess.length})
            </label>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
              {REMOTE_PAGE_OPTIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.remoteAccess.includes(p.key)}
                    onChange={() => handleRemoteAccessToggle(p.key)}
                    className="rounded border-slate-300 bg-white text-[#f37121] focus:ring-[#f37121]/50"
                  />
                  <span className="text-slate-700 text-sm">{lang === 'ar' ? p.ar : p.en}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );

  // Each filter reads one value per user; counts per value apply every other filter, as in HR.
  const QF_KEYS = [
    { key: 'role', ar: 'الدور', en: 'Role' },
    { key: 'section', ar: 'القسم', en: 'Department' },
    { key: 'manager', ar: 'المدير المباشر', en: 'Direct manager' },
    { key: 'hrFile', ar: 'ملف الموظف', en: 'HR file' },
    { key: 'status', ar: 'الحالة', en: 'Status' },
    { key: 'accountType', ar: 'نوع الحساب', en: 'Account type' },
    { key: 'branch', ar: 'الفرع', en: 'Branch' },
  ];
  const NONE = '__none';
  const isPartner = (u: UserRecord) => u.accountType === 'customer' || u.accountType === 'vendor' || u.role === 'client';
  const qfValue = (u: UserRecord, key: string): string => {
    switch (key) {
      case 'role': return u.role || '';
      case 'section': return serverRoles.find((r) => r.key === u.role)?.section || NONE;
      case 'manager': return u.manager?._id || NONE;
      case 'hrFile': return isPartner(u) ? 'partner' : u.linkedEmployee ? 'linked' : 'unlinked';
      case 'status': return getUserStatus(u);
      case 'accountType': return u.accountType === 'customer' || u.accountType === 'vendor' ? u.accountType : (u.role === 'client' ? 'customer' : 'employee');
      case 'branch': return u.branch?._id || NONE;
      default: return '';
    }
  };
  const qfLabel = (key: string, v: string, sample?: UserRecord): string => {
    const ar = lang === 'ar';
    if (v === NONE) return key === 'manager' ? (ar ? 'بدون مدير مباشر' : 'No direct manager') : key === 'branch' ? (ar ? 'بدون فرع' : 'No branch') : (ar ? 'بدون قسم' : 'No department');
    if (key === 'role') return roleLabels[v] || v;
    if (key === 'section') return getSectionLabel(v, ar ? 'ar' : 'en');
    if (key === 'manager') return sample?.manager ? `${sample.manager.firstName} ${sample.manager.lastName}` : v;
    if (key === 'hrFile') return ({ linked: ar ? 'مرتبط بملف موظف' : 'Linked', unlinked: ar ? 'غير مرتبط' : 'Not linked', partner: ar ? 'حساب عميل أو مورد' : 'Partner account' } as Record<string, string>)[v] || v;
    if (key === 'status') return statusLabels[v] || v;
    if (key === 'accountType') return ({ employee: ar ? 'موظف' : 'Employee', customer: ar ? 'عميل' : 'Customer', vendor: ar ? 'مورد' : 'Supplier' } as Record<string, string>)[v] || v;
    if (key === 'branch') return sample?.branch?.name || v;
    return v;
  };
  const passes = (u: UserRecord, skip?: string) => QF_KEYS.every(({ key }) => {
    if (key === skip || !qf[key]) return true;
    return qf[key].split(',').includes(qfValue(u, key));
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownUsers = useMemo(() => users.filter((u) => passes(u)), [users, qf, serverRoles]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const qfOptions = useMemo(() => Object.fromEntries(QF_KEYS.map(({ key }) => {
    const by = new Map<string, { n: number; sample: UserRecord }>();
    for (const u of users) {
      if (!passes(u, key)) continue;
      const v = qfValue(u, key);
      const cur = by.get(v);
      if (cur) cur.n += 1; else by.set(v, { n: 1, sample: u });
    }
    return [key, [...by.entries()].map(([value, x]) => ({ value, count: x.n, label: qfLabel(key, value, x.sample) }))
      .sort((a, b) => b.count - a.count)];
  })), [users, qf, serverRoles, lang]);

  // With filters on, the shown rows are offered first.
  const exportOptions = Object.keys(qf).length
    ? [{ key: 'shown', label: scope.shown, sheets: [{ name: T.title, rows: shownUsers, columns: exportColumns }] }, exportAll]
    : [exportAll];

  const menuRow = actionMenuId ? users.find((u) => u._id === actionMenuId) || null : null;
  // The table depends only on the list, language and role names. Rebuilt on every render, each keystroke in the create/edit form re-rendered every user row, which is what made the page hang.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const table = useMemo(() => (
    <DataTable
      columns={columns}
      data={shownUsers}
      searchable
      pageSize={50}
      searchPlaceholder={T.searchUsers}
      emptyMessage={T.noUsers}
      actions={(row: UserRecord) => (
        <button
          type="button"
          aria-label={lang === 'ar' ? 'إجراءات' : 'Actions'}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
            setActionMenuId((cur) => (cur === row._id ? null : row._id));
          }}
          className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      )}
    />
  ), [shownUsers, lang, serverRoles]);

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
          <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ExportMenu fileName="users" lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={T.downloadExcel} options={exportOptions} />
          <button
            type="button"
            onClick={() => { setLoading(true); fetchUsers(); }}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title={txx.refresh}
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-600 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <HrQuickFilters ar={lang === 'ar'} keys={QF_KEYS} value={qf} options={qfOptions}
          onChange={(v) => setQf(Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== '')) as Record<string, string>)} />
        {Object.keys(qf).length > 0 && (
          <span className="text-sm font-semibold text-slate-700">{lang === 'ar' ? `${shownUsers.length} من ${users.length} مستخدم` : `${shownUsers.length} of ${users.length} users`}</span>
        )}
      </div>

      {/* Data Table — memoized so typing in a form does not re-render every user row. */}
      {table}

      {menuRow && menuAnchor && (() => {
        const row = menuRow;
        const status = getUserStatus(row);
        const isCurrentUser = row._id === currentUser?._id;
        return (
          <RowMenu anchor={menuAnchor} onClose={closeMenu} rtl={lang === 'ar'}>
          <button
            type="button"
            onClick={() => openEditModal(row)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <Edit className="w-3.5 h-3.5" />
            {T.edit}
          </button>
          {!isCurrentUser && (
            <button
              type="button"
              onClick={() => handleToggleLock(row)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
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
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {T.resetPassword}
          </button>
          {!isCurrentUser && (
            <button
              type="button"
              onClick={() => openDeleteConfirm(row)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {T.delete}
            </button>
          )}
          </RowMenu>
        );
      })()}

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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <UserCog className="w-5 h-5 text-[#f37121]" />
                    {T.addUser}
                  </h2>
                  <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-slate-900">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleCreate} className="p-5 space-y-4">
                  {renderFormFields(false)}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <Edit className="w-5 h-5 text-[#f37121]" />
                    {T.editUser}
                  </h2>
                  <button type="button" onClick={() => setShowEditModal(false)} className="text-slate-500 hover:text-slate-900">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleEdit} className="p-5 space-y-4">
                  {renderFormFields(true)}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowEditModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <KeyRound className="w-5 h-5 text-[#f37121]" />
                    {T.resetPassword}
                  </h2>
                  <button type="button" onClick={() => setShowResetModal(false)} className="text-slate-500 hover:text-slate-900">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleResetPassword} className="p-5 space-y-4">
                  {resetError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">
                      {resetError}
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <p className="text-slate-500 text-xs uppercase font-medium">{T.user}</p>
                    <p className="text-slate-900 text-sm font-medium mt-0.5">
                      {selectedUser.firstName} {selectedUser.lastName} ({selectedUser.email})
                    </p>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.newPassword}</label>
                    <div className="relative">
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pe-10"
                        required
                        minLength={8}
                        placeholder={txx.newPasswordPlaceholder}
                      />
                      <button
                        type="button"
                        aria-label={showResetPassword ? txx.hidePassword : txx.showPassword}
                        onClick={() => setShowResetPassword(!showResetPassword)}
                        className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 transition-colors"
                      >
                        {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
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
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg mb-3">{T.deleteUser}</h3>
                    <p className="text-slate-500 text-sm mt-2">
                      {T.deleteConfirmGeneric}{' '}
                      <span className="text-slate-900 font-medium">
                        {selectedUser.firstName} {selectedUser.lastName}
                      </span>
                    </p>
                  </div>
                  <div className="flex justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
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
