import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { decodeCursor, isRankCursor, toPage } from '../../common/cursor.js';
import { Task } from '../../database/entities/task.entity.js';
import { AccessService } from '../access/access.service.js';
import { TASK_RELATIONS, toTask } from '../projects/project.dto.js';

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

interface Hit {
  id: string;
  rank: number;
  headline: string;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly access: AccessService,
  ) {}

  async search(workspaceId: string, userId: string, q: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isRankCursor) : undefined;
    // Raw SQL with numbered parameters ($1, $2, …): values travel separately from the text,
    // so nothing the user typed is ever parsed as SQL.
    const params: unknown[] = [`StartSel=${START}, StopSel=${STOP}`, q, workspaceId, limit + 1];
    // rank is a float4 (`real`); casting the cursor value back to real makes the
    // row comparison exact, because JSON carries the shortest round-tripping decimal.
    let afterClause = '';
    if (after) {
      params.push(after.rank, after.id);
      afterClause = 'AND (ts_rank(t.search_vector, query), t.id) < ($5::real, $6::uuid)';
    }
    const hits = await this.dataSource.query<Hit[]>(
      `SELECT t.id,
              ts_rank(t.search_vector, query) AS rank,
              ts_headline('english', t.title || ' ' || coalesce(t.description, ''), query, $1) AS headline
       FROM tasks t
       JOIN projects p ON p.id = t.project_id,
            websearch_to_tsquery('english', $2) AS query
       WHERE p.workspace_id = $3::uuid
         AND t.search_vector @@ query
         ${afterClause}
       ORDER BY rank DESC, t.id DESC
       LIMIT $4`,
      params,
    );

    const found = hits.length
      ? await this.tasks.find({
          where: { id: In(hits.map((h) => h.id)) },
          relations: TASK_RELATIONS,
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
