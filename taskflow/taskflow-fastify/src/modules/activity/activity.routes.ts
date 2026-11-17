import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import { ActivityEvent, type ActivityService } from './activity.service.js';

const WorkspaceParams = Type.Object({ workspaceId: Id });
const ActivityQuery = Type.Object({
  ...PageQuery.properties,
  projectId: Type.Optional(Id),
  taskId: Type.Optional(Id),
});

export const activityRoutes: FastifyPluginAsyncTypebox<{ activity: ActivityService }> = async (
  app,
  { activity },
) => {
  app.get(
    '/workspaces/:workspaceId/activity',
    {
      schema: {
        params: WorkspaceParams,
        querystring: ActivityQuery,
        response: { 200: Page(ActivityEvent) },
      },
    },
    async (request) => {
      const { limit, cursor, ...filter } = request.query;
      return activity.list(request.params.workspaceId, userIdOf(request), filter, limit, cursor);
    },
  );
};
