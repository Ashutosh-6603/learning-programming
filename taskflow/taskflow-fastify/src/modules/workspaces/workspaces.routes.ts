import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Email, Id, Page, PageQuery, Patch, Trimmed } from '../../lib/schemas.js';
import type { InvitationsService } from './invitations.service.js';
import type { MembersService } from './members.service.js';
import { InvitableRoleSchema, RoleSchema } from './roles.js';
import { Invitation, Member, Workspace } from './workspaces.dto.js';
import type { WorkspacesService } from './workspaces.service.js';

const Slug = Type.String({ minLength: 3, maxLength: 40, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' });

const CreateWorkspaceBody = Type.Object({ name: Trimmed(1, 80), slug: Slug });
const UpdateWorkspaceBody = Patch({ name: Trimmed(1, 80), slug: Slug });

const WorkspaceParams = Type.Object({ workspaceId: Id });
const MemberParams = Type.Object({ workspaceId: Id, userId: Id });
const InvitationParams = Type.Object({ workspaceId: Id, invitationId: Id });

const UpdateMemberBody = Type.Object({ role: RoleSchema });
const CreateInvitationBody = Type.Object({ email: Email, role: InvitableRoleSchema });
const AcceptInvitationBody = Type.Object({ token: Type.String({ minLength: 1, maxLength: 128 }) });

export interface WorkspacesRoutesOptions {
  workspaces: WorkspacesService;
  members: MembersService;
  invitations: InvitationsService;
}

export const workspacesRoutes: FastifyPluginAsyncTypebox<WorkspacesRoutesOptions> = async (
  app,
  { workspaces, members, invitations },
) => {
  app.get(
    '/workspaces',
    { schema: { querystring: PageQuery, response: { 200: Page(Workspace) } } },
    async (request) => {
      const { limit, cursor } = request.query;
      return workspaces.list(userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/workspaces',
    { schema: { body: CreateWorkspaceBody, response: { 201: Workspace } } },
    async (request, reply) => {
      reply.status(201);
      return workspaces.create(userIdOf(request), request.body);
    },
  );

  app.get(
    '/workspaces/:workspaceId',
    { schema: { params: WorkspaceParams, response: { 200: Workspace } } },
    async (request) => workspaces.get(request.params.workspaceId, userIdOf(request)),
  );

  app.patch(
    '/workspaces/:workspaceId',
    {
      schema: { params: WorkspaceParams, body: UpdateWorkspaceBody, response: { 200: Workspace } },
    },
    async (request) =>
      workspaces.update(request.params.workspaceId, userIdOf(request), request.body),
  );

  app.delete(
    '/workspaces/:workspaceId',
    { schema: { params: WorkspaceParams } },
    async (request, reply) => {
      await workspaces.delete(request.params.workspaceId, userIdOf(request));
      return reply.status(204).send();
    },
  );

  app.get(
    '/workspaces/:workspaceId/members',
    {
      schema: { params: WorkspaceParams, querystring: PageQuery, response: { 200: Page(Member) } },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      return members.list(request.params.workspaceId, userIdOf(request), limit, cursor);
    },
  );

  app.patch(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: MemberParams, body: UpdateMemberBody, response: { 200: Member } } },
    async (request) => {
      const { workspaceId, userId } = request.params;
      return members.updateRole(workspaceId, userIdOf(request), userId, request.body.role);
    },
  );

  app.delete(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: MemberParams } },
    async (request, reply) => {
      const { workspaceId, userId } = request.params;
      await members.remove(workspaceId, userIdOf(request), userId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/workspaces/:workspaceId/invitations',
    {
      schema: {
        params: WorkspaceParams,
        querystring: PageQuery,
        response: { 200: Page(Invitation) },
      },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      return invitations.list(request.params.workspaceId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/workspaces/:workspaceId/invitations',
    {
      schema: {
        params: WorkspaceParams,
        body: CreateInvitationBody,
        response: { 201: Invitation },
      },
    },
    async (request, reply) => {
      reply.status(201);
      return invitations.create(request.params.workspaceId, userIdOf(request), request.body);
    },
  );

  app.delete(
    '/workspaces/:workspaceId/invitations/:invitationId',
    { schema: { params: InvitationParams } },
    async (request, reply) => {
      const { workspaceId, invitationId } = request.params;
      await invitations.revoke(workspaceId, userIdOf(request), invitationId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/invitations/accept',
    { schema: { body: AcceptInvitationBody, response: { 200: Workspace } } },
    async (request) => invitations.accept(userIdOf(request), request.body.token),
  );
};
