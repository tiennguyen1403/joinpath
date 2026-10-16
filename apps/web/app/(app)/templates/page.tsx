import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { NewTemplateButton, Templates } from './templates';

export const metadata: Metadata = { title: 'Templates · Joinpath' };

// Templates are HR's, even to read (PLAN §8, §9). A row opens the template's editor.
export default async function TemplatesPage() {
  const me = await requireMe();
  if (me.role !== 'HR') notFound();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-[1_1_420px] flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Templates</h1>
          <p className="leading-[23px] text-muted-foreground">
            New onboardings start from a template&apos;s current version.
            Running onboardings keep the version they started with.
          </p>
        </div>
        <NewTemplateButton />
      </div>
      <Templates timeZone={me.organization.timezone} />
    </>
  );
}
