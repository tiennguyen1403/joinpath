import {
  type Department,
  type OnboardingStatus,
  type OnboardingSummary,
  onboardingStatusSchema,
} from '@joinpath/core';

/** A department's onboardings by status (FR-24): null for new hires with no department. */
export type DepartmentCounts = {
  department: Department | null;
  total: number;
  // Only the statuses it has, in the order of an onboarding's life: a draft first.
  counts: { status: OnboardingStatus; count: number }[];
};

/**
 * Every onboarding by its new hire's department as it is now, the most onboardings first, then
 * by name; new hires with no department last. A department nobody is onboarded in has no row.
 */
export function byDepartment(
  onboardings: OnboardingSummary[],
): DepartmentCounts[] {
  const groups = new Map<string | undefined, OnboardingSummary[]>();
  for (const onboarding of onboardings) {
    const id = onboarding.employee.department?.id;
    groups.set(id, [...(groups.get(id) ?? []), onboarding]);
  }
  return [...groups.values()]
    .map((group) => ({
      department: group[0]!.employee.department,
      total: group.length,
      counts: onboardingStatusSchema.options.flatMap((status) => {
        const count = group.filter((row) => row.status === status).length;
        return count ? [{ status, count }] : [];
      }),
    }))
    .sort((a, b) =>
      a.department && b.department
        ? b.total - a.total ||
          a.department.name.localeCompare(b.department.name)
        : Number(!a.department) - Number(!b.department),
    );
}
