import type { ActivityEvent } from '@/lib/api/types';
import { timeAgo } from '@/lib/format';
import { useActivity } from '@/lib/queries/tasks';

const VERBS: Record<string, string> = {
  'task.created': 'created this task',
  'task.updated': 'updated',
  'task.moved': 'moved this task',
  'comment.created': 'commented',
  'comment.updated': 'edited a comment',
  'comment.deleted': 'deleted a comment',
  'attachment.added': 'attached a file',
  'attachment.deleted': 'removed a file',
};

function describe(event: ActivityEvent): string {
  const verb = VERBS[event.type] ?? event.type;
  if (event.type === 'task.updated') {
    const changes = event.data.changes;
    if (changes && typeof changes === 'object') return `${verb} ${Object.keys(changes).join(', ')}`;
  }
  return verb;
}

export function TaskActivity({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const activity = useActivity(workspaceId, taskId);
  if (activity.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <ol className="flex flex-col gap-3 border-l border-white/10 pl-4">
      {activity.data?.items.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span
            aria-hidden="true"
            className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary"
          />
          <span className="font-semibold">{e.actor.displayName}</span> {describe(e)}{' '}
          <time dateTime={e.createdAt} className="text-xs text-muted-foreground">
            {timeAgo(e.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
