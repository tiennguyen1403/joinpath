import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { Wizard } from '../wizard';

export const metadata: Metadata = { title: 'New onboarding · Joinpath' };

// Only HR starts an onboarding (PLAN §9).
export default async function NewOnboardingPage() {
  const me = await requireMe();
  if (me.role !== 'HR') redirect('/onboardings');
  return (
    <Wizard
      orgName={me.organization.name}
      today={me.organization.today}
      timeZone={me.organization.timezone}
    />
  );
}
