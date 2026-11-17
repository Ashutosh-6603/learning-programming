import type { UserSummary } from '@/lib/api/types';
import type { SocketStatus } from '@/lib/realtime/project-socket';
import { cn } from '@/lib/utils';
import { colorFor, initials } from '@/lib/visuals';

const STATUS_TEXT: Record<SocketStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  closed: 'Offline',
};

function describe(users: UserSummary[]): string {
  const names = users.map((u) => u.displayName.split(' ')[0] ?? u.displayName);
  if (names.length === 0) return 'Nobody is viewing this board yet';
  if (names.length === 1) return `${names[0] ?? ''} is viewing this board`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''} are viewing this board`;
}

/** Who's on the board, as moons circling the live-status dot. */
export function PresenceOrbit({ users, status }: { users: UserSummary[]; status: SocketStatus }) {
  const shown = users.slice(0, 5);
  return (
    <div className="flex items-center gap-2">
      <div
        role="img"
        aria-label={describe(users)}
        className="relative grid h-11 w-16 place-items-center"
      >
        <div className="animate-orbit absolute size-11 rounded-full border border-dashed border-primary/50">
          {shown.map((u, i) => {
            const angle = (i / shown.length) * 2 * Math.PI - Math.PI / 2;
            return (
              <span
                key={u.id}
                className="absolute -mt-[11px] -ml-[11px] size-[22px]"
                style={{
                  left: `${50 + 50 * Math.cos(angle)}%`,
                  top: `${50 + 50 * Math.sin(angle)}%`,
                }}
              >
                <span
                  className="animate-counter-orbit grid size-[22px] place-items-center rounded-full border-2 border-background text-[9px] font-bold text-white"
                  style={{ background: colorFor(u.id) }}
                >
                  {initials(u.displayName)}
                </span>
              </span>
            );
          })}
        </div>
        <span
          className={cn(
            'size-2 rounded-full',
            status === 'live'
              ? 'bg-primary'
              : status === 'closed'
                ? 'bg-muted-foreground'
                : 'animate-pulse bg-amber',
          )}
        />
      </div>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {STATUS_TEXT[status]}
      </span>
    </div>
  );
}
