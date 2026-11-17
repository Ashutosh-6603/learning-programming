import type { Priority, Role, UserSummary } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { colorFor, initials, PRIORITY } from '@/lib/visuals';

export function Avatar({
  user,
  size = 26,
  className,
}: {
  user: UserSummary;
  size?: number;
  className?: string;
}) {
  return (
    <span
      title={user.displayName}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.38, background: colorFor(user.id) }}
    >
      {initials(user.displayName)}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const p = PRIORITY[priority];
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: p.color, background: `color-mix(in srgb, ${p.color} 14%, transparent)` }}
    >
      {p.label}
    </span>
  );
}

export function RolePill({ role }: { role: Role }) {
  return (
    <span className="rounded-full bg-white/8 px-2.5 py-0.5 text-xs font-semibold capitalize">
      {role}
    </span>
  );
}
