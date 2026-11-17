import { cn } from '@/lib/utils';

export function OrbitMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-9 place-items-center rounded-[11px] bg-primary', className)}>
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="#06070B"
        strokeWidth={2.2}
        aria-hidden="true"
      >
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)" />
        <circle cx="12" cy="12" r="2.6" fill="#06070B" />
      </svg>
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-3">
      <OrbitMark />
      <span className="font-display text-xl font-bold tracking-tight">TaskFlow</span>
    </span>
  );
}
