import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/stores/auth';
import { OrbitMark } from './brand';

/** Layout route: renders its children only for a signed-in user, else sends them to /login. */
export function RequireAuth() {
  const bootstrapped = useAuth((s) => s.bootstrapped);
  const signedIn = useAuth((s) => s.accessToken !== null);
  const location = useLocation();

  if (!bootstrapped) {
    return (
      <div className="grid min-h-svh place-items-center" aria-busy="true">
        <OrbitMark className="animate-pulse" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (!signedIn) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
