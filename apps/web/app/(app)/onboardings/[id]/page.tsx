import { EmptyState } from '@/components/empty-state';

// Until M1.6b and M1.7 build them: the wizard at /onboardings/new, an onboarding's page here.
export default async function OnboardingPage({
  params,
}: PageProps<'/onboardings/[id]'>) {
  const { id } = await params;
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {id === 'new' ? 'New onboarding' : 'Onboarding'}
      </h1>
      <EmptyState
        title="Coming soon"
        description="This part of Joinpath is still being built."
      />
    </>
  );
}
