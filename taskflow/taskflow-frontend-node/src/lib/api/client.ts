import { config } from '@/config';
import { useAuth } from '@/stores/auth';
import type { AccessToken, FieldError, Problem } from './types';

/** A non-2xx response, carrying the RFC 9457 problem body. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
  }

  /** 422 field errors keyed by field, ready for react-hook-form's setError. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.problem.errors ?? []).map((e: FieldError) => [e.field, e.message]),
    );
  }
}

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Skip the Authorization header and the refresh-and-retry dance (the auth endpoints). */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(config.apiUrl + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function send<T>(method: string, path: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = useAuth.getState().accessToken;
  if (!options.anonymous && token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // The refresh cookie lives on /api/v1/auth; it must travel cross-origin (5173 → the API's port).
    credentials: 'include',
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      (data as Problem | null) ?? {
        type: 'about:blank',
        title: response.statusText,
        status: response.status,
      },
    );
  }
  return data as T;
}

let refreshing: Promise<string | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share ONE request:
 * two parallel refreshes would present the same token twice, and the server would treat the
 * second as theft and revoke the whole session (README §6.2).
 */
export function refreshSession(): Promise<string | null> {
  refreshing ??= send<AccessToken>('POST', '/api/v1/auth/refresh', { anonymous: true })
    .then((res) => {
      useAuth.getState().setSession(res.accessToken);
      return res.accessToken;
    })
    .catch(() => {
      useAuth.getState().clear();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await send<T>(method, path, options);
  } catch (err) {
    if (options.anonymous || !(err instanceof ApiError) || err.status !== 401) throw err;
    const token = await refreshSession();
    if (!token) throw err;
    return send<T>(method, path, options);
  }
}
