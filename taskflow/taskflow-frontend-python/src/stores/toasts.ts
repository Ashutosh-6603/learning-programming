import { create } from 'zustand';
import { ApiError } from '@/lib/api/client';

export interface Toast {
  id: number;
  title: string;
  description?: string | undefined;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => {
      get().dismiss(id);
    }, 6000);
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Every failure that isn't a 422 on a form lands here (UI kit: "toast with its status"). */
export function toastError(err: unknown, action: string): void {
  const push = useToasts.getState().push;
  if (err instanceof ApiError) {
    push({
      title: `${action} failed · ${err.status}`,
      description: err.problem.detail ?? err.problem.title,
    });
  } else {
    push({ title: `${action} failed`, description: 'The server could not be reached.' });
  }
}
