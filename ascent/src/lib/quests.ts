import { parseSteps, type ParsedSteps, type Step } from './parser';

export type Language = 'typescript' | 'python' | 'java';
export type Peak = {
  id: string;
  app: string;
  label: string;
  language: Language;
  side: 'backend' | 'frontend';
};
export type Quest = Peak & ParsedSteps & { repoPath: string };
export type Range = { app: string; name: string; tagline: string; peaks: Peak[] };

// Build order from CLAUDE.md §10.
const PEAKS: Omit<Peak, 'id' | 'app'>[] = [
  { label: 'express', language: 'typescript', side: 'backend' },
  { label: 'frontend-node', language: 'typescript', side: 'frontend' },
  { label: 'fastify', language: 'typescript', side: 'backend' },
  { label: 'nestjs', language: 'typescript', side: 'backend' },
  { label: 'fastapi', language: 'python', side: 'backend' },
  { label: 'frontend-python', language: 'typescript', side: 'frontend' },
  { label: 'django', language: 'python', side: 'backend' },
  { label: 'springboot', language: 'java', side: 'backend' },
  { label: 'frontend-java', language: 'typescript', side: 'frontend' },
];

const range = (app: string, name: string, tagline: string): Range => ({
  app,
  name,
  tagline,
  peaks: PEAKS.map((peak) => ({ ...peak, app, id: `${app}-${peak.label}` })),
});

export const RANGES: Range[] = [
  range('taskflow', 'TaskFlow', 'Auth, RBAC, ordering, real-time boards'),
  range('pulse', 'Pulse', 'Streams, presence, delivery guarantees'),
  range('cartly', 'Cartly', 'Transactions, payments, Kafka, observability'),
];

const sources = import.meta.glob<string>('../../../*/*/STEPS.md', {
  query: '?raw',
  import: 'default',
});

export async function loadQuests(): Promise<Map<string, Quest>> {
  const quests = new Map<string, Quest>();
  const peaks = new Map(RANGES.flatMap((r) => r.peaks.map((p) => [p.id, p] as const)));
  await Promise.all(
    Object.entries(sources).map(async ([file, load]) => {
      const segments = file.split('/');
      const peak = peaks.get(segments.at(-2) ?? '');
      if (!peak) return;
      const parsed = parseSteps(await load());
      if (parsed.steps.length > 0) {
        quests.set(peak.id, { ...peak, ...parsed, repoPath: `${peak.app}/${peak.id}` });
      }
    }),
  );
  return quests;
}

export function findStep(quest: Quest, stepId: string): Step | undefined {
  return quest.steps.find((step) => step.id === stepId);
}
