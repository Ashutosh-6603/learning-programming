import { describe, expect, it } from "vitest";
import {
  currentStep,
  emptyProgress,
  reopenStep,
  skipTo,
  STEP_BONUS,
  stepState,
  stepTicks,
  streak,
  summarizeStep,
  toggleTask,
  totalMetres,
  VERIFIED_BONUS,
  verifyCommit,
  type Progress,
} from "./game";
import { parseSteps, type Step, type TaskBlock } from "./parser";
import { checkPatches } from "./patches";
import type { Quest } from "./quests";

const source = `# Demo
## Part 1 · Authentication
### Step 1.1 · First
**Goal:** a.
**\`a.ts\`** · new file
\`\`\`ts
one
two
three
\`\`\`
**Commit:** \`feat: a\`
### Step 1.2 · Second
**Goal:** b.
**✅ Checkpoint**
\`\`\`bash
x
\`\`\`
Expected: y.
## Part 2 · Docker
### Step 2.1 · Third
**Goal:** c.
**✅ Checkpoint**
\`\`\`bash
z
\`\`\`
Expected: y.
`;

const quest: Quest = {
  ...parseSteps(source),
  id: "taskflow-express",
  app: "taskflow",
  label: "express",
  language: "typescript",
  side: "backend",
  repoPath: "taskflow/taskflow-express",
};
const quests = [quest];
const now = new Date("2026-11-04T12:00:00");
const stepAt = (i: number) => quest.steps[i] as Step;
const taskAt = (step: Step, i: number) => step.tasks[i] as TaskBlock;

function remaining(p: Progress): TaskBlock {
  const ticks = stepTicks(p, quest.id, "1.1");
  return stepAt(0).tasks.find((task) => !ticks[task.key]) as TaskBlock;
}

function completeStep(p: Progress, step: Step, at = now) {
  let progress = p;
  const events = [];
  for (const task of step.tasks) {
    const move = toggleTask(progress, quest, step, task, quests, at);
    progress = move.progress;
    events.push(...move.events);
  }
  return { progress, events };
}

describe("moving up the route", () => {
  it("unlocks one step at a time", () => {
    const p = emptyProgress();
    expect(currentStep(p, quest)?.id).toBe("1.1");
    expect(stepState(p, quest, "1.2")).toBe("locked");
    const { progress } = completeStep(p, stepAt(0));
    expect(stepState(progress, quest, "1.1")).toBe("done");
    expect(stepState(progress, quest, "1.2")).toBe("current");
  });

  it("pays one metre per typed line, plus task and step bonuses", () => {
    const { progress } = completeStep(emptyProgress(), stepAt(0));
    expect(totalMetres(progress)).toBe(3 + 5 + STEP_BONUS);
    expect(summarizeStep(progress, quest, stepAt(0)).lines).toBe(3);
  });

  it("takes the metres back when a tick is undone", () => {
    const step = stepAt(0);
    const on = toggleTask(
      emptyProgress(),
      quest,
      step,
      taskAt(step, 0),
      quests,
      now,
    ).progress;
    expect(totalMetres(on)).toBe(3);
    const off = toggleTask(on, quest, step, taskAt(step, 0), quests, now);
    expect(totalMetres(off.progress)).toBe(0);
    expect(off.events).toEqual([{ type: "untick" }]);
  });

  it("celebrates a step, then a camp at the end of a part, then the summit", () => {
    const first = completeStep(emptyProgress(), stepAt(0));
    expect(first.events.map((e) => e.type)).toContain("step");
    expect(first.events.map((e) => e.type)).not.toContain("camp");
    const second = completeStep(first.progress, stepAt(1));
    expect(second.events.map((e) => e.type)).toContain("camp");
    const third = completeStep(second.progress, stepAt(2));
    expect(third.events.map((e) => e.type)).toContain("summit");
  });

  it("reopens a finished step with its last task to redo", () => {
    const { progress } = completeStep(emptyProgress(), stepAt(0));
    const reopened = reopenStep(progress, quest.id, "1.1");
    expect(stepState(reopened, quest, "1.1")).toBe("current");
    expect(Object.keys(stepTicks(reopened, quest.id, "1.1"))).toHaveLength(1);
    expect(totalMetres(reopened)).toBeLessThan(totalMetres(progress));
    const again = toggleTask(
      reopened,
      quest,
      stepAt(0),
      remaining(reopened),
      quests,
      now,
    );
    expect(again.events.map((e) => e.type)).toContain("step");
  });
});

describe("reopening a step with a verified commit", () => {
  it("undoes a hand-ticked task and keeps the verified commit", () => {
    const step = stepAt(0);
    const typed = toggleTask(
      emptyProgress(),
      quest,
      step,
      taskAt(step, 0),
      quests,
      now,
    ).progress;
    const later = new Date(now.getTime() + 60_000);
    const { progress } = verifyCommit(
      typed,
      quest,
      step,
      taskAt(step, 1),
      quests,
      later,
    );
    const reopened = reopenStep(progress, quest.id, "1.1");
    const ticks = stepTicks(reopened, quest.id, "1.1");
    expect(ticks[taskAt(step, 1).key]?.verified).toBe(true);
    expect(ticks[taskAt(step, 0).key]).toBeUndefined();
  });
});

describe("skipping ahead", () => {
  const skipped = skipTo(emptyProgress(), quest, "2.1", now);

  it("jumps the climber forward for free", () => {
    expect(stepState(skipped, quest, "1.1")).toBe("skipped");
    expect(stepState(skipped, quest, "2.1")).toBe("current");
    expect(totalMetres(skipped)).toBe(0);
  });

  it("earns no camp stamps or patches", () => {
    expect(checkPatches(skipped, quests, now)).toEqual([]);
  });

  it("summits, but not cleanly", () => {
    const { events } = completeStep(skipped, stepAt(2));
    const summit = events.find((e) => e.type === "summit");
    expect(summit).toMatchObject({ clean: false });
  });

  it("keeps the skipped part from counting as cleared", () => {
    const { progress } = completeStep(skipped, stepAt(2));
    expect(progress.patches["skill-auth"]).toBeUndefined();
    expect(progress.patches["skill-docker"]).toBeDefined();
  });
});

describe("verified commits", () => {
  const step = stepAt(0);
  const commit = taskAt(step, 1);

  it("ticks the commit and pays the bonus", () => {
    const { progress, events } = verifyCommit(
      emptyProgress(),
      quest,
      step,
      commit,
      quests,
      now,
    );
    expect(totalMetres(progress)).toBe(5 + VERIFIED_BONUS);
    expect(events[0]).toMatchObject({
      type: "tick",
      verified: true,
      m: 5 + VERIFIED_BONUS,
    });
  });

  it("upgrades a commit that was ticked by hand, paying only the difference", () => {
    const ticked = toggleTask(
      emptyProgress(),
      quest,
      step,
      commit,
      quests,
      now,
    ).progress;
    const { progress, events } = verifyCommit(
      ticked,
      quest,
      step,
      commit,
      quests,
      now,
    );
    expect(totalMetres(progress)).toBe(5 + VERIFIED_BONUS);
    expect(events[0]).toMatchObject({ m: VERIFIED_BONUS });
  });

  it("pays once", () => {
    const once = verifyCommit(
      emptyProgress(),
      quest,
      step,
      commit,
      quests,
      now,
    ).progress;
    const twice = verifyCommit(once, quest, step, commit, quests, now);
    expect(twice.events).toEqual([]);
    expect(totalMetres(twice.progress)).toBe(5 + VERIFIED_BONUS);
  });

  it("finishes the step when the commit was the last task", () => {
    const typed = toggleTask(
      emptyProgress(),
      quest,
      step,
      taskAt(step, 0),
      quests,
      now,
    ).progress;
    const { events } = verifyCommit(typed, quest, step, commit, quests, now);
    expect(events.map((e) => e.type)).toContain("step");
  });
});

describe("streak", () => {
  const onDays = (...days: string[]) => {
    const p = emptyProgress();
    days.forEach((day, i) => {
      ((p.ticks["q"] ??= {})["s"] ??= {})[`k${i}`] = {
        at: new Date(`${day}T12:00:00`).toISOString(),
        m: 1,
        kind: "read",
      };
    });
    return p;
  };
  const week = ["01", "02", "03", "04", "05", "06", "07"].map(
    (d) => `2026-11-${d}`,
  );

  it("counts consecutive days", () => {
    const p = onDays("2026-11-01", "2026-11-02", "2026-11-03");
    expect(streak(p, new Date("2026-11-03T20:00:00")).current).toBe(3);
  });

  it("survives until the end of the next day", () => {
    const p = onDays("2026-11-01", "2026-11-02");
    expect(streak(p, new Date("2026-11-03T20:00:00")).current).toBe(2);
  });

  it("breaks after a missed day when no rest day is banked", () => {
    const p = onDays("2026-11-01", "2026-11-02");
    expect(streak(p, new Date("2026-11-04T20:00:00")).current).toBe(0);
  });

  it("banks a rest day per 7 days and spends it on a gap", () => {
    const p = onDays(...week);
    expect(streak(p, new Date("2026-11-07T20:00:00"))).toMatchObject({
      current: 7,
      restDays: 1,
    });
    expect(streak(p, new Date("2026-11-09T20:00:00"))).toMatchObject({
      current: 7,
      restDays: 0,
    });
    expect(streak(p, new Date("2026-11-10T20:00:00")).current).toBe(0);
  });

  it("carries the streak across a covered gap", () => {
    const p = onDays(...week, "2026-11-09");
    expect(streak(p, new Date("2026-11-09T20:00:00")).current).toBe(8);
  });

  it("remembers the best streak after a break", () => {
    const p = onDays("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-20");
    expect(streak(p, new Date("2026-11-20T20:00:00"))).toMatchObject({
      current: 1,
      best: 3,
    });
  });
});

describe("patches", () => {
  it("awards first moves as they happen, once", () => {
    const step = stepAt(0);
    const first = toggleTask(
      emptyProgress(),
      quest,
      step,
      taskAt(step, 0),
      quests,
      now,
    );
    expect(first.events).toContainEqual({
      type: "patch",
      id: "first-keystroke",
    });
    const second = toggleTask(
      first.progress,
      quest,
      step,
      taskAt(step, 1),
      quests,
      now,
    );
    expect(second.events).not.toContainEqual({
      type: "patch",
      id: "first-keystroke",
    });
    expect(second.events).toContainEqual({ type: "patch", id: "first-commit" });
  });

  it("awards skill patches from the Part title", () => {
    const one = completeStep(emptyProgress(), stepAt(0));
    const two = completeStep(one.progress, stepAt(1));
    expect(two.events).toContainEqual({ type: "patch", id: "skill-auth" });
    expect(two.events).toContainEqual({ type: "patch", id: "first-camp" });
  });

  it("awards Second Dialect for the database Part in two backends", () => {
    const db = `# Demo
## Part 2 · Database schema & migrations
### Step 2.1 · Schema
**Goal:** g.
**✅ Checkpoint**
\`\`\`bash
x
\`\`\`
Expected: y.
`;
    const make = (label: string): Quest => ({
      ...parseSteps(db),
      id: `taskflow-${label}`,
      app: "taskflow",
      label,
      language: "typescript",
      side: "backend",
      repoPath: `taskflow/taskflow-${label}`,
    });
    const express = make("express");
    const fastify = make("fastify");
    const both = [express, fastify];
    const clear = (p: Progress, q: Quest) => {
      let progress = p;
      const events = [];
      const step = q.steps[0] as Step;
      for (const task of step.tasks) {
        const move = toggleTask(progress, q, step, task, both, now);
        progress = move.progress;
        events.push(...move.events);
      }
      return { progress, events };
    };
    const one = clear(emptyProgress(), express);
    expect(one.events).not.toContainEqual({ type: "patch", id: "two-orms" });
    expect(clear(one.progress, fastify).events).toContainEqual({
      type: "patch",
      id: "two-orms",
    });
  });

  it("awards Wired by the Container for HTTP foundations in a DI framework only", () => {
    const http = `# Demo
## Part 3 · HTTP foundations
### Step 3.1 · Problems
**Goal:** g.
**✅ Checkpoint**
\`\`\`bash
x
\`\`\`
Expected: y.
`;
    const make = (label: string): Quest => ({
      ...parseSteps(http),
      id: `taskflow-${label}`,
      app: "taskflow",
      label,
      language: "typescript",
      side: "backend",
      repoPath: `taskflow/taskflow-${label}`,
    });
    const fastify = make("fastify");
    const nestjs = make("nestjs");
    const both = [fastify, nestjs];
    const clear = (p: Progress, q: Quest) => {
      let progress = p;
      const events = [];
      const step = q.steps[0] as Step;
      for (const task of step.tasks) {
        const move = toggleTask(progress, q, step, task, both, now);
        progress = move.progress;
        events.push(...move.events);
      }
      return { progress, events };
    };
    const one = clear(emptyProgress(), fastify);
    expect(one.events).not.toContainEqual({ type: "patch", id: "skill-di" });
    expect(clear(one.progress, nestjs).events).toContainEqual({
      type: "patch",
      id: "skill-di",
    });
  });

  it("awards Brokered Labour for background jobs in a Celery backend only", () => {
    const jobs = `# Demo
## Part 11 · Background jobs & schedules
### Step 11.1 · Worker
**Goal:** g.
**✅ Checkpoint**
\`\`\`bash
x
\`\`\`
Expected: y.
`;
    const make = (label: string, language: Quest["language"]): Quest => ({
      ...parseSteps(jobs),
      id: `taskflow-${label}`,
      app: "taskflow",
      label,
      language,
      side: "backend",
      repoPath: `taskflow/taskflow-${label}`,
    });
    const nestjs = make("nestjs", "typescript");
    const fastapi = make("fastapi", "python");
    const both = [nestjs, fastapi];
    const clear = (p: Progress, q: Quest) => {
      let progress = p;
      const events = [];
      const step = q.steps[0] as Step;
      for (const task of step.tasks) {
        const move = toggleTask(progress, q, step, task, both, now);
        progress = move.progress;
        events.push(...move.events);
      }
      return { progress, events };
    };
    const one = clear(emptyProgress(), nestjs);
    expect(one.events).not.toContainEqual({
      type: "patch",
      id: "skill-celery",
    });
    expect(clear(one.progress, fastapi).events).toContainEqual({
      type: "patch",
      id: "skill-celery",
    });
  });

  it("awards Signed by the Contract for the API Part of the contract-first frontend only", () => {
    const api = `# Demo
## Part 2 · Talking to the API
### Step 2.1 · Client
**Goal:** g.
**✅ Checkpoint**
\`\`\`bash
x
\`\`\`
Expected: y.
`;
    const make = (label: string): Quest => ({
      ...parseSteps(api),
      id: `taskflow-${label}`,
      app: "taskflow",
      label,
      language: "typescript",
      side: "frontend",
      repoPath: `taskflow/taskflow-${label}`,
    });
    const node = make("frontend-node");
    const python = make("frontend-python");
    const both = [node, python];
    const clear = (p: Progress, q: Quest) => {
      let progress = p;
      const events = [];
      const step = q.steps[0] as Step;
      for (const task of step.tasks) {
        const move = toggleTask(progress, q, step, task, both, now);
        progress = move.progress;
        events.push(...move.events);
      }
      return { progress, events };
    };
    const one = clear(emptyProgress(), node);
    expect(one.events).not.toContainEqual({
      type: "patch",
      id: "skill-contract-first",
    });
    expect(clear(one.progress, python).events).toContainEqual({
      type: "patch",
      id: "skill-contract-first",
    });
  });

  it("awards Translator for the same Part cleared in two languages, not two frameworks", () => {
    const http = `# Demo
## Part 3 · HTTP foundations
### Step 3.1 · Problems
**Goal:** g.
**✅ Checkpoint**
\`\`\`bash
x
\`\`\`
Expected: y.
`;
    const make = (label: string, language: Quest["language"]): Quest => ({
      ...parseSteps(http),
      id: `taskflow-${label}`,
      app: "taskflow",
      label,
      language,
      side: "backend",
      repoPath: `taskflow/taskflow-${label}`,
    });
    const express = make("express", "typescript");
    const nestjs = make("nestjs", "typescript");
    const fastapi = make("fastapi", "python");
    const all = [express, nestjs, fastapi];
    const clear = (p: Progress, q: Quest) => {
      let progress = p;
      const events = [];
      const step = q.steps[0] as Step;
      for (const task of step.tasks) {
        const move = toggleTask(progress, q, step, task, all, now);
        progress = move.progress;
        events.push(...move.events);
      }
      return { progress, events };
    };
    const ts = clear(clear(emptyProgress(), express).progress, nestjs);
    expect(ts.events).not.toContainEqual({
      type: "patch",
      id: "cross-language",
    });
    expect(clear(ts.progress, fastapi).events).toContainEqual({
      type: "patch",
      id: "cross-language",
    });
  });

  it("notices a return after a week away, and an early start", () => {
    const first = completeStep(
      emptyProgress(),
      stepAt(0),
      new Date("2026-11-01T12:00:00"),
    );
    const back = completeStep(
      first.progress,
      stepAt(1),
      new Date("2026-11-20T05:00:00"),
    );
    expect(back.events).toContainEqual({ type: "patch", id: "comeback" });
    expect(back.events).toContainEqual({ type: "patch", id: "dawn-patrol" });
  });
});
