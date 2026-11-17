import { cn } from '@/lib/utils';
import { planetFor } from '@/lib/visuals';

export function Planet({
  id,
  size = 64,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const p = planetFor(id);
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, ${p.light}, ${p.core} 40%, ${p.dark})`,
        boxShadow: `0 0 ${size * 0.6}px color-mix(in srgb, ${p.core} 45%, transparent), inset -${size * 0.15}px -${size * 0.18}px ${size * 0.38}px rgb(0 0 0 / 0.5)`,
      }}
    />
  );
}
