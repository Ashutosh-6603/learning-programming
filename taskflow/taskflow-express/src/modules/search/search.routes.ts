import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseParams, parseQuery } from '../../lib/validation.js';
import type { SearchService } from './search.service.js';

const WorkspaceParams = z.object({ workspaceId: Id });
const SearchQuery = PageQuery.extend({ q: z.string().min(1).max(200) });

export function searchRoutes(search: SearchService): Router {
  const router = Router();

  router
    .route('/workspaces/:workspaceId/search')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { q, limit, cursor } = parseQuery(SearchQuery, req);
      res.json(await search.search(workspaceId, userIdOf(req), q, limit, cursor));
    })
    .all(methodNotAllowed);

  return router;
}
