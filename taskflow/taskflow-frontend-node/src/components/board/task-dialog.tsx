import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { UpdateTaskBody } from '@/lib/api/endpoints';
import type { Board, Member, Priority, Task } from '@/lib/api/types';
import { afterTaskIdFor } from '@/lib/board-cache';
import { dateInputToIso, dateInputValue } from '@/lib/format';
import { useMoveTask } from '@/lib/queries/board';
import { useDeleteTask, useUpdateTask } from '@/lib/queries/tasks';
import { cn } from '@/lib/utils';
import { PRIORITY } from '@/lib/visuals';
import { toastError } from '@/stores/toasts';
import { TaskActivity } from './task-activity';
import { TaskComments } from './task-comments';
import { TaskFiles } from './task-files';

interface Props {
  task: Task;
  board: Board;
  members: Member[];
  workspaceId: string;
  canEdit: boolean;
  onClose: () => void;
}

type Tab = 'comments' | 'activity' | 'files';

const statClass = 'flex flex-col gap-1 rounded-2xl bg-white/4 p-3.5';
const controlClass =
  'h-9 w-full rounded-lg border border-transparent bg-transparent font-semibold outline-none enabled:hover:border-input focus-visible:border-primary disabled:opacity-100';

export function TaskDialog({ task, board, members, workspaceId, canEdit, onClose }: Props) {
  const projectId = board.project.id;
  const update = useUpdateTask(projectId, workspaceId);
  const move = useMoveTask(projectId);
  const remove = useDeleteTask(projectId);
  const [tab, setTab] = useState<Tab>('comments');

  const columnIndex = board.columns.findIndex((c) => c.id === task.columnId);
  const column = board.columns[columnIndex];

  /** Merge-patch: send only the fields that actually changed. */
  const save = (changes: UpdateTaskBody) => {
    update.mutate(
      { taskId: task.id, changes },
      {
        onError: (err) => {
          toastError(err, 'Saving');
        },
      },
    );
  };

  const moveTo = (columnId: string) => {
    const target = board.columns.find((c) => c.id === columnId);
    if (!target || columnId === task.columnId) return;
    move.mutate(
      { taskId: task.id, columnId, afterTaskId: afterTaskIdFor(target.tasks, task.id, null) },
      {
        onError: (err) => {
          toastError(err, 'Moving the task');
        },
      },
    );
  };

  const prev = board.columns[columnIndex - 1];
  const next = board.columns[columnIndex + 1];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        // Radix focuses the first field by default, which would select the whole title and let
        // the next keystroke replace it. Focus the dialog itself; Tab reaches the fields.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        className="animate-flip max-h-[calc(100svh-32px)] gap-5 overflow-y-auto rounded-[28px] border border-primary/40 bg-[linear-gradient(160deg,#1c2030,#0e1018_70%)] p-7 shadow-[0_60px_120px_-30px_rgb(0_0_0/0.95),0_0_80px_rgb(200_255_77/0.08)] sm:max-w-[640px]"
      >
        <span className="font-mono text-[13px] text-primary">{task.key}</span>
        <DialogTitle
          className={cn('font-display text-3xl leading-tight tracking-tight', canEdit && 'sr-only')}
        >
          {task.title}
        </DialogTitle>
        {canEdit ? (
          <input
            key={`title-${task.updatedAt}`}
            aria-label="Title"
            defaultValue={task.title}
            maxLength={200}
            onBlur={(e) => {
              const title = e.target.value.trim();
              if (title && title !== task.title) save({ title });
            }}
            className="-mx-2 rounded-xl border border-transparent bg-transparent px-2 font-display text-3xl leading-tight font-bold tracking-tight outline-none hover:border-input focus-visible:border-primary"
          />
        ) : null}
        <DialogDescription className="sr-only">
          Details, comments, activity and files for {task.key}
        </DialogDescription>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Status" htmlFor="t-status">
            <select
              id="t-status"
              disabled={!canEdit}
              value={task.columnId}
              onChange={(e) => {
                moveTo(e.target.value);
              }}
              className={controlClass}
            >
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Stat>
          <Stat label="Priority" htmlFor="t-priority">
            <select
              id="t-priority"
              disabled={!canEdit}
              value={task.priority}
              onChange={(e) => {
                save({ priority: e.target.value as Priority });
              }}
              className={controlClass}
              style={{ color: PRIORITY[task.priority].color }}
            >
              {(Object.keys(PRIORITY) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </Stat>
          <Stat label="Assignee" htmlFor="t-assignee">
            <select
              id="t-assignee"
              disabled={!canEdit}
              value={task.assignee?.id ?? ''}
              onChange={(e) => {
                save({ assigneeId: e.target.value || null });
              }}
              className={controlClass}
            >
              <option value="">Unassigned</option>
              {members
                .filter((m) => m.role !== 'viewer')
                .map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.displayName}
                  </option>
                ))}
            </select>
          </Stat>
          <Stat label="Due" htmlFor="t-due">
            <input
              id="t-due"
              type="date"
              disabled={!canEdit}
              value={dateInputValue(task.dueAt)}
              onChange={(e) => {
                save({ dueAt: dateInputToIso(e.target.value) });
              }}
              className={cn(controlClass, '[color-scheme:dark]')}
            />
          </Stat>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="t-desc" className="text-xs text-muted-foreground">
            Description
          </label>
          <textarea
            id="t-desc"
            key={`desc-${task.updatedAt}`}
            readOnly={!canEdit}
            rows={4}
            maxLength={10_000}
            defaultValue={task.description ?? ''}
            placeholder={canEdit ? 'Add the details when you know more.' : 'No description.'}
            onBlur={(e) => {
              const description = e.target.value.trim() || null;
              if (description !== task.description) save({ description });
            }}
            className="rounded-[14px] border border-transparent bg-white/4 p-3 text-[15px] text-[#c9cfdb] outline-none hover:border-input focus-visible:border-primary"
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <h3 className="font-display text-[15px] font-semibold">Trajectory</h3>
          <div className="flex">
            {board.columns.map((c, i) => (
              <div key={c.id} className="flex flex-1 flex-col gap-1.5">
                <span
                  className={cn('h-1 rounded-sm', i <= columnIndex ? 'bg-primary' : 'bg-white/12')}
                />
                <span
                  className={cn(
                    'text-xs',
                    i === columnIndex ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {c.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={!prev}
              onClick={() => {
                if (prev) moveTo(prev.id);
              }}
              className="h-12 rounded-[14px] border border-white/18 px-4 hover:bg-white/8 disabled:opacity-35"
            >
              Move back
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => {
                if (next) moveTo(next.id);
              }}
              className="h-12 rounded-[14px] bg-primary px-5 font-bold text-primary-foreground disabled:opacity-35"
            >
              {next ? `Advance to ${next.name}` : `In ${column?.name ?? 'the last column'}`}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Delete ${task.key}? Its comments and files go too.`)) return;
                remove.mutate(task.id, {
                  onSuccess: onClose,
                  onError: (err) => {
                    toastError(err, 'Deleting the task');
                  },
                });
              }}
              className="ml-auto flex h-12 items-center gap-2 rounded-[14px] px-4 text-coral hover:bg-coral/10"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-4 border-t border-white/8 pt-4">
          <div role="tablist" aria-label="Task sections" className="flex gap-1">
            {(['comments', 'activity', 'files'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`panel-${t}`}
                onClick={() => {
                  setTab(t);
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground capitalize aria-selected:bg-white/10 aria-selected:text-foreground"
              >
                {t}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'comments' ? (
              <TaskComments taskId={task.id} workspaceId={workspaceId} canComment={canEdit} />
            ) : null}
            {tab === 'activity' ? (
              <TaskActivity workspaceId={workspaceId} taskId={task.id} />
            ) : null}
            {tab === 'files' ? <TaskFiles taskId={task.id} canUpload={canEdit} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className={statClass}>
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
