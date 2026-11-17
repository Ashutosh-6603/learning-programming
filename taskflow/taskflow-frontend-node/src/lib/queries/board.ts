import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi, tasksApi, type CreateTaskBody } from '@/lib/api/endpoints';
import type { Board } from '@/lib/api/types';
import { moveTask, upsertTask } from '@/lib/board-cache';
import { keys } from './keys';

export const useBoard = (projectId: string) =>
  useQuery({ queryKey: keys.board(projectId), queryFn: () => projectsApi.board(projectId) });

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => tasksApi.create(projectId, body),
    onSuccess: (task) => {
      qc.setQueryData<Board>(keys.board(projectId), (b) => (b ? upsertTask(b, task) : b));
    },
  });
}

/**
 * Drag-and-drop with an optimistic update: the card moves instantly, the server's answer
 * replaces it with the real position, and an error puts the board back.
 */
export function useMoveTask(projectId: string) {
  const qc = useQueryClient();
  const key = keys.board(projectId);
  return useMutation({
    mutationFn: (vars: { taskId: string; columnId: string; afterTaskId: string | null }) =>
      tasksApi.move(vars.taskId, { columnId: vars.columnId, afterTaskId: vars.afterTaskId }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Board>(key);
      if (previous) {
        qc.setQueryData(key, moveTask(previous, vars.taskId, vars.columnId, vars.afterTaskId));
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (task) => {
      qc.setQueryData<Board>(key, (b) => (b ? upsertTask(b, task) : b));
      qc.setQueryData(keys.task(task.id), task);
    },
  });
}
