import type { INestApplication } from '@nestjs/common';
import {
  type ActivityEvent,
  activityEventSchema,
  addDays,
  dashboardSchema,
  SESSION_COOKIE,
  today,
} from '@joinpath/core';
import type { App } from 'supertest/types.js';
import { createSession } from '../src/modules/auth/auth.service.js';
import { handlersFor, purgeOrg } from '../src/modules/demo/sandbox.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import { PrismaService } from '../src/prisma.js';
import {
  type Client,
  clientFor,
  createApp,
  errorOf,
  newSlug,
  PASSWORD,
} from './app.js';

// What an event says, in a line: who did what, to which task.
const lineOf = ({ action, actor, task }: ActivityEvent) =>
  [action, actor?.fullName ?? null, task?.title ?? null] as const;

describe('dashboard and activity', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // An org with onboardings A, B and C (PLAN §11), as Try demo seeds them, and another company.
  let organizationId: string;
  let timezone: string;
  let otherId: string;
  // A drafted, B stuck on HR's review, C done.
  const onboardingOf: Record<string, string> = {};
  // The business date, `offset` days on, while the demo clock is untouched.
  let day: (offset: number) => string;

  // Signed in as anyone in an org, new hires included, whose passwords nobody knows.
  const as = async (fullName: string, org = organizationId) => {
    const { id } = await prisma.user.findFirstOrThrow({
      where: { organizationId: org, employee: { fullName } },
      select: { id: true },
    });
    return clientFor(
      app,
      `${SESSION_COOKIE}=${await createSession(prisma, id)}`,
    );
  };
  const dashboardOf = async (client: Client) =>
    dashboardSchema.parse((await client.get('/dashboard').expect(200)).body);
  const activityOf = async (client: Client, fullName: string) =>
    activityEventSchema
      .array()
      .parse(
        (
          await client
            .get(`/onboardings/${onboardingOf[fullName]}/activity`)
            .expect(200)
        ).body,
      );

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    const { organization } = await seedDemoOrg(prisma, {
      slug: newSlug(),
      password: PASSWORD,
      scenarios: handlersFor(prisma),
    });
    organizationId = organization.id;
    timezone = organization.timezone;
    day = (offset) => addDays(today(timezone, 0, new Date()), offset);
    for (const { id, employee } of await prisma.onboarding.findMany({
      where: { organizationId },
      select: { id: true, employee: { select: { fullName: true } } },
    })) {
      onboardingOf[employee.fullName] = id;
    }
    otherId = (
      await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD })
    ).organization.id;
  }, 30_000);

  afterAll(async () => {
    await purgeOrg(prisma, organizationId);
    await purgeOrg(prisma, otherId);
    await app.close();
  });

  it("FR-19 HR's dashboard: the running onboarding and the draft, with the tasks the draft would leave without an owner; the open tasks, overdue or blocked by today; the newest of what happened", async () => {
    const lan = await as('Lan Pham');
    const dashboard = await dashboardOf(lan);
    expect(dashboard.today).toBe(day(0));

    // B started two days ago; A starts in five, IT's two tasks for HR to hand out (two
    // people could take them). C is done, so off it.
    expect(
      dashboard.onboardings.map(
        ({ employee, status, startDate, templateVersion, unassigned }) => ({
          name: employee.fullName,
          status,
          startDate,
          version: templateVersion.version,
          unassigned,
        }),
      ),
    ).toEqual([
      {
        name: 'Bao Ho',
        status: 'ACTIVE',
        startDate: day(-2),
        version: 1,
        unassigned: [],
      },
      {
        name: 'An Vo',
        status: 'DRAFT',
        startDate: day(5),
        version: 2,
        unassigned: [
          { title: 'Prepare laptop', assignee: { kind: 'ROLE', role: 'IT' } },
          {
            title: 'Create work accounts',
            assignee: { kind: 'ROLE', role: 'IT' },
          },
        ],
      },
    ]);

    // B's open tasks by due date: HR's review is overdue, and what waits on it is blocked.
    const bao = onboardingOf['Bao Ho'];
    expect(
      dashboard.tasks.map(
        ({ title, assignee, availability, overdue, dueOn, onboardingId }) => [
          title,
          assignee.fullName,
          availability,
          overdue,
          dueOn,
          onboardingId === bao,
        ],
      ),
    ).toEqual([
      ['Review ID documents', 'Lan Pham', 'READY', true, day(-5), true],
      ['Create work accounts', 'Huy Le', 'BLOCKED', true, day(-5), true],
      ['Set up dev environment', 'Bao Ho', 'BLOCKED', false, day(0), true],
      [
        'Ship your first pull request',
        'Bao Ho',
        'BLOCKED',
        false,
        day(2),
        true,
      ],
      [
        'Week-one check-in',
        'Minh Nguyen',
        'LOCKED_BY_DATE',
        false,
        day(2),
        true,
      ],
    ]);
    const [review, accounts, devEnv] = dashboard.tasks;
    expect(accounts.dependsOn).toEqual([review.id]);
    expect(devEnv.dependsOn).toHaveLength(2);
    // When the ID documents under review came in; nothing to say for any other task.
    const { submittedAt } = await prisma.documentSubmission.findFirstOrThrow({
      where: { task: { onboardingId: bao, definitionKey: 'upload-id' } },
    });
    expect(review).toMatchObject({
      type: 'APPROVAL',
      reviewsTaskId: expect.any(String),
      submittedAt: submittedAt.toISOString(),
    });
    expect(
      dashboard.tasks.slice(1).every((task) => task.submittedAt === null),
    ).toBe(true);

    // The org's ten newest events: A drafted last, after B's story; no file events.
    expect(dashboard.activity.map(lineOf)).toEqual([
      ['onboarding.created', 'Lan Pham', null],
      ['task.completed', 'Minh Nguyen', 'Welcome meeting'],
      ['task.completed', 'Minh Nguyen', 'Assign an onboarding buddy'],
      ['task.completed', 'Huy Le', 'Prepare laptop'],
      ['task.completed', 'Bao Ho', 'Sign the employee handbook'],
      ['document.submitted', 'Bao Ho', 'Upload ID documents'],
      ['invitation.accepted', 'Bao Ho', null],
      ['invitation.sent', 'Lan Pham', null],
      ['onboarding.activated', 'Lan Pham', null],
      ['onboarding.created', 'Lan Pham', null],
    ]);
    expect(
      dashboard.activity.map(({ onboarding }) => onboarding.employee.fullName),
    ).toEqual(['An Vo', ...Array<string>(9).fill('Bao Ho')]);
    expect(dashboard.activity[5]).toMatchObject({ revision: 1 });
    // HR's picks go with the activation: IT's two tasks, both to Huy.
    expect(dashboard.activity[8]).toMatchObject({
      version: 1,
      taskCount: 10,
      picks: [
        { task: { title: 'Prepare laptop' }, assignee: { fullName: 'Huy Le' } },
        {
          task: { title: 'Create work accounts' },
          assignee: { fullName: 'Huy Le' },
        },
      ],
    });
  });

  it('FR-19 the dashboard is for HR only', async () => {
    for (const fullName of ['Minh Nguyen', 'Duc Tran', 'Bao Ho']) {
      const res = await (await as(fullName)).get('/dashboard').expect(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
  });

  it("FR-19 BR-P03 an onboarding's activity, newest first, for whoever sees the onboarding: revisions and decisions only for those who see its files", async () => {
    const lan = await as('Lan Pham');
    const baoStory = [
      ['task.completed', 'Minh Nguyen', 'Welcome meeting'],
      ['task.completed', 'Minh Nguyen', 'Assign an onboarding buddy'],
      ['task.completed', 'Huy Le', 'Prepare laptop'],
      ['task.completed', 'Bao Ho', 'Sign the employee handbook'],
      ['document.submitted', 'Bao Ho', 'Upload ID documents'],
      ['invitation.accepted', 'Bao Ho', null],
      ['invitation.sent', 'Lan Pham', null],
      ['onboarding.activated', 'Lan Pham', null],
      ['onboarding.created', 'Lan Pham', null],
    ];
    const withoutRevisions = baoStory.filter(
      ([action]) => action !== 'document.submitted',
    );
    // HR and the new hire, who uploads, hear of the revision; the manager and IT, who see the
    // onboarding but not the files, do not.
    expect((await activityOf(lan, 'Bao Ho')).map(lineOf)).toEqual(baoStory);
    expect(
      (await activityOf(await as('Bao Ho'), 'Bao Ho')).map(lineOf),
    ).toEqual(baoStory);
    const minh = await as('Minh Nguyen');
    const duc = await as('Duc Tran');
    expect((await activityOf(minh, 'Bao Ho')).map(lineOf)).toEqual(
      withoutRevisions,
    );
    expect(
      (await activityOf(await as('Huy Le'), 'Bao Ho')).map(lineOf),
    ).toEqual(withoutRevisions);

    // C, done: the decision too, for HR and the new hire, not for IT, who had tasks in it.
    const decided = [
      ['document.approved', 'Lan Pham', 'Review ID documents'],
      ['document.submitted', 'Chi Dang', 'Upload ID documents'],
    ];
    const chiOf = async (client: Client) =>
      (await activityOf(client, 'Chi Dang')).map(lineOf);
    const chi = await chiOf(lan);
    expect(chi.slice(0, 2)).toEqual([
      ['onboarding.completed', 'Minh Nguyen', null],
      ['task.completed', 'Minh Nguyen', 'Week-one check-in'],
    ]);
    expect(chi).toEqual(expect.arrayContaining(decided));
    expect(await chiOf(await as('Chi Dang'))).toEqual(chi);
    expect(await chiOf(duc)).toEqual(
      chi.filter(([action]) => !action.startsWith('document.')),
    );

    // The draft is HR's: its one event so far.
    expect((await activityOf(lan, 'An Vo')).map(lineOf)).toEqual([
      ['onboarding.created', 'Lan Pham', null],
    ]);
    // Out of scope, a 404, as the onboarding itself (BR-P02): IT with no task in B, anyone
    // but HR on a draft, another company's HR.
    for (const [client, fullName] of [
      [duc, 'Bao Ho'],
      [minh, 'An Vo'],
      [await as('Lan Pham', otherId), 'Bao Ho'],
    ] as const) {
      const res = await client
        .get(`/onboardings/${onboardingOf[fullName]}/activity`)
        .expect(404);
      expect(errorOf(res).code).toBe('NOT_FOUND');
    }
    await lan.get('/onboardings/not-an-id/activity').expect(400);
  });

  it("FR-19 BR-D05 HR's changes go on the timeline, named and dated by the business day; what came before keeps its date", async () => {
    const lan = await as('Lan Pham');
    const before = await activityOf(lan, 'Bao Ho');
    await lan.post('/demo/clock/advance', { days: 1 }).expect(200);
    const tasks = Object.fromEntries(
      (
        await prisma.task.findMany({
          where: { onboardingId: onboardingOf['Bao Ho'] },
          select: { id: true, definitionKey: true },
        })
      ).map(({ id, definitionKey }) => [definitionKey, id]),
    );
    const { id: duc } = await prisma.employee.findFirstOrThrow({
      where: { organizationId, fullName: 'Duc Tran' },
    });
    // IT's accounts go to Duc; the first pull request is due sooner, then the start date
    // moves past that deadline, which gives way (BR-S02).
    await lan
      .post(`/tasks/${tasks['create-accounts']}/reassign`, { employeeId: duc })
      .expect(200);
    await lan
      .post(`/tasks/${tasks['ship-first-pr']}/due-date`, { dueOn: day(1) })
      .expect(200);
    await lan
      .post(`/onboardings/${onboardingOf['Bao Ho']}/reschedule`, {
        startDate: day(4),
      })
      .expect(200);

    const after = await activityOf(lan, 'Bao Ho');
    expect(after.slice(3)).toEqual(before);
    const [rescheduled, dueChanged, reassigned] = after;
    expect(rescheduled).toMatchObject({
      action: 'onboarding.rescheduled',
      actor: { fullName: 'Lan Pham' },
      task: null,
      from: day(-2),
      to: day(4),
      dueReset: [
        {
          task: {
            id: tasks['ship-first-pr'],
            title: 'Ship your first pull request',
          },
          from: day(1),
          to: day(8),
        },
      ],
    });
    expect(dueChanged).toMatchObject({
      action: 'task.due_changed',
      task: { title: 'Ship your first pull request' },
      from: day(2),
      to: day(1),
    });
    expect(reassigned).toMatchObject({
      action: 'task.reassigned',
      task: { title: 'Create work accounts' },
      from: { fullName: 'Huy Le' },
      to: { id: duc, fullName: 'Duc Tran' },
    });
    // Tomorrow, by the demo clock; the seed's story stays on today.
    const dayOf = ({ at }: ActivityEvent) => today(timezone, 0, new Date(at));
    expect(after.slice(0, 3).map(dayOf)).toEqual(Array(3).fill(day(1)));
    expect(before.map(dayOf)).toEqual(Array(before.length).fill(day(0)));
  });
});
