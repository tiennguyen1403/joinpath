import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { firstName } from '@/lib/format';
import { homeFor } from '@/lib/nav';
import { requireMe } from '@/lib/session';
import { Dashboard } from './dashboard';

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

// HR's home.
export default async function DashboardPage() {
  const me = await requireMe();
  if (me.role !== 'HR') redirect(homeFor(me));
  return (
    <Dashboard
      greeting={`Good ${partOfDay(me.organization.timezone)}, ${firstName(me.employee.fullName)}`}
      employeeId={me.employee.id}
      timeZone={me.organization.timezone}
    />
  );
}
