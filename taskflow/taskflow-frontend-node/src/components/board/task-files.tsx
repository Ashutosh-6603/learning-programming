import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useRef, type ChangeEvent } from 'react';
import { attachmentsApi } from '@/lib/api/endpoints';
import { formatBytes } from '@/lib/format';
import { useAttachmentMutations, useAttachments } from '@/lib/queries/tasks';
import { MAX_UPLOAD_BYTES } from '@/lib/uploads';
import { toastError, useToasts } from '@/stores/toasts';

export function TaskFiles({ taskId, canUpload }: { taskId: string; canUpload: boolean }) {
  const files = useAttachments(taskId);
  const { upload, remove } = useAttachmentMutations(taskId);
  const input = useRef<HTMLInputElement>(null);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      useToasts
        .getState()
        .push({ title: 'File too large', description: 'Attachments can be at most 25 MB.' });
      return;
    }
    upload.mutate(file, {
      onError: (err) => {
        toastError(err, 'Uploading');
      },
    });
  };

  const download = async (id: string) => {
    try {
      // The URL is presigned and expires in 5 minutes, so fetch it on click, not on render.
      window.location.assign((await attachmentsApi.download(id)).url);
    } catch (err) {
      toastError(err, 'Downloading');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {files.data?.items.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-[14px] bg-white/4 px-3 py-2">
            <Paperclip aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{a.fileName}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
            <button
              type="button"
              aria-label={`Download ${a.fileName}`}
              onClick={() => void download(a.id)}
              className="grid size-8 place-items-center rounded-lg hover:bg-white/8"
            >
              <Download className="size-4" />
            </button>
            {canUpload ? (
              <button
                type="button"
                aria-label={`Delete ${a.fileName}`}
                onClick={() => {
                  remove.mutate(a.id, {
                    onError: (err) => {
                      toastError(err, 'Deleting the file');
                    },
                  });
                }}
                className="grid size-8 place-items-center rounded-lg hover:bg-white/8"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {files.data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : null}
      {canUpload ? (
        <>
          <input
            ref={input}
            type="file"
            className="sr-only"
            aria-label="Choose a file"
            onChange={onPick}
            tabIndex={-1}
          />
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
            className="self-start rounded-xl border border-dashed border-primary/45 px-4 py-2 text-sm hover:bg-white/6 disabled:opacity-50"
          >
            {upload.isPending ? 'Uploading…' : 'Attach a file'}
          </button>
        </>
      ) : null}
    </div>
  );
}
