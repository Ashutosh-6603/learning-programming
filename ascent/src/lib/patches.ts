import {
  activeDays,
  dayOf,
  partCleared,
  questSummited,
  streak,
  type Progress,
} from "./game";
import type { Quest } from "./quests";

export type Patch = {
  id: string;
  name: string;
  hint: string;
  icon: string;
  group:
    "First moves" | "Volume" | "The route" | "Skills" | "Habit" | "Polyglot";
  secret?: boolean;
};

type Stats = {
  ticks: { at: string; kind: string; verified: boolean }[];
  lines: number;
  doneSteps: { questId: string; stepId: string; at: string }[];
  cleared: { quest: Quest; title: string }[];
  summits: Quest[];
  cleanSummits: number;
};

function collect(p: Progress, quests: Quest[]): Stats {
  const ticks: Stats["ticks"] = [];
  let lines = 0;
  for (const steps of Object.values(p.ticks)) {
    for (const stepTicks of Object.values(steps)) {
      for (const tick of Object.values(stepTicks)) {
        ticks.push({
          at: tick.at,
          kind: tick.kind,
          verified: tick.verified === true,
        });
        if (tick.kind === "type") lines += tick.m;
      }
    }
  }
  const doneSteps: Stats["doneSteps"] = [];
  for (const [questId, steps] of Object.entries(p.steps)) {
    for (const [stepId, record] of Object.entries(steps)) {
      if (record.status === "done")
        doneSteps.push({ questId, stepId, at: record.at });
    }
  }
  const cleared: Stats["cleared"] = [];
  for (const quest of quests) {
    for (const part of quest.parts) {
      if (partCleared(p, quest, part.number))
        cleared.push({ quest, title: part.title });
    }
  }
  const summits = quests.filter((quest) => questSummited(p, quest));
  const cleanSummits = summits.filter((quest) =>
    quest.steps.every((s) => p.steps[quest.id]?.[s.id]?.status === "done"),
  ).length;
  return { ticks, lines, doneSteps, cleared, summits, cleanSummits };
}

type Rule = Patch & {
  earned: (s: Stats, p: Progress, quests: Quest[], now: Date) => boolean;
};

const countKind = (s: Stats, kind: string) =>
  s.ticks.filter((t) => t.kind === kind).length;
const clearedTopic = (s: Stats, topic: RegExp) =>
  s.cleared.some((c) => topic.test(c.title));
const hourOf = (iso: string) => new Date(iso).getHours();

function countBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return counts;
}

const volume = (
  lines: number,
  name: string,
  hint: string,
  icon: string,
): Rule => ({
  id: `lines-${lines}`,
  name,
  hint,
  icon,
  group: "Volume",
  earned: (s) => s.lines >= lines,
});

const topic = (
  id: string,
  name: string,
  hint: string,
  icon: string,
  match: RegExp,
): Rule => ({
  id,
  name,
  hint,
  icon,
  group: "Skills",
  earned: (s) => clearedTopic(s, match),
});

const days = (n: number, name: string, icon: string): Rule => ({
  id: `streak-${n}`,
  name,
  hint: `Keep a ${n}-day streak`,
  icon,
  group: "Habit",
  earned: (_s, p, _q, now) => streak(p, now).best >= n,
});

const RULES: Rule[] = [
  {
    id: "first-keystroke",
    name: "First Keystroke",
    hint: "Type your first block of code",
    icon: "Keyboard",
    group: "First moves",
    earned: (s) => countKind(s, "type") >= 1,
  },
  {
    id: "first-step",
    name: "Off the Ground",
    hint: "Finish your first step",
    icon: "Footprints",
    group: "First moves",
    earned: (s) => s.doneSteps.length >= 1,
  },
  {
    id: "first-commit",
    name: "Signed the Logbook",
    hint: "Tick off your first commit",
    icon: "GitCommitHorizontal",
    group: "First moves",
    earned: (s) => countKind(s, "commit") >= 1,
  },
  {
    id: "first-verified",
    name: "Proof on the Rock",
    hint: "Have a commit verified in your linked repo",
    icon: "BadgeCheck",
    group: "First moves",
    earned: (s) => s.ticks.some((t) => t.verified),
  },
  {
    id: "first-note",
    name: "Field Notes",
    hint: "Open your first DSA field note",
    icon: "NotebookPen",
    group: "First moves",
    earned: (s) => countKind(s, "note") >= 1,
  },
  {
    id: "first-camp",
    name: "First Camp",
    hint: "Clear a whole Part without skipping",
    icon: "Tent",
    group: "The route",
    earned: (s) => s.cleared.length >= 1,
  },
  {
    id: "five-camps",
    name: "Seasoned Camper",
    hint: "Clear 5 Parts",
    icon: "Tents",
    group: "The route",
    earned: (s) => s.cleared.length >= 5,
  },
  {
    id: "first-summit",
    name: "Summit",
    hint: "Finish a whole repo",
    icon: "MountainSnow",
    group: "The route",
    earned: (s) => s.summits.length >= 1,
  },
  {
    id: "clean-ascent",
    name: "Clean Ascent",
    hint: "Finish a repo with no skipped steps",
    icon: "Sparkles",
    group: "The route",
    earned: (s) => s.cleanSummits >= 1,
  },
  {
    id: "second-range",
    name: "New Horizons",
    hint: "Finish a step in a second app",
    icon: "Compass",
    group: "The route",
    earned: (s, _p, quests) => {
      const apps = new Set(
        s.doneSteps
          .map((d) => quests.find((q) => q.id === d.questId)?.app)
          .filter(Boolean),
      );
      return apps.size >= 2;
    },
  },
  volume(100, "Warm Hands", "Type 100 lines by hand", "Hand"),
  volume(1000, "Thousand Lines", "Type 1,000 lines by hand", "Flame"),
  volume(5000, "Muscle Memory", "Type 5,000 lines by hand", "BicepsFlexed"),
  volume(20000, "Iron Fingers", "Type 20,000 lines by hand", "Anvil"),
  volume(100000, "The Long Road", "Type 100,000 lines by hand", "Infinity"),
  topic(
    "skill-auth",
    "Keymaster",
    "Clear an authentication Part",
    "KeyRound",
    /auth/i,
  ),
  topic(
    "skill-realtime",
    "Live Wire",
    "Clear a real-time Part",
    "Radio",
    /real-?time/i,
  ),
  topic(
    "skill-jobs",
    "Night Shift",
    "Clear a background jobs Part",
    "Clock",
    /background|jobs/i,
  ),
  topic(
    "skill-storage",
    "Packhorse",
    "Clear an attachments Part",
    "Package",
    /attachment|upload/i,
  ),
  topic(
    "skill-docker",
    "Shipwright",
    "Clear a Docker Part",
    "Container",
    /docker/i,
  ),
  topic(
    "skill-ci",
    "Green Check",
    "Clear a CI/CD Part",
    "Workflow",
    /ci\/cd|github actions/i,
  ),
  topic(
    "skill-tests",
    "Belay Check",
    "Clear a contract or E2E Part",
    "ShieldCheck",
    /contract|end-to-end/i,
  ),
  days(3, "Three in a Row", "CalendarCheck"),
  days(7, "One Full Week", "CalendarDays"),
  days(30, "Thirty Days High", "Trophy"),
  {
    id: "big-day",
    name: "Big Wall Day",
    hint: "Finish 5 steps in one day",
    icon: "Zap",
    group: "Habit",
    earned: (s) =>
      [...countBy(s.doneSteps, (d) => dayOf(d.at)).values()].some(
        (count) => count >= 5,
      ),
  },
  {
    id: "comeback",
    name: "Back on the Rope",
    hint: "Climb again after a week or more away",
    icon: "HeartHandshake",
    group: "Habit",
    secret: true,
    earned: (_s, p) => {
      const list = activeDays(p).map((d) => Date.parse(`${d}T00:00:00Z`));
      return list.some(
        (day, i) => i > 0 && day - (list[i - 1] as number) >= 7 * 86_400_000,
      );
    },
  },
  {
    id: "night-owl",
    name: "Headlamp",
    hint: "Climb between midnight and 4am",
    icon: "Moon",
    group: "Habit",
    secret: true,
    earned: (s) => s.ticks.some((t) => hourOf(t.at) < 4),
  },
  {
    id: "dawn-patrol",
    name: "Alpine Start",
    hint: "Climb between 4am and 7am",
    icon: "Sunrise",
    group: "Habit",
    secret: true,
    earned: (s) => s.ticks.some((t) => hourOf(t.at) >= 4 && hourOf(t.at) < 7),
  },
  {
    id: "lang-python",
    name: "Snake Charmer",
    hint: "Finish a step in a Python repo",
    icon: "Braces",
    group: "Polyglot",
    earned: (s, _p, quests) =>
      s.doneSteps.some(
        (d) => quests.find((q) => q.id === d.questId)?.language === "python",
      ),
  },
  {
    id: "lang-java",
    name: "Bean Counter",
    hint: "Finish a step in a Java repo",
    icon: "Coffee",
    group: "Polyglot",
    earned: (s, _p, quests) =>
      s.doneSteps.some(
        (d) => quests.find((q) => q.id === d.questId)?.language === "java",
      ),
  },
  {
    id: "same-step",
    name: "Same Step, New Rock",
    hint: "Finish the same step number in two backends",
    icon: "GitCompare",
    group: "Polyglot",
    earned: (s, _p, quests) => {
      const backends = s.doneSteps.filter(
        (d) => quests.find((q) => q.id === d.questId)?.side === "backend",
      );
      return [...countBy(backends, (d) => d.stepId).values()].some(
        (count) => count >= 2,
      );
    },
  },
  {
    id: "two-orms",
    name: "Second Dialect",
    hint: "Clear the database Part in two backends (each uses a different ORM)",
    icon: "Database",
    group: "Polyglot",
    earned: (s) =>
      new Set(
        s.cleared
          .filter(
            (c) => c.quest.side === "backend" && /database/i.test(c.title),
          )
          .map((c) => c.quest.id),
      ).size >= 2,
  },
  {
    id: "skill-di",
    name: "Wired by the Container",
    hint: "Clear HTTP foundations in a framework with a DI container (NestJS, Spring Boot)",
    icon: "Boxes",
    group: "Skills",
    earned: (s) =>
      s.cleared.some(
        (c) =>
          ["nestjs", "springboot"].includes(c.quest.label) &&
          /http foundations/i.test(c.title),
      ),
  },
  {
    id: "skill-celery",
    name: "Brokered Labour",
    hint: "Clear background jobs in a Celery backend (FastAPI, Django)",
    icon: "Workflow",
    group: "Skills",
    earned: (s) =>
      s.cleared.some(
        (c) =>
          ["fastapi", "django"].includes(c.quest.label) &&
          /background jobs/i.test(c.title),
      ),
  },
  {
    id: "skill-contract-first",
    name: "Signed by the Contract",
    hint: "Clear Talking to the API in a frontend whose client is generated from the contract",
    icon: "ScrollText",
    group: "Skills",
    earned: (s) =>
      s.cleared.some(
        (c) =>
          c.quest.label === "frontend-python" &&
          /talking to the api/i.test(c.title),
      ),
  },
  {
    id: "cross-language",
    name: "Translator",
    hint: "Clear the same Part in backends written in two languages",
    icon: "Languages",
    group: "Polyglot",
    earned: (s) => {
      const languagesByPart = new Map<string, Set<string>>();
      for (const c of s.cleared) {
        if (c.quest.side !== "backend") continue;
        languagesByPart.set(
          c.title,
          (languagesByPart.get(c.title) ?? new Set()).add(c.quest.language),
        );
      }
      return [...languagesByPart.values()].some(
        (languages) => languages.size >= 2,
      );
    },
  },
  {
    id: "both-sides",
    name: "Both Sides of the Wire",
    hint: "Finish a backend step and a frontend step on one day",
    icon: "ArrowLeftRight",
    group: "Polyglot",
    earned: (s, _p, quests) => {
      const sides = new Map<string, Set<string>>();
      for (const d of s.doneSteps) {
        const side = quests.find((q) => q.id === d.questId)?.side;
        if (!side) continue;
        const day = dayOf(d.at);
        sides.set(day, (sides.get(day) ?? new Set()).add(side));
      }
      return [...sides.values()].some((set) => set.size === 2);
    },
  },
];

export const PATCHES: Patch[] = RULES;

export function findPatch(id: string): Patch | undefined {
  return PATCHES.find((patch) => patch.id === id);
}

export function checkPatches(
  p: Progress,
  quests: Quest[],
  now: Date,
): string[] {
  const stats = collect(p, quests);
  return RULES.filter(
    (rule) => !p.patches[rule.id] && rule.earned(stats, p, quests, now),
  ).map((rule) => rule.id);
}
