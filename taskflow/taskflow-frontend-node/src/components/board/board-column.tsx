import type { DragEvent, ReactNode } from 'react';
import type { BoardColumn as Column } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const DOTS = ['#9aa3b5', '#7fd8ff', '#ffd166', '#c8ff4d', '#b79bff', '#ff9b6a'];

interface Props {
  column: Column;
  index: number;
  isLast: boolean;
  dropActive: boolean;
  onDragOverEmpty: () => void;
  onDrop: () => void;
  children: ReactNode;
}

export function BoardColumn({
  column,
  index,
  isLast,
  dropActive,
  onDragOverEmpty,
  onDrop,
  children,
}: Props) {
  const count = column.tasks.length;
  const overLimit = column.wipLimit !== null && count > column.wipLimit;
  const dot = isLast ? '#c8ff4d' : (DOTS[index % (DOTS.length - 1)] ?? '#9aa3b5');

  return (
    <section
      aria-label={column.name}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        onDragOverEmpty();
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        'animate-rise flex w-[300px] flex-none flex-col gap-3.5 rounded-3xl border bg-white/[0.035] p-4',
        dropActive ? 'border-primary/50' : 'border-white/9',
      )}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="size-2.5 rounded-full"
            style={{ background: dot, boxShadow: `0 0 14px ${dot}` }}
          />
          <h2 className="font-display text-base font-semibold">{column.name}</h2>
        </div>
        <span
          className={cn(
            'font-mono text-xs',
            overLimit ? 'rounded-full bg-coral/15 px-2 text-coral' : 'text-muted-foreground',
          )}
          title={
            column.wipLimit !== null ? `Work-in-progress limit: ${column.wipLimit}` : undefined
          }
        >
          {column.wipLimit !== null
            ? `${count} / ${column.wipLimit}`
            : String(count).padStart(2, '0')}
          {overLimit ? ' · over WIP limit' : ''}
        </span>
      </div>
      {children}
    </section>
  );
}

export function DropMarker() {
  return (
    <div
      aria-hidden="true"
      className="h-1 rounded-full bg-primary shadow-[0_0_12px_rgb(200_255_77/0.7)]"
    />
  );
}
