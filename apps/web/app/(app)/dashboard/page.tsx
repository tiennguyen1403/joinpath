import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { homeFor } from '@/lib/nav';
import { requireMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard · Joinpath' };

// Morning or evening where the company is (PLAN §4.6), not where the server runs.
function partOfDay(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date()),
  );
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

// HR's home. Stats, attention list and the onboardings table arrive with data in M3.4.
export default async function DashboardPage() {
  const me = await requireMe();
  if (me.role !== 'HR') redirect(homeFor(me.role));
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Good {partOfDay(me.organization.timezone)},{' '}
        {me.employee.fullName.split(' ')[0]}
      </h1>
      <EmptyState
        title="No onboardings yet"
        description="Onboardings you start show up here, along with anything that needs your attention."
      />
    </>
  );
}
