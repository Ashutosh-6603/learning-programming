import { ArrowRight, BadgeCheck, Flag, Footprints, MountainSnow, Sun } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { PatchBadge } from '../components/PatchBadge';
import {
  currentStep,
  questPercent,
  questSummited,
  stepTicks,
  streak,
  totalMetres,
  type Progress,
} from '../lib/game';
import { findPatch, PATCHES } from '../lib/patches';
import type { Peak, Quest } from '../lib/quests';
import { RANGES } from '../lib/quests';
import { rankProgress } from '../lib/ranks';
import { useGame } from '../lib/store';

function latestActivity(progress: Progress, questId: string): string {
  let latest = '';
  for (const ticks of Object.values(progress.ticks[questId] ?? {})) {
    for (const tick of Object.values(ticks)) if (tick.at > latest) latest = tick.at;
  }
  return latest;
}

function chooseQuest(progress: Progress, quests: Map<string, Quest>): Quest | undefined {
  const open = [...quests.values()].filter((quest) => currentStep(progress, quest));
  const byRecent = [...open].sort((a, b) =>
    latestActivity(progress, b.id).localeCompare(latestActivity(progress, a.id)),
  );
  const recent = byRecent[0];
  if (recent && latestActivity(progress, recent.id)) return recent;
  for (const range of RANGES) {
    for (const peak of range.peaks) {
      const quest = quests.get(peak.id);
      if (quest && currentStep(progress, quest)) return quest;
    }
  }
  return undefined;
}

function ContinueCard({ quest }: { quest: Quest }) {
  const progress = useGame((state) => state.progress);
  const step = currentStep(progress, quest);
  if (!step) return null;
  const started = Object.keys(stepTicks(progress, quest.id, step.id)).length;
  const part = quest.parts.find((candidate) => candidate.number === step.partNumber);
  const fresh = totalMetres(progress) === 0;
  return (
    <Link
      to={`/q/${quest.id}/${step.id}`}
      className="group block rounded-2xl border border-glow/40 bg-gradient-to-br from-panel-2 to-panel p-6 transition-colors hover:border-glow sm:p-7"
    >
      <p className="flex items-center gap-2 text-sm text-rose">
        <Footprints className="size-4" aria-hidden />
        {fresh ? 'Your first step' : started > 0 ? 'Pick up where you left off' : 'Next up'} ·{' '}
        {quest.id}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-balance sm:text-4xl">
        Step {step.id} · {step.title}
      </h1>
      <p className="mt-1 text-mist">
        Camp {step.partNumber}: {part?.title}
      </p>
      <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-glow px-5 py-2.5 font-semibold text-ink transition-transform group-hover:translate-x-0.5">
        {started > 0 ? `Continue (${started}/${step.tasks.length})` : 'Climb'}{' '}
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}

function shapeFor(index: number) {
  const j = (seed: number, spread: number) => ((Math.sin(index * 12.9 + seed) + 1) / 2) * spread;
  const top = 14 + j(1, 26);
  const x = 52 + j(2, 16);
  return {
    x,
    top,
    outline: `M0 150 L${18 + j(3, 8)} ${88 + j(4, 16)} L${32 + j(5, 6)} ${98 + j(6, 8)} L${x} ${top} L${x + 16 + j(7, 6)} ${top + 46 + j(8, 10)} L${x + 26} ${top + 40 + j(9, 8)} L120 150Z`,
    snow: `M${x} ${top} L${x - 13} ${top + 28} L${x - 5} ${top + 22} L${x + 1} ${top + 31} L${x + 7} ${top + 23} L${x + 12} ${top + 28}Z`,
  };
}

function PeakCard({ peak, index, quest }: { peak: Peak; index: number; quest?: Quest }) {
  const progress = useGame((state) => state.progress);
  const clipId = useId();
  const shape = shapeFor(index);
  const percent = quest ? questPercent(progress, quest) : 0;
  const summited = quest ? questSummited(progress, quest) : false;
  const fillTop = 150 - ((150 - shape.top) * percent) / 100;

  const body = (
    <>
      <svg viewBox="0 0 120 150" className="block w-full" aria-hidden>
        <defs>
          <clipPath id={clipId}>
            <path d={shape.outline} />
          </clipPath>
        </defs>
        {quest ? (
          <>
            <path d={shape.outline} fill="#2b3a4a" />
            <path d={shape.snow} fill="#c2ced8" />
            <rect
              x="0"
              y={fillTop}
              width="120"
              height={150 - fillTop}
              clipPath={`url(#${clipId})`}
              fill="#ff7d4d"
              className="transition-all duration-700"
            />
            {summited && (
              <>
                <path d={`M${shape.x} ${shape.top} V${shape.top - 14}`} stroke="#fff" strokeWidth="1.5" />
                <path d={`M${shape.x} ${shape.top - 14} h15 l-4 4 l4 4 h-15z`} fill="#f7c948" className="anim-flag" />
              </>
            )}
          </>
        ) : (
          <path d={shape.outline} fill="none" stroke="#2a3847" strokeWidth="1.5" strokeDasharray="3 4" />
        )}
      </svg>
      <p className={`mt-1 truncate text-center text-xs ${quest ? 'text-snow' : 'text-faint'}`}>{peak.label}</p>
      <p className="text-center font-mono text-[11px] text-mist tabular-nums">
        {quest ? `${percent}%` : 'uncharted'}
      </p>
    </>
  );

  if (!quest) {
    return (
      <div title="This route's STEPS.md hasn't been written yet" aria-label={`${peak.label}: not written yet`}>
        {body}
      </div>
    );
  }
  return (
    <Link
      to={`/q/${quest.id}`}
      aria-label={`${peak.id}: ${percent}% climbed`}
      className="block rounded-lg transition-transform hover:-translate-y-1"
    >
      {body}
    </Link>
  );
}

export function HomePage() {
  const progress = useGame((state) => state.progress);
  const quests = useGame((state) => state.quests);
  const metres = totalMetres(progress);
  const { next, fraction, toGo } = rankProgress(metres);
  const { current, best, restDays } = streak(progress, new Date());
  const quest = chooseQuest(progress, quests);

  const recent = Object.entries(progress.patches)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, 5)
    .flatMap(([id]) => findPatch(id) ?? []);
  const earnedCount = Object.keys(progress.patches).length;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
      <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {quest ? (
          <ContinueCard quest={quest} />
        ) : (
          <div className="rounded-2xl border border-line bg-panel p-7">
            <MountainSnow className="size-8 text-gold" aria-hidden />
            <h1 className="mt-3 font-display text-3xl font-semibold">Every charted route is climbed.</h1>
            <p className="mt-2 text-mist">New routes appear here as soon as their STEPS.md exists.</p>
          </div>
        )}

        <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5">
          {next && (
            <div>
              <p className="flex items-center gap-2 text-sm text-mist">
                <Flag className="size-4" aria-hidden /> Next landmark
              </p>
              <p className="mt-1 font-display text-lg font-semibold">{next.landmark}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-glow" style={{ width: `${Math.round(fraction * 100)}%` }} />
              </div>
              <p className="mt-1 font-mono text-xs text-mist tabular-nums">
                {toGo.toLocaleString()} m to go · {next.title}
              </p>
            </div>
          )}
          <div className="border-t border-line pt-4">
            <p className="flex items-center gap-2 text-sm text-mist">
              <Sun className="size-4 text-gold" aria-hidden /> Streak
            </p>
            <p className="mt-1 font-display text-lg font-semibold">
              {current} day{current === 1 ? '' : 's'}
              {best > current && <span className="ml-2 text-sm font-normal text-mist">best {best}</span>}
            </p>
            <p className="text-xs text-mist">
              {restDays > 0
                ? `${restDays} rest day${restDays === 1 ? '' : 's'} banked: a missed day won't break it`
                : 'Every 7 days banks a free rest day'}
            </p>
          </div>
        </aside>
      </section>

      {RANGES.map((range) => {
        const offset = RANGES.indexOf(range) * 9;
        return (
          <section key={range.app} aria-labelledby={`range-${range.app}`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id={`range-${range.app}`} className="font-display text-2xl font-semibold">
                {range.name}
              </h2>
              <p className="text-sm text-mist">{range.tagline}</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 lg:grid-cols-9">
              {range.peaks.map((peak, i) => {
                const q = quests.get(peak.id);
                return <PeakCard key={peak.id} peak={peak} index={offset + i} {...(q ? { quest: q } : {})} />;
              })}
            </div>
          </section>
        );
      })}

      <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-line bg-panel p-5">
        <Link to="/patches" className="flex items-center gap-2 font-display text-lg font-semibold hover:text-glow">
          <BadgeCheck className="size-5 text-gold" aria-hidden />
          {earnedCount} of {PATCHES.length} patches
        </Link>
        {recent.length === 0 ? (
          <p className="text-sm text-mist">Tick your first block and you'll earn the first one.</p>
        ) : (
          <div className="flex gap-2">
            {recent.map((patch) => (
              <div key={patch.id} title={patch.name}>
                <PatchBadge patch={patch} earned size={44} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
