import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { QueryProvider } from '@/components/query-provider';
import { homeFor } from '@/lib/nav';
import { requireMe } from '@/lib/session';
import { Portal } from './portal';

export const metadata: Metadata = { title: 'Your onboarding · Joinpath' };

// The new hire's portal, outside the app shell as the canvas draws it (PLAN §10). Anyone with
// no onboarding of their own goes to their usual page.
export default async function PortalPage() {
  const me = await requireMe();
  if (!me.onboardingId) redirect(homeFor(me));
  return (
    <QueryProvider>
      <Portal me={me} />
    </QueryProvider>
  );
}
