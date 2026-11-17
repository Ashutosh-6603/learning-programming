import { Mountain, Sun, Volume2, VolumeX } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { dayOf, metresOn, streak, totalMetres } from '../lib/game';
import { rankProgress } from '../lib/ranks';
import { useGame } from '../lib/store';
import { useCountUp } from './useCountUp';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-1.5 py-1.5 text-sm transition-colors sm:px-2.5 ${
    isActive ? 'bg-panel-2 text-snow' : 'text-mist hover:text-snow'
  }`;

export function Hud() {
  const progress = useGame((state) => state.progress);
  const lastEvent = useGame((state) => state.lastEvent);
  const saveFailed = useGame((state) => state.saveFailed);
  const set = useGame((state) => state.set);

  const metres = totalMetres(progress);
  const shown = useCountUp(metres);
  const { rank, next, fraction, toGo } = rankProgress(metres);
  const now = new Date();
  const today = metresOn(progress, dayOf(now.toISOString()));
  const { current, restDays } = streak(progress, now);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
      {saveFailed && (
        <p role="alert" className="bg-rose px-4 py-1.5 text-center text-sm font-medium text-ink">
          Progress isn't saving. Is the Vite dev server still running?
        </p>
      )}
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-3">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Mountain className="size-5 text-glow" aria-hidden />
          <span className="hidden sm:inline">Ascent</span>
        </Link>
        <nav className="flex items-center" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            Map
          </NavLink>
          <NavLink to="/patches" className={navClass}>
            Patches
          </NavLink>
          <NavLink to="/notes" className={navClass}>
            Notes
          </NavLink>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-5">
          <div
            className="hidden items-center gap-1.5 text-sm md:flex"
            title={`${restDays} rest day${restDays === 1 ? '' : 's'} banked`}
          >
            <Sun className={`size-4 ${current > 0 ? 'text-gold' : 'text-faint'}`} aria-hidden />
            <span className="font-mono tabular-nums">{current}</span>
            <span className="text-mist">day{current === 1 ? '' : 's'}</span>
          </div>
          <div className="hidden text-sm md:block">
            <span className="font-mono tabular-nums text-pine">+{today.toLocaleString()}</span>
            <span className="text-mist"> today</span>
          </div>
          <div
            className="w-24 min-w-0 sm:w-44"
            title={next ? `${toGo.toLocaleString()} m to ${next.landmark}` : 'The top'}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-mist">{rank.title}</span>
              <span
                key={lastEvent?.id}
                className="anim-bump inline-block origin-right font-mono text-sm font-semibold tabular-nums"
              >
                {shown.toLocaleString()} m
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-glow transition-[width] duration-700"
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label={progress.sound ? 'Mute sound' : 'Turn sound on'}
            onClick={(event) => {
              set({ ...progress, sound: !progress.sound });
              event.currentTarget.blur();
            }}
            className="rounded-md p-1.5 text-mist hover:text-snow"
          >
            {progress.sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
