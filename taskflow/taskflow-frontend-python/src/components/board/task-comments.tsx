import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Avatar } from '@/components/orbit/badges';
import { timeAgo } from '@/lib/format';
import { applyProblem } from '@/lib/forms';
import { useAddComment, useComments } from '@/lib/queries/tasks';
import { commentSchema, type CommentValues } from '@/lib/schemas';
import { toastError } from '@/stores/toasts';

export function TaskComments({
  taskId,
  workspaceId,
  canComment,
}: {
  taskId: string;
  workspaceId: string;
  canComment: boolean;
}) {
  const comments = useComments(taskId);
  const add = useAddComment(taskId, workspaceId);
  const form = useForm<CommentValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await add.mutateAsync(values.body);
      form.reset();
    } catch (err) {
      const message = applyProblem(err, ['body'], form.setError);
      if (message) toastError(err, 'Posting the comment');
    }
  });

  return (
    <div className="flex flex-col gap-4">
      {comments.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {comments.data?.items.map((c) => (
          <li key={c.id} className="flex gap-3">
            <Avatar user={c.author} size={30} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm">
                <span className="font-semibold">{c.author.displayName}</span>{' '}
                <time dateTime={c.createdAt} className="text-xs text-muted-foreground">
                  {timeAgo(c.createdAt)}
                </time>
              </span>
              <p className="text-sm whitespace-pre-wrap text-[#c9cfdb]">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {canComment ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
          <label htmlFor="comment-body" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="comment-body"
            rows={3}
            placeholder="Add a comment"
            aria-invalid={form.formState.errors.body ? true : undefined}
            className="rounded-[14px] border border-input bg-background/60 p-3 outline-none focus-visible:border-primary"
            {...form.register('body')}
          />
          {form.formState.errors.body ? (
            <span className="text-sm text-coral">{form.formState.errors.body.message}</span>
          ) : null}
          <button
            type="submit"
            disabled={form.formState.isSubmitting}
            className="self-end rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
          >
            Comment
          </button>
        </form>
      ) : null}
    </div>
  );
}
