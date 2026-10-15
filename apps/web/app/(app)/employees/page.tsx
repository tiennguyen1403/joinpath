import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Plus } from 'reicon-react';
import { ButtonLink } from '@/components/beui/motion/button/base';
import { requireMe } from '@/lib/session';
import { Employees } from './employees';

export const metadata: Metadata = { title: 'Employees · Joinpath' };

// Employee records and departments are HR's (PLAN §9).
export default async function EmployeesPage() {
  const me = await requireMe();
  if (me.role !== 'HR') notFound();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Employees</h1>
        <ButtonLink
          href="/employees/new"
          className="bg-primary-strong hover:bg-primary-strong/90"
        >
          <Plus className="size-4" />
          New employee
        </ButtonLink>
      </div>
      <Employees />
    </>
  );
}
