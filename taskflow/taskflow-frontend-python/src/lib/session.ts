import { authApi } from '@/lib/api/endpoints';
import { refreshSession } from '@/lib/api/client';
import type { AuthSession } from '@/lib/api/types';
import { queryClient } from '@/lib/query-client';
import { useAuth } from '@/stores/auth';

let bootstrapping: Promise<void> | null = null;

/**
 * On page load the access token is gone (it only ever lived in memory), but the httpOnly
 * refresh cookie survives. Trade it for a new access token, then load the user.
 * Memoised: React StrictMode runs effects twice in development.
 */
export function bootstrapSession(): Promise<void> {
  bootstrapping ??= (async () => {
    const token = await refreshSession();
    if (token) {
      try {
        useAuth.getState().setUser(await authApi.me());
      } catch {
        useAuth.getState().clear();
      }
    }
    useAuth.getState().markBootstrapped();
  })();
  return bootstrapping;
}

export function startSession(session: AuthSession): void {
  useAuth.getState().setSession(session.accessToken, session.user);
}

export async function endSession(): Promise<void> {
  try {
    await authApi.logout();
  } finally {
    useAuth.getState().clear();
    // Another user may sign in next in this tab: drop everything cached for this one.
    queryClient.clear();
  }
}
