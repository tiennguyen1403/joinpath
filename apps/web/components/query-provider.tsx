'use client';

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { notificationsQuery } from '@/components/notifications';
import { ApiError } from '@/lib/api';

/** TanStack Query for the pages under it: the app shell's, the portal's and the mock inbox. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      // Any change can bring the one who made it a notification, a task of theirs that opens
      // (BR-N02), so the sidebar and the bell ask again; and it goes on its onboarding's
      // timeline, which asks again too. Not awaited: the change's own callbacks don't wait for
      // it. The server's part of the page renders again too, for a fresh `me`: in a sandbox,
      // an activation moves the demo island's next start date.
      mutationCache: new MutationCache({
        onSuccess: () => {
          void client.invalidateQueries({
            queryKey: notificationsQuery.queryKey,
          });
          void client.invalidateQueries({ queryKey: ['activity'] });
          router.refresh();
        },
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
