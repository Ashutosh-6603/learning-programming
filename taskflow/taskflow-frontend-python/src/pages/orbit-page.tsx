import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Wordmark } from '@/components/orbit/brand';
import { CreateWorkspaceDialog } from '@/components/orbit/create-workspace-dialog';
import { Planet } from '@/components/orbit/planet';
import { GhostButton, PrimaryButton } from '@/components/orbit/primary-button';
import { UserMenu } from '@/components/orbit/user-menu';
import { panelAt, ringRadius, ringTransform, rotateTo, step, wrap } from '@/lib/carousel';
import { useWorkspaces } from '@/lib/queries/workspaces';

const PANEL_WIDTH = 300;

export function OrbitPage() {
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [rotation, setRotation] = useState(0);
  const [creating, setCreating] = useState(false);

  const items = workspaces.data?.pages.flatMap((p) => p.items) ?? [];
  const n = items.length;
  const radius = ringRadius(n, PANEL_WIDTH);
  const active = n > 0 ? items[wrap(rotation, n)] : undefined;

  const open = (id: string) => void navigate(`/w/${id}`);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setRotation((r) => step(r, -1, n));
    if (e.key === 'ArrowRight') setRotation((r) => step(r, 1, n));
  };

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 px-7 py-5">
        <Wordmark />
        <UserMenu />
      </header>
      <main className="flex flex-1 flex-col items-center gap-3 px-4 pt-2 pb-10">
        <span className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
          Workspaces{n > 0 ? ` · ${wrap(rotation, n) + 1} of ${n}` : ''}
        </span>
        <h1 className="text-center font-display text-[clamp(32px,4vw,48px)] font-bold tracking-[-0.03em]">
          {n === 0 && !workspaces.isPending ? 'Create your first world' : 'Choose your world'}
        </h1>

        {workspaces.isPending ? (
          <p className="py-24 text-muted-foreground">Scanning the sky…</p>
        ) : workspaces.isError ? (
          <p role="alert" className="py-24 text-coral">
            Couldn’t load your workspaces. Is the backend running?
          </p>
        ) : n === 0 ? (
          <div className="flex flex-col items-center gap-6 py-16">
            <Planet id="00000000-0000-0000-0000-000000000000" size={96} />
            <p className="max-w-sm text-center text-muted-foreground">
              Workspaces hold your team and its projects. Make one, or accept an invitation from a
              teammate.
            </p>
          </div>
        ) : (
          <section
            aria-roledescription="carousel"
            aria-label="Your workspaces"
            onKeyDown={onKeyDown}
            className="relative grid h-[420px] w-full max-w-[1100px] place-items-center perspective-[1500px]"
          >
            <div
              className="relative h-[340px] w-[300px] transform-3d transition-transform duration-900 ease-[cubic-bezier(.2,.8,.2,1)]"
              style={{ transform: ringTransform(rotation, n, radius) }}
            >
              {items.map((w, i) => {
                const panel = panelAt(i, rotation, n, radius);
                return (
                  <button
                    key={w.id}
                    type="button"
                    tabIndex={panel.front ? 0 : -1}
                    aria-label={panel.front ? `Enter ${w.name}` : `Rotate to ${w.name}`}
                    onClick={() => {
                      if (panel.front) open(w.id);
                      else setRotation((r) => rotateTo(r, i, n));
                    }}
                    className="absolute inset-0 flex flex-col gap-3.5 rounded-[26px] border bg-[rgb(12_14_22/0.82)] p-[26px] text-left shadow-[0_50px_80px_-30px_rgb(0_0_0/0.9)] backdrop-blur-md transition-[opacity,filter] duration-900 backface-hidden"
                    style={{
                      transform: panel.transform,
                      opacity: panel.opacity,
                      filter: panel.filter,
                      borderColor: panel.front ? 'rgb(200 255 77 / 0.6)' : 'rgb(255 255 255 / 0.1)',
                    }}
                  >
                    <Planet id={w.id} />
                    <span className="font-display text-[26px] leading-tight font-bold tracking-tight">
                      {w.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">/{w.slug}</span>
                    <span className="mt-auto self-start rounded-full bg-white/8 px-2.5 py-0.5 text-xs font-semibold capitalize">
                      {w.currentUserRole}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-center gap-4">
          {n > 1 ? (
            <GhostButton
              aria-label="Previous workspace"
              className="size-[52px] rounded-full p-0"
              onClick={() => {
                setRotation((r) => step(r, -1, n));
              }}
            >
              <ChevronLeft className="size-5" />
            </GhostButton>
          ) : null}
          {active ? (
            <PrimaryButton
              className="h-[52px] px-6"
              onClick={() => {
                open(active.id);
              }}
            >
              Enter {active.name}
            </PrimaryButton>
          ) : null}
          {n > 1 ? (
            <GhostButton
              aria-label="Next workspace"
              className="size-[52px] rounded-full p-0"
              onClick={() => {
                setRotation((r) => step(r, 1, n));
              }}
            >
              <ChevronRight className="size-5" />
            </GhostButton>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <GhostButton
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus className="size-4" /> New workspace
          </GhostButton>
          {workspaces.hasNextPage ? (
            <GhostButton
              disabled={workspaces.isFetchingNextPage}
              onClick={() => void workspaces.fetchNextPage()}
            >
              Load more worlds
            </GhostButton>
          ) : null}
        </div>
      </main>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
