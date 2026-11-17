import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Nullable, Page, PageQuery, Patch, Timestamp, Trimmed } from '../../lib/schemas.js';
import { Priority, Task } from '../projects/projects.dto.js';
import type { TasksService } from './tasks.service.js';

const Title = Trimmed(1, 200);
const Description = Nullable(Type.String({ maxLength: 10_000 }));

const ListTasksQuery = Type.Object({
  ...PageQuery.properties,
  columnId: Type.Optional(Id),
  assigneeId: Type.Optional(Type.Union([Id, Type.Literal('none')])),
  priority: Type.Optional(Priority),
  dueBefore: Type.Optional(Timestamp),
});

const CreateTaskBody = Type.Object({
  title: Title,
  description: Type.Optional(Description),
  columnId: Type.Optional(Id),
  priority: Type.Optional(Priority),
  assigneeId: Type.Optional(Nullable(Id)),
  dueAt: Type.Optional(Nullable(Timestamp)),
});

const UpdateTaskBody = Patch({
  title: Title,
  description: Description,
  priority: Priority,
  assigneeId: Nullable(Id),
  dueAt: Nullable(Timestamp),
});

const MoveTaskBody = Type.Object({ columnId: Id, afterTaskId: Nullable(Id) });

const ProjectParams = Type.Object({ projectId: Id });
const TaskParams = Type.Object({ taskId: Id });

export const tasksRoutes: FastifyPluginAsyncTypebox<{ tasks: TasksService }> = async (
  app,
  { tasks },
) => {
  app.get(
    '/projects/:projectId/tasks',
    {
      schema: { params: ProjectParams, querystring: ListTasksQuery, response: { 200: Page(Task) } },
    },
    async (request) => {
      const { limit, cursor, ...filters } = request.query;
      return tasks.list(request.params.projectId, userIdOf(request), filters, limit, cursor);
    },
  );

  app.post(
    '/projects/:projectId/tasks',
    { schema: { params: ProjectParams, body: CreateTaskBody, response: { 201: Task } } },
    async (request, reply) => {
      reply.status(201);
      const { priority = 'medium', ...rest } = request.body;
      return tasks.create(request.params.projectId, userIdOf(request), { ...rest, priority });
    },
  );

  app.get(
    '/tasks/:taskId',
    { schema: { params: TaskParams, response: { 200: Task } } },
    async (request) => tasks.get(request.params.taskId, userIdOf(request)),
  );

  app.patch(
    '/tasks/:taskId',
    { schema: { params: TaskParams, body: UpdateTaskBody, response: { 200: Task } } },
    async (request) => tasks.update(request.params.taskId, userIdOf(request), request.body),
  );

  app.delete('/tasks/:taskId', { schema: { params: TaskParams } }, async (request, reply) => {
    await tasks.delete(request.params.taskId, userIdOf(request));
    return reply.status(204).send();
  });

  app.post(
    '/tasks/:taskId/move',
    { schema: { params: TaskParams, body: MoveTaskBody, response: { 200: Task } } },
    async (request) => tasks.move(request.params.taskId, userIdOf(request), request.body),
  );
};
