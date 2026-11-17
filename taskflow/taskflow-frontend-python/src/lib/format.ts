const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const shortDate = (d: Date) => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });

/** "Today", "Tomorrow", "Overdue · Oct 2" or "Nov 8", in the viewer's time zone. */
export function formatDue(iso: string, now = new Date()): { label: string; soon: boolean } {
  const due = new Date(iso);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < 0) return { label: `Overdue · ${shortDate(due)}`, soon: true };
  if (days === 0) return { label: 'Today', soon: true };
  if (days === 1) return { label: 'Tomorrow', soon: true };
  return { label: shortDate(due), soon: false };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', DAY],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 minutes ago", "yesterday", "just now". */
export function timeAgo(iso: string, now = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** `<input type="date">` speaks "YYYY-MM-DD"; the API speaks ISO-8601 UTC instants. */
export const dateInputValue = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
export const dateInputToIso = (value: string) => (value ? `${value}T12:00:00Z` : null);
