import type { Metadata } from 'next';
import { findNavItem } from '@/lib/nav';
import { requireMe } from '@/lib/session';
import { NewOnboardingButton, OnboardingsTable } from './onboardings-table';

export const metadata: Metadata = { title: 'Onboardings · Joinpath' };

// Every onboarding for HR; for anyone else, "Onboardings I'm in" (PLAN §9).
export default async function OnboardingsPage() {
  const me = await requireMe();
  const hr = me.role === 'HR';
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          {findNavItem(me.role, '/onboardings')!.label}
        </h1>
        {hr && <NewOnboardingButton />}
      </div>
      <OnboardingsTable
        timeZone={me.organization.timezone}
        empty={{
          title: 'No onboardings yet',
          description: hr
            ? 'Onboardings you start show up here.'
            : 'An onboarding shows up here once you have a task in it, or when someone who reports to you starts.',
        }}
      />
    </>
  );
}
