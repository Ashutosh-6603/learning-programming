import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi, workspacesApi } from '@/lib/api/endpoints';
import { keys } from './keys';

/** Cursor pagination: each page carries the cursor for the next; null means the end. */
export const useWorkspaces = () =>
  useInfiniteQuery({
    queryKey: keys.workspaces,
    queryFn: ({ pageParam }) => workspacesApi.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useWorkspace = (id: string) =>
  useQuery({ queryKey: keys.workspace(id), queryFn: () => workspacesApi.get(id) });

export const useProjects = (workspaceId: string) =>
  useQuery({ queryKey: keys.projects(workspaceId), queryFn: () => projectsApi.list(workspaceId) });

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; key: string; description?: string | null }) =>
      projectsApi.create(workspaceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects(workspaceId) }),
  });
}
