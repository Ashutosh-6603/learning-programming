import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import {
  atLeastOneField,
  Id,
  PageQuery,
  parseBody,
  parseParams,
  parseQuery,
  trimmed,
} from '../../lib/validation.js';
import type { ColumnsService } from './columns.service.js';
import type { ProjectsService } from './projects.service.js';

const Description = z.string().max(2000).nullable();
const WipLimit = z.number().int().min(1).max(999).nullable();

const CreateProjectBody = z.object({
  name: trimmed(1, 80),
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, '2-10 uppercase letters or digits, starting with a letter'),
  description: Description.optional(),
});
const UpdateProjectBody = z
  .object({ name: trimmed(1, 80).optional(), description: Description.optional() })
  .refine(...atLeastOneField);

const CreateColumnBody = z.object({ name: trimmed(1, 50), wipLimit: WipLimit.optional() });
const UpdateColumnBody = z
  .object({ name: trimmed(1, 50).optional(), wipLimit: WipLimit.optional() })
  .refine(...atLeastOneField);
const MoveColumnBody = z.object({ afterColumnId: Id.nullable() });

const WorkspaceParams = z.object({ workspaceId: Id });
const ProjectParams = z.object({ projectId: Id });
const ColumnParams = z.object({ columnId: Id });

export function projectsRoutes(projects: ProjectsService, columns: ColumnsService): Router {
  const router = Router();

  router
    .route('/workspaces/:workspaceId/projects')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await projects.list(workspaceId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const body = parseBody(CreateProjectBody, req);
      res.status(201).json(await projects.create(workspaceId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/projects/:projectId')
    .get(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      res.json(await projects.get(projectId, userIdOf(req)));
    })
    .patch(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const body = parseBody(UpdateProjectBody, req);
      res.json(await projects.update(projectId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      await projects.delete(projectId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/projects/:projectId/board')
    .get(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      res.json(await projects.board(projectId, userIdOf(req)));
    })
    .all(methodNotAllowed);

  router
    .route('/projects/:projectId/columns')
    .post(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const body = parseBody(CreateColumnBody, req);
      res.status(201).json(await columns.create(projectId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/columns/:columnId')
    .patch(async (req, res) => {
      const { columnId } = parseParams(ColumnParams, req);
      const body = parseBody(UpdateColumnBody, req);
      res.json(await columns.update(columnId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { columnId } = parseParams(ColumnParams, req);
      await columns.delete(columnId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/columns/:columnId/move')
    .post(async (req, res) => {
      const { columnId } = parseParams(ColumnParams, req);
      const { afterColumnId } = parseBody(MoveColumnBody, req);
      res.json(await columns.move(columnId, userIdOf(req), afterColumnId));
    })
    .all(methodNotAllowed);

  return router;
}
