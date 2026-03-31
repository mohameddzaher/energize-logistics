// Empty baseUrl so requests go through Next.js rewrites (same origin)
// This ensures cookies are sent/received correctly on both dev and Netlify SSR
const API_URL = '';

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
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
    const { skipAuth, ...fetchOptions } = options;

    const config: RequestInit = {
      ...fetchOptions,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    };

    const res = await fetch(`${this.baseUrl}${endpoint}`, config);

    if (res.status === 401 && !skipAuth) {
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

  delete<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient(API_URL);
export default api;
