import confetti from 'canvas-confetti';
import { create } from 'zustand';
import {
  emptyProgress,
  type GameEvent,
  type Move,
  type Progress,
  type RouteSummary,
  type StepSummary,
} from './game';
import type { Step } from './parser';
import { findPatch, type Patch } from './patches';
import { isProgressShape } from './progress-shape';
import { loadQuests, type Quest } from './quests';
import type { Rank } from './ranks';
import { setSoundEnabled, sound } from './sound';

export type Celebration =
  | { type: 'step'; quest: Quest; step: Step; summary: StepSummary; rank?: Rank }
  | { type: 'camp'; quest: Quest; step: Step; partNumber: number; summary: RouteSummary; rank?: Rank }
  | { type: 'summit'; quest: Quest; summary: RouteSummary; clean: boolean; rank?: Rank };

export type Toast = { id: number; patch: Patch };

type State = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  saveFailed: boolean;
  quests: Map<string, Quest>;
  progress: Progress;
  celebration: Celebration | null;
  toasts: Toast[];
  lastEvent: { id: number; m: number; verified: boolean } | null;
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  play: (move: Move) => void;
  set: (progress: Progress) => void;
  dismissCelebration: () => void;
  dismissToast: (id: number) => void;
};

async function fetchProgress(): Promise<Progress | null> {
  const response = await fetch('/api/progress');
  if (!response.ok) throw new Error(`Could not read data/progress.json (${response.status})`);
  const saved: unknown = await response.json();
  if (saved === null) return null;
  // Throwing keeps the error screen up on boot and keeps what's in memory on a refresh.
  if (!isProgressShape(saved)) throw new Error('data/progress.json is not a valid save');
  return saved as Progress;
}

let saving: Promise<void> = Promise.resolve();
let eventId = 0;

export const useGame = create<State>((set, get) => {
  // Saves run one at a time so a slow write can't land after a newer one.
  const save = (progress: Progress) => {
    saving = saving.then(async () => {
      try {
        const response = await fetch('/api/progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(progress),
        });
        if (!response.ok) throw new Error(String(response.status));
        set({ saveFailed: false });
      } catch {
        set({ saveFailed: true });
      }
    });
  };

  const handleEvents = (events: GameEvent[]) => {
    const celebrations: Celebration[] = [];
    let rank: Rank | undefined;
    const step = events.find((e) => e.type === 'step');
    for (const event of events) {
      if (event.type === 'tick') {
        set({ lastEvent: { id: ++eventId, m: event.m, verified: event.verified } });
        if (event.verified) sound.verified();
        else if (event.kind === 'note') sound.note();
        else sound.tick(event.index);
      }
      if (event.type === 'untick') sound.untick();
      if (event.type === 'rank') rank = event.rank;
      if (event.type === 'step') celebrations.push(event);
      if (event.type === 'camp' && step) {
        celebrations.push({
          type: 'camp',
          quest: event.quest,
          step: step.step,
          partNumber: event.partNumber,
          summary: event.summary,
        });
      }
      if (event.type === 'summit') celebrations.push(event);
      if (event.type === 'patch') {
        const patch = findPatch(event.id);
        if (patch) {
          setTimeout(() => {
            sound.patch();
            set((state) => ({ toasts: [...state.toasts, { id: ++eventId, patch }] }));
          }, 500);
        }
      }
    }
    // Only the biggest moment gets the screen: a summit outranks a camp, a camp outranks a step.
    const top = celebrations.at(-1);
    if (top) {
      set({ celebration: { ...top, ...(rank ? { rank } : {}) } });
      burst(top.type);
    } else if (rank) {
      sound.rank();
    }
  };

  return {
    status: 'loading',
    error: null,
    saveFailed: false,
    quests: new Map(),
    progress: emptyProgress(),
    celebration: null,
    toasts: [],
    lastEvent: null,

    boot: async () => {
      try {
        const [quests, saved] = await Promise.all([loadQuests(), fetchProgress()]);
        const progress = saved ?? emptyProgress();
        setSoundEnabled(progress.sound);
        set({ quests, progress, status: 'ready' });
      } catch (error) {
        // Stay on the error screen: starting with empty progress would overwrite the real file.
        set({ status: 'error', error: String(error) });
      }
    },

    // A second tab may have moved on; pick up its progress instead of overwriting it later.
    refresh: async () => {
      await saving;
      const saved = await fetchProgress().catch(() => null);
      if (saved) set({ progress: saved });
    },

    play: ({ progress, events }) => {
      set({ progress });
      save(progress);
      handleEvents(events);
    },

    set: (progress) => {
      set({ progress });
      setSoundEnabled(progress.sound);
      save(progress);
    },

    dismissCelebration: () => set({ celebration: null }),
    dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  };
});

function burst(type: Celebration['type']) {
  const colors = ['#ff7d4d', '#ffb4a2', '#f7c948', '#eef3f6', '#7cc7e8'];
  const base = { colors, disableForReducedMotion: true, zIndex: 60 };
  if (type === 'step') {
    sound.step();
    void confetti({ ...base, particleCount: 60, spread: 70, startVelocity: 32, origin: { y: 0.45 }, scalar: 0.8 });
  } else if (type === 'camp') {
    sound.camp();
    setTimeout(() => {
      void confetti({ ...base, particleCount: 140, spread: 110, startVelocity: 42, origin: { y: 0.5 } });
    }, 240);
  } else {
    sound.summit();
    const fire = (x: number, delay: number) =>
      setTimeout(() => {
        void confetti({ ...base, particleCount: 180, spread: 120, startVelocity: 50, origin: { x, y: 0.6 } });
      }, delay);
    fire(0.2, 150);
    fire(0.8, 450);
    fire(0.5, 900);
    fire(0.3, 1500);
    fire(0.7, 1800);
  }
}
