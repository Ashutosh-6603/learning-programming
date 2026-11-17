import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachmentsApi, tasksApi, workspacesApi } from '@/lib/api/endpoints';
import type { Board, UpdateTaskBody } from '@/lib/api/types';
import { removeTask, upsertTask } from '@/lib/board-cache';
import { uploadAttachment } from '@/lib/uploads';
import { keys } from './keys';

export const useTask = (taskId: string | null) =>
  useQuery({
    queryKey: keys.task(taskId ?? ''),
    queryFn: () => tasksApi.get(taskId ?? ''),
    enabled: taskId !== null,
  });

export function useUpdateTask(projectId: string, workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskId: string; changes: UpdateTaskBody }) =>
      tasksApi.update(vars.taskId, vars.changes),
    onSuccess: (task) => {
      qc.setQueryData(keys.task(task.id), task);
      qc.setQueryData<Board>(keys.board(projectId), (b) => (b ? upsertTask(b, task) : b));
      void qc.invalidateQueries({ queryKey: keys.activity(workspaceId, task.id) });
    },
  });
}

export function useDeleteTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.remove(taskId),
    onSuccess: (_void, taskId) => {
      qc.setQueryData<Board>(keys.board(projectId), (b) => (b ? removeTask(b, taskId) : b));
      qc.removeQueries({ queryKey: keys.task(taskId) });
    },
  });
}

export const useComments = (taskId: string) =>
  useQuery({ queryKey: keys.comments(taskId), queryFn: () => tasksApi.comments(taskId) });

export function useAddComment(taskId: string, workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => tasksApi.comment(taskId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.comments(taskId) });
      void qc.invalidateQueries({ queryKey: keys.activity(workspaceId, taskId) });
    },
  });
}

export const useActivity = (workspaceId: string, taskId: string) =>
  useQuery({
    queryKey: keys.activity(workspaceId, taskId),
    queryFn: () => workspacesApi.activity(workspaceId, { taskId }),
  });

export const useAttachments = (taskId: string) =>
  useQuery({ queryKey: keys.attachments(taskId), queryFn: () => attachmentsApi.list(taskId) });

export function useAttachmentMutations(taskId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.attachments(taskId) });
  return {
    upload: useMutation({
      mutationFn: (file: File) => uploadAttachment(taskId, file),
      onSettled: refresh,
    }),
    remove: useMutation({ mutationFn: attachmentsApi.remove, onSettled: refresh }),
  };
}
