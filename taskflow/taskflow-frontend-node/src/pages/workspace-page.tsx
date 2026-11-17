import { ChevronLeft, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { RolePill } from '@/components/orbit/badges';
import { CreateProjectDialog } from '@/components/orbit/create-project-dialog';
import { Planet } from '@/components/orbit/planet';
import { GhostButton } from '@/components/orbit/primary-button';
import { UserMenu } from '@/components/orbit/user-menu';
import { can } from '@/lib/permissions';
import { useProjects, useWorkspace } from '@/lib/queries/workspaces';
import { NotMember } from './not-member';

export function WorkspacePage() {
  const { workspaceId = '' } = useParams();
  const workspace = useWorkspace(workspaceId);
  const projects = useProjects(workspaceId);
  const [creating, setCreating] = useState(false);
  const role = workspace.data?.currentUserRole;

  if (workspace.isError) return <NotMember />;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-white/8 bg-background/60 px-6 py-4 backdrop-blur-lg">
        <Link
          to="/"
          aria-label="Back to workspaces"
          className="grid size-10 place-items-center rounded-xl border border-input text-foreground hover:bg-white/8"
        >
          <ChevronLeft className="size-[18px]" />
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate font-display text-xl font-bold">{workspace.data?.name ?? '…'}</h1>
          {role ? <RolePill role={role} /> : null}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link
            to="members"
            className="flex h-10 items-center gap-2 rounded-xl border border-input px-3.5 text-foreground no-underline hover:bg-white/8"
          >
            <Users className="size-4" /> Members
          </Link>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-bold tracking-tight">Projects</h2>
          {role && can.manageProjects(role) ? (
            <GhostButton
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus className="size-4" /> New project
            </GhostButton>
          ) : null}
        </div>

        {projects.isPending ? (
          <p className="text-muted-foreground">Loading projects…</p>
        ) : projects.data?.items.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-white/15 p-10 text-center text-muted-foreground">
            No projects yet.{' '}
            {role && can.manageProjects(role)
              ? 'Create one to get a board.'
              : 'Ask an admin to create one.'}
          </p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data?.items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`p/${p.id}`}
                  className="flex h-full flex-col gap-3 rounded-3xl border border-white/10 bg-white/4 p-6 text-foreground no-underline transition hover:-translate-y-1 hover:border-primary/55"
                >
                  <div className="flex items-center justify-between">
                    <Planet id={p.id} size={44} />
                    <span className="font-mono text-xs text-primary">{p.key}</span>
                  </div>
                  <span className="font-display text-xl font-bold">{p.name}</span>
                  {p.description ? (
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {p.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <CreateProjectDialog workspaceId={workspaceId} open={creating} onOpenChange={setCreating} />
    </div>
  );
}
