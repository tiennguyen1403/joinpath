import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { TemplateView } from './template-view';

export const metadata: Metadata = { title: 'Template · Joinpath' };

// HR's alone, like the list (PLAN §8, §9).
export default async function TemplatePage({
  params,
}: PageProps<'/templates/[id]'>) {
  const [{ id }, me] = await Promise.all([params, requireMe()]);
  if (me.role !== 'HR') notFound();
  return <TemplateView id={id} timeZone={me.organization.timezone} />;
}
