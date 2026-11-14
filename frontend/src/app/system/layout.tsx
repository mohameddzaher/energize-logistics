'use client';
import NewVersionWatcher from '@/components/system/NewVersionWatcher';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { getLayoutTranslations, NAV_LABEL_KEYS, getSectionLabel, getRoleLabel } from '@/lib/translations';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, FileText, CreditCard, Phone,
  AlertTriangle, UserCog, ClipboardList, BarChart3, Settings, Lock,
  LogOut, Bell, Menu, X, ChevronDown, ChevronRight, ChevronLeft, Shield, Bot,
  Briefcase, TrendingUp, ListTodo, Building2, Wallet,
  Store, Truck, Tags, Languages, Wrench, Hammer, ShoppingCart, MessageSquare, Package,
  Target, Award, CalendarDays, Clock, Megaphone, CalendarCheck,
  Calculator, Scale, BookOpen, Gauge, Ship, ScrollText, Landmark,
  Activity, Car, UserSquare, IdCard, MapPin, Globe, Boxes, Ruler, Palette, ShieldCheck, PackageSearch, SlidersHorizontal,
  Thermometer, Satellite, Crown, Container, FileBarChart,
  Compass, Handshake, Gavel, MonitorCog, LifeBuoy, Laptop, Server, RefreshCw, Inbox, LayoutGrid, Mail, Send,
  CalendarClock, TriangleAlert, ShieldQuestion,
  FileSignature, PhoneCall, UserCheck, Fuel, ClipboardCheck,
  Receipt, Banknote, Layers, Link2,
  Camera, Loader2,
  CheckCircle2, Info,
  KeySquare,
  Archive,
  MonitorPlay, Clapperboard, BadgeDollarSign,
  UserRound, BellRing, Route as RouteIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { downloadExportJob } from '@/lib/backgroundExport';
import { notificationHref, notificationTone, sinceLabel } from '@/lib/notificationLink';
import { useSocket } from '@/hooks/useSocket';
import { homeRouteForRole, landingFor } from '@/lib/roleRoutes';
import { OPS_SECTION_ROLES as OPS_ROLES } from '@/lib/ops';
import { isBrParticipant, isBrRunner } from '@/lib/businessReview';
import { SO_EDIT_ROLES as SO_ROLES } from '@/lib/shipmentOrders';
import { canAsk as canAskShipment, canPlace as canPlaceShipment, isSalesUser, isVendorUser } from '@/lib/shipmentRequests';
import { VENDOR_NAV_ROLES } from '@/lib/vendors';
import { FLEET_EDIT_ROLES as FLEET_ROLES, FLEET_ADMIN_ROLES } from '@/lib/fleet';
import { LS2_SECTION_ROLES } from '@/lib/ls2';

import { isManagedSection, canAccessSection, canAccessPage } from '@/lib/sections';
import { isDataRole } from '@/lib/dataSupport';
import { ALL_ROLES, roleIn, rightsRoleOf } from '@/lib/roles';
import { jpMember, jpManager, jpTop } from '@/lib/jpNav';
import { PERF_STAFF_ROLES } from '@/lib/performance';
import { WALLET_ROLES, WALLET_DASHBOARD_ROLES, WALLET_VIEW_ONLY_ROLES } from '@/lib/wallet';

// Section-KPI pages render TeamBoard, which admits PERF_STAFF_ROLES only — a
// nav entry offering the link to anyone else is a guaranteed dead-end screen.
// Intersecting here keeps every section's list in sync with the page's gate.
const kpiRoles = (roles: string[]) => roles.filter((r) => PERF_STAFF_ROLES.includes(r));

// Mirrors REPORT_ROLES in backend/src/controllers/reportController.js — reports
// cross sections, so they are gated by role rather than by the section matrix.
const REPORT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'moderator',
  'operations_manager', 'operations_team_leader', 'operations_staff', 'fleet_manager', 'fleet_team_leader', 'fleet_supervisor',
  'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant',
  'crm_manager', 'crm_team_leader', 'crm_team_lead', 'sales_manager', 'sales_team_leader', 'contracts_manager', 'contracts_team_leader',
  'customs_manager', 'customs_team_leader', 'procurement_manager', 'procurement_team_leader',
  'bd_manager', 'bd_team_leader', 'marketing_manager', 'marketing_team_leader', 'administration_staff',
];
import { DialogProvider } from '@/components/system/DialogProvider';
import DateFieldLocale from '@/components/system/DateFieldLocale';
// Sidebar visibility for the new sections. Managed sections are additionally
// gated by the per-role permission matrix (canAccessSection).
const MARKETING_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'marketing_manager', 'marketing_team_leader', 'marketing_specialist', 'moderator', 'bd_manager', 'bd_team_leader'];
const BD_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'bd_manager', 'bd_team_leader', 'bd_specialist', 'sales_manager', 'sales_team_leader', 'crm_manager', 'crm_team_leader', 'operations_manager', 'operations_team_leader'];
const IT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'];
// Administrative affairs (secretariat): the shared office task board.
const ADMINISTRATION_ROLES = ['super_admin', 'admin', 'administration_staff', 'bd_manager', 'bd_team_leader', 'it_manager', 'it_team_leader', 'it_specialist'];
// Contracts management: 3PL vendor contracts, analysis and other departments' contracts.
const CONTRACTS_ROLES = ['super_admin', 'admin', 'contracts_manager', 'contracts_team_leader', 'contracts_staff', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader',
  'sales_manager', 'sales_team_leader', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'];

// Self service (my profile / my leaves / my requests) belongs to EVERY employee, managers included, and the only non-employee login is `client`, an external customer-portal account.
// The rule is every internal role, so new roles get self service without a hand-written list; external partners are excluded. The Media Go account is also an external partner and sees one screen (MEDIAGO_ROLE below).
// Dashboards: every department dashboard, the JP dashboard, the executive summary and the wallets dashboard, plus later ones added by name.
const isDashboardPath = (p: string) => /\/(dashboard|jp-dashboard|wallet-dashboard|executive)(\/|$)/.test(p);
const EXTERNAL_ROLES = ['client', 'partner', 'customer_portal', 'vendor_portal', 'mediago_account'];

// Scoped account: a partner sees a single page (backend/src/config/scopedRoles); the sidebar shows only it and every other route redirects to it. The real guard is server-side (middleware/scopedRoleFence); this avoids opening a screen whose endpoints would reject it.
const SCOPED_HOME: Record<string, string> = { mediago_account: '/system/b2c/mediago-complaints' };
// All pages of the scoped account; mirrors `pages` in backend/config/scopedRoles.js.
const SCOPED_PAGES: Record<string, string[]> = { mediago_account: ['/system/b2c/mediago-complaints', '/system/b2c/mediago-ads'] };
// role-only: not an action gate; it separates employees from customers and suppliers.
const isInternal = (role?: string | null) => !!role && !EXTERNAL_ROLES.includes(role);

// Collections department. Access is managed by the permission matrix; this list only documents who has it by default.
const COLLECTIONS_NAV_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist',
  'collections_manager', 'collections_team_leader', 'collections_staff',
  'operations_manager', 'operations_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant',
];

// Self service is derived, not hand-written: a manual role list dropped roles added later. The source is `lib/roles.ts`, generated from `config/roles.js`: every role that is not an external partner. A new role gets self service from day one.
const SELF_SERVICE_ROLES = ALL_ROLES.filter((r) => !EXTERNAL_ROLES.includes(r));

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
  section?: string;
  // For Remote pages: a remote_employee only sees this if their remoteAccess
  // includes this key. Managers/admins see every remote item regardless.
  remoteKey?: string;
  // For Portal pages: the partner only sees this link if they have work of at
  // least one of these service kinds (heavy_transport, customs, finance…).
  portalService?: string[];
  // A rule, evaluated against the signed-in user. Used where a frozen role list
  // would go stale — e.g. Business Review, where "any *_manager" is the rule.
  visible?: (u: { role?: string | null }) => boolean;
  // Inside a matrix-managed section the roles list is normally IGNORED (the
  // permission matrix decides). `restrict: true` re-applies it as an EXTRA
  // filter for the few items whose own page rejects junior roles anyway
  // (KPI evaluation boards, section settings, supervisor assignment) — a link
  // the page will refuse is worse than no link.
  restrict?: boolean;
  // The page's own grant opens it even when its section is closed to the role (the loads board for sales; config/opsBoard).
  pageOpens?: boolean;
}

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <SystemLayoutInner>{children}</SystemLayoutInner>
    </LanguageProvider>
  );
}

function SystemLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, isAuthenticated, refreshUser } = useAuth();
  const { lang, toggleLang, isRTL, applyAccountLang } = useLanguage();
  // Partner accounts open in their own language (English unless they chose Arabic).
  useEffect(() => { if (user?.role) applyAccountLang(user.role); }, [user?.role, applyAccountLang]);
  const L = getLayoutTranslations(lang);
  const router = useRouter();
  const pathname = usePathname() || '';
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  // Sections collapsed by default — user clicks a section header to expand it.
  // Persists across navigation because this layout stays mounted between pages.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // A click is acknowledged at once while the code is fetched first. Page code loads on first open and collapsed sections are not prefetched by Next, so an immediate click would wait with no feedback.
  // So section pages are prefetched on open and on link hover (`router.prefetch`, a silent download), and the clicked link shows a bar and spinner until the new page renders.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => { setPendingHref(null); }, [pathname]);
  // Prefetch yields to the real request: prefetching a whole section at once starts about twenty downloads that compete with the current screen. It is deferred to idle time (`requestIdleCallback`), never repeated, capped at eight per section, and a hovered link is prefetched immediately.
  const prefetched = useRef<Set<string>>(new Set());
  const prefetch = useCallback((href: string, soon = false) => {
    if (prefetched.current.has(href)) return;
    prefetched.current.add(href);
    const run = () => { try { router.prefetch(href); } catch (_) { /* Prefetch is an optimization, not a requirement. */ } };
    if (soon || typeof window === 'undefined') { run(); return; }
    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') ric(run, { timeout: 3000 }); else setTimeout(run, 300);
  }, [router]);
  const prefetchSection = useCallback((items: NavItem[]) => {
    items.slice(0, 8).forEach((i) => prefetch(i.href));
  }, [prefetch]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  }, []);

  // Number boxes change on the mouse wheel and arrow keys, which silently turned a
  // typed 1600 into 1598. The value should only ever be what was typed.
  useEffect(() => {
    const isNumberBox = (el: Element | null) => el instanceof HTMLInputElement && el.type === 'number';
    const onWheel = () => { if (isNumberBox(document.activeElement)) (document.activeElement as HTMLElement).blur(); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isNumberBox(e.target as Element)) e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('wheel', onWheel); document.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push(`/login?returnTo=${pathname}`);
    }
  }, [loading, isAuthenticated, router, pathname]);

  // Remote roles live inside /system/remote/*, plus the shared HR self-service
  // pages under /system/hr/* (their own profile/leaves/requests, and — when they
  // manage others — approving their team's leave). Any OTHER section would fire
  // role-gated API calls and surface "Insufficient permissions", so bounce them
  // back to their home page instead.
  useEffect(() => {
    if (loading || !user) return;
    const scopedHome = SCOPED_HOME[user.role];
    if (scopedHome) {
      const allowed = SCOPED_PAGES[user.role] || [scopedHome];
      if (!allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`))) router.replace(scopedHome);
      return;
    }
    const isRemoteRole = user.role === 'remote_employee' || rightsRoleOf(user.role) === 'remote_manager';
    if (isRemoteRole && !pathname.startsWith('/system/remote') && !pathname.startsWith('/system/hr')) {
      router.replace(homeRouteForRole(user.role));
    }
  }, [loading, user, pathname, router]);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/notifications?unreadOnly=true&limit=10');
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
    }
  }, [isAuthenticated, fetchNotifications]);

  /** Notification of a ready export file: fetched, then downloaded. */
  const downloadExport = (n: any) => {
    api.get<{ job: any }>(`/api/exports/jobs/${n.relatedEntityId}`)
      .then(({ job }) => downloadExportJob(job))
      .catch(() => { /* The file expired or was deleted. */ });
    setShowNotifications(false);
  };

  const markAllRead = async () => {
    try {
      await api.put('/api/notifications/read-all');
      setNotifications([]);
      setUnreadCount(0);
    } catch {}
  };

  const navItems: NavItem[] = [
    // Main
    // Page + /api/analytics/super-overview admit super_admin/admin ONLY — offering
    // the link to the IT roles was a guaranteed dead-end screen.
    // Top management: the flagged accounts (User.isTopManagement) and super admins; the server gate is routes/topManagement.
    { href: '/system/top-management', label: lang === 'ar' ? 'طلبات الإجازات' : 'Leave Requests', icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Top Management', visible: (u: any) => u?.isTopManagement === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(u?.role) },
    { href: '/system/top-management/requests', label: lang === 'ar' ? 'طلبات الموظفين' : 'Staff Requests', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Top Management', visible: (u: any) => u?.isTopManagement === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(u?.role) },
    { href: '/system/chairman', label: lang === 'ar' ? 'اعتمادات رئيس مجلس الإدارة' : 'Chairman’s Approvals', icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Top Management', visible: (u: any) => u?.isChairman === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(u?.role) },
    { href: '/system/top-management/activity', label: lang === 'ar' ? 'نشاط الشركة المباشر' : 'Live Company Activity', icon: <Activity className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Top Management', visible: (u: any) => u?.isTopManagement === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(u?.role) },
    { href: '/system/executive', label: lang === 'ar' ? 'النظرة التنفيذية' : 'Executive Overview', icon: <Crown className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Main' },
    // Top-management plan to department managers; its dashboard is for the system admin only (a department manager finds the management plan inside their department).
    { href: '/system/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Main', visible: (u) => jpTop(u) },
    { href: '/system/management-jp/dashboard', label: lang === 'ar' ? 'لوحة خطّة الإدارة' : 'Management JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Main', visible: (u) => jpTop(u) },
    // Arrears page removed: it belonged to a deleted section, read the empty `Invoice` and `Customer` collections, and crashed after its endpoint changed. Collections -> debt aging answers it from real invoices with buckets, filters and credit limit.
    { href: '/system/credit-alerts', label: L.creditAlerts, icon: <Shield className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'employee', 'moderator'], section: 'Main' },
    // Operations
    { href: '/system/operations', label: L.operations, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'collections_manager', 'collections_team_leader', 'collections_staff'], section: 'Operations', pageOpens: true },
    // Margin is not shown to everyone who opens the section: the private operations page shows our profit per load, so it is narrower than the workflow (management and finance). `restrict` keeps the menu honest, since a link the page rejects is worse than none. The guard is server-side (routes/operationsPrivate).
    // Loads board: the workflow without billing and collection columns. Opened by its page, so sales reach it without the rest of Operations (config/opsBoard).
    { href: '/system/operations/loads', label: lang === 'ar' ? 'متابعة الحمولات والشحنات' : 'Loads & Shipments', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'sales_manager', 'sales_team_leader', 'sales_rep', 'data_manager', 'data_analyst'], section: 'Operations', pageOpens: true },
    { href: '/system/operations/private', label: lang === 'ar' ? 'التشغيل — خاصّ' : 'Operations — private', icon: <Lock className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Operations', restrict: true },
    // Customer attribute is readable by whoever opens the operations page and writable only by its managers; the server enforces it and this list only gates who reaches the endpoint.
    { href: '/system/operations/payment-types', label: lang === 'ar' ? 'أنواع الدفع' : 'Payment Types', icon: <Banknote className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant', 'collections_manager', 'collections_team_leader', 'collections_staff'], section: 'Operations' },
    // Customers register: same screen as in shipment orders so people working on manifests read the customer from their own section; one shared component keeps the copies identical.
    { href: '/system/operations/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'collections_manager', 'collections_team_leader', 'collections_staff'], section: 'Operations' },
    // A section's first page is its dashboard: opening a section asks how it is doing, not for the first table row. It used to be last in procurement and opened on the suppliers register.
    { href: '/system/procurement/dashboard', label: L.procurementDashboard, icon: <ShoppingCart className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'], section: 'Procurement' },
    { href: '/system/vendors', label: L.vendors, icon: <Store className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'operations_staff', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'], section: 'Procurement' },
    // Custody lists come from one place. They were hand-written here and in the branch selector condition, so adding the accountant on the server left both stale: his endpoints were open but he saw no link.
    { href: '/system/wallet', label: L.wallet, icon: <Wallet className="w-5 h-5" />, roles: WALLET_ROLES, section: 'Operations' },
    { href: '/system/wallet-dashboard', label: L.walletDashboard, icon: <BarChart3 className="w-5 h-5" />, roles: WALLET_DASHBOARD_ROLES, section: 'Operations' },
    { href: '/system/operations/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Operations', visible: (u) => jpMember(u, 'Operations') },
    { href: '/system/operations/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Operations', visible: (u) => jpManager(u, 'Operations') },
    { href: '/system/operations/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Operations', visible: (u) => jpManager(u, 'Operations') && !jpTop(u) },
    { href: '/system/operations/customer-requests', label: lang === 'ar' ? 'التواصل مع العملاء' : 'Customer Communication', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator'], section: 'Operations' },
    { href: '/system/operations/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator'], section: 'Operations' },
    { href: '/system/operations/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator']), section: 'Operations', restrict: true },
    // Collections section: four pages (dashboard, customers and vendors registers, department settings) plus the two fixed pages every section has (my tasks and complaints).
    { href: '/system/collections-dept/dashboard', label: lang === 'ar' ? 'لوحة التحصيل' : 'Collections Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    // Invoices: the department works from here. Collections chases invoices, not manifests, so these pages come before the registers.
    { href: '/system/collections-dept/invoices/tax', label: lang === 'ar' ? 'الفواتير الضريبية' : 'Tax Invoices', icon: <Receipt className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    { href: '/system/collections-dept/invoices/cash', label: lang === 'ar' ? 'فواتير الكاش' : 'Cash Invoices', icon: <Banknote className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    // Collections ledger: aging register first (the morning screen: how much is owed and since when), then the invoice ledger in detail, then the plan and team.
    { href: '/system/collections-dept/aging', label: lang === 'ar' ? 'أعمار الديون' : 'Aging', icon: <Layers className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    { href: '/system/collections-dept/ledger', label: lang === 'ar' ? 'دفتر الفواتير' : 'Invoice Ledger', icon: <BookOpen className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    // Cases: customers under negotiation or in litigation; a customer state, not an invoice state.
    { href: '/system/collections-dept/cases', label: lang === 'ar' ? 'القضايا' : 'Cases', icon: <Scale className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    { href: '/system/collections-dept/plan', label: lang === 'ar' ? 'الخطة اليومية' : 'Daily Plan', icon: <CalendarCheck className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    { href: '/system/collections-dept/team', label: lang === 'ar' ? 'الفريق' : 'The Team', icon: <UserCog className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    // Link review is the manager's decision only; merging moves debt.
    { href: '/system/collections-dept/links', label: lang === 'ar' ? 'ربط الحسابات' : 'Account Linking', icon: <Link2 className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'collections_manager', 'collections_team_leader'], section: 'Collections', restrict: true },
    { href: '/system/collections-dept/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    { href: '/system/collections-dept/suppliers', label: lang === 'ar' ? 'الموردين' : 'Suppliers', icon: <Truck className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    // Wallet shown read-only to collections: the same two operations pages, opened here because the operations section is closed to them. See config/walletViewOnly.
    { href: '/system/wallet', label: lang === 'ar' ? 'محفظة الفروع (عرض)' : 'Branch wallets (view)', icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', ...WALLET_VIEW_ONLY_ROLES], section: 'Collections', restrict: true },
    { href: '/system/wallet-dashboard', label: lang === 'ar' ? 'لوحة المحفظة (عرض)' : 'Wallet dashboard (view)', icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', ...WALLET_VIEW_ONLY_ROLES], section: 'Collections', restrict: true },
    // The operations manifest page from inside their section: the manifest is the collections worksheet (what is owed to us and by us; the invoice and collection date are written there), so the link saves searching a section they do not have.
    { href: '/system/operations', label: lang === 'ar' ? 'سير عمل التشغيل' : 'Operations Workflow', icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'collections_manager', 'collections_team_leader', 'collections_staff'], section: 'Collections', restrict: true },
    { href: '/system/collections-dept/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Collections', visible: (u) => jpMember(u, 'Collections') },
    { href: '/system/collections-dept/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Collections', visible: (u) => jpManager(u, 'Collections') },
    { href: '/system/collections-dept/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Collections', visible: (u) => jpManager(u, 'Collections') && !jpTop(u) },
    { href: '/system/collections-dept/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: COLLECTIONS_NAV_ROLES, section: 'Collections' },
    { href: '/system/collections-dept/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(COLLECTIONS_NAV_ROLES), section: 'Collections', restrict: true },
    { href: '/system/collections-dept/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'Section Settings', icon: <SlidersHorizontal className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'collections_manager', 'collections_team_leader'], section: 'Collections' },
    // Customs Clearance
    // Operations Platform: live mirror of the external UPL field-ops system (B2B: Fleet + 3PL)
    { href: '/system/ops', label: lang === 'ar' ? 'لوحة الأوبريشن' : 'Ops Dashboard', icon: <Activity className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/shipments', label: lang === 'ar' ? 'الشحنات' : 'Shipments', icon: <Truck className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/drivers', label: lang === 'ar' ? 'السائقون' : 'Drivers', icon: <Users className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/cars', label: lang === 'ar' ? 'المركبات' : 'Cars', icon: <Car className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/car-owners', label: lang === 'ar' ? 'أصحاب المركبات' : 'Car Owners', icon: <UserSquare className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/users', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <UserSquare className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/branches', label: lang === 'ar' ? 'الفروع' : 'Branches', icon: <Building2 className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/cities', label: lang === 'ar' ? 'المدن' : 'Cities', icon: <MapPin className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/countries', label: lang === 'ar' ? 'الدول' : 'Countries', icon: <Globe className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/truck-types', label: lang === 'ar' ? 'أنواع الشاحنات' : 'Truck Types', icon: <Boxes className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/truck-sizes', label: lang === 'ar' ? 'أحجام الشاحنات' : 'Truck Sizes', icon: <Ruler className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/load-types', label: lang === 'ar' ? 'أنواع الحمولة' : 'Load Types', icon: <Package className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/car-brands', label: lang === 'ar' ? 'ماركات المركبات' : 'Car Brands', icon: <Tags className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/car-colors', label: lang === 'ar' ? 'ألوان المركبات' : 'Car Colors', icon: <Palette className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },

    // Shipment Orders: standalone trial. Creates shipments natively instead of on the external UPL system, fully independent from the Operations Platform; if the trial works the team moves here and the integration is retired.
    // Analytics first (the dashboard was merged into it): opening the section asks how it is doing.
    { href: '/system/shipment-orders/analytics', label: lang === 'ar' ? 'التحليلات' : 'Analytics', icon: <BarChart3 className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    { href: '/system/shipment-orders', label: lang === 'ar' ? 'الشحنات' : 'Shipments', icon: <PackageSearch className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    // Two-step creation: sales asks, the vendors team places. Each sees only its own step.
    { href: '/system/shipment-orders/request', label: lang === 'ar' ? 'طلب شحنة' : 'Shipment Request', icon: <ClipboardList className="w-5 h-5" />, roles: [], section: 'Shipment Orders', visible: (u) => canAskShipment(u) && !isVendorUser(u) },
    { href: '/system/shipment-orders/requests', label: lang === 'ar' ? 'الطلبات من المبيعات' : 'Requests from Sales', icon: <Inbox className="w-5 h-5" />, roles: [], section: 'Shipment Orders', visible: (u) => canPlaceShipment(u) && !isSalesUser(u) },
    { href: '/system/shipment-orders/chat', label: lang === 'ar' ? 'مساعد الإنشاء' : 'Create Assistant', icon: <Bot className="w-5 h-5" />, roles: [], section: 'Shipment Orders', visible: (u) => SO_ROLES.includes(u?.role || '') && !isSalesUser(u) && !isVendorUser(u) },
    { href: '/system/shipment-orders/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    { href: '/system/shipment-orders/fleet', label: lang === 'ar' ? 'الموردون والمركبات' : 'Suppliers & Vehicles', icon: <Truck className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    // Department settings gather what was scattered: waybill numbering, department lists and the status cycle. The form settings used to be a page of their own.
    { href: '/system/shipment-orders/permissions', label: lang === 'ar' ? 'الصلاحيات' : 'Permissions', icon: <ShieldCheck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'data_manager', 'data_analyst'], section: 'Shipment Orders' },
    { href: '/system/shipment-orders/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'Section Settings', icon: <SlidersHorizontal className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'shipment_orders_manager', 'shipment_orders_team_leader'], section: 'Shipment Orders' },
    { href: '/system/shipment-orders/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Shipment Orders', visible: (u) => jpMember(u, 'Shipment Orders') },
    { href: '/system/shipment-orders/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Shipment Orders', visible: (u) => jpManager(u, 'Shipment Orders') },
    { href: '/system/shipment-orders/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Shipment Orders', visible: (u) => jpManager(u, 'Shipment Orders') && !jpTop(u) },
    { href: '/system/shipment-orders/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader'], section: 'Shipment Orders' },
    { href: '/system/shipment-orders/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader']), section: 'Shipment Orders', restrict: true },

    // Vendors management: the carriers we buy loads from, their register, the sales requests to place, and the section's two analyses.
    { href: '/system/vendors-mgmt', label: lang === 'ar' ? 'تحليل القسم' : 'Section Analysis', icon: <BarChart3 className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/daily', label: lang === 'ar' ? 'التحليل التشغيلي اليومي' : 'Daily Operations', icon: <Activity className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/requests', label: lang === 'ar' ? 'الطلبات من المبيعات' : 'Requests from Sales', icon: <Inbox className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/vendors', label: lang === 'ar' ? 'الموردون' : 'Carriers', icon: <Building2 className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/approvals', label: lang === 'ar' ? 'اعتماد الموردين' : 'Carrier Approvals', icon: <ClipboardCheck className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/vehicles', label: lang === 'ar' ? 'السيارات' : 'Trucks', icon: <Truck className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/drivers', label: lang === 'ar' ? 'الفريلانسرز (نقل ثقيل)' : 'Freelancers (heavy)', icon: <UserRound className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/alerts', label: lang === 'ar' ? 'التنبيهات' : 'Alerts', icon: <BellRing className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/routes', label: lang === 'ar' ? 'المسارات والأسعار المعتمدة' : 'Routes & Approved Prices', icon: <RouteIcon className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'Section Settings', icon: <SlidersHorizontal className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Vendors Management', visible: (u) => jpMember(u, 'Vendors Management') },
    { href: '/system/vendors-mgmt/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Vendors Management', visible: (u) => jpManager(u, 'Vendors Management') },
    { href: '/system/vendors-mgmt/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Vendors Management', visible: (u) => jpManager(u, 'Vendors Management') && !jpTop(u) },
    { href: '/system/vendors-mgmt/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: VENDOR_NAV_ROLES, section: 'Vendors Management' },
    { href: '/system/vendors-mgmt/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'vendors_manager', 'vendors_team_leader', 'operations_manager', 'operations_team_leader']), section: 'Vendors Management', restrict: true },

    // Fleet Management: our own trucks.
    { href: '/system/fleet/board', label: lang === 'ar' ? 'اللوحة الرئيسية' : 'Fleet Board', icon: <LayoutGrid className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet', label: lang === 'ar' ? 'الحمولات' : 'Shipments', icon: <Truck className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/requests', label: lang === 'ar' ? 'طلبات من المبيعات' : 'Requests from Sales', icon: <Inbox className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/arrivals', label: lang === 'ar' ? 'المتوقع للوصول' : 'Expected Arrivals', icon: <CalendarClock className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    // One page with two tabs: overview, and loads plus driver expenses. They were two similarly named entries for the same thing.
    { href: '/system/fleet/dashboard', label: lang === 'ar' ? 'التحليلات' : 'Analytics', icon: <BarChart3 className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/drivers', label: lang === 'ar' ? 'السائقون' : 'Drivers', icon: <UserSquare className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    // Driver expenses: read by department roles; only marking as paid is restricted to accounts. The guard is on the route, not the menu (see EXPENSE_PAY_ROLES in routes/fleet).
    { href: '/system/fleet/driver-expenses', label: lang === 'ar' ? 'مصاريف السوّاق' : 'Driver Expenses', icon: <Wallet className="w-5 h-5" />, roles: [...FLEET_ROLES, 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Fleet Management' },
    { href: '/system/fleet/driver-kpis', label: lang === 'ar' ? 'تقييم السائقين' : 'Driver KPIs', icon: <Target className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    // Vehicle status directly after 'our cars': both screens describe the same truck, one says what it is, the other how it is now.
    { href: '/system/fleet/health', label: lang === 'ar' ? 'حالة المركبات' : 'Vehicle Health', icon: <Activity className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/vehicles', label: lang === 'ar' ? 'سياراتنا' : 'Our Vehicles', icon: <Car className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/vehicle-logs', label: lang === 'ar' ? 'سجلّات السيارات' : 'Vehicle Logs', icon: <ClipboardList className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/assign', label: lang === 'ar' ? 'توزيع المشرفين' : 'Assign Supervisors', icon: <UserCog className="w-5 h-5" />, roles: FLEET_ADMIN_ROLES, section: 'Fleet Management', restrict: true },
    { href: '/system/fleet/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'Fleet Settings', icon: <Settings className="w-5 h-5" />, roles: FLEET_ADMIN_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Fleet Management', visible: (u) => jpMember(u, 'Fleet Management') },
    { href: '/system/fleet/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Fleet Management', visible: (u) => jpManager(u, 'Fleet Management') },
    { href: '/system/fleet/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Fleet Management', visible: (u) => jpManager(u, 'Fleet Management') && !jpTop(u) },
    { href: '/system/fleet/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(FLEET_ROLES), section: 'Fleet Management', restrict: true },
    { href: '/system/fleet/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: FLEET_ROLES, section: 'Fleet Management' },

    // Department dashboard first: how work is going before the status of a single transaction. It is for the whole team: operations with no financial figures. Analytics (profits) are for the system admin and department manager only, and the server guards them with the same list.
    { href: '/system/customs/dashboard', label: lang === 'ar' ? 'لوحة القسم' : 'Section Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/analytics', label: lang === 'ar' ? 'تحليلات قسم التخليص' : 'Customs Analytics', icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'customs_manager', 'customs_team_leader'], section: 'Customs', restrict: true },
    { href: '/system/customs', label: L.customsClearance, icon: <Ship className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    // Clearance pages: the clearance guide is hidden from navigation but kept in code since it is written and working, and restoring it takes one line; deleting it would lose the work.
    { href: '/system/customs/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/agents', label: lang === 'ar' ? 'وكلاء الشحن' : 'Shipping Agents', icon: <Ship className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/carriers', label: lang === 'ar' ? 'الناقلون' : 'Carriers', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/contracts', label: lang === 'ar' ? 'العقود' : 'Contracts', icon: <FileSignature className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    // Department settings follow the permissions page like the rest of its pages, in all sections. `restrict` limited them to manager and management, so a staff member granted access from the permissions page could not find them in the menu; whoever should not see them is blocked from there.
    { href: '/system/customs/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'Section Settings', icon: <SlidersHorizontal className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'customs_manager', 'customs_team_leader'], section: 'Customs' },
    // Vehicles & Authorizations: super admin + HR + Accounting.
    { href: '/system/vehicles/registry/overview', label: lang === 'ar' ? 'نظرة شاملة' : 'Overview', icon: <LayoutGrid className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry', label: lang === 'ar' ? 'سجل المركبات' : 'Vehicle Registry', icon: <Car className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/expiring', label: lang === 'ar' ? 'الانتهاءات والتجديد' : 'Expiries & Renewals', icon: <CalendarClock className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/claims', label: lang === 'ar' ? 'الحوادث والمطالبات' : 'Accidents & Claims', icon: <TriangleAlert className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/corporate', label: lang === 'ar' ? 'وثائق تأمين الشركة' : 'Company Policies', icon: <ShieldCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/records', label: lang === 'ar' ? 'سجلّات القسم' : 'Registers', icon: <Boxes className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    // One page per document family. The source file groups each family with a colour (insurance, fuel card, tracking, operating cards, driving licences, inspection, authorizations). The data was stored with no column to show it, and one table would exceed forty columns, so each family is a screen following the paper the department knows. Same roles as the other vehicle pages: a granted section is fully open.
    { href: '/system/vehicles/registry/insurance/vehicles', label: lang === 'ar' ? 'تأمين المركبات' : 'Vehicle Insurance', icon: <ShieldCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/operating-cards', label: lang === 'ar' ? 'بطاقات التشغيل' : 'Operating Cards', icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/driver-cards', label: lang === 'ar' ? 'بطاقات السائقين' : 'Driver Cards', icon: <IdCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/authorizations', label: lang === 'ar' ? 'التفاويض' : 'Authorisations', icon: <UserCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/fuel-cards', label: lang === 'ar' ? 'بترو اب — شرائح الوقود' : 'Petro App Cards', icon: <Fuel className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/gps', label: lang === 'ar' ? 'أجهزة التتبّع GPS' : 'GPS Devices', icon: <Satellite className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/licenses', label: lang === 'ar' ? 'رخص السير' : 'Vehicle Licences', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/inspection', label: lang === 'ar' ? 'الفحص الدوري' : 'Periodic Inspection', icon: <ClipboardCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    // Vehicles whose service ended: kept with their history, out of every active list; restored from here.
    { href: '/system/vehicles/registry/archive', label: lang === 'ar' ? 'الأرشيف' : 'Archive', icon: <Archive className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/registry/dashboard', label: lang === 'ar' ? 'تحليلات المركبات' : 'Registry Analytics', icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Vehicles', visible: (u) => jpMember(u, 'Vehicles') },
    { href: '/system/vehicles/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Vehicles', visible: (u) => jpManager(u, 'Vehicles') },
    { href: '/system/vehicles/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Vehicles', visible: (u) => jpManager(u, 'Vehicles') && !jpTop(u) },
    { href: '/system/vehicles/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'Section Settings', icon: <SlidersHorizontal className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'vehicles_manager', 'vehicles_team_leader'], section: 'Vehicles' },
    { href: '/system/vehicles/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant']), section: 'Vehicles', restrict: true },
    // Location Solutions: live Wialon GPS/telemetry mirror.
    { href: '/system/ls2', label: lang === 'ar' ? 'لوحة التتبّع' : 'Telemetry Dashboard', icon: <Gauge className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/live', label: lang === 'ar' ? 'الأسطول المباشر' : 'Live Fleet', icon: <Satellite className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/registry', label: lang === 'ar' ? 'سجل الأسطول' : 'Fleet Registry', icon: <ClipboardList className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/drivers', label: lang === 'ar' ? 'السواقين' : 'Drivers', icon: <UserSquare className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/driver-performance', label: lang === 'ar' ? 'تقييم السواقين' : 'Driver Performance', icon: <Target className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/tires', label: lang === 'ar' ? 'الكاوتش' : 'Tires', icon: <Activity className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/temperature', label: lang === 'ar' ? 'الحرارة' : 'Temperature', icon: <Thermometer className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/maintenance', label: lang === 'ar' ? 'الصيانة' : 'Maintenance', icon: <Wrench className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/maintenance-analytics', label: lang === 'ar' ? 'تحليلات الصيانة' : 'Maintenance Analytics', icon: <BarChart3 className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/fleet-assets', label: lang === 'ar' ? 'السطحات والكاوتشات' : 'Fleet Assets', icon: <Container className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    // Custody is money: shown only where the server opens it (custodyPages, middleware/custodyGate), owner roles or a permissions-screen grant.
    { href: '/system/ls2/custody', label: lang === 'ar' ? 'عهدة النقل الثقيل' : 'Heavy Transport Custody', icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'location_manager', 'location_team_leader', 'vehicles_manager', 'vehicles_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Location Solutions', visible: (u: any) => (Array.isArray(u?.custodyPages) ? u.custodyPages.includes('/system/ls2/custody') : true) },
    { href: '/system/ls2/store', label: lang === 'ar' ? 'مخزن النقل الثقيل' : 'Store', icon: <Boxes className="w-5 h-5" />, roles: [...LS2_SECTION_ROLES, 'accountant', 'accounting_manager', 'accounting_team_leader', 'cfo', 'vehicles_manager', 'vehicles_team_leader'], section: 'Location Solutions' },
    // Who spare parts are bought from; also added from the supplier field in the item form.
    { href: '/system/ls2/suppliers', label: lang === 'ar' ? 'الموردون' : 'Suppliers', icon: <Truck className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/repairs', label: lang === 'ar' ? 'الإصلاحات السابقة' : 'Earlier repairs', icon: <Hammer className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    // Fleet management request ('I need this truck but its maintenance is overdue'); the decision is made here.
    { href: '/system/ls2/fleet-requests', label: lang === 'ar' ? 'طلبات الأسطول' : 'Fleet Requests', icon: <ShieldQuestion className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/alerts', label: lang === 'ar' ? 'التنبيهات' : 'Alerts', icon: <Bell className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/reports', label: lang === 'ar' ? 'التقارير' : 'Reports', icon: <FileBarChart className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },

    // Workshop: placed right after Location Solutions because it is the shop floor servicing that fleet and its store holds the tires and trailers the ls2 asset registry tracks; keeping them apart made people search the sidebar for one truck's story.
    // Performance (KPI evaluation): department dashboard first; the all-departments view is the department's state and the evaluation is work within it.
    { href: '/system/performance/overview', label: lang === 'ar' ? 'نظرة كل الأقسام' : 'All Departments', icon: <Crown className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Performance' },
    { href: '/system/performance', label: lang === 'ar' ? 'تقييم مديري الأقسام' : 'Evaluate Managers', icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Performance' },
    { href: '/system/performance/requests', label: lang === 'ar' ? 'طلبات تعديل التقييم' : 'Edit Requests', icon: <Inbox className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Performance' },
    { href: '/system/performance/settings', label: lang === 'ar' ? 'إعداد المؤشرات' : 'Configure KPIs', icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Performance', visible: (u: any) => u?.isTopManagement === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(u?.role) },
    // ---- Marketing ----
    { href: '/system/marketing', label: lang === 'ar' ? 'لوحة التسويق' : 'Marketing Dashboard', icon: <Megaphone className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/campaigns', label: lang === 'ar' ? 'الحملات' : 'Campaigns', icon: <Target className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/activities', label: lang === 'ar' ? 'سجل الأنشطة' : 'Activity Log', icon: <ClipboardList className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/reports', label: lang === 'ar' ? 'التقارير الدورية' : 'Periodic Reports', icon: <BarChart3 className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Marketing', visible: (u) => jpMember(u, 'Marketing') },
    { href: '/system/marketing/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Marketing', visible: (u) => jpManager(u, 'Marketing') },
    { href: '/system/marketing/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Marketing', visible: (u) => jpManager(u, 'Marketing') && !jpTop(u) },
    { href: '/system/marketing/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(MARKETING_ROLES), section: 'Marketing', restrict: true },
    // ---- Business Development ----
    { href: '/system/bd', label: lang === 'ar' ? 'تطوير الأعمال' : 'Business Development', icon: <BarChart3 className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/opportunities', label: lang === 'ar' ? 'الفرص الاستراتيجية' : 'Opportunities', icon: <Compass className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/partners', label: lang === 'ar' ? 'الشراكات' : 'Partners', icon: <Handshake className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/tenders', label: lang === 'ar' ? 'المناقصات' : 'Tenders', icon: <Gavel className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Business Development', visible: (u) => jpMember(u, 'Business Development') },
    { href: '/system/bd/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Business Development', visible: (u) => jpManager(u, 'Business Development') },
    { href: '/system/bd/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Business Development', visible: (u) => jpManager(u, 'Business Development') && !jpTop(u) },
    { href: '/system/bd/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(BD_ROLES), section: 'Business Development', restrict: true },
    // Administration (secretariat).
    { href: '/system/administration', label: lang === 'ar' ? 'لوحة المهام' : 'Task Board', icon: <ClipboardList className="w-5 h-5" />, roles: ADMINISTRATION_ROLES, section: 'Administration' },
    { href: '/system/administration/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Administration', visible: (u) => jpMember(u, 'Administration') },
    { href: '/system/administration/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Administration', visible: (u) => jpManager(u, 'Administration') },
    { href: '/system/administration/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Administration', visible: (u) => jpManager(u, 'Administration') && !jpTop(u) },
    { href: '/system/administration/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Administration' },
    { href: '/system/administration/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist']), section: 'Administration', restrict: true },
    // Contracts.
    // Business review meetings: the managers/board forum. `my-tasks` is listed for EVERY role because ordinary employees receive delegated work there; the other three pages check their own tier server-side.
    { href: '/system/business-review/daily', label: lang === 'ar' ? 'الاجتماعات ومتابعة الأقسام' : 'Meetings & departments', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Business Review', visible: (u) => isBrParticipant(u.role) },
    { href: '/system/business-review/my-actions', label: lang === 'ar' ? 'البنود المسندة إليّ' : 'My Actions', icon: <ClipboardList className="w-5 h-5" />, roles: [], section: 'Business Review', visible: (u) => isBrParticipant(u.role) },
    { href: '/system/business-review/actions', label: lang === 'ar' ? 'سجل المتابعة' : 'Action Register', icon: <ListTodo className="w-5 h-5" />, roles: [], section: 'Business Review', visible: (u) => isBrRunner(u.role) },
    // Everyone — an ordinary employee's ONLY link into this section.
    { href: '/system/business-review/my-tasks', label: lang === 'ar' ? 'مهامي من الاجتماعات' : 'My Meeting Tasks', icon: <ListTodo className="w-5 h-5" />, roles: [], section: 'Business Review' },
    { href: '/system/contracts', label: lang === 'ar' ? 'لوحة إدارة العقود' : 'Contracts Dashboard', icon: <FileSignature className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    { href: '/system/contracts/vendors', label: lang === 'ar' ? 'سجل موردي 3PL' : 'Vendor Register', icon: <Building2 className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    // Customers directly after vendors: the two are read together, and a register for one alone was half the department's work.
    { href: '/system/contracts/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Handshake className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    { href: '/system/contracts/analysis', label: lang === 'ar' ? 'تحليل التشغيل' : 'Utilisation Analysis', icon: <BarChart3 className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    { href: '/system/contracts/prospects', label: lang === 'ar' ? 'تنشيط الموردين الجدد' : 'Prospect Outreach', icon: <PhoneCall className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    { href: '/system/contracts/agreements', label: lang === 'ar' ? 'عقود الأقسام' : 'Department Contracts', icon: <ScrollText className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    { href: '/system/contracts/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Contracts', visible: (u) => jpMember(u, 'Contracts') },
    { href: '/system/contracts/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Contracts', visible: (u) => jpManager(u, 'Contracts') },
    { href: '/system/contracts/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Contracts', visible: (u) => jpManager(u, 'Contracts') && !jpTop(u) },
    { href: '/system/contracts/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: CONTRACTS_ROLES, section: 'Contracts' },
    { href: '/system/contracts/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(CONTRACTS_ROLES), section: 'Contracts', restrict: true },
    // ---- Software & IT ----
    { href: '/system/it', label: lang === 'ar' ? 'لوحة تقنية المعلومات' : 'IT Dashboard', icon: <MonitorCog className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/tickets', label: lang === 'ar' ? 'التذاكر والمشكلات' : 'Tickets', icon: <LifeBuoy className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/recurring', label: lang === 'ar' ? 'المشكلات المتكررة' : 'Recurring Problems', icon: <RefreshCw className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/custody', label: lang === 'ar' ? 'العهد والأجهزة' : 'IT Custody', icon: <Laptop className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/custody-log', label: lang === 'ar' ? 'سجل حركة العهد' : 'Custody Log', icon: <ClipboardList className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/stock', label: lang === 'ar' ? 'المستودع' : 'IT Stock', icon: <Boxes className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/systems', label: lang === 'ar' ? 'الأنظمة والخدمات' : 'Systems & Services', icon: <Server className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/emails', label: lang === 'ar' ? 'بريد الشركة' : 'Company Email', icon: <Mail className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Software & IT', visible: (u) => jpMember(u, 'Software & IT') },
    { href: '/system/it/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Software & IT', visible: (u) => jpManager(u, 'Software & IT') },
    { href: '/system/it/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Software & IT', visible: (u) => jpManager(u, 'Software & IT') && !jpTop(u) },
    { href: '/system/it/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(IT_ROLES), section: 'Software & IT', restrict: true },
    { href: '/system/ls2/settings', label: lang === 'ar' ? 'الإعدادات' : 'Settings', icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'location_manager', 'location_team_leader'], section: 'Location Solutions' },
    { href: '/system/ls2/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(LS2_SECTION_ROLES), section: 'Location Solutions', restrict: true },
    { href: '/system/ls2/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Location Solutions', visible: (u) => jpMember(u, 'Location Solutions') },
    { href: '/system/ls2/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Location Solutions', visible: (u) => jpManager(u, 'Location Solutions') },
    { href: '/system/ls2/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Location Solutions', visible: (u) => jpManager(u, 'Location Solutions') && !jpTop(u) },
    { href: '/system/ls2/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader'], section: 'Location Solutions' },
    // B2C
    { href: '/system/b2c/dashboard', label: L.b2cDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    // Orders analysis moved to its own page from the dashboard, which is now the full department picture (people, vehicles, housing) rather than an orders report.
    { href: '/system/b2c/orders-analysis', label: L.b2cOrdersAnalysis, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    // Rep performance (Excel upload and Google Sheets sync) was removed: orders are written on the system in order entry, and project managers and supervisors see their own projects.
    { href: '/system/b2c/daily-entry', label: L.b2cDailyEntry, icon: <CalendarDays className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'], section: 'B2C' },
    // Amazon rep follow-up (attendance, not orders); the server decides who opens it (Amazon project manager and department officers).
    // Media Go complaints: screen fault reports on the vehicles. The department raises them and only the Media Go account sees them, updating status and replying; each side's limits are enforced server-side.
    { href: '/system/b2c/mediago-complaints', label: L.b2cMediaGoComplaints, icon: <MonitorPlay className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'], section: 'B2C' },
    // Advertising content, shared with Media Go.
    { href: '/system/b2c/mediago-ads', label: lang === 'ar' ? 'المحتوى الإعلاني' : 'Ad Content', icon: <Clapperboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor', 'mediago_account'], section: 'B2C' },
    { href: '/system/b2c/amazon-attendance', label: L.b2cAmazonAttendance, icon: <UserCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'], section: 'B2C' },
    // Start-of-shift check: two screens, one the supervisor works from each morning and one management reads. Both are open to department roles; who sees which rep is decided by `B2CRep.supervisor` on the server, not this list.
    { href: '/system/b2c/duty/start', label: lang === 'ar' ? 'تفقّد بداية الدوام' : 'Duty Start Check', icon: <Camera className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'], section: 'B2C' },
    { href: '/system/b2c/duty', label: lang === 'ar' ? 'سجلّ التفقّد والتحليل' : 'Duty Register', icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'], section: 'B2C' },
    // The whole department register, not only reporting reps: 'sales reps' showed only those with an order report, hiding supervisors, mechanics and cleaners (11 of 161).
    { href: '/system/b2c/light-transport', label: L.b2cLightTransport, icon: <Truck className="w-5 h-5" />, roles: ['cfo', 'accounting_manager', 'accounting_team_leader', 'accountant', 'super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    { href: '/system/b2c/user-rentals', label: lang === 'ar' ? 'تأجير اليوزرات' : 'User Rentals', icon: <KeySquare className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'B2C' },
    // Department store: items, balance and movements; separate from the heavy-transport store in the database, but the same screen (one store mechanism).
    { href: '/system/b2c/light-transport/store', label: lang === 'ar' ? 'مخزن النقل الخفيف' : 'Light Transport Store', icon: <Boxes className="w-5 h-5" />, roles: ['cfo', 'accounting_manager', 'accounting_team_leader', 'accountant', 'super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    { href: '/system/b2c/orders', label: L.b2cOrders, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    { href: '/system/b2c/projects', label: L.b2cProjects, icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    // Department custody: cash, purchase card and workshop, with each one's in, out and balance.
    { href: '/system/b2c/light-transport/custody', label: lang === 'ar' ? 'عهدة النقل الخفيف' : 'Light Transport Custody', icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'vehicles_manager', 'vehicles_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'B2C', visible: (u: any) => (Array.isArray(u?.custodyPages) ? u.custodyPages.includes('/system/b2c/light-transport/custody') : true) },
    // Department project vehicles from the vehicle register itself: actual driver and authorization.
    { href: '/system/b2c/vehicles', label: lang === 'ar' ? 'مركبات النقل الخفيف' : 'Light Transport Vehicles', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'B2C' },
    // The department reports field observations to HR: a rep may return to work today and HR hear days later, leaving him 'ended' in the system with no operating order. The reps' operations supervisor sees it first, so this screen is theirs.
    { href: '/system/b2c/hr-requests', label: lang === 'ar' ? 'طلبات الموارد البشرية' : 'HR Requests', icon: <Send className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor'], section: 'B2C' },
    { href: '/system/b2c/settings', label: L.b2cSettings, icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'], section: 'B2C' },
    { href: '/system/b2c/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead']), section: 'B2C', restrict: true },
    { href: '/system/b2c/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'B2C', visible: (u) => jpMember(u, 'B2C') },
    { href: '/system/b2c/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'B2C', visible: (u) => jpManager(u, 'B2C') },
    { href: '/system/b2c/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'B2C', visible: (u) => jpManager(u, 'B2C') && !jpTop(u) },
    { href: '/system/b2c/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'], section: 'B2C' },
    // Remote (work-from-home)
    { href: '/system/remote/dashboard', label: L.remoteDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'dashboard' },
    { href: '/system/remote/attendance', label: L.remoteAttendance, icon: <Clock className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'attendance' },
    { href: '/system/remote/leave', label: L.remoteLeave, icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'leave' },
    { href: '/system/remote/chat', label: L.remoteChat, icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'chat' },
    { href: '/system/remote/tasks', label: L.remoteTasks, icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'tasks' },
    { href: '/system/remote/report', label: L.remoteReport, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'report' },
    { href: '/system/remote/announcements', label: L.remoteAnnouncements, icon: <Megaphone className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote', remoteKey: 'announcements' },
    { href: '/system/remote/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader']), section: 'Remote', restrict: true },
    { href: '/system/remote/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Remote', visible: (u) => jpMember(u, 'Remote') },
    { href: '/system/remote/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Remote', visible: (u) => jpManager(u, 'Remote') },
    { href: '/system/remote/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Remote', visible: (u) => jpManager(u, 'Remote') && !jpTop(u) },
    { href: '/system/remote/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'remote_manager', 'remote_team_leader', 'remote_employee'], section: 'Remote' },
    // HR (back-office — staff only)
    { href: '/system/hr/master', label: L.hrDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/grid', label: lang === 'ar' ? 'ماستر الموارد البشرية' : 'HR Master', icon: <LayoutGrid className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/expiring', label: lang === 'ar' ? 'انتهاءات المستندات' : 'Document Expiries', icon: <CalendarClock className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/iqama', label: lang === 'ar' ? 'الإقامات' : 'Iqamas', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/passport', label: lang === 'ar' ? 'الجوازات' : 'Passports', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/medicalInsurance', label: lang === 'ar' ? 'التأمين الطبي' : 'Medical Insurance', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/healthCertificate', label: lang === 'ar' ? 'الشهادات الصحية' : 'Health Certificates', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/driverCard', label: lang === 'ar' ? 'بطاقات السائقين' : 'Driver Cards', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/drivingLicense', label: lang === 'ar' ? 'رخص القيادة' : 'Driving Licences', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    // New path; the old `master/gosi` keeps working through GROUP_ALIASES because saved links must not break over a rename.
    { href: '/system/hr/master/socialInsurance', label: lang === 'ar' ? 'السجل والتأمينات الاجتماعية' : 'Register & Social Insurance', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/master/banking', label: lang === 'ar' ? 'البيانات البنكية' : 'Banking', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/employees', label: L.hrEmployees, icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/archive', label: lang === 'ar' ? 'الأرشيف' : 'Archive', icon: <Archive className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/contracts', label: L.hrContracts, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/leaves', label: L.hrLeaves, icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/leave-register', label: lang === 'ar' ? 'الإجازات' : 'Leaves', icon: <CalendarDays className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/requests', label: L.hrRequests, icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/custody', label: L.hrCustody, icon: <Package className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/stock', label: L.hrStock, icon: <Boxes className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/finance-follow', label: lang === 'ar' ? 'متابعة المالية' : 'Finance Follow-up', icon: <Landmark className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/licenses', label: lang === 'ar' ? 'التراخيص والاشتراكات' : 'Licenses & Subscriptions', icon: <ScrollText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    // Receiving side of department requests: received, then executed or rejected with a reason.
    { href: '/system/hr/staff-requests', label: lang === 'ar' ? 'طلبات الأقسام' : 'Section Requests', icon: <Inbox className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    // Department forms library: official forms and letters, each with a version number.
    { href: '/system/hr/forms', label: lang === 'ar' ? 'النماذج والخطابات' : 'Forms & Letters', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/leave-types', label: L.hrLeaveTypes, icon: <Tags className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    // Department settings: leave types, alert thresholds and lists in one place instead of one page each.
    { href: '/system/hr/settings', label: lang === 'ar' ? 'إعدادات القسم' : 'HR Settings', icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    // Self Service (HR pages every employee sees)
    { href: '/system/hr/me', label: L.hrMyProfile, icon: <Briefcase className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, visible: (u: any) => isInternal(u?.role), section: 'Self Service' },
    { href: '/system/hr/my-leaves', label: L.hrMyLeaves, icon: <CalendarDays className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, visible: (u: any) => isInternal(u?.role), section: 'Self Service' },
    // Leave approvals sit under self service, not HR, on purpose: the fleet and operations managers sign their teams' leaves without owning HR. The page shows nothing to someone with no station, so the server builds the list from the reader's stations, not from the role listed here.
    // Only for those who approve: a direct manager of someone, or a stage owner (server's approvesLeaves). An employee with nobody under him has nothing to approve here.
    { href: '/system/hr/leave-approvals', label: lang === 'ar' ? 'موافقات الإجازات' : 'Leave Approvals', icon: <CalendarCheck className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, visible: (u: any) => isInternal(u?.role) && (u?.approvesLeaves === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(u?.role)), section: 'Self Service' },
    { href: '/system/hr/my-requests', label: L.hrMyRequests, icon: <ClipboardList className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, visible: (u: any) => isInternal(u?.role), section: 'Self Service' },
    // Personal settings: password, signature and language. They were under Tools and limited to eight roles, so those who needed them could not find them.
    { href: '/system/settings', label: L.settings, icon: <Settings className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, visible: (u: any) => isInternal(u?.role), section: 'Self Service' },
    // CRM
    { href: '/system/crm/dashboard', label: L.crmDashboard, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/companies', label: L.crmCompanies, icon: <Building2 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/vendors', label: lang === 'ar' ? 'الموردين' : 'Vendors', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/customer-kpis', label: lang === 'ar' ? 'مؤشرات العملاء' : 'Customer KPIs', icon: <Gauge className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/vendor-kpis', label: lang === 'ar' ? 'مؤشرات الموردين' : 'Vendor KPIs', icon: <Gauge className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/contacts', label: L.crmContacts, icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/deals', label: L.crmDeals, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/tasks', label: L.crmTasks, icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/calendar', label: L.crmCalendar, icon: <CalendarDays className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/activities', label: L.crmActivities, icon: <Phone className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    // Sales
    { href: '/system/sales/dashboard', label: L.salesDashboard, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'Sales' },
    // Customers: the same register as operations and shipment orders (components/customers); a third entry point, not a third copy.
    { href: '/system/sales/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'Sales' },
    // Operations workflow from inside their section, for the selling value: sales prices the manifest and sees and writes only the selling value (the server hides other money from them), like the link in the collections section.
    { href: '/system/sales/pipeline', label: L.salesPipeline, icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'Sales' },
    { href: '/system/sales/targets', label: L.salesTargets, icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'Sales' },
    { href: '/system/sales/performance', label: L.salesPerformance, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'Sales' },
    // Selling-price approvals: the sales manager, top roles and flagged top-management accounts; the server checks again (config/sellingPriceRequests).
    { href: '/system/selling-requests', label: lang === 'ar' ? 'طلبات تعديل سعر البيع' : 'Selling-price requests', icon: <BadgeDollarSign className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'sales_manager', 'sales_team_leader'], section: 'Sales', visible: (u: any) => u?.isTopManagement === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'sales_manager', 'sales_team_leader'].includes(u?.role) },
    // Accounting
    // Finance management replaced the accounting pages (chart of accounts, journal entries, trial balance), which were filled by manual sync and stayed incomplete. Each department's money is read from the department itself. The `Accounting` key stays so saved permissions are not migrated; only the name changed.
    { href: '/system/finance', label: lang === 'ar' ? 'لوحة الإدارة المالية' : 'Finance Overview', icon: <Landmark className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/leaves', label: lang === 'ar' ? 'طلبات الإجازات' : 'Leave Requests', icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting', restrict: true },
    { href: '/system/finance/staff-requests', label: lang === 'ar' ? 'طلبات الموظفين' : 'Staff Requests', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting', restrict: true },
    { href: '/system/finance/operations', label: lang === 'ar' ? 'ماليات التشغيل' : 'Operations Finance', icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/fleet', label: lang === 'ar' ? 'ماليات إدارة الأسطول' : 'Fleet Finance', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/customs', label: lang === 'ar' ? 'ماليات التخليص الجمركي' : 'Customs Finance', icon: <Ship className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/light-transport', label: lang === 'ar' ? 'ماليات النقل الخفيف' : 'Light Transport Finance', icon: <Award className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/marketing', label: lang === 'ar' ? 'ماليات التسويق والتطوير' : 'Marketing & BD Finance', icon: <Megaphone className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/hr', label: lang === 'ar' ? 'ماليات الموارد البشرية' : 'HR Finance', icon: <UserCog className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/hr/residency', label: lang === 'ar' ? 'الإقامات ورخص العمل' : 'Iqamas & Work Permits', icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/it', label: lang === 'ar' ? 'ماليات تقنية المعلومات' : 'IT Finance', icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/collections', label: lang === 'ar' ? 'ماليات التحصيل' : 'Collections Finance', icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/finance/vehicles', label: lang === 'ar' ? 'ماليات المركبات' : 'Vehicles Finance', icon: <Car className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    // Procurement
    { href: '/system/procurement/requests', label: L.purchaseRequests, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'], section: 'Procurement' },
    { href: '/system/procurement/orders', label: L.purchaseOrders, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'], section: 'Procurement' },
    { href: '/system/procurement/bills', label: L.vendorBills, icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'], section: 'Procurement' },

    // Per-section Tasks (private) + Complaints — strict visibility (assignee + creator + super_admin)
    { href: '/system/crm/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'CRM', visible: (u) => jpMember(u, 'CRM') },
    { href: '/system/crm/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'CRM', visible: (u) => jpManager(u, 'CRM') },
    { href: '/system/crm/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'CRM', visible: (u) => jpManager(u, 'CRM') && !jpTop(u) },
    { href: '/system/crm/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'CRM' },
    { href: '/system/crm/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff']), section: 'CRM', restrict: true },
    { href: '/system/sales/shipment-request', label: lang === 'ar' ? 'طلب شحنة' : 'Shipment Request', icon: <ClipboardList className="w-5 h-5" />, roles: [], section: 'Sales', visible: (u) => canAskShipment(u) },
    { href: '/system/sales/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Sales', visible: (u) => jpMember(u, 'Sales') },
    { href: '/system/sales/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Sales', visible: (u) => jpManager(u, 'Sales') },
    { href: '/system/sales/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Sales', visible: (u) => jpManager(u, 'Sales') && !jpTop(u) },
    { href: '/system/sales/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff'], section: 'Sales' },
    { href: '/system/sales/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'sales_manager', 'sales_team_leader', 'sales_rep', 'operations_manager', 'operations_team_leader', 'operations_staff']), section: 'Sales', restrict: true },
    { href: '/system/accounting/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Accounting', visible: (u) => jpMember(u, 'Accounting') },
    { href: '/system/accounting/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Accounting', visible: (u) => jpManager(u, 'Accounting') },
    { href: '/system/accounting/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Accounting', visible: (u) => jpManager(u, 'Accounting') && !jpTop(u) },
    { href: '/system/accounting/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant']), section: 'Accounting', restrict: true },
    { href: '/system/procurement/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Procurement', visible: (u) => jpMember(u, 'Procurement') },
    { href: '/system/procurement/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Procurement', visible: (u) => jpManager(u, 'Procurement') },
    { href: '/system/procurement/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Procurement', visible: (u) => jpManager(u, 'Procurement') && !jpTop(u) },
    { href: '/system/procurement/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'procurement_manager', 'procurement_team_leader', 'procurement_staff'], section: 'Procurement' },
    { href: '/system/procurement/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'procurement_manager', 'procurement_team_leader', 'procurement_staff']), section: 'Procurement', restrict: true },
    { href: '/system/hr/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'HR', visible: (u) => jpMember(u, 'HR') },
    { href: '/system/hr/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'HR', visible: (u) => jpManager(u, 'HR') },
    { href: '/system/hr/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'HR', visible: (u) => jpManager(u, 'HR') && !jpTop(u) },
    { href: '/system/hr/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'hr_manager', 'hr_team_leader', 'hr_specialist']), section: 'HR', restrict: true },
    { href: '/system/ops/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Operations Platform', visible: (u) => jpMember(u, 'Operations Platform') },
    { href: '/system/ops/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Operations Platform', visible: (u) => jpManager(u, 'Operations Platform') },
    { href: '/system/ops/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Operations Platform', visible: (u) => jpManager(u, 'Operations Platform') && !jpTop(u) },
    { href: '/system/ops/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(OPS_ROLES), section: 'Operations Platform', restrict: true },
    { href: '/system/customs/jp', label: lang === 'ar' ? 'خطّة العمل (JP)' : 'JP', icon: <CalendarCheck className="w-5 h-5" />, roles: [], section: 'Customs', visible: (u) => jpMember(u, 'Customs') },
    { href: '/system/customs/jp-dashboard', label: lang === 'ar' ? 'لوحة JP' : 'JP Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: [], section: 'Customs', visible: (u) => jpManager(u, 'Customs') },
    { href: '/system/customs/management-jp', label: lang === 'ar' ? 'خطّة الإدارة (Management JP)' : 'Management JP', icon: <Crown className="w-5 h-5" />, roles: [], section: 'Customs', visible: (u) => jpManager(u, 'Customs') && !jpTop(u) },
    { href: '/system/customs/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader', 'customs_manager', 'customs_team_leader', 'customs_officer']), section: 'Customs', restrict: true },

    // Tools
    // The exec KPI board admits KPI_ROLES (lib/finance.ts) — mirror it exactly.
    { href: '/system/reports', label: lang === 'ar' ? 'مركز التقارير' : 'Reports', icon: <FileBarChart className="w-5 h-5" />, roles: REPORT_ROLES, section: 'Tools' },
    { href: '/system/assistant', label: L.assistant, icon: <Bot className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'employee'], section: 'Tools' },

    // Admin (configuration & oversight — kept near the bottom)
    { href: '/system/branches', label: L.branches, icon: <Building2 className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Admin' },
    // Reference lists: each role gets its own lists. It used to be a hand-written role list that missed the fleet and vehicles managers, who do own lists, and whoever entered saw every department's lists. The server now returns only what each role may edit, so the page is open to all and shows nobody what is not theirs; a user with no list is told so.
    { href: '/system/settings/reference-data', label: lang === 'ar' ? 'القوائم المرجعية' : 'Reference Data', icon: <Tags className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, visible: (u: any) => isInternal(u?.role), section: 'Admin' },
    { href: '/system/users', label: L.users, icon: <UserCog className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Admin' },
    { href: '/system/permissions', label: lang === 'ar' ? 'الأدوار والصلاحيات' : 'Roles & Permissions', icon: <ShieldCheck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Admin' },
    { href: '/system/audit', label: L.auditLog, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin'], section: 'Admin' },
    // Data & Decision Support: one analysis page per company section, each read from the section's own analytics (backend dataSupportController).
    { href: '/system/data-support', label: lang === 'ar' ? 'لوحة دعم القرار' : 'Decision Support Home', icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/operations', label: lang === 'ar' ? 'تحليل العمليات والشحنات' : 'Operations & Shipments Analysis', icon: <PackageSearch className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/heavy-transport', label: lang === 'ar' ? 'تحليل النقل الثقيل' : 'Heavy Transport Analysis', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/light-transport', label: lang === 'ar' ? 'تحليل النقل الخفيف' : 'Light Transport Analysis', icon: <Award className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/sales', label: lang === 'ar' ? 'تحليل المبيعات والعلاقات' : 'Sales & CRM Analysis', icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/vendors', label: lang === 'ar' ? 'تحليل الموردين' : 'Vendors Analysis', icon: <Handshake className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/customs', label: lang === 'ar' ? 'تحليل التخليص الجمركي' : 'Customs Analysis', icon: <Ship className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/collections', label: lang === 'ar' ? 'تحليل التحصيل' : 'Collections Analysis', icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/hr', label: lang === 'ar' ? 'تحليل الموارد البشرية' : 'HR Analysis', icon: <UserCog className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/finance', label: lang === 'ar' ? 'التحليل المالي' : 'Finance Analysis', icon: <Landmark className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'data_manager', 'data_analyst', 'data_entry'], section: 'Data & Decision Support' },
    { href: '/system/data-support/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'data_manager', 'data_analyst', 'data_entry']), section: 'Data & Decision Support', restrict: true },
    // The team's data-entry screens, grouped here for the data roles only. Each is declared earlier under its own section, which owns the page permission (the catalogue registers the first declaration); the link shows only if that section is open too.
    { href: '/system/shipment-orders', label: lang === 'ar' ? 'الشحنات' : 'Shipments', icon: <PackageSearch className="w-5 h-5" />, roles: [], section: 'Data & Decision Support', visible: (u: any) => isDataRole(u) && canAccessSection(u?.permissions, 'Shipment Orders') },
    { href: '/system/shipment-orders/request', label: lang === 'ar' ? 'طلب شحنة' : 'Shipment Request', icon: <ClipboardList className="w-5 h-5" />, roles: [], section: 'Data & Decision Support', visible: (u: any) => isDataRole(u) && canAccessSection(u?.permissions, 'Shipment Orders') && canAskShipment(u) },
    { href: '/system/shipment-orders/requests', label: lang === 'ar' ? 'الطلبات من المبيعات' : 'Requests from Sales', icon: <Inbox className="w-5 h-5" />, roles: [], section: 'Data & Decision Support', visible: (u: any) => isDataRole(u) && canAccessSection(u?.permissions, 'Shipment Orders') && canPlaceShipment(u) },
    { href: '/system/fleet', label: lang === 'ar' ? 'حمولات الأسطول' : 'Fleet Loads', icon: <Truck className="w-5 h-5" />, roles: [], section: 'Data & Decision Support', visible: (u: any) => isDataRole(u) && canAccessSection(u?.permissions, 'Fleet Management') },
    { href: '/system/operations', label: lang === 'ar' ? 'سير عمل التشغيل' : 'Operations Workflow', icon: <ClipboardList className="w-5 h-5" />, roles: [], section: 'Data & Decision Support', visible: (u: any) => isDataRole(u) && canAccessSection(u?.permissions, 'Operations') },
    { href: '/system/operations/loads', label: lang === 'ar' ? 'متابعة الحمولات والشحنات' : 'Loads & Shipments', icon: <Truck className="w-5 h-5" />, roles: [], section: 'Data & Decision Support', visible: (u: any) => isDataRole(u) && canAccessSection(u?.permissions, 'Operations') },
    // API documentation, built from the code on open; the internal surface is for those the server guards with it (FULL_ACCESS_ROLES).
    { href: '/system/api-docs', label: 'API Reference', icon: <BookOpen className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'], section: 'Admin' },
    { href: '/system/complaints', label: L.complaints, icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_team_leader', 'it_specialist', 'admin', 'operations_manager', 'operations_team_leader'], section: 'Admin' },
    // Customer / supplier portal. `portalService` gates a link on the partner ACTUALLY having work of that kind: a customs-only customer never sees a shipments tab, and a supplier never sees invoices. Links without it always show.
    { href: '/system/portal', label: L.overview, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['client'], section: 'Portal' },
    { href: '/system/portal/shipments', label: lang === 'ar' ? 'شحناتي' : 'My Shipments', icon: <Truck className="w-5 h-5" />, roles: ['client'], section: 'Portal', portalService: ['shipments', 'operations', 'heavy_transport', 'shipment_orders'] },
    { href: '/system/portal/customs', label: lang === 'ar' ? 'معاملات التخليص' : 'Customs Files', icon: <Ship className="w-5 h-5" />, roles: ['client'], section: 'Portal', portalService: ['customs'] },
    { href: '/system/portal/requests', label: lang === 'ar' ? 'طلباتي' : 'My Requests', icon: <MessageSquare className="w-5 h-5" />, roles: ['client'], section: 'Portal' },
    { href: '/system/portal/invoices', label: L.myInvoices, icon: <FileText className="w-5 h-5" />, roles: ['client'], section: 'Portal', portalService: ['finance', 'invoices'] },
    { href: '/system/portal/payments', label: L.myPayments, icon: <CreditCard className="w-5 h-5" />, roles: ['client'], section: 'Portal', portalService: ['finance'] },
  ];

  // Which portal tabs this partner gets. Resolved once per session from what
  // they actually have with us (see backend portalController.servicesFor).
  const [portalServices, setPortalServices] = useState<string[] | null>(null);
  useEffect(() => {
    if (user?.role !== 'client') { setPortalServices(null); return; }
    api.get<{ services: { key: string }[] }>('/api/portal/me')
      .then((m) => setPortalServices((m.services || []).map((x) => x.key)))
      // On failure show every portal tab rather than locking the partner out of
      // pages they may well have data on.
      .catch(() => setPortalServices([]));
  }, [user?.role, user?._id]);

  // Numbers beside page names (/api/nav-badges): what awaits the page owner. Customs finance: pending disbursement and invoicing requests. Refetched on every customs change and every minute as a fallback.
  const [navBadges, setNavBadges] = useState<Record<string, number>>({});
  // External and scoped accounts (Media Go...) have no badges and are not queried, which would return 403.
  const wantsBadges = !!user && isInternal(user.role) && !SCOPED_HOME[user.role];
  const fetchNavBadges = useCallback(() => {
    if (!wantsBadges) return;
    api.get<Record<string, number>>('/api/nav-badges').then((d) => setNavBadges(d || {})).catch(() => {});
  }, [wantsBadges]);
  useEffect(() => {
    if (!user) return undefined;
    fetchNavBadges();
    const t = setInterval(fetchNavBadges, 60000);
    return () => clearInterval(t);
  }, [user?._id, fetchNavBadges]); // eslint-disable-line react-hooks/exhaustive-deps
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgesSoon = useCallback(() => {
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(fetchNavBadges, 1200);
  }, [fetchNavBadges]);
  useSocket('customs:updated', badgesSoon);
  // Leave and staff-request counters follow each decision and new request.
  useSocket('hr:leave', badgesSoon);
  useSocket('hr:request', badgesSoon);
  useSocket('sellingRequests:changed', badgesSoon);
  useSocket('shipmentRequests:changed', badgesSoon);

  // Real-time notification updates
  useSocket('notification:new', useCallback(() => {
    fetchNotifications();
  }, []));
  // An action on the system: seen by the system admin and the department manager, who alone can re-pull; the server decides what each sees (see notificationController.scopeOf).
  useSocket('notification:activity', useCallback(() => {
    const r = user?.role || '';
    if (['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(r || '') || r === 'cfo' || /_manager$/.test(r)) fetchNotifications();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]));

  // Live permission changes: when the super_admin edits a role's section access,
  // every logged-in user of that role refetches /me so their sidebar + access
  // update immediately without re-login.
  useSocket('permissions:updated', useCallback((data: { role?: string }) => {
    if (data?.role && user?.role === data.role) refreshUser();
  }, [user?.role, refreshUser]));

  const filteredNav = navItems.filter((item) => {
    if (!user) return false;
    // A scoped account sees only its own page, whatever the other rules say.
    if (SCOPED_HOME[user.role]) return (SCOPED_PAGES[user.role] || [SCOPED_HOME[user.role]]).includes(item.href);
    // Page before section: a layer under the sections matrix. The vehicles section has nineteen pages and a granted section used to open all of them. A page closed here stays closed whatever the section says; a page the screen is silent on follows its section (computed by the server, see effectivePages).
    if (!canAccessPage(user.pageAccess, item.href)) return false;
    // Managed sections are governed by the super_admin permission matrix
    // (sectionKey → none/view/edit) instead of the static role list. This is
    // what makes granting/removing a section to a role take effect live.
    if (isManagedSection(item.section)) {
      if (!canAccessSection(user.permissions, item.section as string) && !(item.pageOpens && user.pageAccess?.[item.href] === true)) return false;
      if (item.remoteKey && user.role === 'remote_employee') {
        return Array.isArray(user.remoteAccess) && user.remoteAccess.includes(item.remoteKey);
      }
      // Restricted items keep their role list even inside a granted section —
      // the target page rejects other roles, so the link would be a dead-end.
      if (item.restrict && !roleIn(user.role, item.roles)) return false;
      // …and a `visible` rule beats a list where the list would go stale.
      if (item.visible && !item.visible(user)) return false;
      return true;
    }
    // Legacy role-gated sections (Main, Tools, Admin, Self Service, Portal).
    // `visible` takes precedence over the role list where present: hand-written role lists age with every new role, the rule does not. This is why self service shows for the vehicles manager and clearance staff without thirty added lines.
    // A matrix grant also precedes the list: these sections are not owned by the sections matrix, so their guard is a list. A custom role granted 'reports center' in the pages matrix got open endpoints but no link, since the list does not know the role. An explicit grant is shown; the list is what ages.
    const ticked = Array.isArray(user.pagesGranted) && user.pagesGranted.includes(item.href);
    if (!ticked) {
      if (item.visible) { if (!item.visible(user)) return false; }
      else if (!roleIn(user.role, item.roles)) return false;
    }
    // Portal links are further narrowed to the services this partner has. While
    // the lookup is still in flight (null) we show nothing extra rather than
    // flashing tabs that then disappear.
    if (item.portalService) {
      if (portalServices === null) return false;
      // unknown → don't hide anything — except money: invoices/payments show
      // only when the server explicitly offers `finance` (never to customers).
      if (!portalServices.length) return !item.portalService.includes('finance');
      return item.portalService.some((k: string) => portalServices.includes(k));
    }
    if (item.remoteKey && user.role === 'remote_employee') {
      return Array.isArray(user.remoteAccess) && user.remoteAccess.includes(item.remoteKey);
    }
    return true;
  });

  // The page door closes on those who type the path: hiding a link blocks nobody. The real data guard is the section on the API, but a screen that was denied and then half-opened makes the setting lie to whoever configured it.
  // Compared against the longest matching path: `/system/vehicles/registry/123` is the `registry` page, and 'no catalogue page matches' means a screen outside the sidebar (a record detail), which follows its nearest ancestor.
  // Detail screens reachable from pages other than the one their path sits under (page key -> the other pages that open its records).
  const DETAIL_OPENED_FROM: Record<string, string[]> = {
    '/system/ls2/tires': ['/system/ls2/fleet-assets'],
  };
  const pageBlocked = (() => {
    if (!user || !user.pageAccess) return false;
    const keys = Object.keys(user.pageAccess);
    let best = '';
    for (const k of keys) {
      if (pathname === k || pathname.startsWith(`${k}/`)) {
        if (k.length > best.length) best = k;
      }
    }
    if (!best || user.pageAccess[best] !== false) return false;
    // A record opened from another page follows that page too: a tire's file lives under «الكاوتش» but opens from «السطحات والكاوتشات», so either open page lets it through.
    if (pathname !== best) {
      const openers = DETAIL_OPENED_FROM[best] || [];
      if (openers.some((k) => user.pageAccess?.[k] !== false)) return false;
    }
    return true;
  })();

  // Sidebar section order is explicit, not accidental: sections used to appear in the order of their first page in the `nav` array, so adding a page in its natural place could move a whole section to the top.
  // The intended order follows the work chain: operations, shipment orders, platform, then collections, then fleet and tracking, then supporting sections. Anything not listed comes after in its existing order.
  const SECTION_ORDER = [
    // Home is always first; when it was missing from the list it dropped below all sections and looked gone to the system admin.
    'Main',
    'Top Management',
    'Data & Decision Support',
    'Operations',
    'Shipment Orders',
    'Operations Platform',
    'Collections',
    'Fleet Management',
    'Location Solutions',
    'HR',
    'Vehicles',
    'Customs',
    'B2C',
    'Software & IT',
  ];

  const groupedNav = filteredNav.reduce((acc, item) => {
    const section = item.section || 'Other';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, NavItem[]>);

  // Listed sections in order, then the rest as they came, so a section missing from the list does not vanish.
  const orderedNav: [string, NavItem[]][] = Object.entries(groupedNav).sort(([a], [b]) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const renderNavLink = (item: NavItem, onClick?: () => void) => {
    const hasChildren = filteredNav.some(other => other.href !== item.href && other.href.startsWith(item.href + '/'));
    const isActive = hasChildren ? pathname === item.href : (pathname === item.href || pathname.startsWith(item.href + '/'));
    return (
      <Link
        key={item.href}
        href={item.href}
        onMouseEnter={() => prefetch(item.href, true)}
        onTouchStart={() => prefetch(item.href, true)}
        onClick={() => { setPendingHref(item.href); onClick?.(); }}
        className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-[#f37121] text-white shadow-sm shadow-[#f37121]/30'
            : pendingHref === item.href
              ? 'bg-slate-800 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {pendingHref === item.href && !isActive
          ? <Loader2 className="w-5 h-5 animate-spin text-[#f37121] shrink-0" />
          : item.icon}
        {(onClick || sidebarOpen) && <span className="min-w-0 flex-1">{item.label}</span>}
        {navBadges[item.href] ? (
          <span className={`${(onClick || sidebarOpen) ? '' : 'absolute -top-1 -end-1'} inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-5 text-white tabular-nums`}
            title={lang === 'ar' ? 'طلبات تنتظر الإجراء' : 'Awaiting action'}>
            {navBadges[item.href] > 99 ? '99+' : navBadges[item.href]}
          </span>
        ) : null}
      </Link>
    );
  };

  // Renders a section header + its items as an accordion. Used by both the
  // desktop sidebar (when expanded) and the mobile sheet. When the desktop
  // sidebar is in icon-only mode there are no headers, so callers handle that
  // case separately.
  const renderSection = (section: string, items: NavItem[], onItemClick?: () => void) => {
    const isExpanded = expandedSections.has(section);
    return (
      <div key={section}>
        <button
          type="button"
          onClick={() => { toggleSection(section); prefetchSection(items); }}
          onMouseEnter={() => prefetchSection(items)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 mt-2 rounded-lg text-xs font-bold text-slate-400 uppercase tracking-wide bg-slate-800/40 hover:bg-slate-800 hover:text-slate-200 transition-colors"
        >
          <span className="flex-1 text-start">{getSectionLabel(section, lang)}</span>
          {!isExpanded && items.reduce((n, it) => n + (navBadges[it.href] || 0), 0) > 0 && (
            <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold leading-[18px] text-white tabular-nums normal-case">
              {items.reduce((n, it) => n + (navBadges[it.href] || 0), 0)}
            </span>
          )}
          {isExpanded
            ? <ChevronDown className="w-4 h-4 text-[#f37121]" />
            : (isRTL ? <ChevronLeft className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />)}
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-0.5 pb-1">
                {items.map((item) => renderNavLink(item, onItemClick))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <DialogProvider>
    {/* Date fields use one format for everyone; see the file header. */}
    <DateFieldLocale />
    {/* A new version was published while the tab was open; it refreshes (see lib/appVersion). */}
    <NewVersionWatcher ar={lang === 'ar'} />
    <div className="min-h-screen bg-slate-100 flex" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* A thin bar showing the click was received until the page renders. */}
      {pendingHref && (
        <div className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden">
          <div className="refresh-bar" />
        </div>
      )}
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col ${sidebarOpen ? 'w-64' : 'w-20'} bg-slate-900 ${isRTL ? 'border-l' : 'border-r'} border-slate-800 transition-all duration-300 fixed h-full z-40 ${isRTL ? 'right-0' : 'left-0'}`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          {sidebarOpen && (
            <Link href="/" className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-[#f37121]" />
              <span className="text-white font-bold text-sm">Energize CFS</span>
            </Link>
          )}
          <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="text-slate-400 hover:text-white p-1" title={L.toggleSidebar}>
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 sidebar-scroll">
          {orderedNav.map(([section, items]) => {
            // Icon-only mode: no section headers, all items always visible
            // (the accordion only makes sense when labels are showing).
            if (!sidebarOpen) {
              return (
                <div key={section}>
                  <div className="my-2 mx-2 border-t border-slate-800" />
                  <div className="space-y-0.5">
                    {items.map((item) => renderNavLink(item))}
                  </div>
                </div>
              );
            }
            return renderSection(section, items);
          })}
        </nav>

        {/* User Info + Logout */}
        <div className="border-t border-slate-800 p-4">
          {sidebarOpen && (
            <div className="mb-3">
              <p className="text-white text-sm font-medium">{user.firstName} {user.lastName}</p>
              <p className="text-slate-400 text-xs capitalize">{user.roleLabel ? (lang === 'ar' ? user.roleLabel.ar : user.roleLabel.en) : getRoleLabel(user.role, lang)}</p>
            </div>
          )}
          <button type="button" onClick={handleLogout} className="flex items-center gap-2 text-slate-400 hover:text-red-600 transition-colors text-sm w-full">
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>{L.logout}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 ${sidebarOpen ? (isRTL ? 'lg:mr-64' : 'lg:ml-64') : (isRTL ? 'lg:mr-20' : 'lg:ml-20')} transition-all duration-300`}>
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 shadow-sm px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileMenuOpen(true)} className="lg:hidden text-slate-500 hover:text-slate-900" title={L.openMenu}>
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg hidden sm:block mb-3">
              {[...filteredNav].sort((a, b) => b.href.length - a.href.length).find((n) => pathname === n.href || pathname.startsWith(n.href + '/'))?.label || L.system}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            {/* Language Toggle */}
            <button type="button" onClick={toggleLang}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 hover:text-slate-900 transition-colors"
              title={lang === 'en' ? L.switchToArabic : L.switchToEnglish}>
              <Languages className="w-4 h-4" />
              <span className="text-xs">{lang === 'en' ? 'عربي' : 'EN'}</span>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button type="button" onClick={() => setShowNotifications(!showNotifications)} className="text-slate-500 hover:text-slate-900 relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute end-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto"
                  >
                    <div className="p-3 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-slate-900 font-medium text-sm">{L.notifications}</span>
                      {unreadCount > 0 && (
                        <button type="button" onClick={markAllRead} className="text-[#f37121] text-xs hover:underline">
                          {L.markAllRead}
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <p className="p-6 text-slate-400 text-sm text-center">{L.noNewNotifications}</p>
                    ) : (
                      notifications.map((n: any) => {
                        // Ready export notification: a click downloads it.
                        const isExport = n.relatedEntity === 'ExportJob' && n.relatedEntityId;
                        // Other notifications go to what they refer to. They were all `div`s with no handler, so reading 'a task was assigned to you' and clicking did nothing. The destination is built from `relatedEntity` (see lib/notificationLink); one without a destination is not guessed and stays a plain line.
                        const href = isExport ? null : notificationHref(n);
                        const tone = notificationTone(n);
                        const Icon = tone === 'alert' ? AlertTriangle : tone === 'task' ? ClipboardList : tone === 'ok' ? CheckCircle2 : Info;
                        const toneCls = tone === 'alert' ? 'bg-red-50 text-red-600'
                          : tone === 'task' ? 'bg-amber-50 text-amber-600'
                          : tone === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600';
                        const go = () => {
                          // Marked read and then opened: opening it means it was read, and leaving it unread makes the counter wrong.
                          if (!n.isRead) {
                            api.put(`/api/notifications/${n._id}/read`).catch(() => { /* The counter is corrected on the next refresh. */ });
                            setUnreadCount((c) => Math.max(0, c - 1));
                          }
                          setShowNotifications(false);
                          if (href) router.push(href);
                        };
                        const clickable = !!href || !!isExport;
                        return (
                          <div
                            key={n._id}
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isExport ? downloadExport(n) : go(); } } : undefined}
                            onClick={isExport ? () => downloadExport(n) : (href ? go : undefined)}
                            className={`px-3 py-2.5 border-b border-slate-100 flex items-start gap-2.5 ${clickable ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                          >
                            <span className={`mt-0.5 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${toneCls}`}>
                              <Icon className="w-3.5 h-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <p className="text-slate-900 text-[13px] font-semibold leading-snug flex-1 min-w-0">{n.title}</p>
                                <span className="text-[10.5px] text-slate-400 shrink-0 mt-0.5 whitespace-nowrap">{sinceLabel(n.createdAt, lang === 'ar')}</span>
                              </div>
                              {/* At most two lines: a long message stretched the row until the list became a block of text. */}
                              <p className="text-slate-500 text-[12px] mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                              {isExport && (
                                <p className="text-[#f37121] text-[11px] mt-1 font-semibold">
                                  {lang === 'ar' ? 'اضغط للتنزيل' : 'Click to download'}
                                </p>
                              )}
                            </div>
                            {!n.isRead && <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-[#f37121]" aria-hidden="true" />}
                          </div>
                        );
                      })
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* User badge */}
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <div className="w-8 h-8 rounded-full bg-[#f37121]/20 border border-[#f37121]/50 flex items-center justify-center text-[#f37121] font-bold text-xs">
                {user.firstName[0]}{user.lastName[0]}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        {/* Department dashboards show on a meeting screen, so their text is made clearer (globals.css: [data-dash]). */}
        <main className="flex-1 p-4 md:p-6 overflow-x-auto min-w-0" data-dash={isDashboardPath(pathname) ? '' : undefined}>
          {pageBlocked ? (
            <div className="max-w-lg mx-auto mt-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-7 h-7" />
              </div>
              <p className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? 'هذه الصفحة ليست ضمن صلاحيّاتك' : 'This page is not part of your access'}
              </p>
              {/* A blocked user is told whom to contact, not just 'not authorized', which reads as a fault and gets the page reloaded repeatedly before support is called. */}
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {lang === 'ar'
                  ? 'صلاحيّاتُ الصفحات تُضبط من «الأدوار والصلاحيّات». إن كنت تحتاجها في عملك فاطلبها من صاحب النظام.'
                  : 'Page access is set in Roles & Permissions. If you need this page for your work, ask the system owner for it.'}
              </p>
              <button type="button" onClick={() => router.push(landingFor(user))}
                className="mt-5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold">
                {lang === 'ar' ? 'العودة إلى صفحتي' : 'Back to my page'}
              </button>
            </div>
          ) : children}
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: isRTL ? 280 : -280 }}
              animate={{ x: 0 }}
              exit={{ x: isRTL ? 280 : -280 }}
              className={`fixed ${isRTL ? 'right-0' : 'left-0'} top-0 w-[280px] h-full bg-slate-900 ${isRTL ? 'border-l' : 'border-r'} border-slate-800 z-50 lg:hidden flex flex-col`}
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
                <span className="text-white font-bold">Energize CFS</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400 hover:text-white" title={L.closeMenu}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-2 px-2 sidebar-scroll">
                {orderedNav.map(([section, items]) =>
                  renderSection(section, items, () => setMobileMenuOpen(false))
                )}
              </nav>
              <div className="border-t border-slate-800 p-4">
                <p className="text-white text-sm">{user.firstName} {user.lastName}</p>
                <p className="text-slate-400 text-xs capitalize mb-3">{user.roleLabel ? (lang === 'ar' ? user.roleLabel.ar : user.roleLabel.en) : getRoleLabel(user.role, lang)}</p>
                <button type="button" onClick={handleLogout} className="flex items-center gap-2 text-slate-400 hover:text-red-600 text-sm">
                  <LogOut className="w-4 h-4" />
                  <span>{L.logout}</span>
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
    </DialogProvider>
  );
}
