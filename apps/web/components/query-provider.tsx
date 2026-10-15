'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ApiError } from '@/lib/api';

/** TanStack Query for the pages under it: the app shell's, and the portal's. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // An answer from the API stands; only a request that got none is tried again.
        defaultOptions: {
          queries: {
            retry: (failures, error) =>
              !(error instanceof ApiError) && failures < 3,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
