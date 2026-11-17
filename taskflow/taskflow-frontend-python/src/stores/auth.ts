import { create } from 'zustand';
import type { User } from '@/lib/api/types';

interface AuthState {
  /** Kept in memory only: never localStorage, where any injected script could read it. */
  accessToken: string | null;
  user: User | null;
  /** True once the startup refresh attempt has finished, whatever its outcome. */
  bootstrapped: boolean;
  setSession: (accessToken: string, user?: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
  markBootstrapped: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  bootstrapped: false,
  setSession: (accessToken, user) => {
    set((s) => ({ accessToken, user: user ?? s.user }));
  },
  setUser: (user) => {
    set({ user });
  },
  clear: () => {
    set({ accessToken: null, user: null });
  },
  markBootstrapped: () => {
    set({ bootstrapped: true });
  },
}));
