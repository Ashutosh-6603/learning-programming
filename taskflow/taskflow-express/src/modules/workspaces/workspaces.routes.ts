import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import {
  atLeastOneField,
  Email,
  Id,
  PageQuery,
  parseBody,
  parseParams,
  parseQuery,
  trimmed,
} from '../../lib/validation.js';
import type { InvitationsService } from './invitations.service.js';
import type { MembersService } from './members.service.js';
import { InvitableRoleSchema, RoleSchema } from './roles.js';
import type { WorkspacesService } from './workspaces.service.js';

const Slug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens only');

const CreateWorkspaceBody = z.object({ name: trimmed(1, 80), slug: Slug });
const UpdateWorkspaceBody = z
  .object({ name: trimmed(1, 80).optional(), slug: Slug.optional() })
  .refine(...atLeastOneField);

const WorkspaceParams = z.object({ workspaceId: Id });
const MemberParams = WorkspaceParams.extend({ userId: Id });
const InvitationParams = WorkspaceParams.extend({ invitationId: Id });

const UpdateMemberBody = z.object({ role: RoleSchema });
const CreateInvitationBody = z.object({ email: Email, role: InvitableRoleSchema });
const AcceptInvitationBody = z.object({ token: z.string().min(1).max(128) });

export function workspacesRoutes(
  workspaces: WorkspacesService,
  members: MembersService,
  invitations: InvitationsService,
): Router {
  const router = Router();

  router
    .route('/workspaces')
    .get(async (req, res) => {
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await workspaces.list(userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const body = parseBody(CreateWorkspaceBody, req);
      res.status(201).json(await workspaces.create(userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      res.json(await workspaces.get(workspaceId, userIdOf(req)));
    })
    .patch(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const body = parseBody(UpdateWorkspaceBody, req);
      res.json(await workspaces.update(workspaceId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      await workspaces.delete(workspaceId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/members')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await members.list(workspaceId, userIdOf(req), limit, cursor));
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/members/:userId')
    .patch(async (req, res) => {
      const { workspaceId, userId } = parseParams(MemberParams, req);
      const { role } = parseBody(UpdateMemberBody, req);
      res.json(await members.updateRole(workspaceId, userIdOf(req), userId, role));
    })
    .delete(async (req, res) => {
      const { workspaceId, userId } = parseParams(MemberParams, req);
      await members.remove(workspaceId, userIdOf(req), userId);
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/invitations')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await invitations.list(workspaceId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const body = parseBody(CreateInvitationBody, req);
      res.status(201).json(await invitations.create(workspaceId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/invitations/:invitationId')
    .delete(async (req, res) => {
      const { workspaceId, invitationId } = parseParams(InvitationParams, req);
      await invitations.revoke(workspaceId, userIdOf(req), invitationId);
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/invitations/accept')
    .post(async (req, res) => {
      const { token } = parseBody(AcceptInvitationBody, req);
      res.json(await invitations.accept(userIdOf(req), token));
    })
    .all(methodNotAllowed);

  return router;
}
