import type {
  Department,
  OnboardingStatus,
  OnboardingSummary,
} from '@joinpath/core';
import { describe, expect, it } from 'vitest';
import { byDepartment } from './by-department';

const department = (name: string): Department => ({
  id: crypto.randomUUID(),
  name,
});
const engineering = department('Engineering');
const people = department('People Operations');
const itDepartment = department('IT');
const design = department('Design');

const onboarding = (
  status: OnboardingStatus,
  of: Department | null,
): OnboardingSummary => ({
  id: crypto.randomUUID(),
  status,
  startDate: '2026-10-19',
  activatedAt: null,
  completedAt: null,
  canceledAt: null,
  employee: {
    id: crypto.randomUUID(),
    fullName: 'New Hire',
    email: 'new.hire@acme.test',
    jobTitle: 'Engineer',
    department: of,
    manager: null,
  },
  template: {
    id: crypto.randomUUID(),
    name: 'Engineering Onboarding',
    archivedAt: null,
  },
  templateVersion: { id: crypto.randomUUID(), version: 2 },
  progress: { completed: 0, total: 0, overdue: 0 },
  nextTask: null,
});

// "Engineering 3: DRAFT 1, ACTIVE 1, COMPLETED 1", one line per row.
const rows = (onboardings: OnboardingSummary[]) =>
  byDepartment(onboardings).map(
    ({ department, total, counts }) =>
      `${department?.name ?? 'none'} ${total}: ${counts
        .map(({ status, count }) => `${status} ${count}`)
        .join(', ')}`,
  );

describe('byDepartment', () => {
  it('FR-24 counts the seed’s onboardings, all in Engineering, by status in the order of an onboarding’s life', () => {
    expect(
      rows([
        onboarding('COMPLETED', engineering), // Chi
        onboarding('ACTIVE', engineering), // Bao
        onboarding('DRAFT', engineering), // An
      ]),
    ).toEqual(['Engineering 3: DRAFT 1, ACTIVE 1, COMPLETED 1']);
  });

  it('FR-24 puts the most onboardings first, then by name, and new hires with no department last', () => {
    expect(
      rows([
        onboarding('DRAFT', null),
        onboarding('CANCELED', engineering),
        onboarding('COMPLETED', itDepartment),
        onboarding('ACTIVE', people),
        onboarding('COMPLETED', engineering),
        onboarding('DRAFT', null),
        onboarding('ACTIVE', engineering),
        onboarding('COMPLETED', people),
        onboarding('ACTIVE', design),
        onboarding('CANCELED', null),
        onboarding('DRAFT', engineering),
        onboarding('ACTIVE', engineering),
      ]),
    ).toEqual([
      'Engineering 5: DRAFT 1, ACTIVE 2, COMPLETED 1, CANCELED 1',
      'People Operations 2: ACTIVE 1, COMPLETED 1',
      'Design 1: ACTIVE 1',
      'IT 1: COMPLETED 1',
      'none 3: DRAFT 2, CANCELED 1',
    ]);
  });

  it('FR-24 has no row without an onboarding', () => {
    expect(byDepartment([])).toEqual([]);
  });
});
