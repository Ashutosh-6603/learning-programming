import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar, RolePill } from '@/components/orbit/badges';
import { Field, FormAlert } from '@/components/orbit/field';
import { PrimaryButton } from '@/components/orbit/primary-button';
import type { Member, Role } from '@/lib/api/types';
import { timeAgo } from '@/lib/format';
import { applyProblem } from '@/lib/forms';
import { can } from '@/lib/permissions';
import { useInvitations, useMemberMutations, useMembers } from '@/lib/queries/members';
import { useWorkspace } from '@/lib/queries/workspaces';
import { inviteSchema, type InviteValues } from '@/lib/schemas';
import { useAuth } from '@/stores/auth';
import { toastError } from '@/stores/toasts';
import { NotMember } from './not-member';

export function MembersPage() {
  const { workspaceId = '' } = useParams();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const role = workspace.data?.currentUserRole;
  const invitations = useInvitations(workspaceId, role ? can.invite(role) : false);
  const mutations = useMemberMutations(workspaceId);

  if (workspace.isError) return <NotMember />;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center gap-4 border-b border-white/8 bg-background/60 px-6 py-4 backdrop-blur-lg">
        <Link
          to={`/w/${workspaceId}`}
          aria-label="Back to projects"
          className="grid size-10 place-items-center rounded-xl border border-input text-foreground hover:bg-white/8"
        >
          <ChevronLeft className="size-[18px]" />
        </Link>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{workspace.data?.name}</span>
          <h1 className="font-display text-xl font-bold">Members</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10">
        <ul className="flex flex-col divide-y divide-white/8 rounded-3xl border border-white/10 bg-white/3">
          {members.data?.items.map((m) => (
            <MemberRow key={m.user.id} member={m} actorRole={role} mutations={mutations} />
          ))}
        </ul>

        {role && can.invite(role) ? (
          <section className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-bold">Invite someone</h2>
            <InviteForm roles={can.invitableRoles(role)} mutations={mutations} />
            {invitations.data && invitations.data.items.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {invitations.data.items.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/4 px-4 py-3"
                  >
                    <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                    <RolePill role={inv.role} />
                    <span className="text-xs text-muted-foreground">
                      expires {timeAgo(inv.expiresAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        mutations.revoke.mutate(inv.id, {
                          onError: (err) => {
                            toastError(err, 'Revoking');
                          },
                        });
                      }}
                      className="rounded-lg px-2.5 py-1 text-sm text-coral hover:bg-coral/10"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

type Mutations = ReturnType<typeof useMemberMutations>;

function MemberRow({
  member,
  actorRole,
  mutations,
}: {
  member: Member;
  actorRole: Role | undefined;
  mutations: Mutations;
}) {
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();
  const isMe = me?.id === member.user.id;
  const roles = actorRole && !isMe ? can.assignableRoles(actorRole, member.role) : [];
  const canRemove = actorRole && !isMe ? can.removeMember(actorRole, member.role) : false;
  const selectId = `role-${member.user.id}`;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <Avatar user={member.user} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">
          {member.user.displayName}
          {isMe ? <span className="text-muted-foreground"> (you)</span> : null}
        </span>
        <span className="truncate text-sm text-muted-foreground">{member.user.email}</span>
      </div>
      {roles.length > 0 ? (
        <>
          <label htmlFor={selectId} className="sr-only">
            Role for {member.user.displayName}
          </label>
          <select
            id={selectId}
            value={member.role}
            onChange={(e) => {
              mutations.changeRole.mutate(
                { userId: member.user.id, role: e.target.value as Role },
                {
                  onError: (err) => {
                    toastError(err, 'Changing the role');
                  },
                },
              );
            }}
            className="h-9 rounded-lg border border-input bg-background px-2 capitalize"
          >
            {[...new Set<Role>([member.role, ...roles])].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </>
      ) : (
        <RolePill role={member.role} />
      )}
      {canRemove || isMe ? (
        <button
          type="button"
          onClick={() => {
            const question = isMe ? 'Leave this workspace?' : `Remove ${member.user.displayName}?`;
            if (!window.confirm(question)) return;
            mutations.remove.mutate(member.user.id, {
              onSuccess: () => {
                if (isMe) void navigate('/');
              },
              onError: (err) => {
                toastError(err, isMe ? 'Leaving' : 'Removing');
              },
            });
          }}
          className="rounded-lg px-2.5 py-1 text-sm text-coral hover:bg-coral/10"
        >
          {isMe ? 'Leave' : 'Remove'}
        </button>
      ) : null}
    </li>
  );
}

function InviteForm({ roles, mutations }: { roles: InviteValues['role'][]; mutations: Mutations }) {
  const [alert, setAlert] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: roles.includes('member') ? 'member' : (roles[0] ?? 'viewer'),
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setAlert(null);
    setSent(null);
    try {
      await mutations.invite.mutateAsync(values);
      setSent(`Invitation sent to ${values.email}.`);
      form.reset({ email: '', role: values.role });
    } catch (err) {
      setAlert(applyProblem(err, ['email', 'role'], form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <Field
          id="invite-email"
          label="Email"
          type="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-sm text-muted-foreground">
          Role
        </label>
        <select
          id="invite-role"
          className="h-12 rounded-xl border border-input bg-background px-3 capitalize"
          {...form.register('role')}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <PrimaryButton type="submit" disabled={form.formState.isSubmitting}>
        Send invite
      </PrimaryButton>
      <div className="w-full">
        <FormAlert message={alert} />
        {sent ? (
          <p role="status" className="text-sm text-primary">
            {sent}
          </p>
        ) : null}
      </div>
    </form>
  );
}
