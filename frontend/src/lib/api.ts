// Call the backend DIRECTLY at api.<domain>. It's a same-SITE subdomain of the
// frontend, so the SameSite=None;Secure auth cookies are still sent — the
// Safari/iOS ITP problem only affects cross-SITE (different registrable domain,
// e.g. *.onrender.com), NOT a subdomain. Going direct skips Netlify's
// same-origin /api proxy, which detours through a far region and made every API
// call ~4x slower (measured 1.1s vs 0.25s). Falls back to same-origin ('') when
// NEXT_PUBLIC_API_URL is unset (e.g. local dev via the Next.js rewrite).
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
  timeoutMs?: number;
}

class ApiClient {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private failedQueue: Array<{
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    endpoint: string;
    options: FetchOptions;
  }> = [];

  private processQueue(success: boolean) {
    this.failedQueue.forEach(({ resolve, reject, endpoint, options }) => {
      if (success) {
        resolve(this.request(endpoint, { ...options, skipAuth: true }));
      } else {
        reject(new Error('Authentication required'));
      }
    });
    this.failedQueue = [];
  }

  private async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { skipAuth, timeoutMs, ...fetchOptions } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? 45000);

    const config: RequestInit = {
      ...fetchOptions,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    };

    // Diagnostic timing: log every request's round-trip to the browser console so
    // slow endpoints (e.g. a cold backend, or the socket/poll proxy stalling
    // login) are visible. Slow (>2s) requests are warned in orange; failures in
    // red. Copy these lines to diagnose production latency.
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = () => Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
    const logTiming = (status: number | string) => {
      if (typeof window === 'undefined') return;
      const ms = elapsed();
      const line = `[api] ${method} ${endpoint} → ${status} in ${ms}ms`;
      if (typeof status === 'number' && status >= 200 && status < 400) {
        (ms > 2000 ? console.warn : console.log)(ms > 2000 ? `🐢 SLOW ${line}` : line);
      } else {
        console.error(`❌ ${line}`);
      }
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${endpoint}`, config);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        logTiming(`TIMEOUT after ${timeoutMs ?? 45000}ms`);
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      logTiming(`NETWORK ERROR (${err?.message || 'failed'})`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    // Auth endpoints (login/refresh/logout) must NOT go through the refresh-retry
    // path: a 401 there is the real answer (e.g. wrong password), and retrying a
    // refresh that also fails would mask it behind a generic "Authentication
    // required" message. Surface the actual error instead.
    const isAuthEndpoint = endpoint.startsWith('/api/auth/');

    // A 401 we are about to recover from (expired 15-min access cookie →
    // silent refresh → retry) is NOT an error — logging it red made people
    // hunt for a bug that isn't there. Only a FINAL failure logs red.
    const recoverable401 = res.status === 401 && !skipAuth && !isAuthEndpoint;
    if (recoverable401) {
      if (typeof window !== 'undefined') console.log(`[api] ${method} ${endpoint} → 401 in ${elapsed()}ms (access token expired — refreshing session)`);
    } else {
      logTiming(res.status);
    }

    if (recoverable401) {
      // If already refreshing, queue this request
      if (this.isRefreshing) {
        return new Promise<T>((resolve, reject) => {
          this.failedQueue.push({
            resolve: resolve as (value: unknown) => void,
            reject,
            endpoint,
            options,
          });
        });
      }

      // Try refresh on ANY 401 (not just TOKEN_EXPIRED)
      //
      // والاستثناء يُلتقَط هنا لا يُترَك يصعد: لو رمى التجديد (انقطاع شبكة) لم
      // تُستدعَ processQueue أصلًا، فيبقى كلُّ طلبٍ في الطابور معلَّقًا إلى
      // الأبد — دوائرُ تحميلٍ لا تنتهي حتى يصادف 401 آخر يفرّغ الطابور.
      let refreshed = false;
      try {
        refreshed = await this.refreshToken();
      } catch {
        this.processQueue(false);
        throw new Error('Network error during session refresh');
      }
      if (refreshed) {
        this.processQueue(true);
        return this.request<T>(endpoint, { ...options, skipAuth: true });
      }

      this.processQueue(false);
      // THIS is the real failure worth a red line: the refresh itself failed,
      // so the session is genuinely over.
      if (typeof window !== 'undefined') console.error(`❌ [api] ${method} ${endpoint} → 401 (session refresh failed — signed out)`);
      // Don't hard-redirect here — let AuthContext handle auth state
      // and the system layout will redirect to login when needed
      throw new Error('Authentication required');
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Request failed' }));
      // ── وما زاد على الرسالة يبقى معها ──────────────────────────────────
      // الخادمُ يعيد مع الرسالة أسماءَ الحقول التي ردَّها ورمزَ السبب، وكان
      // يُبنى منه `Error` بالرسالة وحدَها فيضيع الباقي. فتبحث الشاشةُ في أربعين
      // خانةً عن الخطأ بدل أن تلوّن خانتَه.
      const err = new Error(error.message || 'Request failed') as Error & {
        status?: number; fields?: string[]; code?: string; data?: any;
      };
      err.status = res.status;
      if (Array.isArray(error.fields)) err.fields = error.fields;
      if (error.code) err.code = error.code;
      err.data = error;
      throw err;
    }

    return res.json();
  }

  private async refreshToken(): Promise<boolean> {
    if (this.isRefreshing) {
      return this.refreshPromise!;
    }

    this.isRefreshing = true;
    this.refreshPromise = fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .finally(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * تجديدٌ استباقيّ يناديه AuthContext كلّ اثنتي عشرة دقيقة.
   *
   * يمرّ من هنا لا بـ`fetch` على مسارٍ نسبيّ: الخادم على نطاقٍ غير نطاق
   * الواجهة، وكوكيز الجلسة مربوطةٌ بنطاقه وحده — فالمسار النسبيّ يذهب إلى
   * المستضيف بلا كوكيز فيردّ ٤٠١ ولا يجدّد شيئًا.
   */
  refreshSession(): Promise<boolean> {
    return this.refreshToken();
  }

  get<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  // Fetch a binary endpoint (e.g. the server-rendered بوليصة PDF) as a Blob,
  // carrying the session cookie and doing ONE silent refresh on a 401 — same
  // recovery as request(), but returning bytes instead of JSON.
  async getBlob(endpoint: string, retried = false): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (res.status === 401 && !retried && !endpoint.startsWith('/api/auth/')) {
      if (await this.refreshToken()) return this.getBlob(endpoint, true);
      throw new Error('Authentication required');
    }
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(msg.message || 'Request failed');
    }
    return res.blob();
  }

  post<T>(endpoint: string, data?: unknown, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(endpoint: string, data?: unknown, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  patch<T>(endpoint: string, data?: unknown, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient(API_URL);
export default api;
