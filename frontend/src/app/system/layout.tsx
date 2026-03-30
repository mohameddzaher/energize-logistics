'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { getLayoutTranslations, NAV_LABEL_KEYS } from '@/lib/translations';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, FileText, CreditCard, Phone,
  AlertTriangle, UserCog, ClipboardList, BarChart3, Settings,
  LogOut, Bell, Menu, X, ChevronDown, Shield, Bot,
  Briefcase, TrendingUp, ListTodo, Building2, Wallet,
  Store, Truck, Tags, Languages,
} from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
}

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <SystemLayoutInner>{children}</SystemLayoutInner>
    </LanguageProvider>
  );
}

function SystemLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, isAuthenticated } = useAuth();
  const { lang, toggleLang, isRTL } = useLanguage();
  const L = getLayoutTranslations(lang);
  const router = useRouter();
  const pathname = usePathname() || '';
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push(`/login?returnTo=${pathname}`);
    }
  }, [loading, isAuthenticated, router, pathname]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
    }
  }, [isAuthenticated]);

  const fetchNotifications = async () => {
    try {
      const data = await api.get<any>('/api/notifications?unreadOnly=true&limit=10');
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.put('/api/notifications/read-all');
      setNotifications([]);
      setUnreadCount(0);
    } catch {}
  };

  const navItems: NavItem[] = [
    { href: '/system/dashboard', label: L.dashboard, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'] },
    { href: '/system/overdue', label: L.overdue, icon: <AlertTriangle className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager', 'moderator'] },
    { href: '/system/credit-alerts', label: L.creditAlerts, icon: <Shield className="w-5 h-5" />, roles: ['super_admin', 'admin', 'operations_manager', 'employee', 'moderator'] },
    { href: '/system/customers', label: L.customers, icon: <Users className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager', 'moderator'] },
    { href: '/system/invoices', label: L.invoices, icon: <FileText className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager', 'moderator'] },
    { href: '/system/payments', label: L.payments, icon: <CreditCard className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee'] },
    { href: '/system/collections', label: L.collections, icon: <Phone className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee'] },
    { href: '/system/collectors', label: L.collectors, icon: <TrendingUp className="w-5 h-5" />, roles: ['super_admin', 'admin'] },
    { href: '/system/tasks', label: L.tasks, icon: <ListTodo className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee'] },
    { href: '/system/disputes', label: L.disputes, icon: <AlertTriangle className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager'] },
    { href: '/system/operations', label: L.operations, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'] },
    { href: '/system/wallet', label: L.wallet, icon: <Wallet className="w-5 h-5" />, roles: ['super_admin', 'admin', 'operations_manager', 'operations', 'moderator'] },
    { href: '/system/wallet-dashboard', label: L.walletDashboard, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'admin', 'operations_manager', 'moderator'] },
    { href: '/system/branches', label: L.branches, icon: <Building2 className="w-5 h-5" />, roles: ['super_admin'] },
    { href: '/system/vendors', label: L.vendors, icon: <Store className="w-5 h-5" />, roles: ['super_admin', 'admin', 'operations_manager', 'operations'] },
    { href: '/system/drivers', label: L.drivers, icon: <Truck className="w-5 h-5" />, roles: ['super_admin', 'admin', 'operations_manager', 'operations'] },
    { href: '/system/expense-categories', label: L.expenseCategories, icon: <Tags className="w-5 h-5" />, roles: ['super_admin'] },
    { href: '/system/assistant', label: L.assistant, icon: <Bot className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee'] },
    { href: '/system/reports', label: L.reports, icon: <BarChart3 className="w-5 h-5" />, roles: ['super_admin', 'admin'] },
    { href: '/system/users', label: L.users, icon: <UserCog className="w-5 h-5" />, roles: ['super_admin'] },
    { href: '/system/audit', label: L.auditLog, icon: <ClipboardList className="w-5 h-5" />, roles: ['super_admin', 'admin'] },
    { href: '/system/settings', label: L.settings, icon: <Settings className="w-5 h-5" />, roles: ['super_admin', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'] },
    // Client portal
    { href: '/system/portal', label: L.overview, icon: <LayoutDashboard className="w-5 h-5" />, roles: ['client'] },
    { href: '/system/portal/invoices', label: L.myInvoices, icon: <FileText className="w-5 h-5" />, roles: ['client'] },
    { href: '/system/portal/payments', label: L.myPayments, icon: <CreditCard className="w-5 h-5" />, roles: ['client'] },
  ];

  // Real-time notification updates
  useSocket('notification:new', useCallback(() => {
    fetchNotifications();
  }, []));

  const filteredNav = navItems.filter((item) => user && item.roles.includes(user.role));

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  return (
    <div className="min-h-screen bg-gray-900 flex" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col ${sidebarOpen ? 'w-64' : 'w-20'} bg-gray-800 ${isRTL ? 'border-l' : 'border-r'} border-gray-700 transition-all duration-300 fixed h-full z-40 ${isRTL ? 'right-0' : 'left-0'}`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
          {sidebarOpen && (
            <Link href="/" className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-[#f37121]" />
              <span className="text-white font-bold text-sm">Energize CFS</span>
            </Link>
          )}
          <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-white p-1" title="Toggle sidebar">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {filteredNav.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[#f37121] text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {item.icon}
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User Info + Logout */}
        <div className="border-t border-gray-700 p-4">
          {sidebarOpen && (
            <div className="mb-3">
              <p className="text-white text-sm font-medium">{user.firstName} {user.lastName}</p>
              <p className="text-gray-400 text-xs capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          )}
          <button type="button" onClick={handleLogout} className="flex items-center gap-2 text-gray-400 hover:text-red-400 transition-colors text-sm w-full">
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>{L.logout}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 ${sidebarOpen ? (isRTL ? 'lg:mr-64' : 'lg:ml-64') : (isRTL ? 'lg:mr-20' : 'lg:ml-20')} transition-all duration-300`}>
        {/* Top Bar */}
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileMenuOpen(true)} className="lg:hidden text-gray-400 hover:text-white" title="Open menu">
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="text-white font-semibold text-lg hidden sm:block">
              {filteredNav.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'))?.label || L.system}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            {/* Language Toggle */}
            <button type="button" onClick={toggleLang}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-600 hover:text-white transition-colors"
              title={lang === 'en' ? 'التبديل للعربية' : 'Switch to English'}>
              <Languages className="w-4 h-4" />
              <span className="text-xs">{lang === 'en' ? 'عربي' : 'EN'}</span>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button type="button" onClick={() => setShowNotifications(!showNotifications)} className="text-gray-400 hover:text-white relative">
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
                    className="absolute right-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto"
                  >
                    <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                      <span className="text-white font-medium text-sm">{L.notifications}</span>
                      {unreadCount > 0 && (
                        <button type="button" onClick={markAllRead} className="text-[#f37121] text-xs hover:underline">
                          {L.markAllRead}
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <p className="p-4 text-gray-400 text-sm text-center">{L.noNewNotifications}</p>
                    ) : (
                      notifications.map((n: any) => (
                        <div key={n._id} className="p-3 border-b border-gray-700/50 hover:bg-gray-700/50">
                          <p className="text-white text-sm font-medium">{n.title}</p>
                          <p className="text-gray-400 text-xs mt-1">{n.message}</p>
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
              className={`fixed ${isRTL ? 'right-0' : 'left-0'} top-0 w-[280px] h-full bg-gray-800 ${isRTL ? 'border-l' : 'border-r'} border-gray-700 z-50 lg:hidden flex flex-col`}
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
                <span className="text-white font-bold">Energize CFS</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-white" title="Close menu">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
                {filteredNav.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        isActive ? 'bg-[#f37121] text-white' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="border-t border-gray-700 p-4">
                <p className="text-white text-sm">{user.firstName} {user.lastName}</p>
                <p className="text-gray-400 text-xs capitalize mb-3">{user.role.replace('_', ' ')}</p>
                <button type="button" onClick={handleLogout} className="flex items-center gap-2 text-gray-400 hover:text-red-400 text-sm">
                  <LogOut className="w-4 h-4" />
                  <span>{L.logout}</span>
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
