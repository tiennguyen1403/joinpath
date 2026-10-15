import {
  type AssigneeRule,
  type TaskDef,
  type TemplateDefinition,
  templateDefinitionSchema,
  validateTemplate,
} from '@joinpath/core';

// Templates every demo org starts with (PLAN §11). Engineering v2 is the design canvas's
// template, copied from packages/core/src/test/fixtures.ts.

const HR: AssigneeRule = { kind: 'ROLE', role: 'HR' };
const IT: AssigneeRule = { kind: 'ROLE', role: 'IT' };
const MANAGER: AssigneeRule = { kind: 'DIRECT_MANAGER' };

const task = (key: string, fields: Partial<TaskDef> = {}): TaskDef => ({
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

const before = 'before-day-1';
const engineering: TemplateDefinition = {
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

const without = (
  def: TemplateDefinition,
  ...keys: string[]
): TemplateDefinition => ({
  ...def,
  tasks: def.tasks.filter(({ key }) => !keys.includes(key)),
});

/** Each version is PUBLISHED, oldest first. */
export const seedTemplates = [
  {
    name: 'Engineering Onboarding',
    description:
      'For engineers joining the product team: documents, laptop, accounts, dev environment and a first pull request.',
    // v1 came before security training. The canvas has Bao Ho on v1 at 5/10.
    versions: [without(engineering, 'security-training'), engineering],
  },
  {
    name: 'General Onboarding',
    description: 'The company-wide basics for every new hire.',
    versions: [
      without(engineering, 'assign-buddy', 'set-up-dev-env', 'ship-first-pr'),
    ],
  },
];

// The seed writes these as PUBLISHED and so skips the publish check (BR-T03): run it here.
for (const { name, versions } of seedTemplates) {
  for (const definition of versions) {
    const [issue] = validateTemplate(
      templateDefinitionSchema.parse(definition),
    );
    if (issue) throw new Error(`Seed template ${name}: ${issue.message}`);
  }
}
