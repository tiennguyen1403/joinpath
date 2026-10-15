import type { AssigneeRule, TaskDef, TemplateDefinition } from '../template.js';

// Shared by the tests; the build leaves src/test out.

export const HR: AssigneeRule = { kind: 'ROLE', role: 'HR' };
export const IT: AssigneeRule = { kind: 'ROLE', role: 'IT' };
export const MANAGER: AssigneeRule = { kind: 'DIRECT_MANAGER' };

export const task = (key: string, fields: Partial<TaskDef> = {}): TaskDef => ({
  key,
  phase: 'day-1',
  title: key,
  type: 'CHECKLIST',
  assignee: { kind: 'NEW_HIRE' },
  availableOffsetDays: 0,
  dueOffsetDays: 0,
  dependsOn: [],
  ...fields,
});

export const template = (...tasks: TaskDef[]): TemplateDefinition => ({
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks,
});

// "Engineering Onboarding" v2 as drawn on the design canvas. The keys are ours: the canvas never shows them.
const before = 'before-day-1';
export const engineering: TemplateDefinition = {
  phases: [
    { key: before, name: 'Before day 1' },
    { key: 'day-1', name: 'Day 1' },
    { key: 'week-1', name: 'Week 1' },
  ],
  tasks: [
    task('upload-id', {
      phase: before,
      title: 'Upload ID documents',
      type: 'DOCUMENT',
      availableOffsetDays: -14,
      dueOffsetDays: -5,
    }),
    task('review-id', {
      phase: before,
      title: 'Review ID documents',
      type: 'APPROVAL',
      assignee: HR,
      availableOffsetDays: -14,
      dueOffsetDays: -3,
      reviews: 'upload-id',
    }),
    task('sign-handbook', {
      phase: before,
      title: 'Sign the employee handbook',
      availableOffsetDays: -14,
      dueOffsetDays: -3,
    }),
    task('prepare-laptop', {
      phase: before,
      title: 'Prepare laptop',
      assignee: IT,
      availableOffsetDays: -7,
      dueOffsetDays: -3,
    }),
    task('create-accounts', {
      phase: before,
      title: 'Create work accounts',
      assignee: IT,
      availableOffsetDays: -5,
      dueOffsetDays: -3,
      dependsOn: ['review-id'],
    }),
    task('assign-buddy', {
      phase: before,
      title: 'Assign an onboarding buddy',
      assignee: MANAGER,
      availableOffsetDays: -7,
      dueOffsetDays: -4,
    }),
    task('welcome-meeting', { title: 'Welcome meeting', assignee: MANAGER }),
    task('set-up-dev-env', {
      title: 'Set up dev environment',
      dueOffsetDays: 2,
      dependsOn: ['prepare-laptop', 'create-accounts'],
    }),
    task('security-training', {
      title: 'Security awareness training',
      dueOffsetDays: 4,
    }),
    task('ship-first-pr', {
      phase: 'week-1',
      title: 'Ship your first pull request',
      availableOffsetDays: 1,
      dueOffsetDays: 4,
      dependsOn: ['set-up-dev-env'],
    }),
    task('week-one-check-in', {
      phase: 'week-1',
      title: 'Week-one check-in',
      assignee: MANAGER,
      availableOffsetDays: 4,
      dueOffsetDays: 4,
      dependsOn: ['welcome-meeting'],
    }),
  ],
};
