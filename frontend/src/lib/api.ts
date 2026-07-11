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
    logTiming(res.status);

    // Auth endpoints (login/refresh/logout) must NOT go through the refresh-retry
    // path: a 401 there is the real answer (e.g. wrong password), and retrying a
    // refresh that also fails would mask it behind a generic "Authentication
    // required" message. Surface the actual error instead.
    const isAuthEndpoint = endpoint.startsWith('/api/auth/');

    if (res.status === 401 && !skipAuth && !isAuthEndpoint) {
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
      const refreshed = await this.refreshToken();
      if (refreshed) {
        this.processQueue(true);
        return this.request<T>(endpoint, { ...options, skipAuth: true });
      }

      this.processQueue(false);
      // Don't hard-redirect here — let AuthContext handle auth state
      // and the system layout will redirect to login when needed
      throw new Error('Authentication required');
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || 'Request failed');
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

  get<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
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
