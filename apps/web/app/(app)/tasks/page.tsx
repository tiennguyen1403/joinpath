import type { Metadata } from 'next';
import { requireMe } from '@/lib/session';
import { MyTasks } from './my-tasks';

export const metadata: Metadata = { title: 'My tasks · Joinpath' };

export default async function TasksPage() {
  const me = await requireMe();
  return (
    <MyTasks employeeId={me.employee.id} timeZone={me.organization.timezone} />
  );
}
