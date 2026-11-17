import { ArrowRight, BadgeCheck, Flag, NotebookPen, Tent, Type, X } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { currentStep, type RouteSummary } from '../lib/game';
import type { Rank } from '../lib/ranks';
import { useGame, type Celebration } from '../lib/store';
import { PatchBadge } from './PatchBadge';
import { useCountUp } from './useCountUp';

function RankRibbon({ rank }: { rank: Rank }) {
  return (
    <div className="anim-rise mt-5 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 [animation-delay:600ms]">
      <p className="text-xs tracking-widest text-gold uppercase">New rank · {rank.title}</p>
      <p className="mt-0.5 text-sm text-snow">
        You've now climbed the height of {rank.landmark}: {rank.metres.toLocaleString()} m of it by
        hand.
      </p>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-ink/50 px-3 py-3">
      <span className="text-mist">{icon}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-mist">{label}</span>
    </div>
  );
}

function RouteStats({ summary }: { summary: RouteSummary }) {
  return (
    <div className="mt-6 grid grid-cols-3 gap-2">
      <Stat icon={<Flag className="size-4" />} value={String(summary.steps)} label="steps" />
      <Stat icon={<Type className="size-4" />} value={summary.lines.toLocaleString()} label="lines typed" />
      <Stat icon={<NotebookPen className="size-4" />} value={String(summary.insights)} label="field notes" />
    </div>
  );
}

function Actions({
  primary,
  onPrimary,
  onClose,
}: {
  primary: string;
  onPrimary: () => void;
  onClose: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="mt-7 flex flex-col items-center gap-3">
      <button
        ref={button}
        type="button"
        onClick={onPrimary}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-glow px-5 py-3 font-semibold text-ink transition-transform hover:scale-[1.02] active:scale-95"
      >
        {primary} <ArrowRight className="size-4" />
        <kbd className="ml-1 rounded bg-ink/15 px-1.5 text-xs font-medium">↵</kbd>
      </button>
      <button type="button" onClick={onClose} className="text-sm text-mist hover:text-snow">
        Stay here
      </button>
    </div>
  );
}

function StepCard({ c, onNext, onClose }: { c: Extract<Celebration, { type: 'step' }>; onNext: () => void; onClose: () => void }) {
  const earned = useCountUp(c.summary.earned, 800, 0);
  return (
    <div className="anim-rise w-full max-w-md rounded-2xl border border-line bg-panel p-7 text-center">
      <p className="text-sm tracking-widest text-mist uppercase">Step {c.step.id} done</p>
      <p className="mt-3 font-mono text-6xl font-bold text-glow tabular-nums">+{earned}<span className="text-3xl"> m</span></p>
      <h2 className="mt-3 font-display text-xl">{c.step.title}</h2>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-mist">
        {c.summary.lines > 0 && (
          <span className="flex items-center gap-1.5">
            <Type className="size-3.5" /> {c.summary.lines} lines by hand
          </span>
        )}
        {c.summary.insights > 0 && (
          <span className="flex items-center gap-1.5">
            <NotebookPen className="size-3.5" /> field note
          </span>
        )}
        {c.summary.verified && (
          <span className="flex items-center gap-1.5 text-pine">
            <BadgeCheck className="size-3.5" /> commit verified
          </span>
        )}
      </div>
      {c.rank && <RankRibbon rank={c.rank} />}
      <Actions primary="Next step" onPrimary={onNext} onClose={onClose} />
    </div>
  );
}

function CampCard({ c, onNext, onClose }: { c: Extract<Celebration, { type: 'camp' }>; onNext: () => void; onClose: () => void }) {
  const part = c.quest.parts.find((candidate) => candidate.number === c.partNumber);
  const earned = useCountUp(c.summary.earned, 1100, 0);
  return (
    <div className="anim-shake w-full max-w-lg rounded-2xl border border-line bg-panel p-8 text-center">
      <div className="anim-stamp mx-auto flex size-36 flex-col items-center justify-center rounded-full border-4 border-double border-glow text-glow">
        <Tent className="size-9" aria-hidden />
        <span className="mt-1 font-display text-lg font-bold">Camp {c.partNumber}</span>
        <span className="text-[10px] tracking-widest uppercase">reached</span>
      </div>
      <div className="anim-rise [animation-delay:500ms]">
        <h2 className="mt-5 font-display text-3xl font-semibold">{part?.title}</h2>
        <p className="mt-2 font-mono text-2xl font-bold text-glow tabular-nums">+{earned.toLocaleString()} m this Part</p>
        <RouteStats summary={c.summary} />
      </div>
      {c.rank && <RankRibbon rank={c.rank} />}
      <Actions primary="Keep climbing" onPrimary={onNext} onClose={onClose} />
    </div>
  );
}

function SummitCard({ c, onNext, onClose }: { c: Extract<Celebration, { type: 'summit' }>; onNext: () => void; onClose: () => void }) {
  const earned = useCountUp(c.summary.earned, 2200, 0);
  return (
    <div className="w-full max-w-xl text-center">
      <svg viewBox="0 0 320 170" className="anim-rise mx-auto w-full max-w-sm" aria-hidden>
        <defs>
          <linearGradient id="summit-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd9a8" />
            <stop offset="0.5" stopColor="#ff7d4d" />
            <stop offset="1" stopColor="#5b2b3a" />
          </linearGradient>
        </defs>
        <path d="M0 170 96 62l34 40 34-74 56 82 28-26 72 86z" fill="url(#summit-glow)" />
        <path d="m164 28-17 37 13-7 11 10 9-6 7 6z" fill="#fff" />
        <path d="M164 28V2" stroke="#fff" strokeWidth="2.5" />
        <path d="M165 3h30l-9 8 9 8h-30z" fill="#f7c948" className="anim-flag" />
      </svg>
      <p className="mt-4 text-sm tracking-[0.35em] text-gold uppercase">Summit</p>
      <h2 className="text-shine mt-1 font-display text-5xl font-bold">{c.quest.id}</h2>
      <p className="mx-auto mt-3 max-w-md text-mist">
        You built this from an empty folder, by hand.
        {c.clean ? ' No step skipped: that\'s a clean ascent.' : ''}
      </p>
      <p className="mt-4 font-mono text-4xl font-bold text-glow tabular-nums">{earned.toLocaleString()} m</p>
      <RouteStats summary={c.summary} />
      {c.rank && <RankRibbon rank={c.rank} />}
      <Actions primary="Back to the map" onPrimary={onNext} onClose={onClose} />
    </div>
  );
}

export function Celebrations() {
  const celebration = useGame((state) => state.celebration);
  const dismiss = useGame((state) => state.dismissCelebration);
  const navigate = useNavigate();

  const onNext = useCallback(() => {
    if (!celebration) return;
    const { quest, type } = celebration;
    dismiss();
    if (type === 'summit') return void navigate('/');
    const next = currentStep(useGame.getState().progress, quest);
    void navigate(next ? `/q/${quest.id}/${next.id}` : `/q/${quest.id}`);
  }, [celebration, dismiss, navigate]);

  useEffect(() => {
    if (!celebration) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [celebration, dismiss]);

  if (!celebration) return null;
  const backdrop =
    celebration.type === 'summit'
      ? 'bg-[radial-gradient(ellipse_at_top,#57303d_0%,#0b1118_72%)]'
      : 'bg-ink/80 backdrop-blur-sm';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${celebration.type} complete`}
      className={`anim-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center ${backdrop}`}
    >
      {celebration.type === 'step' && <StepCard c={celebration} onNext={onNext} onClose={dismiss} />}
      {celebration.type === 'camp' && <CampCard c={celebration} onNext={onNext} onClose={dismiss} />}
      {celebration.type === 'summit' && <SummitCard c={celebration} onNext={onNext} onClose={dismiss} />}
    </div>
  );
}

function ToastItem({ id, children }: { id: number; children: ReactNode }) {
  const dismiss = useGame((state) => state.dismissToast);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), 6000);
    return () => clearTimeout(timer);
  }, [dismiss, id]);
  return (
    <div
      role="status"
      className="anim-rise flex items-center gap-3 rounded-xl border border-line bg-panel py-2.5 pr-2 pl-3 shadow-2xl shadow-black/50"
    >
      {children}
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(id)} className="self-start p-1 text-faint hover:text-snow">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useGame((state) => state.toasts);
  return (
    <div className="pointer-events-none fixed top-16 right-3 z-[70] flex w-[min(21rem,calc(100vw-1.5rem))] flex-col gap-2 [&>*]:pointer-events-auto">
      {toasts.map(({ id, patch }) => (
        <ToastItem key={id} id={id}>
          <PatchBadge patch={patch} earned size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-widest text-gold uppercase">Patch earned</p>
            <p className="font-display font-semibold">{patch.name}</p>
            <p className="text-xs text-mist">{patch.hint}</p>
          </div>
        </ToastItem>
      ))}
    </div>
  );
}

