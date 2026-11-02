'use client';
import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef, ReactNode } from 'react';
import api from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';

interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'employee' | 'operations_manager' | 'operations_staff' | 'moderator' | 'client' | 'procurement_staff' | 'b2c_manager' | 'b2c_deputy' | 'b2c_project_lead' | 'b2c_rep_supervisor' | 'b2c_inspection_supervisor' | 'remote_employee' | 'remote_manager' | 'hr_manager' | 'hr_specialist' | 'crm_manager' | 'crm_team_lead' | 'crm_specialist' | 'crm_agent' | 'cfo' | 'accounting_manager' | 'accountant' | 'sales_manager' | 'sales_rep' | 'procurement_manager' | 'mediago_account';
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
  // Which screens open: the section says what can be done and the page says where; page path maps to allowed or not.
  // A page missing from the map is allowed (the server sends it in full; absence means an older frontend, so no screen is hidden because of it).
  pageAccess?: Record<string, boolean>;
  // Pages explicitly ticked in the page matrix take precedence over the role lists in the nav bar.
  pagesGranted?: string[];
  // First screen opened for this role, if one is set.
  homePage?: string;
  // Display name of a custom role in both languages; the frontend translation table does not know roles created after the build.
  roleLabel?: { ar: string; en: string } | null;
  // Display preferences saved on the account (PATCH /api/auth/me/prefs); a dot in the key arrives as a colon, e.g. `shipmentOrders:view`.
  uiPrefs?: Record<string, string>;
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

// Why the user is kept in the tab.
// Every page open waited on /api/auth/me, and once the 15-minute access token expired it became three sequential calls (me, refresh, me) before the page started loading data. A copy of the user in tab storage lets the screen render at once and be verified in the background. It is display-only: every server request verifies identity itself, and a stale copy is corrected by the verification.
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
  } catch { /* Private browsing mode rejects writes; the screen works without them. */ }
};

// On the server useLayoutEffect warns in React; in the browser it is what is needed.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function AuthProvider({ children }: { children: ReactNode }) {
  // The stored copy is read after hydration, not before.
  // Reading it in the initial state made the server render no user (loading) while the browser's first paint saw the user from sessionStorage. That mismatch throws React hydration error #418 on every reload and discards the whole tree. So state starts as the server rendered it and the copy is applied in useLayoutEffect: after hydration, before paint, with no flash.
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginKey, setLoginKey] = useState(0);
  useIsoLayoutEffect(() => {
    const c = readCached();
    // Do not wait when a copy exists: render and verify in the background.
    if (c) { setUser((u) => u || c); setLoading(false); }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      // Let api.ts handle 401 → refresh automatically (no skipAuth)
      const data = await api.get<{ user: User }>('/api/auth/me');
      setUser(data.user);
      writeCached(data.user);
      connectSocket();
    } catch (e: any) {
      // A network failure is not a logout.
      // Any failure here used to clear the user (timeout, server restart, lost packet) and send them to login with a valid session. Logout happens only when the server itself says the session is no longer accepted; otherwise the stored copy stays and a retry follows.
      if (e?.message === 'Authentication required' || e?.status === 401 || e?.status === 403) {
        setUser(null);
        writeCached(null);
      }
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  // Proactive refresh: the access token lives 15 minutes, so it is renewed every 12. Otherwise the first request after expiry hits a 401 and costs two extra round trips, making a page opened after idle slower than during work.
  useEffect(() => {
    if (!user) return undefined;
    // Goes through the API client, not a relative path: the frontend and server are on different domains and the session cookie is bound to the server domain, so a relative path reached the host without cookies and got a 401. It only worked locally, where everything shares one origin.
    const id = setInterval(() => { api.refreshSession().catch(() => {}); }, 12 * 60 * 1000);
    return () => clearInterval(id);
  }, [user]);

  // Tabs follow the account instead of keeping the old user.
  // The session cookie is shared by the whole browser, so signing in as another account in one tab makes the other tabs act as the new account while rendering the old one (empty users page, executive view rejected every few seconds). Login and logout are broadcast to all tabs: logout signs them out, and login as a different account reloads them.
  const userIdRef = useRef<string | null>(null);
  useEffect(() => { userIdRef.current = user?._id ?? null; }, [user]);
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return undefined;
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel('energize-auth'); } catch { return undefined; }
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'logout') {
        writeCached(null);
        setUser(null);
        disconnectSocket();
      } else if (msg.type === 'login' && msg.id && msg.id !== userIdRef.current) {
        writeCached(null);
        window.location.reload();
      }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, []);
  const announce = (msg: { type: 'login' | 'logout'; id?: string }) => {
    try { channelRef.current?.postMessage(msg); } catch { /* A single tab does not need it. */ }
  };

  const login = async (email: string, password: string): Promise<User> => {
    const data = await api.post<{ user: User }>('/api/auth/login', { email, password });
    setUser(data.user);
    writeCached(data.user);
    setLoginKey(k => k + 1);
    connectSocket();
    announce({ type: 'login', id: data.user?._id });
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
    announce({ type: 'logout' });
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
