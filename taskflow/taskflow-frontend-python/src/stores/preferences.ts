import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface Preferences {
  tilt: boolean;
  toggleTilt: () => void;
}

/** UI-only settings that should survive a reload. `persist` writes them to localStorage. */
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      tilt: true,
      toggleTilt: () => {
        set((s) => ({ tilt: !s.tilt }));
      },
    }),
    { name: 'taskflow-preferences', storage: createJSONStorage(() => localStorage) },
  ),
);
