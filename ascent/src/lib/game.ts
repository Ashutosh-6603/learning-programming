import type { Step, TaskBlock } from './parser';
import { checkPatches } from './patches';
import type { Quest } from './quests';
import { rankIndex, type Rank, RANKS } from './ranks';

export type Tick = { at: string; m: number; kind: TaskKind; verified?: boolean };
export type TaskKind = 'type' | 'run' | 'read' | 'note' | 'check' | 'commit';
export type StepRecord = { at: string; status: 'done' | 'skipped'; bonus: number };

export type Progress = {
  version: 1;
  ticks: Record<string, Record<string, Record<string, Tick>>>;
  steps: Record<string, Record<string, StepRecord>>;
  links: Record<string, string>;
  patches: Record<string, string>;
  rankSeen: number;
  sound: boolean;
};

export const emptyProgress = (): Progress => ({
  version: 1,
  ticks: {},
  steps: {},
  links: {},
  patches: {},
  rankSeen: 0,
  sound: true,
});

export const VERIFIED_BONUS = 15;
export const STEP_BONUS = 10;

export function taskKind(block: TaskBlock): TaskKind {
  return block.kind === 'code' ? block.task : block.kind;
}

export function taskMetres(block: TaskBlock): number {
  switch (block.kind) {
    case 'code':
      return block.task === 'type' ? block.lines : 3;
    case 'read':
      return 5;
    case 'note':
      return 15;
    case 'check':
      return 10;
    case 'commit':
      return 5;
  }
}

export type StepState = 'done' | 'skipped' | 'current' | 'locked';

export function stepRecord(p: Progress, questId: string, stepId: string): StepRecord | undefined {
  return p.steps[questId]?.[stepId];
}

export function currentStep(p: Progress, quest: Quest): Step | undefined {
  return quest.steps.find((step) => !stepRecord(p, quest.id, step.id));
}

export function stepState(p: Progress, quest: Quest, stepId: string): StepState {
  const record = stepRecord(p, quest.id, stepId);
  if (record) return record.status;
  return currentStep(p, quest)?.id === stepId ? 'current' : 'locked';
}

export function stepTicks(p: Progress, questId: string, stepId: string): Record<string, Tick> {
  return p.ticks[questId]?.[stepId] ?? {};
}

export function isTicked(p: Progress, questId: string, stepId: string, key: string): boolean {
  return stepTicks(p, questId, stepId)[key] !== undefined;
}

function allTicks(p: Progress): Tick[] {
  return Object.values(p.ticks).flatMap((steps) =>
    Object.values(steps).flatMap((ticks) => Object.values(ticks)),
  );
}

export function totalMetres(p: Progress): number {
  let total = 0;
  for (const tick of allTicks(p)) total += tick.m;
  for (const steps of Object.values(p.steps)) {
    for (const record of Object.values(steps)) total += record.bonus;
  }
  return total;
}

/** Local calendar day: a streak should follow the climber's clock, not UTC. */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

export function metresOn(p: Progress, day: string): number {
  let total = 0;
  for (const tick of allTicks(p)) if (dayOf(tick.at) === day) total += tick.m;
  for (const steps of Object.values(p.steps)) {
    for (const record of Object.values(steps)) {
      if (dayOf(record.at) === day) total += record.bonus;
    }
  }
  return total;
}

export function activeDays(p: Progress): string[] {
  return [...new Set(allTicks(p).map((tick) => dayOf(tick.at)))].sort();
}

export type Streak = { current: number; best: number; restDays: number };

/**
 * Forgiving by design: every 7 days climbed banks a rest day (max 3), spent automatically on a gap.
 * A missed day should never be the reason someone stops.
 */
export function streak(p: Progress, now: Date): Streak {
  let current = 0;
  let best = 0;
  let restDays = 0;
  let previous: number | null = null;
  for (const day of activeDays(p)) {
    const n = dayNumber(day);
    if (previous !== null) {
      const gap = n - previous - 1;
      if (gap > restDays) {
        current = 0;
        restDays = 0;
      } else {
        restDays -= gap;
      }
    }
    current++;
    if (current % 7 === 0) restDays = Math.min(3, restDays + 1);
    best = Math.max(best, current);
    previous = n;
  }
  if (previous !== null) {
    const gap = dayNumber(dayOf(now.toISOString())) - previous - 1;
    if (gap > restDays) return { current: 0, best, restDays: 0 };
    if (gap > 0) restDays -= gap;
  }
  return { current, best, restDays };
}

export type StepSummary = { earned: number; lines: number; insights: number; verified: boolean };

export function summarizeStep(p: Progress, quest: Quest, step: Step): StepSummary {
  const ticks = Object.values(stepTicks(p, quest.id, step.id));
  const record = stepRecord(p, quest.id, step.id);
  return {
    earned: ticks.reduce((sum, t) => sum + t.m, 0) + (record?.bonus ?? 0),
    lines: ticks.filter((t) => t.kind === 'type').reduce((sum, t) => sum + t.m, 0),
    insights: ticks.filter((t) => t.kind === 'note').length,
    verified: ticks.some((t) => t.verified),
  };
}

export type RouteSummary = { earned: number; lines: number; insights: number; steps: number };

export function summarizeSteps(p: Progress, quest: Quest, steps: Step[]): RouteSummary {
  const total: RouteSummary = { earned: 0, lines: 0, insights: 0, steps: 0 };
  for (const step of steps) {
    const s = summarizeStep(p, quest, step);
    total.earned += s.earned;
    total.lines += s.lines;
    total.insights += s.insights;
    if (stepRecord(p, quest.id, step.id)?.status === 'done') total.steps++;
  }
  return total;
}

export function questPercent(p: Progress, quest: Quest): number {
  const resolved = quest.steps.filter((s) => stepRecord(p, quest.id, s.id)).length;
  return Math.round((resolved / quest.steps.length) * 100);
}

export type GameEvent =
  | { type: 'tick'; m: number; kind: TaskKind; index: number; verified: boolean }
  | { type: 'untick' }
  | { type: 'step'; quest: Quest; step: Step; summary: StepSummary }
  | { type: 'camp'; quest: Quest; partNumber: number; summary: RouteSummary }
  | { type: 'summit'; quest: Quest; summary: RouteSummary; clean: boolean }
  | { type: 'rank'; rank: Rank }
  | { type: 'patch'; id: string };

export type Move = { progress: Progress; events: GameEvent[] };

/** Everything that follows from earning metres: a finished step, new rank, new patches. */
function settle(next: Progress, quest: Quest, step: Step, quests: Quest[], now: Date, events: GameEvent[]) {
  const ticked = stepTicks(next, quest.id, step.id);
  const finished = step.tasks.every((task) => ticked[task.key]);
  if (finished && !stepRecord(next, quest.id, step.id)) {
    (next.steps[quest.id] ??= {})[step.id] = {
      at: now.toISOString(),
      status: 'done',
      bonus: STEP_BONUS,
    };
    events.push({ type: 'step', quest, step, summary: summarizeStep(next, quest, step) });

    const part = quest.parts.find((candidate) => candidate.number === step.partNumber);
    if (part?.steps.every((s) => stepRecord(next, quest.id, s.id))) {
      events.push({
        type: 'camp',
        quest,
        partNumber: part.number,
        summary: summarizeSteps(next, quest, part.steps),
      });
    }
    if (quest.steps.every((s) => stepRecord(next, quest.id, s.id))) {
      events.push({
        type: 'summit',
        quest,
        summary: summarizeSteps(next, quest, quest.steps),
        clean: quest.steps.every((s) => stepRecord(next, quest.id, s.id)?.status === 'done'),
      });
    }
  }

  const rank = rankIndex(totalMetres(next));
  if (rank > next.rankSeen) {
    next.rankSeen = rank;
    events.push({ type: 'rank', rank: RANKS[rank] as Rank });
  }
  for (const id of checkPatches(next, quests, now)) {
    next.patches[id] = now.toISOString();
    events.push({ type: 'patch', id });
  }
}

export function toggleTask(
  p: Progress,
  quest: Quest,
  step: Step,
  block: TaskBlock,
  quests: Quest[],
  now: Date,
): Move {
  const next = structuredClone(p);
  const ticks = ((next.ticks[quest.id] ??= {})[step.id] ??= {});
  if (ticks[block.key]) {
    delete ticks[block.key];
    return { progress: next, events: [{ type: 'untick' }] };
  }
  const m = taskMetres(block);
  ticks[block.key] = { at: now.toISOString(), m, kind: taskKind(block) };
  const index = Object.keys(ticks).length;
  const events: GameEvent[] = [{ type: 'tick', m, kind: taskKind(block), index, verified: false }];
  settle(next, quest, step, quests, now, events);
  return { progress: next, events };
}

/** The commit really exists in the linked repo: tick it if needed and pay the bonus once. */
export function verifyCommit(
  p: Progress,
  quest: Quest,
  step: Step,
  block: TaskBlock,
  quests: Quest[],
  now: Date,
): Move {
  const existing = stepTicks(p, quest.id, step.id)[block.key];
  if (existing?.verified) return { progress: p, events: [] };
  const next = structuredClone(p);
  const ticks = ((next.ticks[quest.id] ??= {})[step.id] ??= {});
  const base = existing?.m ?? taskMetres(block);
  ticks[block.key] = {
    at: existing?.at ?? now.toISOString(),
    m: base + VERIFIED_BONUS,
    kind: 'commit',
    verified: true,
  };
  const m = existing ? VERIFIED_BONUS : base + VERIFIED_BONUS;
  const index = Object.keys(ticks).length;
  const events: GameEvent[] = [{ type: 'tick', m, kind: 'commit', index, verified: true }];
  settle(next, quest, step, quests, now, events);
  return { progress: next, events };
}

/** Bring a finished step back to the climb, undoing the tick that finished it. */
export function reopenStep(p: Progress, questId: string, stepId: string): Progress {
  const next = structuredClone(p);
  delete next.steps[questId]?.[stepId];
  const ticks = next.ticks[questId]?.[stepId] ?? {};
  const entries = Object.entries(ticks);
  // A verified commit is still in the repo, so undoing it would just re-verify and re-finish.
  const manual = entries.filter(([, tick]) => !tick.verified);
  const latest = (manual.length > 0 ? manual : entries).reduce<[string, Tick] | null>(
    (best, entry) => (best && best[1].at > entry[1].at ? best : entry),
    null,
  );
  if (latest) delete ticks[latest[0]];
  return next;
}

/** "I already did these": resolves earlier steps for free, so they earn no metres or stamps. */
export function skipTo(p: Progress, quest: Quest, stepId: string, now: Date): Progress {
  const next = structuredClone(p);
  const records = (next.steps[quest.id] ??= {});
  for (const step of quest.steps) {
    if (step.id === stepId) break;
    records[step.id] ??= { at: now.toISOString(), status: 'skipped', bonus: 0 };
  }
  return next;
}

export function setLink(p: Progress, questId: string, path: string | null): Progress {
  const next = structuredClone(p);
  if (path) next.links[questId] = path;
  else delete next.links[questId];
  return next;
}

export function partCleared(p: Progress, quest: Quest, partNumber: number): boolean {
  const part = quest.parts.find((candidate) => candidate.number === partNumber);
  return !!part && part.steps.every((s) => stepRecord(p, quest.id, s.id)?.status === 'done');
}

export function questSummited(p: Progress, quest: Quest): boolean {
  return quest.steps.every((s) => stepRecord(p, quest.id, s.id));
}
