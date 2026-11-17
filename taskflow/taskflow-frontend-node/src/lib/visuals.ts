import type { Priority } from '@/lib/api/types';

const AVATAR_COLORS = ['#3D63FF', '#0E8C7F', '#B5501E', '#8250E8', '#BE185D', '#2563EB'];

/** A stable color per user: the same person is the same color on every screen. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#3D63FF';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'var(--coral)' },
  high: { label: 'High', color: 'var(--amber)' },
  medium: { label: 'Medium', color: 'var(--sky)' },
  low: { label: 'Low', color: 'var(--muted-foreground)' },
};

const PLANETS = [
  { core: '#c8ff4d', light: '#f4ffd9', dark: '#3e5a00' },
  { core: '#7fd8ff', light: '#e6fbff', dark: '#0b4a63' },
  { core: '#ffd166', light: '#fff2da', dark: '#6b4a00' },
  { core: '#b79bff', light: '#f1e8ff', dark: '#3b2273' },
  { core: '#ff9b6a', light: '#ffe8dd', dark: '#6b2a0b' },
] as const;

/** Same id → same planet. Ids are UUIDv7, so hash the random tail, not the timestamp head. */
export function planetFor(id: string): (typeof PLANETS)[number] {
  const n = parseInt(id.replace(/-/g, '').slice(-6), 16) || 0;
  return PLANETS[n % PLANETS.length] ?? PLANETS[0];
}
