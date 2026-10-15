import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { EmployeeForm } from '../employee-form';

export const metadata: Metadata = { title: 'New employee · Joinpath' };

// Employee records are HR's (PLAN §9).
export default async function NewEmployeePage() {
  const me = await requireMe();
  if (me.role !== 'HR') notFound();
  return <EmployeeForm emailDomain={me.organization.emailDomain} />;
}
