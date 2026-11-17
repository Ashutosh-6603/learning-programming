import type { Priority } from '@/lib/api/types';
import { PRIORITY } from '@/lib/visuals';

const FLOATERS: {
  key: string;
  title: string;
  priority: Priority;
  x: number;
  y: number;
  z: number;
  delay: string;
}[] = [
  {
    key: 'TF-2',
    title: 'Fractional indexing',
    priority: 'high',
    x: -30,
    y: 40,
    z: 120,
    delay: '0s',
  },
  {
    key: 'TF-3',
    title: 'Board cache invalidation',
    priority: 'urgent',
    x: 300,
    y: 90,
    z: 60,
    delay: '-2s',
  },
  {
    key: 'TF-8',
    title: 'Search highlights',
    priority: 'medium',
    x: 20,
    y: 330,
    z: 40,
    delay: '-4s',
  },
  { key: 'TF-4', title: 'Live presence', priority: 'medium', x: 290, y: 360, z: 150, delay: '-1s' },
];

/** Decorative: a planet in three tilted rings with task cards floating at different depths. */
export function OrbitHero() {
  return (
    <div
      aria-hidden="true"
      className="hidden h-[560px] max-w-[560px] flex-[1_1_420px] place-items-center perspective-[1200px] lg:grid"
    >
      <div className="relative size-[460px] transform-3d [transform:rotateX(8deg)_rotateY(-14deg)]">
        <div className="animate-ring-1 absolute inset-0 rounded-full border-[1.5px] border-primary/55 shadow-[0_0_40px_rgb(200_255_77/0.18)]" />
        <div className="animate-ring-2 absolute inset-10 rounded-full border border-dashed border-sky/55" />
        <div className="animate-ring-3 absolute inset-[90px] rounded-full border border-white/20" />
        <div className="absolute top-1/2 left-1/2 -mt-[60px] -ml-[60px] size-[120px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#f4ffd9,#c8ff4d_38%,#3e5a00_100%)] shadow-[0_0_80px_rgb(200_255_77/0.45),inset_-14px_-18px_40px_rgb(0_0_0/0.45)]" />
        {FLOATERS.map((f) => {
          const p = PRIORITY[f.priority];
          return (
            <div
              key={f.key}
              className="animate-float absolute flex w-[190px] flex-col gap-1.5 rounded-[14px] border border-white/12 bg-[rgb(14_16_24/0.78)] px-3.5 py-3 shadow-[0_24px_40px_-16px_rgb(0_0_0/0.8)] backdrop-blur-md"
              style={{
                left: f.x,
                top: f.y,
                animationDelay: f.delay,
                ['--z' as string]: `${f.z}px`,
              }}
            >
              <span className="font-mono text-[11px] text-muted-foreground">{f.key}</span>
              <span className="text-[13px] leading-tight font-semibold">{f.title}</span>
              <span
                className="self-start rounded-full px-2 text-[11px] font-semibold"
                style={{
                  color: p.color,
                  background: `color-mix(in srgb, ${p.color} 14%, transparent)`,
                }}
              >
                {p.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
