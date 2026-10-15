import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { EmployeeForm } from '../employee-form';

export const metadata: Metadata = { title: 'Employee · Joinpath' };

// Employee records are HR's (PLAN §9).
export default async function EmployeePage({
  params,
}: PageProps<'/employees/[id]'>) {
  const [{ id }, me] = await Promise.all([params, requireMe()]);
  if (me.role !== 'HR') notFound();
  return <EmployeeForm id={id} emailDomain={me.organization.emailDomain} />;
}
