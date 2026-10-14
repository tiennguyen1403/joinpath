import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { findNavItem } from '@/lib/nav';
import { requireMe } from '@/lib/session';

// Sidebar pages that later sessions build; each one then gets its own route folder.
export default async function SectionPage({ params }: PageProps<'/[section]'>) {
  const { section } = await params;
  const item = findNavItem((await requireMe()).role, `/${section}`);
  if (!item) notFound();
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{item.label}</h1>
      <EmptyState
        title="Coming soon"
        description="This part of Joinpath is still being built."
      />
    </>
  );
}
