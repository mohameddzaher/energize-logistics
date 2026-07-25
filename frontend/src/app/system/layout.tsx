'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { getLayoutTranslations, NAV_LABEL_KEYS, getSectionLabel, getRoleLabel } from '@/lib/translations';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, FileText, CreditCard, Phone,
  AlertTriangle, UserCog, ClipboardList, BarChart3, Settings,
  LogOut, Bell, Menu, X, ChevronDown, ChevronRight, ChevronLeft, Shield, Bot,
  Briefcase, TrendingUp, ListTodo, Building2, Wallet,
  Store, Truck, Tags, Languages, Wrench, Hammer, ShoppingCart, MessageSquare, Package,
  Target, Award, CalendarDays, Clock, Megaphone, CalendarCheck,
  Calculator, Scale, BookOpen, Gauge, Ship, ScrollText,
  Activity, Car, UserSquare, MapPin, Globe, Boxes, Ruler, Palette, ShieldCheck, PackageSearch, SlidersHorizontal,
  Thermometer, Satellite, Crown, Container, FileBarChart,
  Compass, Handshake, Gavel, MonitorCog, LifeBuoy, Laptop, Server, RefreshCw, Inbox,
} from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { homeRouteForRole } from '@/lib/roleRoutes';
import { OPS_SECTION_ROLES as OPS_ROLES } from '@/lib/ops';
import { SO_EDIT_ROLES as SO_ROLES } from '@/lib/shipmentOrders';
import { LS2_SECTION_ROLES } from '@/lib/ls2';

import { isManagedSection, canAccessSection } from '@/lib/sections';
import { PERF_STAFF_ROLES } from '@/lib/performance';

// Section-KPI pages render TeamBoard, which admits PERF_STAFF_ROLES only — a
// nav entry offering the link to anyone else is a guaranteed dead-end screen.
// Intersecting here keeps every section's list in sync with the page's gate.
const kpiRoles = (roles: string[]) => roles.filter((r) => PERF_STAFF_ROLES.includes(r));
import { DialogProvider } from '@/components/system/DialogProvider';
// Sidebar visibility for the new sections. Managed sections are additionally
// gated by the per-role permission matrix (canAccessSection).
const MARKETING_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'moderator'];
const BD_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist', 'sales_manager', 'crm_manager', 'operations_manager'];
const IT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

// Self service (my profile / my leaves / my requests) belongs to EVERY employee,
// managers included — they file leave like anyone else. The only login that is
// not an employee is `client`, an external customer-portal account.
const SELF_SERVICE_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'employee', 'moderator',
  'operations_manager', 'operations', 'workshop_manager', 'workshop_employee', 'purchasing',
  'b2c_head', 'b2c_project_manager', 'remote_employee', 'remote_manager',
  'hr_manager', 'hr_specialist',
  'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent',
  'finance_manager', 'accountant', 'sales_manager', 'sales_rep',
  'procurement_manager', 'customs_manager', 'customs_officer',
  'marketing_manager', 'marketing_specialist', 'bd_manager', 'bd_specialist',
];

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
  section?: string;
  // For Remote pages: a remote_employee only sees this if their remoteAccess
  // includes this key. Managers/admins see every remote item regardless.
  remoteKey?: string;
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
  const { lang, toggleLang, isRTL } = useLanguage();
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

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
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
    const isRemoteRole = user.role === 'remote_employee' || user.role === 'remote_manager';
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
    { href: '/system/executive', label: lang === 'ar' ? 'النظرة التنفيذية' : 'Executive Overview', icon: <Crown className="w-5 h-5" />, roles: ['super_admin', 'admin'], section: 'Main' },
    { href: '/system/dashboard', label: L.dashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'], section: 'Main' },
    { href: '/system/overdue', label: L.overdue, icon: <AlertTriangle className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'moderator'], section: 'Main' },
    { href: '/system/credit-alerts', label: L.creditAlerts, icon: <Shield className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'employee', 'moderator'], section: 'Main' },
    // Customers & Finance
    { href: '/system/invoices', label: L.invoices, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'moderator'], section: 'Customers & Finance' },
    { href: '/system/payments', label: L.payments, icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee'], section: 'Customers & Finance' },
    { href: '/system/collections', label: L.collections, icon: <Phone className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee'], section: 'Customers & Finance' },
    { href: '/system/collectors', label: L.collectors, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin'], section: 'Customers & Finance' },
    { href: '/system/tasks', label: L.tasks, icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee'], section: 'Customers & Finance' },
    { href: '/system/disputes', label: L.disputes, icon: <AlertTriangle className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager'], section: 'Customers & Finance' },
    // Operations
    { href: '/system/operations', label: L.operations, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'], section: 'Operations' },
    { href: '/system/operations/dispatch-sheets', label: L.dispatchSheets, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'], section: 'Operations' },
    { href: '/system/vendors', label: L.vendors, icon: <Store className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'operations', 'procurement_manager', 'purchasing'], section: 'Operations' },
    { href: '/system/wallet', label: L.wallet, icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'operations', 'moderator'], section: 'Operations' },
    { href: '/system/wallet-dashboard', label: L.walletDashboard, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'moderator'], section: 'Operations' },
    { href: '/system/vehicle-analytics', label: L.vehicleAnalytics, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager'], section: 'Operations' },
    { href: '/system/vehicle-analytics/fuel', label: L.fuelAnalysis, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager'], section: 'Operations' },
    { href: '/system/vehicle-analytics/tracking', label: L.gpsTracking, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager'], section: 'Operations' },
    { href: '/system/vehicle-analytics/trips', label: L.trips, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager'], section: 'Operations' },
    { href: '/system/vehicle-analytics/upload', label: L.dataUpload, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager'], section: 'Operations' },
    // Customs Clearance
    // Operations Platform (قسم الأوبريشن) — live mirror of the external UPL field-ops system (B2B: Fleet + 3PL)
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

    // ---- Shipment Orders (طلبات الشحنات) — standalone trial ----
    // Creating shipments natively instead of on the external UPL system. Kept
    // fully independent from Operations Platform: if the trial works, the team
    // moves HERE and the integration is what gets retired.
    { href: '/system/shipment-orders', label: lang === 'ar' ? 'الشحنات' : 'Shipments', icon: <PackageSearch className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    { href: '/system/shipment-orders/chat', label: lang === 'ar' ? 'مساعد الإنشاء' : 'Create Assistant', icon: <Bot className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    { href: '/system/shipment-orders/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    { href: '/system/shipment-orders/fleet', label: lang === 'ar' ? 'الموردون والمركبات' : 'Suppliers & Vehicles', icon: <Truck className="w-5 h-5" />, roles: SO_ROLES, section: 'Shipment Orders' },
    { href: '/system/shipment-orders/form-settings', label: lang === 'ar' ? 'إعدادات النموذج' : 'Form Settings', icon: <SlidersHorizontal className="w-5 h-5" />, roles: ['super_admin', 'admin', 'it_manager', 'operations_manager'], section: 'Shipment Orders' },

    // ---- Fleet Management (إدارة الأسطول) — our own trucks ----
    { href: '/system/fleet', label: lang === 'ar' ? 'الحمولات' : 'Shipments', icon: <Truck className="w-5 h-5" />, roles: SO_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/dashboard', label: lang === 'ar' ? 'لوحة التحليلات' : 'Dashboard', icon: <BarChart3 className="w-5 h-5" />, roles: SO_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/drivers', label: lang === 'ar' ? 'السائقون' : 'Drivers', icon: <UserSquare className="w-5 h-5" />, roles: SO_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/vehicles', label: lang === 'ar' ? 'سياراتنا' : 'Our Vehicles', icon: <Car className="w-5 h-5" />, roles: SO_ROLES, section: 'Fleet Management' },
    { href: '/system/fleet/customers', label: lang === 'ar' ? 'العملاء' : 'Customers', icon: <Users className="w-5 h-5" />, roles: SO_ROLES, section: 'Fleet Management' },

    { href: '/system/customs', label: L.customsClearance, icon: <Ship className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/guide', label: L.customsGuide, icon: <ScrollText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'], section: 'Customs' },
    // Vehicles & Authorizations (المركبات والتفاويض) — super admin + HR + Accounting
    { href: '/system/vehicles/dashboard', label: L.vehiclesDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles', label: L.vehiclesFleet, icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/accidents', label: L.vehiclesAccidents, icon: <AlertTriangle className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'], section: 'Vehicles' },
    { href: '/system/vehicles/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant']), section: 'Vehicles' },
    // Location Solutions (لوكيشن سوليوشن) — live Wialon GPS/telemetry mirror
    { href: '/system/ls2', label: lang === 'ar' ? 'لوحة التتبّع' : 'Telemetry Dashboard', icon: <Gauge className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/live', label: lang === 'ar' ? 'الأسطول المباشر' : 'Live Fleet', icon: <Satellite className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/registry', label: lang === 'ar' ? 'سجل الأسطول' : 'Fleet Registry', icon: <ClipboardList className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/drivers', label: lang === 'ar' ? 'السواقين' : 'Drivers', icon: <UserSquare className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/tires', label: lang === 'ar' ? 'الكاوتش' : 'Tires', icon: <Activity className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/temperature', label: lang === 'ar' ? 'الحرارة' : 'Temperature', icon: <Thermometer className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/maintenance', label: lang === 'ar' ? 'الصيانة' : 'Maintenance', icon: <Wrench className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/fleet-assets', label: lang === 'ar' ? 'السطحات والكاوتشات' : 'Fleet Assets', icon: <Container className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/repairs', label: lang === 'ar' ? 'الصيانة الاستثنائية' : 'Exceptional Repairs', icon: <Hammer className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/alerts', label: lang === 'ar' ? 'التنبيهات' : 'Alerts', icon: <Bell className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },
    { href: '/system/ls2/reports', label: lang === 'ar' ? 'التقارير' : 'Reports', icon: <FileBarChart className="w-5 h-5" />, roles: LS2_SECTION_ROLES, section: 'Location Solutions' },

    // Workshop — deliberately placed right after Location Solutions: this is the
    // shop floor that services that fleet, and its store holds the very tires and
    // trailers the ls2 asset registry tracks. Keeping the two sections apart made
    // people hunt across the sidebar for one truck's story.
    { href: '/system/workshop/store', label: lang === 'ar' ? 'المستودع' : 'Store', icon: <Boxes className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee', 'purchasing'], section: 'Workshop' },
    { href: '/system/workshop', label: L.workshop, icon: <Wrench className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee'], section: 'Workshop' },
    { href: '/system/workshop/purchases', label: L.workshopPurchases, icon: <ShoppingCart className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'purchasing'], section: 'Workshop' },
    { href: '/system/workshop/dashboard', label: L.workshopDashboard, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee', 'purchasing'], section: 'Workshop' },
    { href: '/system/workshop/tasks', label: lang === 'ar' ? 'أوامر شغل المركبات' : 'Vehicle Work Orders', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee'], section: 'Workshop' },
    // ---- Performance (KPI evaluation) ----
    { href: '/system/performance', label: lang === 'ar' ? 'تقييم مديري الأقسام' : 'Evaluate Managers', icon: <Target className="w-5 h-5" />, roles: ['super_admin'], section: 'Performance' },
    { href: '/system/performance/overview', label: lang === 'ar' ? 'نظرة كل الأقسام' : 'All Departments', icon: <Crown className="w-5 h-5" />, roles: ['super_admin'], section: 'Performance' },
    { href: '/system/performance/requests', label: lang === 'ar' ? 'طلبات تعديل التقييم' : 'Edit Requests', icon: <Inbox className="w-5 h-5" />, roles: ['super_admin'], section: 'Performance' },
    { href: '/system/performance/settings', label: lang === 'ar' ? 'إعداد المؤشرات' : 'Configure KPIs', icon: <Settings className="w-5 h-5" />, roles: ['super_admin'], section: 'Performance' },
    // ---- Marketing ----
    { href: '/system/marketing', label: lang === 'ar' ? 'لوحة التسويق' : 'Marketing Dashboard', icon: <Megaphone className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/campaigns', label: lang === 'ar' ? 'الحملات' : 'Campaigns', icon: <Target className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/activities', label: lang === 'ar' ? 'سجل الأنشطة' : 'Activity Log', icon: <ClipboardList className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/reports', label: lang === 'ar' ? 'التقارير الدورية' : 'Periodic Reports', icon: <BarChart3 className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: MARKETING_ROLES, section: 'Marketing' },
    { href: '/system/marketing/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(MARKETING_ROLES), section: 'Marketing' },
    // ---- Business Development ----
    { href: '/system/bd', label: lang === 'ar' ? 'تطوير الأعمال' : 'Business Development', icon: <BarChart3 className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/opportunities', label: lang === 'ar' ? 'الفرص الاستراتيجية' : 'Opportunities', icon: <Compass className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/partners', label: lang === 'ar' ? 'الشراكات' : 'Partners', icon: <Handshake className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/tenders', label: lang === 'ar' ? 'المناقصات' : 'Tenders', icon: <Gavel className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: BD_ROLES, section: 'Business Development' },
    { href: '/system/bd/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(BD_ROLES), section: 'Business Development' },
    // ---- Software & IT ----
    { href: '/system/it', label: lang === 'ar' ? 'لوحة تقنية المعلومات' : 'IT Dashboard', icon: <MonitorCog className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/tickets', label: lang === 'ar' ? 'التذاكر والمشكلات' : 'Tickets', icon: <LifeBuoy className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/recurring', label: lang === 'ar' ? 'المشكلات المتكررة' : 'Recurring Problems', icon: <RefreshCw className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/custody', label: lang === 'ar' ? 'العهد والأجهزة' : 'IT Custody', icon: <Laptop className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/stock', label: lang === 'ar' ? 'المستودع' : 'IT Stock', icon: <Boxes className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/systems', label: lang === 'ar' ? 'الأنظمة والخدمات' : 'Systems & Services', icon: <Server className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ClipboardList className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: IT_ROLES, section: 'Software & IT' },
    { href: '/system/it/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(IT_ROLES), section: 'Software & IT' },
    { href: '/system/ls2/settings', label: lang === 'ar' ? 'الإعدادات' : 'Settings', icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'workshop_manager'], section: 'Location Solutions' },
    { href: '/system/ls2/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(LS2_SECTION_ROLES), section: 'Location Solutions' },
    // B2C
    { href: '/system/b2c/dashboard', label: L.b2cDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager'], section: 'B2C' },
    { href: '/system/b2c/reps-performance', label: L.b2cRepsPerformance, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager'], section: 'B2C' },
    { href: '/system/b2c/daily-entry', label: L.b2cDailyEntry, icon: <CalendarDays className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager'], section: 'B2C' },
    { href: '/system/b2c/reps', label: L.b2cReps, icon: <Award className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager'], section: 'B2C' },
    { href: '/system/b2c/projects', label: L.b2cProjects, icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager'], section: 'B2C' },
    { href: '/system/b2c/custody', label: lang === 'ar' ? 'العهدة' : 'Custody', icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager'], section: 'B2C' },
    { href: '/system/b2c/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'b2c_head', 'b2c_project_manager']), section: 'B2C' },
    // Remote (work-from-home)
    { href: '/system/remote/attendance', label: L.remoteAttendance, icon: <Clock className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'attendance' },
    { href: '/system/remote/dashboard', label: L.remoteDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'dashboard' },
    { href: '/system/remote/leave', label: L.remoteLeave, icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'leave' },
    { href: '/system/remote/chat', label: L.remoteChat, icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'chat' },
    { href: '/system/remote/tasks', label: L.remoteTasks, icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'tasks' },
    { href: '/system/remote/report', label: L.remoteReport, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'report' },
    { href: '/system/remote/announcements', label: L.remoteAnnouncements, icon: <Megaphone className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager', 'remote_employee'], section: 'Remote', remoteKey: 'announcements' },
    { href: '/system/remote/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'remote_manager']), section: 'Remote' },
    // HR (back-office — staff only)
    { href: '/system/hr/dashboard', label: L.hrDashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/employees', label: L.hrEmployees, icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/contracts', label: L.hrContracts, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/leaves', label: L.hrLeaves, icon: <CalendarCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/requests', label: L.hrRequests, icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/custody', label: L.hrCustody, icon: <Package className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/stock', label: L.hrStock, icon: <Boxes className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/licenses', label: lang === 'ar' ? 'التراخيص والاشتراكات' : 'Licenses & Subscriptions', icon: <ScrollText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/leave-types', label: L.hrLeaveTypes, icon: <Tags className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    // Self Service (HR pages every employee sees)
    { href: '/system/hr/me', label: L.hrMyProfile, icon: <Briefcase className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, section: 'Self Service' },
    { href: '/system/hr/my-leaves', label: L.hrMyLeaves, icon: <CalendarDays className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, section: 'Self Service' },
    { href: '/system/hr/my-requests', label: L.hrMyRequests, icon: <ClipboardList className="w-5 h-5" />, roles: SELF_SERVICE_ROLES, section: 'Self Service' },
    // CRM
    { href: '/system/crm/dashboard', label: L.crmDashboard, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/companies', label: L.crmCompanies, icon: <Building2 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/vendors', label: lang === 'ar' ? 'الموردين' : 'Vendors', icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/contacts', label: L.crmContacts, icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/deals', label: L.crmDeals, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/tasks', label: L.crmTasks, icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/calendar', label: L.crmCalendar, icon: <CalendarDays className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/activities', label: L.crmActivities, icon: <Phone className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    // Sales
    { href: '/system/sales/dashboard', label: L.salesDashboard, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'], section: 'Sales' },
    { href: '/system/sales/pipeline', label: L.salesPipeline, icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'], section: 'Sales' },
    { href: '/system/sales/targets', label: L.salesTargets, icon: <Target className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'], section: 'Sales' },
    { href: '/system/sales/performance', label: L.salesPerformance, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'], section: 'Sales' },
    // Accounting
    { href: '/system/accounting/dashboard', label: L.accountingDashboard, icon: <Calculator className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/accounts', label: L.chartOfAccounts, icon: <BookOpen className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/journal', label: L.journal, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/trial-balance', label: L.trialBalance, icon: <Scale className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/profit-loss', label: L.profitLoss, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/receivables', label: L.receivables, icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/payables', label: L.payables, icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    // Procurement
    { href: '/system/procurement/dashboard', label: L.procurementDashboard, icon: <ShoppingCart className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing'], section: 'Procurement' },
    { href: '/system/procurement/requests', label: L.purchaseRequests, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing'], section: 'Procurement' },
    { href: '/system/procurement/orders', label: L.purchaseOrders, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing'], section: 'Procurement' },
    { href: '/system/procurement/bills', label: L.vendorBills, icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing'], section: 'Procurement' },

    // Per-section Tasks (private) + Complaints — strict visibility (assignee + creator + super_admin)
    { href: '/system/crm/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations'], section: 'CRM' },
    { href: '/system/crm/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations']), section: 'CRM' },
    { href: '/system/sales/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'], section: 'Sales' },
    { href: '/system/sales/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations'], section: 'Sales' },
    { href: '/system/sales/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations']), section: 'Sales' },
    { href: '/system/accounting/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant'], section: 'Accounting' },
    { href: '/system/accounting/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'finance_manager', 'accountant']), section: 'Accounting' },
    { href: '/system/procurement/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing'], section: 'Procurement' },
    { href: '/system/procurement/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing'], section: 'Procurement' },
    { href: '/system/procurement/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing']), section: 'Procurement' },
    { href: '/system/hr/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist'], section: 'HR' },
    { href: '/system/hr/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'hr_manager', 'hr_specialist']), section: 'HR' },
    { href: '/system/ops/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: OPS_ROLES, section: 'Operations Platform' },
    { href: '/system/ops/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(OPS_ROLES), section: 'Operations Platform' },
    { href: '/system/workshop/my-tasks', label: lang === 'ar' ? 'مهامي الإدارية' : 'My Admin Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee', 'purchasing'], section: 'Workshop' },
    { href: '/system/workshop/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee', 'purchasing'], section: 'Workshop' },
    { href: '/system/workshop/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee', 'purchasing']), section: 'Workshop' },
    { href: '/system/customs/my-tasks', label: lang === 'ar' ? 'مهامي' : 'My Tasks', icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/complaints', label: lang === 'ar' ? 'الشكاوى' : 'Complaints', icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'], section: 'Customs' },
    { href: '/system/customs/kpis', label: lang === 'ar' ? 'تقييم الأداء' : 'KPIs', icon: <Target className="w-5 h-5" />, roles: kpiRoles(['super_admin', 'it_manager', 'it_specialist', 'admin', 'operations_manager', 'customs_manager', 'customs_officer']), section: 'Customs' },

    // Tools
    // The exec KPI board admits KPI_ROLES (lib/finance.ts) — mirror it exactly.
    { href: '/system/kpis', label: L.kpis, icon: <Gauge className="w-5 h-5" />, roles: ['super_admin', 'admin', 'moderator'], section: 'Tools' },
    { href: '/system/assistant', label: L.assistant, icon: <Bot className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee'], section: 'Tools' },
    { href: '/system/settings', label: L.settings, icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'], section: 'Tools' },
    // Admin (configuration & oversight — kept near the bottom)
    { href: '/system/branches', label: L.branches, icon: <Building2 className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist'], section: 'Admin' },
    { href: '/system/expense-categories', label: L.expenseCategories, icon: <Tags className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist'], section: 'Admin' },
    { href: '/system/settings/reference-data', label: lang === 'ar' ? 'القوائم المرجعية' : 'Reference Data', icon: <Tags className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'procurement_manager', 'purchasing', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'sales_manager', 'hr_manager', 'hr_specialist'], section: 'Admin' },
    { href: '/system/users', label: L.users, icon: <UserCog className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist'], section: 'Admin' },
    { href: '/system/permissions', label: lang === 'ar' ? 'الأدوار والصلاحيات' : 'Roles & Permissions', icon: <ShieldCheck className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist'], section: 'Admin' },
    { href: '/system/audit', label: L.auditLog, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin'], section: 'Admin' },
    { href: '/system/complaints', label: L.complaints, icon: <MessageSquare className="w-5 h-5" />, roles: ['super_admin', 'it_manager', 'it_specialist', 'admin', 'workshop_manager', 'operations_manager'], section: 'Admin' },
    // Client portal
    { href: '/system/portal', label: L.overview, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['client'], section: 'Portal' },
    { href: '/system/portal/invoices', label: L.myInvoices, icon: <FileText className="w-5 h-5" />, roles: ['client'], section: 'Portal' },
    { href: '/system/portal/payments', label: L.myPayments, icon: <CreditCard className="w-5 h-5" />, roles: ['client'], section: 'Portal' },
  ];

  // Real-time notification updates
  useSocket('notification:new', useCallback(() => {
    fetchNotifications();
  }, []));

  // Live permission changes: when the super_admin edits a role's section access,
  // every logged-in user of that role refetches /me so their sidebar + access
  // update immediately without re-login.
  useSocket('permissions:updated', useCallback((data: { role?: string }) => {
    if (data?.role && user?.role === data.role) refreshUser();
  }, [user?.role, refreshUser]));

  const filteredNav = navItems.filter((item) => {
    if (!user) return false;
    // Managed sections are governed by the super_admin permission matrix
    // (sectionKey → none/view/edit) instead of the static role list. This is
    // what makes granting/removing a section to a role take effect live.
    if (isManagedSection(item.section)) {
      if (!canAccessSection(user.permissions, item.section as string)) return false;
      if (item.remoteKey && user.role === 'remote_employee') {
        return Array.isArray(user.remoteAccess) && user.remoteAccess.includes(item.remoteKey);
      }
      return true;
    }
    // Legacy role-gated sections (Main, Tools, Admin, Self Service, Portal).
    if (!item.roles.includes(user.role)) return false;
    if (item.remoteKey && user.role === 'remote_employee') {
      return Array.isArray(user.remoteAccess) && user.remoteAccess.includes(item.remoteKey);
    }
    return true;
  });

  // Group filtered nav items by section, preserving order
  const groupedNav = filteredNav.reduce((acc, item) => {
    const section = item.section || 'Other';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, NavItem[]>);

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
        onClick={onClick}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-[#f37121] text-white shadow-sm shadow-[#f37121]/30'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {item.icon}
        {(onClick || sidebarOpen) && <span>{item.label}</span>}
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
          onClick={() => toggleSection(section)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 mt-2 rounded-lg text-xs font-bold text-slate-400 uppercase tracking-wide bg-slate-800/40 hover:bg-slate-800 hover:text-slate-200 transition-colors"
        >
          <span>{getSectionLabel(section, lang)}</span>
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
    <div className="min-h-screen bg-slate-100 flex" dir={isRTL ? 'rtl' : 'ltr'}>
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
          {Object.entries(groupedNav).map(([section, items]) => {
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
              <p className="text-slate-400 text-xs capitalize">{getRoleLabel(user.role, lang)}</p>
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
                      <p className="p-4 text-slate-500 text-sm text-center">{L.noNewNotifications}</p>
                    ) : (
                      notifications.map((n: any) => (
                        <div key={n._id} className="p-3 border-b border-slate-200/70 hover:bg-slate-100">
                          <p className="text-slate-900 text-sm font-medium">{n.title}</p>
                          <p className="text-slate-500 text-xs mt-1">{n.message}</p>
                        </div>
                      ))
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
        <main className="flex-1 p-4 md:p-6 overflow-x-auto min-w-0">
          {children}
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
                {Object.entries(groupedNav).map(([section, items]) =>
                  renderSection(section, items, () => setMobileMenuOpen(false))
                )}
              </nav>
              <div className="border-t border-slate-800 p-4">
                <p className="text-white text-sm">{user.firstName} {user.lastName}</p>
                <p className="text-slate-400 text-xs capitalize mb-3">{getRoleLabel(user.role, lang)}</p>
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
