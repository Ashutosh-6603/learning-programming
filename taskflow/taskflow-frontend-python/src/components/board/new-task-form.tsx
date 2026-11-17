import { Plus } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useCreateTask } from '@/lib/queries/board';
import { toastError } from '@/stores/toasts';

export function NewTaskForm({ projectId, columnId }: { projectId: string; columnId: string }) {
  const [title, setTitle] = useState('');
  const create = useCreateTask(projectId);

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate(
      { title: trimmed, columnId },
      {
        onSuccess: () => {
          setTitle('');
        },
        onError: (err) => {
          toastError(err, 'Creating the task');
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <label htmlFor={`new-task-${columnId}`} className="sr-only">
        New task title
      </label>
      <input
        id={`new-task-${columnId}`}
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
        placeholder="Launch a new task"
        className="h-11 min-w-0 flex-1 rounded-[14px] border border-dashed border-primary/45 bg-transparent px-3 outline-none focus-visible:border-primary"
      />
      <button
        type="submit"
        aria-label="Add task"
        disabled={create.isPending}
        className="grid size-11 flex-none place-items-center rounded-[14px] bg-primary text-primary-foreground transition-transform hover:-translate-y-0.5"
      >
        <Plus className="size-[18px]" strokeWidth={2.6} />
      </button>
    </form>
  );
}
