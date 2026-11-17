import createClient from 'openapi-fetch';
import { config } from '@/config';
import { useAuth } from '@/stores/auth';
import type { paths } from './schema';
import type { FieldError, Problem } from './types';

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

/** The auth endpoints run on the refresh cookie: no bearer token, no refresh-and-retry. */
const isAuthEndpoint = (request: Request) =>
  new URL(request.url).pathname.startsWith('/api/v1/auth/');

function withBearer(request: Request): Request {
  const token = useAuth.getState().accessToken;
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  return request;
}

/**
 * The transport under the typed client: adds the access token, and on a 401 refreshes once and
 * replays the request. A Request's body is a stream that can be read only once, so the replay
 * needs a clone taken before the first send.
 */
async function authFetch(request: Request): Promise<Response> {
  if (isAuthEndpoint(request)) return fetch(request);
  const replay = request.clone();
  const response = await fetch(withBearer(request));
  if (response.status !== 401) return response;
  const token = await refreshSession();
  return token ? fetch(withBearer(replay)) : response;
}

/** Every path, parameter and body is checked against contract/openapi.yaml at compile time. */
export const api = createClient<paths>({
  baseUrl: config.apiUrl,
  headers: { Accept: 'application/json' },
  // The refresh cookie lives on /api/v1/auth; it must travel cross-origin (5173 → the API's port).
  credentials: 'include',
  fetch: authFetch,
});

interface Outcome<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function problemOf(error: unknown, response: Response): Problem {
  if (typeof error === 'object' && error !== null && 'status' in error) return error as Problem;
  return { type: 'about:blank', title: response.statusText, status: response.status };
}

/** openapi-fetch returns `{ data, error }` instead of throwing; TanStack Query wants a throw. */
export async function unwrap<T>(pending: Promise<Outcome<T>>): Promise<T> {
  const { data, error, response } = await pending;
  if (!response.ok) throw new ApiError(problemOf(error, response));
  return data as T;
}

/** For 204 responses: succeed with nothing, or throw like `unwrap`. */
export async function expectOk(pending: Promise<Outcome<unknown>>): Promise<void> {
  await unwrap(pending);
}

let refreshing: Promise<string | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share ONE request:
 * two parallel refreshes would present the same token twice, and the server would treat the
 * second as theft and revoke the whole session (README §6.2).
 */
export function refreshSession(): Promise<string | null> {
  refreshing ??= unwrap(api.POST('/api/v1/auth/refresh'))
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
