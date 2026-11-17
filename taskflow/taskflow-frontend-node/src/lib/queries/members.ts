import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/lib/api/endpoints';
import type { InvitableRole, Role } from '@/lib/api/types';
import { keys } from './keys';

export const useMembers = (workspaceId: string) =>
  useQuery({
    queryKey: keys.members(workspaceId),
    queryFn: () => workspacesApi.members(workspaceId),
  });

export const useInvitations = (workspaceId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.invitations(workspaceId),
    queryFn: () => workspacesApi.invitations(workspaceId),
    enabled,
  });

export function useMemberMutations(workspaceId: string) {
  const qc = useQueryClient();
  const refreshMembers = () => qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
  const refreshInvitations = () =>
    qc.invalidateQueries({ queryKey: keys.invitations(workspaceId) });
  return {
    changeRole: useMutation({
      mutationFn: (vars: { userId: string; role: Role }) =>
        workspacesApi.updateMember(workspaceId, vars.userId, vars.role),
      onSettled: refreshMembers,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => workspacesApi.removeMember(workspaceId, userId),
      onSettled: refreshMembers,
    }),
    invite: useMutation({
      mutationFn: (body: { email: string; role: InvitableRole }) =>
        workspacesApi.invite(workspaceId, body),
      onSuccess: refreshInvitations,
    }),
    revoke: useMutation({
      mutationFn: (invitationId: string) =>
        workspacesApi.revokeInvitation(workspaceId, invitationId),
      onSettled: refreshInvitations,
    }),
  };
}
