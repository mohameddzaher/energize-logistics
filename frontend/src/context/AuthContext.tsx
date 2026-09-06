'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import api from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';

interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'employee' | 'operations_manager' | 'operations_staff' | 'moderator' | 'client' | 'procurement_staff' | 'b2c_manager' | 'b2c_project_lead' | 'remote_employee' | 'remote_manager' | 'hr_manager' | 'hr_specialist' | 'crm_manager' | 'crm_team_lead' | 'crm_specialist' | 'crm_agent' | 'finance_manager' | 'accountant' | 'sales_manager' | 'sales_rep' | 'procurement_manager';
  linkedCustomer?: { _id: string; companyName: string; creditTerm: number };
  assignedCustomers?: { _id: string; companyName: string }[];
  assignedProjects?: { _id: string; name: string; code?: string }[];
  assignedBranches?: { _id: string; name: string; code?: string; city?: string }[];
  remoteAccess?: string[];
  manager?: { _id: string; firstName: string; lastName: string; email: string; role: string } | string;
  linkedEmployee?: { _id: string; firstName: string; lastName: string; employeeNumber?: string; jobTitle?: string } | string;
  // Effective per-section access set by the super_admin permissions page
  // (sectionKey → 'none' | 'view' | 'edit'). Drives sidebar visibility and
  // client-side edit gating. See lib/sections.ts.
  permissions?: Record<string, 'none' | 'view' | 'edit'>;
  // ── وأيُّ الشاشات تُفتَح ────────────────────────────────────────────────────
  // القسمُ يقول ماذا يُفعَل والصفحةُ تقول أين: مسارُ الصفحة ← مسموحةٌ أو لا.
  // الصفحةُ الغائبةُ من الخريطة مسموحةٌ (الخادمُ يرسلها كاملةً؛ والغيابُ يعني
  // نسخةً أقدمَ من الواجهة، فلا تُخفى شاشةٌ بسببه).
  pageAccess?: Record<string, boolean>;
  // أوّلُ شاشةٍ تُفتَح لصاحب هذا الدور، إن ضُبطت له واحدة.
  homePage?: string;
  // اسمُ الدور المصنوع بلغتيه — جدولُ الترجمة في الواجهة لا يعرف ما صُنع بعد بنائه.
  roleLabel?: { ar: string; en: string } | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  loginKey: number;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── لماذا نحتفظ بالمستخدم في التبويب ────────────────────────────────────────
// الواجهة كلها كانت تنتظر /api/auth/me عند **كل** فتح صفحة. ومع انتهاء توكن
// الوصول (ربع ساعة) تصير الرحلة ثلاثًا متتالية — me ثم refresh ثم me — قبل أن
// تبدأ الصفحة تحميل بياناتها أصلًا. هذا سبب «الصفحات بتقعد تحمّل كتير».
//
// الحلّ: نسخة من المستخدم في تخزين التبويب، فتُرسَم الشاشة فورًا ويُتحقَّق منها
// في الخلفية. وهي للعرض فقط — كل طلب إلى الخادم يتحقّق من هويّته بنفسه، فلا
// تمنح النسخة صلاحيةً ولا تُغني عن تحقّق، ولو كانت قديمة صحّحها التحقّق بعد لحظة.
const CACHE_KEY = 'auth:user';
const readCached = (): User | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch { return null; }
};
const writeCached = (u: User | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (u) sessionStorage.setItem(CACHE_KEY, JSON.stringify(u));
    else sessionStorage.removeItem(CACHE_KEY);
  } catch { /* وضع التصفّح الخاص يرفض الكتابة — الشاشة تعمل بدونها */ }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = readCached();
  const [user, setUser] = useState<User | null>(cached);
  // لا ننتظر إن كانت لدينا نسخة: نرسم ونتحقّق في الخلفية.
  const [loading, setLoading] = useState(!cached);
  const [loginKey, setLoginKey] = useState(0);

  const refreshUser = useCallback(async () => {
    try {
      // Let api.ts handle 401 → refresh automatically (no skipAuth)
      const data = await api.get<{ user: User }>('/api/auth/me');
      setUser(data.user);
      writeCached(data.user);
      connectSocket();
    } catch (e: any) {
      // ── انقطاعُ الشبكة ليس خروجًا ─────────────────────────────────────────
      // كان أيّ فشلٍ هنا يمحو المستخدم: مهلةٌ انتهت، أو إعادةُ تشغيل الخادم،
      // أو حزمةٌ ضاعت من الواي-فاي — فتُقذَف إلى شاشة الدخول وجلستُك سليمة
      // تمامًا. الخروج لا يكون إلا حين يقول الخادمُ نفسه إن الجلسة لم تعد
      // مقبولة؛ وما عدا ذلك تُترَك النسخةُ المحفوظة ويُعاد المحاولة لاحقًا.
      if (e?.message === 'Authentication required' || e?.status === 401 || e?.status === 403) {
        setUser(null);
        writeCached(null);
      }
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  // تجديد استباقي: توكن الوصول يعيش ربع ساعة، فنُجدِّده كل اثنتي عشرة دقيقة.
  // بدونه يصطدم أوّل طلب بعد انتهائه بـ401 فيدفع رحلتين إضافيتين — وهو ما يجعل
  // فتح صفحة بعد فترة سكون أبطأ من فتحها أثناء العمل.
  useEffect(() => {
    if (!user) return undefined;
    // عبر عميل الـAPI لا بمسارٍ نسبيّ: الواجهة على نطاق والخادم على نطاقٍ آخر،
    // وكوكيز الجلسة مربوطةٌ بنطاق الخادم وحده — فالمسار النسبيّ كان يصل إلى
    // Netlify بلا كوكيز فيردّ 401 ولا يجدّد شيئًا. كان يعمل محليًّا وحده، حيث
    // كلّ شيء على أصلٍ واحد.
    const id = setInterval(() => { api.refreshSession().catch(() => {}); }, 12 * 60 * 1000);
    return () => clearInterval(id);
  }, [user]);

  const login = async (email: string, password: string): Promise<User> => {
    const data = await api.post<{ user: User }>('/api/auth/login', { email, password });
    setUser(data.user);
    writeCached(data.user);
    setLoginKey(k => k + 1);
    connectSocket();
    return data.user;
  };

  const logout = async () => {
    writeCached(null);
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Continue even if request fails
    }
    setUser(null);
    disconnectSocket();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refreshUser,
        isAuthenticated: !!user,
        loginKey,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
