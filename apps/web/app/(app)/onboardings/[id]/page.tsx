import type { Metadata } from 'next';
import { requireMe } from '@/lib/session';
import { OnboardingView } from './onboarding-view';

export const metadata: Metadata = { title: 'Onboarding · Joinpath' };

export default async function OnboardingPage({
  params,
}: PageProps<'/onboardings/[id]'>) {
  const [{ id }, me] = await Promise.all([params, requireMe()]);
  return (
    <OnboardingView
      id={id}
      orgName={me.organization.name}
      timeZone={me.organization.timezone}
      hr={me.role === 'HR'}
    />
  );
}
