import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DragEvent } from 'react';
import { Avatar, PriorityPill } from '@/components/orbit/badges';
import type { Task } from '@/lib/api/types';
import { formatDue } from '@/lib/format';
import { PRIORITY } from '@/lib/visuals';
import { cn } from '@/lib/utils';

interface Props {
  task: Task;
  done: boolean;
  dimmed: boolean;
  dragging: boolean;
  canEdit: boolean;
  canStepBack: boolean;
  canStepForward: boolean;
  onOpen: () => void;
  onStep: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragOverHalf: (half: 'top' | 'bottom') => void;
  onDragEnd: () => void;
}

export function TaskCard(props: Props) {
  const { task, done, dimmed, dragging, canEdit } = props;
  const due = task.dueAt && !done ? formatDue(task.dueAt) : null;

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    props.onDragStart();
  };
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    props.onDragOverHalf(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
  };

  return (
    <article
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={props.onDragEnd}
      data-testid={`task-${task.key}`}
      className={cn(
        'glow-card relative flex flex-col gap-3 rounded-[18px] border border-white/10 bg-[linear-gradient(160deg,rgb(30_34_48/0.95),rgb(14_16_24/0.95))] p-4 shadow-[0_22px_34px_-18px_rgb(0_0_0/0.85)]',
        canEdit && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
      style={{ opacity: dimmed ? 0.18 : undefined }}
    >
      <button type="button" onClick={props.onOpen} className="flex flex-col gap-2 text-left">
        <span className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">{task.key}</span>
          <span
            className="h-1 w-[34px] rounded-sm"
            style={{ background: PRIORITY[task.priority].color }}
            title={`${PRIORITY[task.priority].label} priority`}
          />
        </span>
        <span className="text-[15px] leading-snug font-semibold">{task.title}</span>
      </button>
      <div className="flex items-center gap-2">
        <PriorityPill priority={task.priority} />
        {due ? (
          <span className={cn('text-xs', due.soon ? 'text-coral' : 'text-muted-foreground')}>
            {due.label}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-0.5">
          {canEdit ? (
            <>
              <button
                type="button"
                aria-label={`Move ${task.key} back`}
                disabled={!props.canStepBack}
                onClick={() => {
                  props.onStep(-1);
                }}
                className="grid size-8 place-items-center rounded-[10px] hover:bg-white/8 disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" strokeWidth={2.4} />
              </button>
              <button
                type="button"
                aria-label={`Move ${task.key} forward`}
                disabled={!props.canStepForward}
                onClick={() => {
                  props.onStep(1);
                }}
                className="grid size-8 place-items-center rounded-[10px] hover:bg-white/8 disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" strokeWidth={2.4} />
              </button>
            </>
          ) : null}
          {task.assignee ? <Avatar user={task.assignee} className="ml-1" /> : null}
        </span>
      </div>
    </article>
  );
}
