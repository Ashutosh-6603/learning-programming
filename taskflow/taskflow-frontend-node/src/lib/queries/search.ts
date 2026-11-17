import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '@/lib/api/endpoints';
import { keys } from './keys';

export const useSearch = (workspaceId: string, q: string) =>
  useQuery({
    queryKey: keys.search(workspaceId, q),
    queryFn: () => workspacesApi.search(workspaceId, q),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });
