import type { Metadata } from 'next';
import { QueryProvider } from '@/components/query-provider';
import { requireMe } from '@/lib/session';
import { MockInbox } from './mock-inbox';

export const metadata: Metadata = { title: 'Mock inbox · Joinpath' };

// Outside the app shell, as the canvas draws it: the inbox stands in for each person's mail.
export default async function MockInboxPage() {
  const me = await requireMe();
  return (
    <QueryProvider>
      <MockInbox me={me} />
    </QueryProvider>
  );
}
