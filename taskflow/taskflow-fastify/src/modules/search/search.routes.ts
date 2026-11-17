import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import { SearchHit, type SearchService } from './search.service.js';

const WorkspaceParams = Type.Object({ workspaceId: Id });
const SearchQuery = Type.Object({
  ...PageQuery.properties,
  q: Type.String({ minLength: 1, maxLength: 200 }),
});

export const searchRoutes: FastifyPluginAsyncTypebox<{ search: SearchService }> = async (
  app,
  { search },
) => {
  app.get(
    '/workspaces/:workspaceId/search',
    {
      schema: {
        params: WorkspaceParams,
        querystring: SearchQuery,
        response: { 200: Page(SearchHit) },
      },
    },
    async (request) => {
      const { q, limit, cursor } = request.query;
      return search.search(request.params.workspaceId, userIdOf(request), q, limit, cursor);
    },
  );
};
