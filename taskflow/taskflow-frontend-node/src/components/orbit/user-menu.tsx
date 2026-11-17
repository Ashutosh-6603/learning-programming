import { useNavigate } from 'react-router';
import { endSession } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { Avatar } from './badges';

export function UserMenu() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3">
      {user ? <Avatar user={user} size={34} /> : null}
      <button
        type="button"
        onClick={() => {
          void endSession().finally(() => {
            void navigate('/login');
          });
        }}
        className="h-10 rounded-xl border border-input px-3.5 hover:bg-white/8"
      >
        Sign out
      </button>
    </div>
  );
}
