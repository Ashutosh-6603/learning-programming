import { ChevronLeft, Layers } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardColumn, DropMarker } from '@/components/board/board-column';
import { NewTaskForm } from '@/components/board/new-task-form';
import { SearchBox } from '@/components/board/search-box';
import { TaskCard } from '@/components/board/task-card';
import { TaskDialog } from '@/components/board/task-dialog';
import { PresenceOrbit } from '@/components/orbit/presence-orbit';
import { useProjectRealtime } from '@/hooks/use-project-realtime';
import type { Board, Task } from '@/lib/api/types';
import { afterTaskIdFor, neighbourMove } from '@/lib/board-cache';
import { can } from '@/lib/permissions';
import { useBoard, useMoveTask } from '@/lib/queries/board';
import { useMembers } from '@/lib/queries/members';
import { useTask } from '@/lib/queries/tasks';
import { useWorkspace } from '@/lib/queries/workspaces';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/stores/preferences';
import { toastError } from '@/stores/toasts';
import { NotMember } from './not-member';

/** Where the dragged card would land: before `beforeId` in `columnId` (null = at the end). */
interface DropTarget {
  columnId: string;
  beforeId: string | null;
}

const matches = (task: Task, q: string) =>
  task.title.toLowerCase().includes(q) || task.key.toLowerCase().includes(q);

export function BoardPage() {
  const { workspaceId = '', projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const workspace = useWorkspace(workspaceId);
  const board = useBoard(projectId);
  const members = useMembers(workspaceId);
  const move = useMoveTask(projectId);
  const { status, present } = useProjectRealtime(projectId);
  const { tilt, toggleTilt } = usePreferences();

  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  // The open task lives in the URL (?task=…), so it survives a reload and can be shared.
  const openId = params.get('task');
  const boardTask = board.data?.columns.flatMap((c) => c.tasks).find((t) => t.id === openId);
  const fetchedTask = useTask(openId !== null && !boardTask ? openId : null);
  const openTask = boardTask ?? fetchedTask.data;

  const role = workspace.data?.currentUserRole;
  const canEdit = role ? can.editTasks(role) : false;
  const q = query.trim().toLowerCase();

  if (board.isError || workspace.isError) return <NotMember />;

  const setOpen = (taskId: string | null) => {
    setParams(
      (p) => {
        if (taskId) p.set('task', taskId);
        else p.delete('task');
        return p;
      },
      { replace: taskId === null },
    );
  };

  const runMove = (taskId: string, columnId: string, afterTaskId: string | null) => {
    move.mutate(
      { taskId, columnId, afterTaskId },
      {
        onError: (err) => {
          toastError(err, 'Moving the task');
        },
      },
    );
  };

  const aimAt = (next: DropTarget) => {
    // dragover fires many times a second: only re-render when the target actually changes.
    if (target?.columnId !== next.columnId || target.beforeId !== next.beforeId) setTarget(next);
  };

  const drop = (data: Board) => {
    if (dragId && target) {
      const column = data.columns.find((c) => c.id === target.columnId);
      const source = data.columns.find((c) => c.tasks.some((t) => t.id === dragId));
      if (column && source) {
        const after = afterTaskIdFor(column.tasks, dragId, target.beforeId);
        const unchanged = source.id === column.id && after === neighbour(source.tasks, dragId, -1);
        if (!unchanged) runMove(dragId, column.id, after);
      }
    }
    setDragId(null);
    setTarget(null);
  };

  return (
    <div className="flex min-h-svh flex-col">
      <header className="relative z-10 flex flex-wrap items-center gap-4 border-b border-white/8 bg-background/60 px-6 py-4 backdrop-blur-lg">
        <Link
          to={`/w/${workspaceId}`}
          aria-label="Back to projects"
          className="grid size-10 place-items-center rounded-xl border border-input text-foreground hover:bg-white/8"
        >
          <ChevronLeft className="size-[18px]" />
        </Link>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">{workspace.data?.name}</span>
          <h1 className="font-display text-xl font-bold tracking-tight">
            {board.data?.project.name ?? '…'}
            <span className="ml-1.5 font-mono text-xs font-medium text-primary">
              {board.data?.project.key}
            </span>
          </h1>
        </div>
        <SearchBox workspaceId={workspaceId} value={query} onChange={setQuery} />
        <PresenceOrbit users={present} status={status} />
        <button
          type="button"
          aria-pressed={tilt}
          onClick={toggleTilt}
          className={cn(
            'flex h-11 items-center gap-2 rounded-[14px] border px-3.5 hover:bg-white/8',
            tilt ? 'border-primary/60' : 'border-input',
          )}
        >
          <Layers className="size-4" /> {tilt ? '3D view' : 'Flat view'}
        </button>
      </header>

      <div className="flex-1 overflow-x-auto overflow-y-hidden perspective-[1800px] perspective-origin-[50%_10%]">
        {board.isPending ? (
          <p className="p-10 text-muted-foreground">Loading the board…</p>
        ) : (
          // ONE 3D transform (the tilt); everything inside renders flat. Nested preserve-3d
          // layers make Chrome hit-test pointer events by depth and miss the lower cards.
          <div
            className="mx-auto flex w-max items-start gap-[22px] px-12 pt-10 pb-20 transition-transform duration-900 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{
              transformOrigin: '50% 0',
              transform: tilt ? 'rotateX(22deg) translateZ(-40px)' : 'none',
            }}
          >
            {board.data.columns.map((column, ci) => {
              const isTarget = dragId !== null && target?.columnId === column.id;
              return (
                <BoardColumn
                  key={column.id}
                  column={column}
                  index={ci}
                  isLast={ci === board.data.columns.length - 1}
                  dropActive={isTarget}
                  onDragOverEmpty={() => {
                    if (dragId) aimAt({ columnId: column.id, beforeId: null });
                  }}
                  onDrop={() => {
                    drop(board.data);
                  }}
                >
                  {column.tasks.map((task) => (
                    <Fragment key={task.id}>
                      {isTarget && target.beforeId === task.id ? <DropMarker /> : null}
                      <TaskCard
                        task={task}
                        done={ci === board.data.columns.length - 1}
                        dimmed={q !== '' && !matches(task, q)}
                        dragging={dragId === task.id}
                        canEdit={canEdit}
                        canStepBack={ci > 0}
                        canStepForward={ci < board.data.columns.length - 1}
                        onOpen={() => {
                          setOpen(task.id);
                        }}
                        onStep={(direction) => {
                          const m = neighbourMove(board.data, task.id, direction);
                          if (m) runMove(task.id, m.columnId, m.afterTaskId);
                        }}
                        onDragStart={() => {
                          setDragId(task.id);
                        }}
                        onDragOverHalf={(half) => {
                          if (!dragId) return;
                          const beforeId =
                            half === 'top' ? task.id : neighbour(column.tasks, task.id, 1);
                          aimAt({ columnId: column.id, beforeId });
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setTarget(null);
                        }}
                      />
                    </Fragment>
                  ))}
                  {isTarget && target.beforeId === null ? <DropMarker /> : null}
                  {ci === 0 && canEdit ? (
                    <NewTaskForm projectId={projectId} columnId={column.id} />
                  ) : null}
                </BoardColumn>
              );
            })}
          </div>
        )}
      </div>

      {openTask && board.data ? (
        <TaskDialog
          task={openTask}
          board={board.data}
          members={members.data?.items ?? []}
          workspaceId={workspaceId}
          canEdit={canEdit}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

function neighbour(tasks: Task[], id: string, offset: -1 | 1): string | null {
  const i = tasks.findIndex((t) => t.id === id);
  return tasks[i + offset]?.id ?? null;
}
