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
import type { TasksService } from './tasks.service.js';

const Priority = z.enum(['low', 'medium', 'high', 'urgent']);
const Title = trimmed(1, 200);
const Description = z.string().max(10_000).nullable();
const Timestamp = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const ListTasksQuery = PageQuery.extend({
  columnId: Id.optional(),
  assigneeId: z.union([Id, z.literal('none')]).optional(),
  priority: Priority.optional(),
  dueBefore: Timestamp.optional(),
});

const CreateTaskBody = z.object({
  title: Title,
  description: Description.optional(),
  columnId: Id.optional(),
  priority: Priority.default('medium'),
  assigneeId: Id.nullable().optional(),
  dueAt: Timestamp.nullable().optional(),
});

const UpdateTaskBody = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    priority: Priority.optional(),
    assigneeId: Id.nullable().optional(),
    dueAt: Timestamp.nullable().optional(),
  })
  .refine(...atLeastOneField);

const MoveTaskBody = z.object({ columnId: Id, afterTaskId: Id.nullable() });

const ProjectParams = z.object({ projectId: Id });
const TaskParams = z.object({ taskId: Id });

export function tasksRoutes(tasks: TasksService): Router {
  const router = Router();

  router
    .route('/projects/:projectId/tasks')
    .get(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const { limit, cursor, ...filters } = parseQuery(ListTasksQuery, req);
      res.json(await tasks.list(projectId, userIdOf(req), filters, limit, cursor));
    })
    .post(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const body = parseBody(CreateTaskBody, req);
      res.status(201).json(await tasks.create(projectId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/tasks/:taskId')
    .get(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      res.json(await tasks.get(taskId, userIdOf(req)));
    })
    .patch(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const body = parseBody(UpdateTaskBody, req);
      res.json(await tasks.update(taskId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      await tasks.delete(taskId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/tasks/:taskId/move')
    .post(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const body = parseBody(MoveTaskBody, req);
      res.json(await tasks.move(taskId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  return router;
}
