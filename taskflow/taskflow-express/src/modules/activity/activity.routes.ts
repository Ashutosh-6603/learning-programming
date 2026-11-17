import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseParams, parseQuery } from '../../lib/validation.js';
import type { ActivityService } from './activity.service.js';

const WorkspaceParams = z.object({ workspaceId: Id });
const ActivityQuery = PageQuery.extend({ projectId: Id.optional(), taskId: Id.optional() });

export function activityRoutes(activity: ActivityService): Router {
  const router = Router();

  router
    .route('/workspaces/:workspaceId/activity')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor, ...filter } = parseQuery(ActivityQuery, req);
      res.json(await activity.list(workspaceId, userIdOf(req), filter, limit, cursor));
    })
    .all(methodNotAllowed);

  return router;
}
