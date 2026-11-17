import { describe, expect, it } from 'vitest';
import { formatBytes, formatDue, timeAgo } from './format';

const now = new Date(2026, 9, 25, 15, 0);

describe('formatDue', () => {
  it('names today and tomorrow, and flags them as soon', () => {
    expect(formatDue(new Date(2026, 9, 25, 23, 0).toISOString(), now)).toEqual({
      label: 'Today',
      soon: true,
    });
    expect(formatDue(new Date(2026, 9, 26, 1, 0).toISOString(), now)).toEqual({
      label: 'Tomorrow',
      soon: true,
    });
  });

  it('marks past dates overdue and leaves later ones calm', () => {
    expect(formatDue(new Date(2026, 9, 20).toISOString(), now)).toEqual({
      label: 'Overdue · Oct 20',
      soon: true,
    });
    expect(formatDue(new Date(2026, 10, 8).toISOString(), now)).toEqual({
      label: 'Nov 8',
      soon: false,
    });
  });
});

describe('timeAgo', () => {
  it('uses the largest whole unit', () => {
    expect(timeAgo(new Date(now.getTime() - 3 * 60_000).toISOString(), now)).toBe('3 minutes ago');
    expect(timeAgo(new Date(now.getTime() - 26 * 3_600_000).toISOString(), now)).toBe('yesterday');
    expect(timeAgo(now.toISOString(), now)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
