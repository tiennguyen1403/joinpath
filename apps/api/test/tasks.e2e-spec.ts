import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  clockSchema,
  myTasksSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  onboardingSchema,
  type TemplateDefinition,
} from '@joinpath/core';
import type { App } from 'supertest/types.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import {
  type Client,
  createApp,
  errorOf,
  giveAccount,
  newSlug,
  type Org,
  PASSWORD,
  seedOrg,
  signIn,
} from './app.js';

// Checklists only, so an onboarding can complete before documents and approvals can (M2):
// every seeded template has an ID upload and its review.
const checklists: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [
    {
      key: 'welcome',
      phase: 'day-1',
      title: 'Welcome meeting',
      type: 'CHECKLIST',
      assignee: { kind: 'DIRECT_MANAGER' },
      availableOffsetDays: 0,
      dueOffsetDays: 0,
      dependsOn: [],
    },
    {
      key: 'badge',
      phase: 'day-1',
      title: 'Print a badge',
      type: 'CHECKLIST',
      assignee: { kind: 'ROLE', role: 'HR' },
      availableOffsetDays: 0,
      dueOffsetDays: 0,
      dependsOn: [],
    },
  ],
};

// Logins in one app share a throttle bucket (10 per minute, BR-P06): seedOrg signs in six
// people, so this file signs in four more at most.
describe('tasks', () => {
  let app: INestApplication<App>;
  let org: Org;

  const start = (client: Client, { id }: { id: string }) =>
    client.post(`/tasks/${id}/start`);
  const complete = (client: Client, { id }: { id: string }) =>
    client.post(`/tasks/${id}/complete`);
  const detailOf = (res: { body: unknown }) =>
    onboardingDetailSchema.parse(res.body);
  const read = async (id: string) =>
    detailOf(await org.hr.get(`/onboardings/${id}`).expect(200));
  // A title is unique within a template (BR-T04).
  const taskOf = (onboarding: OnboardingDetail, title: string) =>
    onboarding.tasks.find((task) => task.title === title)!;
  // Activated from Engineering Onboarding, starting `startsIn` days from today.
  const onboard = async (employeeId: string, startsIn: number) =>
    org.activate(
      await org.draftFor(employeeId, org.engineering.id, org.day(startsIn)),
    );
  // A new hire with the account their invitation will give them (M2.1), signed in.
  const hireWithAccount = async () => {
    const id = await org.newHire();
    const { fullName, email } = await org.prisma.employee.findUniqueOrThrow({
      where: { id },
    });
    await giveAccount(org.prisma, org.organizationId, fullName);
    return { id, client: await signIn(app, email) };
  };
  const userOf = (email: string) =>
    org.prisma.user.findUniqueOrThrow({ where: { email } });

  beforeAll(async () => {
    app = await createApp();
    org = await seedOrg(app);
  });

  afterAll(async () => {
    await org.prisma.organization.delete({ where: { id: org.organizationId } });
    await app.close();
  });

  it('AT-12 BR-E01 FR-28 a task is neither started nor completed before it opens; the demo clock opens it', async () => {
    // The laptop is prepared from a week before the start: ten days ahead, so in three.
    const onboarding = await onboard(await org.newHire(), 10);
    const laptop = taskOf(onboarding, 'Prepare laptop');
    expect(laptop).toMatchObject({
      availableOn: org.day(3),
      availability: 'LOCKED_BY_DATE',
    });
    for (const command of [start, complete]) {
      const res = await command(org.others.IT, laptop).expect(409);
      expect(errorOf(res)).toEqual({
        code: 'TASK_NOT_ELIGIBLE',
        message: `This task opens on ${org.day(3)}`,
      });
    }
    expect(taskOf(await read(onboarding.id), 'Prepare laptop').status).toBe(
      'PENDING',
    );

    try {
      const moved = await org.others.IT.post('/demo/clock/advance', {
        days: 3,
      }).expect(200);
      expect(clockSchema.parse(moved.body)).toEqual({ today: org.day(3) });
      const res = await complete(org.others.IT, laptop).expect(200);
      expect(taskOf(detailOf(res), 'Prepare laptop')).toMatchObject({
        status: 'COMPLETED',
        availability: 'COMPLETED',
      });
    } finally {
      await org.prisma.organization.update({
        where: { id: org.organizationId },
        data: { clockOffsetDays: 0 },
      });
    }
  });

  it('AT-13 BR-E01 BR-E02 FR-09 a task waits until every task it depends on is completed', async () => {
    const { An } = org.others;
    const onboarding = await onboard(org.anVo.id, 0);
    // Open since today, but it needs a laptop and accounts.
    const devEnv = taskOf(onboarding, 'Set up dev environment');
    expect(devEnv.availability).toBe('BLOCKED');
    const waits = {
      code: 'TASK_NOT_ELIGIBLE',
      message: 'This task waits for other tasks to be done',
    };
    expect(errorOf(await complete(An, devEnv).expect(409))).toEqual(waits);
    // One of the two is not enough (BR-E02).
    await complete(org.others.IT, taskOf(onboarding, 'Prepare laptop')).expect(
      200,
    );
    expect(errorOf(await start(An, devEnv).expect(409))).toEqual(waits);
    // The accounts wait in turn for the ID review.
    const accounts = taskOf(onboarding, 'Create work accounts');
    expect(
      errorOf(await complete(org.others.IT, accounts).expect(409)),
    ).toEqual(waits);

    // Uploading and approving come in M2.
    await org.prisma.task.updateMany({
      where: {
        onboardingId: onboarding.id,
        type: { in: ['DOCUMENT', 'APPROVAL'] },
      },
      data: { status: 'COMPLETED' },
    });
    await complete(org.others.IT, accounts).expect(200);
    const res = await start(An, devEnv).expect(200);
    expect(taskOf(detailOf(res), 'Set up dev environment')).toMatchObject({
      status: 'IN_PROGRESS',
      availability: 'READY',
    });
  });

  it('AT-14 BR-E01 BR-P01 BR-P02 only the assignee works on a task: whoever else sees it gets 403, anyone else 404', async () => {
    const onboarding = await onboard(org.baoHo.id, 0);
    // Duc's, and ready.
    const laptop = taskOf(onboarding, 'Prepare laptop');
    const other = await seedDemoOrg(org.prisma, {
      slug: newSlug(),
      password: PASSWORD,
    });
    try {
      const clients = {
        // They see Bao's onboarding: HR all of the org's, the manager a report's, Bao their
        // own.
        HR: org.hr,
        manager: org.others.manager,
        Bao: org.others.Bao,
        // They don't: Huy has no task in it, An is another new hire, and the last is IT in
        // another org.
        IT2: org.others.IT2,
        An: org.others.An,
        outsider: await signIn(app, other.emails.it),
      };
      const statuses: Record<string, number[]> = {};
      for (const [who, client] of Object.entries(clients)) {
        statuses[who] = [
          (await start(client, laptop)).status,
          (await complete(client, laptop)).status,
        ];
      }
      expect(statuses).toEqual({
        HR: [403, 403],
        manager: [403, 403],
        Bao: [403, 403],
        IT2: [404, 404],
        An: [404, 404],
        outsider: [404, 404],
      });
      expect(errorOf(await complete(org.others.manager, laptop))).toEqual({
        code: 'FORBIDDEN',
        message: 'This task is assigned to someone else',
      });
      expect(errorOf(await complete(org.others.IT2, laptop))).toEqual({
        code: 'NOT_FOUND',
        message: 'Task not found',
      });
    } finally {
      await org.prisma.organization.delete({
        where: { id: other.organization.id },
      });
    }
    await complete(org.others.IT, { id: randomUUID() }).expect(404);
    const malformed = await org.others.IT.post(
      '/tasks/not-a-uuid/complete',
    ).expect(400);
    expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');

    // The refusals changed nothing and left nothing on record.
    expect(taskOf(await read(onboarding.id), 'Prepare laptop')).toEqual(laptop);
    expect(
      await org.prisma.auditEvent.count({
        where: { onboardingId: onboarding.id, entityType: 'task' },
      }),
    ).toBe(0);
    await complete(org.others.IT, laptop).expect(200);
  });

  it('BR-E03 FR-10 FR-21 a checklist completes with or without a start; each command answers with the onboarding and goes on record', async () => {
    const onboarding = await onboard(await org.newHire(), 0);
    const { IT, manager } = org.others;
    const laptop = taskOf(onboarding, 'Prepare laptop');

    const started = await start(IT, laptop).expect(200);
    // The onboarding as its detail now reads.
    expect(started.body).toEqual(
      (await IT.get(`/onboardings/${onboarding.id}`).expect(200)).body,
    );
    const inProgress = taskOf(detailOf(started), 'Prepare laptop');
    expect(inProgress).toEqual({
      ...laptop,
      status: 'IN_PROGRESS',
      startedAt: expect.any(String),
    });
    expect(errorOf(await start(IT, laptop).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'Task is already started',
    });

    const completed = await complete(IT, laptop).expect(200);
    // Done, so no longer overdue (BR-E06).
    expect(taskOf(detailOf(completed), 'Prepare laptop')).toEqual({
      ...inProgress,
      status: 'COMPLETED',
      completedAt: expect.any(String),
      availability: 'COMPLETED',
      overdue: false,
    });
    for (const command of [start, complete]) {
      expect(errorOf(await command(IT, laptop).expect(409))).toEqual({
        code: 'INVALID_STATE',
        message: 'Task is already completed',
      });
    }

    // Straight from PENDING: never started.
    const buddy = taskOf(onboarding, 'Assign an onboarding buddy');
    const after = detailOf(await complete(manager, buddy).expect(200));
    expect(taskOf(after, 'Assign an onboarding buddy')).toMatchObject({
      status: 'COMPLETED',
      startedAt: null,
      completedAt: expect.any(String),
    });
    expect(after.status).toBe('ACTIVE');

    const duc = await userOf(org.seeded.emails.it);
    const minh = await userOf(org.seeded.emails.manager);
    expect(
      await org.prisma.auditEvent.findMany({
        where: { onboardingId: onboarding.id, entityType: 'task' },
        orderBy: { createdAt: 'asc' },
        select: { actorUserId: true, action: true, entityId: true },
      }),
    ).toEqual([
      { actorUserId: duc.id, action: 'task.started', entityId: laptop.id },
      { actorUserId: duc.id, action: 'task.completed', entityId: laptop.id },
      { actorUserId: minh.id, action: 'task.completed', entityId: buddy.id },
    ]);
  });

  it('§4.4 a document or an approval is neither started nor completed by hand', async () => {
    const hire = await hireWithAccount();
    const onboarding = await onboard(hire.id, 0);
    const refusal = {
      code: 'INVALID_STATE',
      message: 'Only a checklist task can be started or completed',
    };
    for (const command of [start, complete]) {
      const upload = taskOf(onboarding, 'Upload ID documents');
      expect(errorOf(await command(hire.client, upload).expect(409))).toEqual(
        refusal,
      );
      const review = taskOf(onboarding, 'Review ID documents');
      expect(errorOf(await command(org.hr, review).expect(409))).toEqual(
        refusal,
      );
    }
  });

  it('BR-C01 BR-C02 the last task completed completes the onboarding in the same transaction; then nothing moves', async () => {
    const templateId = await org.publishedTemplate(checklists);
    const onboarding = await org.activate(
      await org.draftFor(await org.newHire(), templateId, org.day(0)),
    );
    const welcome = taskOf(onboarding, 'Welcome meeting');
    const badge = taskOf(onboarding, 'Print a badge');
    // A task in progress is not done.
    await start(org.hr, badge).expect(200);
    const first = await complete(org.others.manager, welcome).expect(200);
    expect(detailOf(first).status).toBe('ACTIVE');

    const last = detailOf(await complete(org.hr, badge).expect(200));
    expect(last.status).toBe('COMPLETED');
    expect(last.tasks.map((task) => task.availability)).toEqual([
      'COMPLETED',
      'COMPLETED',
    ]);
    // At the moment its last task was.
    const { completedAt } = await org.prisma.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    expect(completedAt?.toISOString()).toBe(
      taskOf(last, 'Print a badge').completedAt,
    );
    const hr = await userOf(org.seeded.emails.hr);
    expect(
      await org.prisma.auditEvent.findMany({
        where: { onboardingId: onboarding.id, action: 'onboarding.completed' },
        select: { actorUserId: true, entityType: true, entityId: true },
      }),
    ).toEqual([
      { actorUserId: hr.id, entityType: 'onboarding', entityId: onboarding.id },
    ]);

    const res = await start(org.others.manager, welcome).expect(409);
    expect(errorOf(res)).toEqual({
      code: 'INVALID_STATE',
      message: 'This onboarding is no longer active',
    });
  });

  it('AT-23 BR-C01 the last two tasks completed at once complete the onboarding exactly once', async () => {
    const templateId = await org.publishedTemplate(checklists);
    const onboarding = await org.activate(
      await org.draftFor(await org.newHire(), templateId, org.day(0)),
    );
    const responses = await Promise.all([
      complete(org.others.manager, taskOf(onboarding, 'Welcome meeting')),
      complete(org.hr, taskOf(onboarding, 'Print a badge')),
    ]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    const done = await read(onboarding.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.tasks.map((task) => task.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
    ]);
    expect(
      await org.prisma.auditEvent.count({
        where: { onboardingId: onboarding.id, action: 'onboarding.completed' },
      }),
    ).toBe(1);
  });

  it('FR-10 My Tasks lists every task assigned to me by due date, each with its onboarding; availability tells the tabs apart', async () => {
    const hire = await hireWithAccount();
    const mine = async () =>
      myTasksSchema.parse(
        (await hire.client.get('/tasks/mine').expect(200)).body,
      );
    expect(await mine()).toEqual({ today: org.day(0), tasks: [] });

    // Starting today, the new hire has tasks ready, done, blocked and not yet open.
    const onboarding = await onboard(hire.id, 0);
    await complete(
      hire.client,
      taskOf(onboarding, 'Sign the employee handbook'),
    ).expect(200);
    const { today, tasks } = await mine();
    expect(today).toBe(org.day(0));
    expect(
      tasks.map((task) => [task.title, task.dueOn, task.availability]),
    ).toEqual([
      ['Upload ID documents', org.day(-5), 'READY'],
      ['Sign the employee handbook', org.day(-3), 'COMPLETED'],
      ['Set up dev environment', org.day(2), 'BLOCKED'],
      ['Security awareness training', org.day(4), 'READY'],
      ['Ship your first pull request', org.day(4), 'LOCKED_BY_DATE'],
    ]);
    // Each is the task as the detail shows it, with the onboarding as the list shows it.
    const detail = await read(onboarding.id);
    const summary = onboardingSchema.parse(detail);
    expect(tasks).toEqual(
      tasks.map(({ id }) => ({
        ...detail.tasks.find((task) => task.id === id),
        onboarding: summary,
      })),
    );
  });

  it('AT-31 BR-D02 FR-28 the demo clock moves forward only, a month at most a call, and in a sandbox only', async () => {
    const advance = (client: Client, body: object) =>
      client.post('/demo/clock/advance', body);
    const todayOf = async (client: Client) =>
      myTasksSchema.parse((await client.get('/tasks/mine').expect(200)).body)
        .today;
    // In a sandbox, anyone moves it: here a new hire, and HR.
    const { An } = org.others;
    for (const body of [
      {},
      { days: 0 },
      { days: -1 },
      { days: 31 },
      { days: 1.5 },
      { days: '2' },
    ]) {
      const res = await advance(An, body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }

    try {
      // Calls at once both count.
      const both = await Promise.all([
        advance(An, { days: 30 }),
        advance(org.hr, { days: 1 }),
      ]);
      expect(both.map((res) => res.status)).toEqual([200, 200]);
      expect(await todayOf(org.hr)).toBe(org.day(31));

      await org.prisma.organization.update({
        where: { id: org.organizationId },
        data: { isSandbox: false },
      });
      for (const client of [org.hr, An]) {
        const res = await advance(client, { days: 1 }).expect(403);
        expect(errorOf(res)).toEqual({
          code: 'FORBIDDEN',
          message: 'The demo clock works in a sandbox only',
        });
      }
      expect(await todayOf(An)).toBe(org.day(31));
    } finally {
      await org.prisma.organization.update({
        where: { id: org.organizationId },
        data: { isSandbox: true, clockOffsetDays: 0 },
      });
    }
  });
});
