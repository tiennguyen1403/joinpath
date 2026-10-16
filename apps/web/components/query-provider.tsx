'use client';

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { notificationsQuery } from '@/components/notifications';
import { ApiError } from '@/lib/api';

/** TanStack Query for the pages under it: the app shell's, and the portal's. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      // Any change can bring the one who made it a notification, a task of theirs that opens
      // (BR-N02), so the sidebar and the bell ask again. Not awaited: the change's own
      // callbacks don't wait for it.
      mutationCache: new MutationCache({
        onSuccess: () =>
          void client.invalidateQueries({
            queryKey: notificationsQuery.queryKey,
          }),
      }),
      // An answer from the API stands; only a request that got none is tried again.
      defaultOptions: {
        queries: {
          retry: (failures, error) =>
            !(error instanceof ApiError) && failures < 3,
        },
      },
    });
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
