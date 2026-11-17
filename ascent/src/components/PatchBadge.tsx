import { icons, Lock, type LucideIcon } from 'lucide-react';
import type { Patch } from '../lib/patches';

const GROUP_COLOR: Record<Patch['group'], string> = {
  'First moves': '#ff7d4d',
  Volume: '#f7c948',
  'The route': '#7cc7e8',
  Skills: '#5fd3a0',
  Habit: '#ffb4a2',
  Polyglot: '#c7a6ff',
};

/** Embroidered-looking hexagon: stitched border around a coloured field. */
export function PatchBadge({
  patch,
  earned,
  size = 72,
}: {
  patch: Patch;
  earned: boolean;
  size?: number;
}) {
  const Icon: LucideIcon = (icons as Record<string, LucideIcon>)[patch.icon] ?? icons.Mountain;
  const color = earned ? GROUP_COLOR[patch.group] : '#2a3847';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0" aria-hidden>
        <path d="M50 3 91 26v48L50 97 9 74V26z" fill={color} opacity={earned ? 0.2 : 0.35} />
        <path d="M50 3 91 26v48L50 97 9 74V26z" fill="none" stroke={color} strokeWidth="3" />
        <path
          d="M50 11 84 30v40L50 89 16 70V30z"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeDasharray="3 3"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {earned ? (
          <Icon style={{ width: size * 0.38, height: size * 0.38, color }} aria-hidden />
        ) : (
          <Lock style={{ width: size * 0.26, height: size * 0.26 }} className="text-faint" aria-hidden />
        )}
      </div>
    </div>
  );
}
