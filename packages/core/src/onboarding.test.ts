import { describe, expect, it } from 'vitest';
import type { IsoDate } from './dates.js';
import {
  availability,
  blockersOf,
  isOverdue,
  planActivation,
  planReschedule,
  type ActivationInput,
  type Availability,
  type PlannedTask,
  type RescheduleInput,
  type TaskStatus,
} from './onboarding.js';
import type { AssigneeRule } from './template.js';
import {
  HR,
  IT,
  MANAGER,
  engineering,
  task,
  template,
} from './test/fixtures.js';

describe('availability', () => {
  const pending = { status: 'PENDING' as const, availableOn: '2026-10-19' };

  it('BR-E01 a task is READY only once the onboarding is active, its date has come and every prerequisite is completed', () => {
    expect(availability(pending, 'ACTIVE', [], '2026-10-19')).toBe('READY');
    expect(
      availability(pending, 'ACTIVE', ['COMPLETED', 'COMPLETED'], '2026-10-20'),
    ).toBe('READY');
    expect(availability(pending, 'ACTIVE', [], '2026-10-18')).toBe(
      'LOCKED_BY_DATE',
    );
    expect(
      availability(
        pending,
        'ACTIVE',
        ['COMPLETED', 'IN_PROGRESS'],
        '2026-10-19',
      ),
    ).toBe('BLOCKED');
    expect(availability(pending, 'DRAFT', [], '2026-10-19')).toBe('INACTIVE');
    // The onboarding is checked first, then the date, then the prerequisites.
    expect(availability(pending, 'CANCELED', ['PENDING'], '2026-10-18')).toBe(
      'INACTIVE',
    );
    expect(availability(pending, 'ACTIVE', ['PENDING'], '2026-10-18')).toBe(
      'LOCKED_BY_DATE',
    );
  });

  it('BR-C02 a finished task keeps its status, whatever else holds', () => {
    expect(
      availability(
        { ...pending, status: 'COMPLETED' },
        'ACTIVE',
        ['IN_PROGRESS'],
        '2026-10-18',
      ),
    ).toBe('COMPLETED');
    expect(
      availability(
        { ...pending, status: 'CANCELED' },
        'CANCELED',
        [],
        '2026-10-19',
      ),
    ).toBe('CANCELED');
  });

  it('BR-S01 a task in progress is never locked by date, even after a later start date', () => {
    expect(
      availability(
        { status: 'IN_PROGRESS', availableOn: '2026-10-26' },
        'ACTIVE',
        [],
        '2026-10-20',
      ),
    ).toBe('READY');
  });
});

describe('isOverdue', () => {
  const due = (status: TaskStatus) => ({ status, dueOn: '2026-10-23' });

  it('BR-E06 a task is overdue once its due date has passed and it is not finished', () => {
    // Due by the end of the day.
    expect(isOverdue(due('PENDING'), '2026-10-23')).toBe(false);
    expect(isOverdue(due('PENDING'), '2026-10-24')).toBe(true);
    expect(isOverdue(due('IN_PROGRESS'), '2026-10-24')).toBe(true);
    expect(isOverdue(due('COMPLETED'), '2026-10-24')).toBe(false);
    expect(isOverdue(due('CANCELED'), '2026-10-24')).toBe(false);
  });

  it('BR-E06 a task can be overdue and blocked at once', () => {
    const late = { ...due('PENDING'), availableOn: '2026-10-21' };
    expect(availability(late, 'ACTIVE', ['IN_PROGRESS'], '2026-10-24')).toBe(
      'BLOCKED',
    );
    expect(isOverdue(late, '2026-10-24')).toBe(true);
  });
});

describe('blockersOf', () => {
  // Bao's open tasks in the seed, two days in: HR's review of the ID holds up IT's accounts,
  // and through them the new hire's first tasks. The laptop is done, so it isn't here.
  const open = (
    id: string,
    availability: Availability,
    dependsOn: string[],
  ) => ({
    id,
    availability,
    dependsOn,
  });
  const review = open('review-id', 'READY', ['upload-id']);
  const accounts = open('create-accounts', 'BLOCKED', ['review-id']);
  const devEnv = open('set-up-dev-env', 'BLOCKED', [
    'prepare-laptop',
    'create-accounts',
  ]);
  const firstPr = open('ship-first-pr', 'BLOCKED', ['set-up-dev-env']);
  const checkIn = open('week-one-check-in', 'LOCKED_BY_DATE', [
    'welcome-meeting',
  ]);
  const tasks = [review, accounts, devEnv, firstPr, checkIn];

  it('FR-19 a blocked task waits on the open task at the start of its chain', () => {
    expect(blockersOf(accounts, tasks)).toEqual([review]);
    expect(blockersOf(devEnv, tasks)).toEqual([review]);
    expect(blockersOf(firstPr, tasks)).toEqual([review]);
  });

  it('FR-19 each chain ends once, at a task ready, under way or waiting for its date', () => {
    const late = open('late', 'BLOCKED', [
      'week-one-check-in',
      'create-accounts',
      'ship-first-pr',
    ]);
    expect(blockersOf(late, [...tasks, late])).toEqual([checkIn, review]);
  });
});

// Ids mean nothing to the core, so names stand in for them. These are the seed org's people:
// An, the new hire, has no account yet; Minh, An's manager, is a MEMBER.
const AN = 'An Vo';
const LAN = 'Lan Pham';
const DUC = 'Duc Tran';
const HUY = 'Huy Le';
const MINH = 'Minh Nguyen';

// The canvas preview: Engineering Onboarding v2 activated on Wed Oct 14 for a start on
// Mon Oct 26, with Duc picked for both IT tasks.
const preview: ActivationInput = {
  definition: engineering,
  startDate: '2026-10-26',
  today: '2026-10-14',
  newHireId: AN,
  managerId: MINH,
  people: [
    { employeeId: LAN, role: 'HR' },
    { employeeId: DUC, role: 'IT' },
    { employeeId: HUY, role: 'IT' },
    { employeeId: MINH, role: 'MEMBER' },
  ],
  assignees: { 'prepare-laptop': DUC, 'create-accounts': DUC },
};

// Right after activation, every task is PENDING.
const fresh = (t: PlannedTask, today: IsoDate) =>
  availability(
    { status: 'PENDING', availableOn: t.availableOn },
    'ACTIVE',
    t.dependsOn.map((): TaskStatus => 'PENDING'),
    today,
  );

describe('planActivation', () => {
  it('BR-A08 copies each task with its phase and order, dated from the start date as the canvas preview shows', () => {
    const plan = planActivation(preview);
    // Phase | Task | Opens | Due | Waits for
    expect(
      plan.map((t) =>
        [
          t.phaseName,
          t.title,
          t.availableOn,
          t.dueOn,
          t.dependsOn.join(', ') || '—',
        ].join(' | '),
      ),
    ).toEqual([
      'Before day 1 | Upload ID documents | 2026-10-12 | 2026-10-21 | —',
      'Before day 1 | Review ID documents | 2026-10-12 | 2026-10-23 | upload-id',
      'Before day 1 | Sign the employee handbook | 2026-10-12 | 2026-10-23 | —',
      'Before day 1 | Prepare laptop | 2026-10-19 | 2026-10-23 | —',
      'Before day 1 | Create work accounts | 2026-10-21 | 2026-10-23 | review-id',
      'Before day 1 | Assign an onboarding buddy | 2026-10-19 | 2026-10-22 | —',
      'Day 1 | Welcome meeting | 2026-10-26 | 2026-10-26 | —',
      'Day 1 | Set up dev environment | 2026-10-26 | 2026-10-28 | prepare-laptop, create-accounts',
      'Day 1 | Security awareness training | 2026-10-26 | 2026-10-30 | —',
      'Week 1 | Ship your first pull request | 2026-10-27 | 2026-10-30 | set-up-dev-env',
      'Week 1 | Week-one check-in | 2026-10-30 | 2026-10-30 | welcome-meeting',
    ]);
    expect(plan.map((t) => t.phaseOrder)).toEqual([
      0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2,
    ]);
    expect(plan.map((t) => t.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(plan[1]).toEqual({
      key: 'review-id',
      phaseKey: 'before-day-1',
      phaseName: 'Before day 1',
      phaseOrder: 0,
      position: 1,
      title: 'Review ID documents',
      type: 'APPROVAL',
      assignee: HR,
      candidates: [LAN],
      assigneeId: LAN,
      reviews: 'upload-id',
      dependsOn: ['upload-id'],
      availableOn: '2026-10-12',
      dueOn: '2026-10-23',
      overdue: false,
    });
    const [described] = planActivation({
      ...preview,
      definition: template(task('a', { description: 'Bring your passport.' })),
    });
    expect(described.description).toBe('Bring your passport.');
  });

  it('BR-A04 resolves every owner as the canvas preview shows', () => {
    // The line under the owner's name in the preview.
    const how = (t: PlannedTask) =>
      t.assignee.kind === 'NEW_HIRE'
        ? 'New hire'
        : t.assignee.kind === 'DIRECT_MANAGER'
          ? 'Direct manager'
          : t.candidates.length === 1
            ? `Only person with ${t.assignee.role}`
            : `${t.assignee.role} · you picked`;
    const plan = planActivation(preview);
    expect(plan.map((t) => `${t.title} | ${t.assigneeId} | ${how(t)}`)).toEqual(
      [
        'Upload ID documents | An Vo | New hire',
        'Review ID documents | Lan Pham | Only person with HR',
        'Sign the employee handbook | An Vo | New hire',
        'Prepare laptop | Duc Tran | IT · you picked',
        'Create work accounts | Duc Tran | IT · you picked',
        'Assign an onboarding buddy | Minh Nguyen | Direct manager',
        'Welcome meeting | Minh Nguyen | Direct manager',
        'Set up dev environment | An Vo | New hire',
        'Security awareness training | An Vo | New hire',
        'Ship your first pull request | An Vo | New hire',
        'Week-one check-in | Minh Nguyen | Direct manager',
      ],
    );
    // "11 tasks are created for 4 people", and nothing stands in the way.
    expect(new Set(plan.map((t) => t.assigneeId)).size).toBe(4);
    expect(plan.filter((t) => t.problem !== undefined)).toEqual([]);
  });

  it('BR-E01 two tasks open on activation day, as the canvas says: Review ID documents waits for the upload', () => {
    const plan = planActivation(preview);
    expect(
      plan
        .filter((t) => fresh(t, preview.today) === 'READY')
        .map((t) => t.title),
    ).toEqual(['Upload ID documents', 'Sign the employee handbook']);
    expect(fresh(plan[1], preview.today)).toBe('BLOCKED');
  });

  it('BR-A04 flags each task the rule finds nobody for, or several people HR has not picked from', () => {
    const plan = planActivation({
      ...preview,
      definition: template(
        task('buddy', { assignee: MANAGER }),
        task('badge', { assignee: HR }),
        task('laptop', { assignee: IT }),
        // A key that is also an Object.prototype property finds no pick.
        task('constructor', { assignee: IT }),
      ),
      managerId: null,
      people: [
        { employeeId: DUC, role: 'IT' },
        { employeeId: HUY, role: 'IT' },
      ],
      assignees: {},
    });
    expect(plan.map((t) => [t.key, t.assigneeId, t.problem])).toEqual([
      ['buddy', null, 'NO_CANDIDATE'], // no manager
      ['badge', null, 'NO_CANDIDATE'], // nobody with HR
      ['laptop', null, 'PICK_NEEDED'], // two people with IT
      ['constructor', null, 'PICK_NEEDED'],
    ]);
  });

  it("BR-A04 HR can hand any task but the new hire's own to someone else with an active account", () => {
    const plan = planActivation({
      ...preview,
      managerId: null,
      // Say An already has an account with IT, having moved over from another team.
      people: [...preview.people, { employeeId: AN, role: 'IT' }],
      assignees: {
        'upload-id': LAN,
        'review-id': DUC,
        'prepare-laptop': DUC,
        'create-accounts': AN,
        'assign-buddy': HUY,
        'welcome-meeting': 'Thu Bui',
      },
    });
    expect(plan.map((t) => [t.key, t.assigneeId, t.problem])).toEqual([
      ['upload-id', null, 'PICK_INVALID'], // the new hire's own task stays theirs
      ['review-id', DUC, undefined], // in place of Lan, the only person with HR
      ['sign-handbook', AN, undefined],
      ['prepare-laptop', DUC, undefined],
      ['create-accounts', null, 'PICK_INVALID'], // not to the new hire, even with IT
      ['assign-buddy', HUY, undefined], // though there is no manager to find
      ['welcome-meeting', null, 'PICK_INVALID'], // Thu has no active account
      ['set-up-dev-env', AN, undefined],
      ['security-training', AN, undefined],
      ['ship-first-pr', AN, undefined],
      ['week-one-check-in', null, 'NO_CANDIDATE'],
    ]);
    // Nor does the rule ever find the new hire.
    expect(plan[3].candidates).toEqual([DUC, HUY]);
  });

  it('BR-A04 a manager without an active account takes no tasks', () => {
    const plan = planActivation({
      ...preview,
      people: preview.people.filter((p) => p.employeeId !== MINH),
    });
    expect(
      plan.filter((t) => t.problem).map((t) => [t.key, t.problem]),
    ).toEqual([
      ['assign-buddy', 'NO_CANDIDATE'],
      ['welcome-meeting', 'NO_CANDIDATE'],
      ['week-one-check-in', 'NO_CANDIDATE'],
    ]);
  });

  it('BR-A06 plans tasks that open later, and marks the ones already past due', () => {
    // Activated on Tue Oct 27, the day after the start date.
    const today = '2026-10-27';
    const plan = planActivation({ ...preview, today });
    expect(plan).toHaveLength(11);
    expect(
      plan
        .filter((t) => fresh(t, today) === 'LOCKED_BY_DATE')
        .map((t) => t.title),
    ).toEqual(['Week-one check-in']);
    expect(plan.filter((t) => t.overdue).map((t) => t.title)).toEqual([
      'Upload ID documents',
      'Review ID documents',
      'Sign the employee handbook',
      'Prepare laptop',
      'Create work accounts',
      'Assign an onboarding buddy',
      'Welcome meeting',
    ]);
  });

  it('BR-R01 an approval never goes to whoever uploads the document it reviews', () => {
    const owners = (
      doc: AssigneeRule,
      review: AssigneeRule,
      input: Partial<ActivationInput>,
    ) =>
      planActivation({
        ...preview,
        definition: template(
          task('doc', { type: 'DOCUMENT', assignee: doc }),
          task('review', {
            type: 'APPROVAL',
            assignee: review,
            reviews: 'doc',
          }),
        ),
        ...input,
      }).map((t) => [t.key, t.assigneeId, t.problem]);
    // Both go to IT, and HR picks Duc for both…
    expect(owners(IT, IT, { assignees: { doc: DUC, review: DUC } })).toEqual([
      ['doc', DUC, undefined],
      ['review', DUC, 'SAME_AS_UPLOADER'],
    ]);
    // …which picking Huy to review puts right.
    expect(owners(IT, IT, { assignees: { doc: DUC, review: HUY } })).toEqual([
      ['doc', DUC, undefined],
      ['review', HUY, undefined],
    ]);
    // The manager uploads, and is also the only person with HR.
    expect(owners(MANAGER, HR, { managerId: LAN })).toEqual([
      ['doc', LAN, undefined],
      ['review', LAN, 'SAME_AS_UPLOADER'],
    ]);
  });

  it('BR-T08 an approval waits for the document it reviews, listed once', () => {
    const [, review] = planActivation({
      ...preview,
      definition: template(
        task('doc', { type: 'DOCUMENT' }),
        task('review', {
          type: 'APPROVAL',
          assignee: HR,
          reviews: 'doc',
          dependsOn: ['doc'],
        }),
      ),
    });
    expect(review.dependsOn).toEqual(['doc']);
  });
});

describe('planReschedule', () => {
  // Engineering Onboarding activated for a start on Mon Oct 26, then moved. Keys stand in for ids.
  const row = (
    key: string,
    status: TaskStatus,
    dueOn: IsoDate,
    dueOverridden = false,
  ) => ({ id: key, definitionKey: key, status, dueOn, dueOverridden });
  const moveTo = (startDate: IsoDate, tasks: RescheduleInput['tasks']) =>
    planReschedule({ definition: engineering, startDate, tasks });
  const moved = (id: string, availableOn: IsoDate, dueOn: IsoDate) => ({
    id,
    availableOn,
    dueOn,
    dueOverridden: false,
    overrideReset: false,
  });

  it('BR-S01 a later or an earlier start date moves both dates of every task not finished, one in progress included', () => {
    const tasks = [
      row('upload-id', 'COMPLETED', '2026-10-21'),
      row('review-id', 'CANCELED', '2026-10-23'),
      row('prepare-laptop', 'IN_PROGRESS', '2026-10-23'),
      row('ship-first-pr', 'PENDING', '2026-10-30'),
    ];
    // A week later. The finished tasks stay as they are.
    expect(moveTo('2026-11-02', tasks)).toEqual([
      moved('prepare-laptop', '2026-10-26', '2026-10-30'),
      moved('ship-first-pr', '2026-11-03', '2026-11-06'),
    ]);
    // Five days sooner: both dates come forward, so each task still opens before it is due.
    expect(moveTo('2026-10-21', tasks)).toEqual([
      moved('prepare-laptop', '2026-10-14', '2026-10-18'),
      moved('ship-first-pr', '2026-10-22', '2026-10-25'),
    ]);
  });

  it('BR-S02 a deadline HR set stays when the start date moves, unless the task would open after it', () => {
    // Due Oct 30 by the template, four days after the start; HR gave until Nov 6.
    const tasks = [
      row('security-training', 'PENDING', '2026-11-06', true),
      row('welcome-meeting', 'PENDING', '2026-10-26'),
    ];
    expect(moveTo('2026-10-21', tasks)).toEqual([
      {
        ...moved('security-training', '2026-10-21', '2026-11-06'),
        dueOverridden: true,
      },
      moved('welcome-meeting', '2026-10-21', '2026-10-21'),
    ]);
    // Opening on the day it is due still keeps it.
    expect(moveTo('2026-11-06', tasks)[0]).toEqual({
      ...moved('security-training', '2026-11-06', '2026-11-06'),
      dueOverridden: true,
    });
    // Opening after it: back to the template's.
    expect(moveTo('2026-11-09', tasks)).toEqual([
      {
        ...moved('security-training', '2026-11-09', '2026-11-13'),
        overrideReset: true,
      },
      moved('welcome-meeting', '2026-11-09', '2026-11-09'),
    ]);
  });
});
