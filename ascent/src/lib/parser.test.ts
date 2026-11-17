import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSteps } from './parser';

const root = path.resolve(import.meta.dirname, '../../..');
const realFiles = ['taskflow', 'pulse', 'cartly'].flatMap((app) =>
  readdirSync(path.join(root, app), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, app, entry.name, 'STEPS.md'))
    .filter((file) => existsSync(file)),
);

function headingCount(source: string, pattern: RegExp): number {
  let inFence = false;
  let count = 0;
  for (const line of source.split('\n')) {
    if (/^\s*`{3,}/.test(line)) inFence = !inFence;
    else if (!inFence && pattern.test(line)) count++;
  }
  return count;
}

describe('every real STEPS.md stays playable', () => {
  it('finds at least one file', () => expect(realFiles.length).toBeGreaterThan(0));

  describe.each(realFiles.map((file) => [path.basename(path.dirname(file)), file] as const))('%s', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const quest = parseSteps(source);

    it('finds every Part and Step', () => {
      expect(quest.parts.length).toBe(headingCount(source, /^## Part \d+ · /));
      expect(quest.steps.length).toBe(headingCount(source, /^### Step \d+\.\d+ · /));
    });

    it('gives every step something to do, and nearly all a goal', () => {
      for (const step of quest.steps) {
        expect(step.tasks.length, `Step ${step.id} tasks`).toBeGreaterThan(0);
      }
      const withGoal = quest.steps.filter((step) => step.goal !== '');
      expect(withGoal.length / quest.steps.length).toBeGreaterThan(0.9);
    });

    it('turns every marker into a task instead of leaving it as prose', () => {
      for (const step of quest.steps) {
        for (const block of step.blocks) {
          if (block.kind !== 'prose') continue;
          expect(block.md, `Step ${step.id}`).not.toMatch(/\*\*✅ Checkpoint/);
          expect(block.md, `Step ${step.id}`).not.toMatch(/^\*\*Commit:/m);
          expect(block.md, `Step ${step.id}`).not.toMatch(/^\*\*What's new/m);
          expect(block.md, `Step ${step.id}`).not.toMatch(/^>\s*(\*\*)?🧠/m);
        }
      }
    });

    it('keeps every checkpoint, What’s new and note', () => {
      const tasks = quest.steps.flatMap((step) => step.tasks);
      expect(tasks.filter((t) => t.kind === 'check').length).toBe(
        headingCount(source, /^\*\*✅ Checkpoint/),
      );
      expect(tasks.filter((t) => t.kind === 'read' && t.md !== '').length).toBe(
        headingCount(source, /^\*\*What's new/),
      );
      expect(tasks.filter((t) => t.kind === 'note').length).toBe(
        headingCount(source, /^>\s*(\*\*)?🧠/),
      );
    });

    it('keeps code byte-identical, attributed to a file when the guide names one', () => {
      const code = quest.steps.flatMap((s) => s.tasks).filter((t) => t.kind === 'code');
      for (const block of code) expect(source).toContain(block.code);
      const typed = code.filter((block) => block.task === 'type');
      expect(typed.filter((block) => block.path).length / typed.length).toBeGreaterThan(0.9);
    });

    it('uses a task key only once per step', () => {
      for (const step of quest.steps) {
        const keys = step.tasks.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });
});

describe('parseSteps', () => {
  const sample = [
    '# STEPS · Rebuild `demo`',
    'Intro.',
    '## What you’ll build',
    '```text',
    '## Part 99 · not a heading',
    '```',
    '## Part 1 · One',
    '### Step 1.1 · First',
    '**Goal:** do it.',
    '**Files:** `a.ts`',
    'Some context.',
    '**`a.ts`** · new file',
    '```ts',
    'const a = 1;',
    '',
    'const b = 2;',
    '```',
    "**What's new**",
    '- a thing',
    '',
    'Then install:',
    '```bash',
    'npm i',
    '```',
    '> **🧠 DSA & scalability · a topic**',
    '> - **Complexity:** O(1)',
    '**✅ Checkpoint**',
    '```bash',
    'npm test',
    '```',
    'Expected: green.',
    '**Commit:** `feat: first`',
    '### Step 1.2 · Second',
    '**Goal:** more.',
    '**Commit:**',
    '',
    '```bash',
    'git add -A && git commit -m "feat: second"',
    '```',
    '### Step 1.3 · Third',
    '**Goal:** nothing to commit.',
    '**Commit:** none; repository settings.',
  ].join('\n');
  const quest = parseSteps(sample);

  it('does not treat headings inside code fences as structure', () => {
    expect(quest.parts.map((p) => p.number)).toEqual([1]);
    expect(quest.briefing).toContain('## Part 99 · not a heading');
  });

  it('splits a step into ordered tasks', () => {
    const step = quest.steps[0];
    expect(step?.tasks.map((t) => t.kind)).toEqual(['code', 'read', 'code', 'note', 'check', 'commit']);
  });

  it('counts non-empty lines and attaches the file label', () => {
    const block = quest.steps[0]?.tasks[0];
    expect(block).toMatchObject({ kind: 'code', task: 'type', path: 'a.ts', action: 'new file', lines: 2 });
  });

  it('treats a shell block under a file label as a file to type', () => {
    const env = parseSteps(
      ['## Part 1 · P', '### Step 1.1 · S', '**`.env.example`** · new file', '```bash', 'PORT=8000', '```'].join('\n'),
    );
    expect(env.steps[0]?.tasks[0]).toMatchObject({ kind: 'code', task: 'type', path: '.env.example' });
  });

  it('ends What’s new where the guide moves on', () => {
    const read = quest.steps[0]?.tasks[1];
    expect(read).toMatchObject({ kind: 'read', md: '- a thing' });
    expect(quest.steps[0]?.blocks.some((b) => b.kind === 'prose' && b.md === 'Then install:')).toBe(true);
  });

  it('reads the note title and strips the quote markers', () => {
    expect(quest.steps[0]?.tasks[3]).toMatchObject({ title: 'a topic', md: '- **Complexity:** O(1)' });
  });

  it('reads commits from inline code and from a git commit block', () => {
    expect(quest.steps[0]?.tasks[5]).toMatchObject({ message: 'feat: first' });
    expect(quest.steps[1]?.tasks[0]).toMatchObject({ kind: 'commit', message: 'feat: second' });
  });

  it('treats a commit note as no commit, and still leaves something to tick', () => {
    expect(quest.steps[2]?.commitNote).toBe('none; repository settings.');
    expect(quest.steps[2]?.tasks.map((t) => t.kind)).toEqual(['read']);
  });
});
