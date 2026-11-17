import { inArray, sql } from 'drizzle-orm';
import { Type } from 'typebox';
import type { Database } from '../../db/client.js';
import { tasks } from '../../db/schema.js';
import { decodeCursor, RankCursor, toPage } from '../../lib/cursor.js';
import { Task, taskWith, toTask } from '../projects/projects.dto.js';
import type { Access } from '../workspaces/access.js';

export const SearchHit = Type.Object({ task: Task, rank: Type.Number(), headline: Type.String() });

// ts_headline can't HTML-escape, so we mark matches with control characters,
// escape the whole snippet ourselves, then swap the markers for <mark> tags.
const START = '\u0001';
const STOP = '\u0002';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const toSafeHeadline = (raw: string) =>
  escapeHtml(raw).replaceAll(START, '<mark>').replaceAll(STOP, '</mark>');

interface Hit extends Record<string, unknown> {
  id: string;
  rank: number;
  headline: string;
}

export class SearchService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
  ) {}

  async search(workspaceId: string, userId: string, q: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(RankCursor, cursor) : undefined;
    // rank is a float4 (`real`); casting the cursor value back to real makes the
    // row comparison exact, because JSON carries the shortest round-tripping decimal.
    const afterClause = after
      ? sql`AND (ts_rank(t.search_vector, query), t.id) < (${after.rank}::real, ${after.id}::uuid)`
      : sql``;
    const { rows: hits } = await this.db.execute<Hit>(sql`
      SELECT t.id,
             ts_rank(t.search_vector, query) AS rank,
             ts_headline('english', t.title || ' ' || coalesce(t.description, ''), query,
                         ${`StartSel=${START}, StopSel=${STOP}`}) AS headline
      FROM tasks t
      JOIN projects p ON p.id = t.project_id,
           websearch_to_tsquery('english', ${q}) AS query
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND t.search_vector @@ query
        ${afterClause}
      ORDER BY rank DESC, t.id DESC
      LIMIT ${limit + 1}`);

    const found = hits.length
      ? await this.db.query.tasks.findMany({
          where: inArray(
            tasks.id,
            hits.map((h) => h.id),
          ),
          with: taskWith,
        })
      : [];
    const byId = new Map(found.map((t) => [t.id, toTask(t)]));
    const rows = hits.flatMap((h) => {
      const task = byId.get(h.id);
      return task ? [{ task, rank: h.rank, headline: toSafeHeadline(h.headline) }] : [];
    });
    return toPage(
      rows,
      limit,
      (r) => r,
      (r) => ({ rank: r.rank, id: r.task.id }),
    );
  }
}
