import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 4xx can't change the answer; retry only network errors and 5xx, twice.
      retry: (failures, err) =>
        failures < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
  },
});
