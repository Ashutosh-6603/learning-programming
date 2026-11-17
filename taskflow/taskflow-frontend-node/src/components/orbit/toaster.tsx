import { X } from 'lucide-react';
import { useToasts } from '@/stores/toasts';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-coral/40 bg-popover/95 p-4 shadow-2xl backdrop-blur-md"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-semibold text-coral">{t.title}</span>
            {t.description ? (
              <span className="text-sm text-muted-foreground">{t.description}</span>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              dismiss(t.id);
            }}
            className="grid size-8 place-items-center rounded-lg hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
