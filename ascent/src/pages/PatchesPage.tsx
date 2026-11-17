import { Flag, HelpCircle, Tent } from 'lucide-react';
import { Link } from 'react-router';
import { PatchBadge } from '../components/PatchBadge';
import { partCleared, questPercent, questSummited, totalMetres } from '../lib/game';
import { PATCHES, type Patch } from '../lib/patches';
import { rankIndex, RANKS } from '../lib/ranks';
import { useGame } from '../lib/store';

const GROUPS: Patch['group'][] = ['First moves', 'The route', 'Skills', 'Volume', 'Habit', 'Polyglot'];

export function PatchesPage() {
  const progress = useGame((state) => state.progress);
  const quests = useGame((state) => state.quests);
  const metres = totalMetres(progress);
  const reached = rankIndex(metres);
  const earnedCount = Object.keys(progress.patches).length;

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8">
      <header>
        <h1 className="font-display text-4xl font-semibold">Patches</h1>
        <p className="mt-1 text-mist">
          {earnedCount} of {PATCHES.length} sewn on.
        </p>
      </header>

      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className="font-display text-xl font-semibold">
            {group}
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PATCHES.filter((patch) => patch.group === group).map((patch) => {
              const at = progress.patches[patch.id];
              const earned = at !== undefined;
              const hidden = patch.secret && !earned;
              return (
                <li key={patch.id} className={`flex items-center gap-3 rounded-xl border p-3 ${earned ? 'border-line bg-panel' : 'border-line/50'}`}>
                  {hidden ? (
                    <div className="flex size-14 shrink-0 items-center justify-center">
                      <HelpCircle className="size-7 text-faint" aria-hidden />
                    </div>
                  ) : (
                    <PatchBadge patch={patch} earned={earned} size={56} />
                  )}
                  <div className="min-w-0">
                    <p className={`font-display font-semibold ${earned ? '' : 'text-mist'}`}>{hidden ? 'Secret' : patch.name}</p>
                    <p className="text-sm text-mist">{hidden ? 'You will know it when it happens.' : patch.hint}</p>
                    {earned && <p className="mt-0.5 font-mono text-xs text-faint">{new Date(at).toLocaleDateString()}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section aria-labelledby="stamps">
        <h2 id="stamps" className="font-display text-xl font-semibold">
          Camp stamps
        </h2>
        <div className="mt-3 space-y-4">
          {[...quests.values()].map((quest) => (
            <div key={quest.id} className="rounded-xl border border-line p-4">
              <Link to={`/q/${quest.id}`} className="flex items-center gap-2 font-medium hover:text-glow">
                {questSummited(progress, quest) && <Flag className="size-4 text-gold" aria-label="Summited" />}
                {quest.id}
                <span className="font-mono text-xs text-mist">{questPercent(progress, quest)}%</span>
              </Link>
              <div className="mt-3 flex flex-wrap gap-2">
                {quest.parts.map((part) => {
                  const cleared = partCleared(progress, quest, part.number);
                  return (
                    <div
                      key={part.number}
                      title={`Camp ${part.number}: ${part.title}`}
                      aria-label={`Camp ${part.number}, ${part.title}: ${cleared ? 'stamped' : 'not yet'}`}
                      role="img"
                      className={`flex size-14 -rotate-6 flex-col items-center justify-center rounded-full border-2 border-double ${
                        cleared ? 'border-glow text-glow' : 'border-line text-faint'
                      }`}
                    >
                      <Tent className="size-4" aria-hidden />
                      <span className="font-mono text-[10px] font-bold">{part.number}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ranks">
        <h2 id="ranks" className="font-display text-xl font-semibold">
          How high you've climbed
        </h2>
        <ol className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {RANKS.map((rank, i) => (
            <li key={rank.title} className={`flex items-baseline gap-3 border-b border-line/60 py-2 ${i <= reached ? '' : 'opacity-45'}`}>
              <span className={`font-mono text-sm tabular-nums ${i === reached ? 'text-glow' : 'text-mist'}`}>
                {rank.metres.toLocaleString()} m
              </span>
              <span className="font-medium">{rank.title}</span>
              <span className="ml-auto truncate text-right text-sm text-mist">{rank.landmark}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
