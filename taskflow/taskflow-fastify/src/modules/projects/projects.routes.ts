import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Nullable, Page, PageQuery, Patch, Trimmed } from '../../lib/schemas.js';
import type { ColumnsService } from './columns.service.js';
import { Board, Column, Project } from './projects.dto.js';
import type { ProjectsService } from './projects.service.js';

const Description = Nullable(Type.String({ maxLength: 2000 }));
const WipLimit = Nullable(Type.Integer({ minimum: 1, maximum: 999 }));

const CreateProjectBody = Type.Object({
  name: Trimmed(1, 80),
  key: Type.String({ pattern: '^[A-Z][A-Z0-9]{1,9}$' }),
  description: Type.Optional(Description),
});
const UpdateProjectBody = Patch({ name: Trimmed(1, 80), description: Description });

const CreateColumnBody = Type.Object({ name: Trimmed(1, 50), wipLimit: Type.Optional(WipLimit) });
const UpdateColumnBody = Patch({ name: Trimmed(1, 50), wipLimit: WipLimit });
const MoveColumnBody = Type.Object({ afterColumnId: Nullable(Id) });

const WorkspaceParams = Type.Object({ workspaceId: Id });
const ProjectParams = Type.Object({ projectId: Id });
const ColumnParams = Type.Object({ columnId: Id });

export interface ProjectsRoutesOptions {
  projects: ProjectsService;
  columns: ColumnsService;
}

export const projectsRoutes: FastifyPluginAsyncTypebox<ProjectsRoutesOptions> = async (
  app,
  { projects, columns },
) => {
  app.get(
    '/workspaces/:workspaceId/projects',
    {
      schema: { params: WorkspaceParams, querystring: PageQuery, response: { 200: Page(Project) } },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      return projects.list(request.params.workspaceId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/workspaces/:workspaceId/projects',
    { schema: { params: WorkspaceParams, body: CreateProjectBody, response: { 201: Project } } },
    async (request, reply) => {
      reply.status(201);
      return projects.create(request.params.workspaceId, userIdOf(request), request.body);
    },
  );

  app.get(
    '/projects/:projectId',
    { schema: { params: ProjectParams, response: { 200: Project } } },
    async (request) => projects.get(request.params.projectId, userIdOf(request)),
  );

  app.patch(
    '/projects/:projectId',
    { schema: { params: ProjectParams, body: UpdateProjectBody, response: { 200: Project } } },
    async (request) => projects.update(request.params.projectId, userIdOf(request), request.body),
  );

  app.delete(
    '/projects/:projectId',
    { schema: { params: ProjectParams } },
    async (request, reply) => {
      await projects.delete(request.params.projectId, userIdOf(request));
      return reply.status(204).send();
    },
  );

  app.get(
    '/projects/:projectId/board',
    { schema: { params: ProjectParams, response: { 200: Board } } },
    async (request) => projects.board(request.params.projectId, userIdOf(request)),
  );

  app.post(
    '/projects/:projectId/columns',
    { schema: { params: ProjectParams, body: CreateColumnBody, response: { 201: Column } } },
    async (request, reply) => {
      reply.status(201);
      return columns.create(request.params.projectId, userIdOf(request), request.body);
    },
  );

  app.patch(
    '/columns/:columnId',
    { schema: { params: ColumnParams, body: UpdateColumnBody, response: { 200: Column } } },
    async (request) => columns.update(request.params.columnId, userIdOf(request), request.body),
  );

  app.delete('/columns/:columnId', { schema: { params: ColumnParams } }, async (request, reply) => {
    await columns.delete(request.params.columnId, userIdOf(request));
    return reply.status(204).send();
  });

  app.post(
    '/columns/:columnId/move',
    { schema: { params: ColumnParams, body: MoveColumnBody, response: { 200: Column } } },
    async (request) =>
      columns.move(request.params.columnId, userIdOf(request), request.body.afterColumnId),
  );
};
