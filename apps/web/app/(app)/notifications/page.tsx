import type { Metadata } from 'next';
import { NotificationsView } from '@/components/notifications';
import { requireMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Notifications · Joinpath' };

export default async function NotificationsPage() {
  const me = await requireMe();
  return <NotificationsView timeZone={me.organization.timezone} />;
}
