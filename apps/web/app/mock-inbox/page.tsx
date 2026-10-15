import type { Metadata } from 'next';
import { homeFor } from '@/lib/nav';
import { requireMe } from '@/lib/session';
import { MockInbox } from './mock-inbox';

export const metadata: Metadata = { title: 'Mock inbox · Joinpath' };

// Outside the app shell, as the canvas draws it: the inbox stands in for each person's mail.
export default async function MockInboxPage() {
  const me = await requireMe();
  return (
    <MockInbox
      home={homeFor(me.role)}
      orgName={me.organization.name}
      timeZone={me.organization.timezone}
    />
  );
}
