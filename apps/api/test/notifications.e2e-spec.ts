import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  formatDate,
  formatDateInFull,
  mockEmailSchema,
  notificationsSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  type TaskDef,
  type TemplateDefinition,
} from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { env } from '../src/env.js';
import { notify } from '../src/modules/notifications/notify.js';
import { tickOrg } from '../src/modules/notifications/tick.js';
import {
  checklists,
  createApp,
  errorOf,
  type Org,
  pdf,
  seedOrg,
} from './app.js';

const task = (fields: Partial<TaskDef> & Pick<TaskDef, 'key' | 'title'>) =>
  ({
    phase: 'day-1',
    type: 'CHECKLIST',
    assignee: { kind: 'DIRECT_MANAGER' },
    availableOffsetDays: 0,
    dueOffsetDays: 0,
    dependsOn: [],
    ...fields,
  }) satisfies TaskDef;

// HR prepares a desk, which the new hire then sets up; the manager's lunch opens later.
const chain: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [
    task({
      key: 'prep',
      title: 'Prepare the desk',
      assignee: { kind: 'ROLE', role: 'HR' },
      dueOffsetDays: 1,
    }),
    task({
      key: 'setup',
      title: 'Set up the desk',
      assignee: { kind: 'NEW_HIRE' },
      dueOffsetDays: 2,
      dependsOn: ['prep'],
    }),
    task({
      key: 'lunch',
      title: 'Team lunch',
      availableOffsetDays: 3,
      dueOffsetDays: 3,
      dependsOn: ['prep'],
    }),
  ],
};

// What the tick finds, starting today: a task overdue that another waits on, one due
// tomorrow, one just open, one whose date is still to come.
const reminders: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [
    task({
      key: 'late',
      title: 'File the forms',
      availableOffsetDays: -5,
      dueOffsetDays: -1,
    }),
    task({
      key: 'after',
      title: 'Book the training',
      availableOffsetDays: -5,
      dueOffsetDays: 1,
      dependsOn: ['late'],
    }),
    task({
      key: 'soon',
      title: 'Order a desk',
      assignee: { kind: 'ROLE', role: 'HR' },
      availableOffsetDays: -2,
      dueOffsetDays: 1,
    }),
    task({
      key: 'open',
      title: 'Read the handbook',
      assignee: { kind: 'NEW_HIRE' },
      dueOffsetDays: 2,
    }),
    task({
      key: 'later',
      title: 'Plan week two',
      availableOffsetDays: 5,
      dueOffsetDays: 6,
    }),
  ],
};

// What each person hears (BR-N02, BR-N03), by the copy approved in M3.2a. Logins in one app
// share a throttle bucket (BR-P06): seedOrg signs in six people, this file one more.
describe('notifications', () => {
  let app: INestApplication<App>;
  let org: Org;
  // Lan Pham is HR, Duc Tran and Huy Le are IT, Minh Nguyen manages every new hire here.
  let lan: string;
  let duc: string;
  let huy: string;
  let minh: string;
  let chainTemplate: string;
  let remindersTemplate: string;
  let checklistsTemplate: string;
  // The onboarding the tick works on, from AT-24 to BR-D03.
  let ticked: OnboardingDetail;

  const server = () => request(app.getHttpServer());
  const detailOf = (res: { body: unknown }) =>
    onboardingDetailSchema.parse(res.body);
  // A title is unique within a template (BR-T04).
  const taskOf = (onboarding: OnboardingDetail, title: string) =>
    onboarding.tasks.find((each) => each.title === title)!;
  // A business date, as the copy writes it.
  const day = (offset: number) => formatDate(org.day(offset));
  // What someone was told about one onboarding: its tasks, or its new hire by name. The new
  // hire hears only of their own.
  const about = async (employeeId: string, onboarding: OnboardingDetail) => {
    const tasks = new Set(onboarding.tasks.map((each) => each.id));
    const name = onboarding.employee.fullName;
    const notes = await org.prisma.notification.findMany({
      where: { recipientEmployeeId: employeeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        kind: true,
        taskId: true,
        title: true,
        body: true,
        link: true,
        dedupeKey: true,
      },
    });
    return notes.filter((note) =>
      employeeId === onboarding.employee.id
        ? true
        : note.taskId
          ? tasks.has(note.taskId)
          : [`${name}'s`, `${name} `].some((text) => note.title.includes(text)),
    );
  };
  const inbox = async (email: string) =>
    mockEmailSchema
      .array()
      .parse((await org.hr.get('/mock-inbox').expect(200)).body)
      .filter((each) => each.toEmail === email);
  // Activated for someone new with no account unless told otherwise, starting in 10 days.
  const onboard = async (
    templateId = org.engineering.id,
    startsIn = 10,
    employeeId?: string,
  ) =>
    org.activate(
      await org.draftFor(
        employeeId ?? (await org.newHire()),
        templateId,
        org.day(startsIn),
      ),
    );
  const smallPrint =
    "You're receiving this because you have tasks in Joinpath at Acme Tech.";

  beforeAll(async () => {
    app = await createApp();
    org = await seedOrg(app);
    const { emails } = org.seeded;
    const employeeOf = async (email: string) =>
      (await org.prisma.user.findUniqueOrThrow({ where: { email } }))
        .employeeId;
    lan = await employeeOf(emails.hr);
    duc = await employeeOf(emails.it);
    huy = await employeeOf(emails.it2);
    minh = org.managerId;
    chainTemplate = await org.publishedTemplate(chain);
    remindersTemplate = await org.publishedTemplate(reminders);
    checklistsTemplate = await org.publishedTemplate(checklists);
  });

  afterAll(async () => {
    await org.prisma.organization.delete({ where: { id: org.organizationId } });
    await app.close();
  });

  it('BR-N02 FR-17 activation tells each assignee of their tasks, one note and one email per person; not the new hire, whom the invitation tells, nor HR, who activated', async () => {
    const onboarding = await onboard();
    const hire = onboarding.employee.fullName;
    const assigned = (title: string, body: string) => ({
      kind: 'ASSIGNED',
      taskId: null,
      title,
      body,
      link: '/tasks',
      dedupeKey: null,
    });
    expect(await about(duc, onboarding)).toEqual([
      assigned(
        `2 tasks for ${hire}'s onboarding`,
        `Prepare laptop opens ${day(3)}, and Create work accounts opens ${day(5)}.`,
      ),
    ]);
    expect(await about(minh, onboarding)).toEqual([
      assigned(
        `3 tasks for ${hire}'s onboarding`,
        `Assign an onboarding buddy opens ${day(3)}, Welcome meeting opens ${day(10)}, and Week-one check-in opens ${day(14)}.`,
      ),
    ]);
    expect(await about(lan, onboarding)).toEqual([]);
    expect(await about(onboarding.employee.id, onboarding)).toEqual([]);

    expect(await inbox(org.seeded.emails.it)).toContainEqual(
      expect.objectContaining({
        toName: 'Duc Tran',
        subject: `2 tasks for ${hire}'s onboarding`,
        body: [
          'Hi Duc,',
          `Lan Pham set up ${hire}'s onboarding. Hire starts on ${formatDateInFull(org.day(10))}, and these two are yours:`,
          `Prepare laptop opens ${day(3)} and is due ${day(7)}.`,
          `Create work accounts opens ${day(5)} and is due ${day(7)}.`,
        ].join('\n\n'),
        link: `${env.APP_ORIGIN}/tasks`,
        linkLabel: 'Open My tasks',
        footer: smallPrint,
      }),
    );
    expect(
      (await inbox(onboarding.employee.email)).map((email) => email.subject),
    ).toEqual(["You're invited to join Acme Tech on Joinpath"]);
  });

  it('BR-N02 a task done opens the next one for its assignee; one whose date is still to come waits for the tick', async () => {
    const onboarding = await onboard(chainTemplate, 0);
    const setup = taskOf(onboarding, 'Set up the desk');
    await org.hr
      .post(`/tasks/${taskOf(onboarding, 'Prepare the desk').id}/complete`)
      .expect(200);
    expect(await about(onboarding.employee.id, onboarding)).toEqual([
      {
        kind: 'READY',
        taskId: setup.id,
        title: 'Set up the desk is open',
        body: `Prepare the desk is done. Due ${day(2)}.`,
        link: '/my-onboarding',
        dedupeKey: `ready:${setup.id}`,
      },
    ]);
    // The lunch opens in three days.
    expect(
      (await about(minh, onboarding)).map(({ kind, body }) => ({ kind, body })),
    ).toEqual([{ kind: 'ASSIGNED', body: `Team lunch opens ${day(3)}.` }]);
  });

  it('BR-N02 BR-R05 BR-R06 FR-17 a document sent tells its approver, once per revision; the decision tells whoever sent it, a request for changes with its reason and by email; each reads and marks their own', async () => {
    const hire = await org.hireWithAccount();
    const onboarding = await onboard(org.engineering.id, 0, hire.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    const review = taskOf(onboarding, 'Review ID documents');
    const accounts = taskOf(onboarding, 'Create work accounts');
    const submit = async () =>
      taskOf(
        detailOf(await hire.client.post(`/tasks/${ids.id}/submit`).expect(200)),
        'Upload ID documents',
      ).submissions[0].id;
    await hire.client
      .upload(`/tasks/${ids.id}/files`, pdf(), 'id.pdf')
      .expect(201);
    await org.hr
      .post(`/tasks/${review.id}/reject`, {
        submissionId: await submit(),
        reason: 'The back of the ID card is missing.',
      })
      .expect(200);
    await org.hr
      .post(`/tasks/${review.id}/approve`, { submissionId: await submit() })
      .expect(200);

    const sent = (revision: number) => ({
      kind: 'READY',
      taskId: review.id,
      title: 'Review ID documents is ready',
      body: `${hire.fullName} sent revision ${revision}. Due ${day(-3)}.`,
      link: '/tasks',
      dedupeKey: `ready:${review.id}:${revision}`,
    });
    expect(await about(lan, onboarding)).toEqual([sent(1), sent(2)]);
    const decision = {
      taskId: ids.id,
      link: '/my-onboarding',
      dedupeKey: null,
    };
    expect(await about(hire.id, onboarding)).toEqual([
      {
        ...decision,
        kind: 'REJECTED',
        title: 'Lan asked for changes',
        body: '“The back of the ID card is missing.” Fix Upload ID documents and send revision 2.',
      },
      {
        ...decision,
        kind: 'APPROVED',
        title: 'Lan approved your documents',
        body: 'Upload ID documents is done: revision 2 is approved.',
      },
    ]);
    // The review was all that Create work accounts waited for.
    expect(
      (await about(duc, onboarding)).filter((note) => note.kind === 'READY'),
    ).toEqual([
      {
        kind: 'READY',
        taskId: accounts.id,
        title: 'Create work accounts is open',
        body: `Review ID documents is done. For ${hire.fullName}, due ${day(-3)}.`,
        link: '/tasks',
        dedupeKey: `ready:${accounts.id}`,
      },
    ]);
    expect(await inbox(onboarding.employee.email)).toEqual([
      expect.objectContaining({
        subject: 'Changes needed: Upload ID documents',
        body: [
          'Hi Hire,',
          'Lan Pham reviewed revision 1 and asked for changes:',
          '“The back of the ID card is missing.”',
          "Upload what's needed, then send revision 2.",
        ].join('\n\n'),
        link: `${env.APP_ORIGIN}/my-onboarding`,
        linkLabel: 'Open your onboarding',
        footer:
          "You're receiving this because Acme Tech added you as a new hire in Joinpath.",
      }),
    ]);

    // Their own, newest first, then read one by one or all at once.
    const listed = (res: { body: unknown }) =>
      notificationsSchema.parse(res.body);
    const mine = listed(await hire.client.get('/notifications').expect(200));
    expect(mine.unread).toBe(2);
    expect(mine.notifications.map((note) => note.kind)).toEqual([
      'APPROVED',
      'REJECTED',
    ]);
    const rejected = mine.notifications[1];
    const once = listed(
      await hire.client.post(`/notifications/${rejected.id}/read`).expect(200),
    );
    expect(once.unread).toBe(1);
    expect(once.notifications[1].readAt).not.toBeNull();
    // Read already: it keeps the time it was read.
    const twice = listed(
      await hire.client.post(`/notifications/${rejected.id}/read`).expect(200),
    );
    expect(twice.notifications[1].readAt).toBe(once.notifications[1].readAt);
    // Someone else's is as good as none (BR-P02).
    const [ducs] = await org.prisma.notification.findMany({
      where: { recipientEmployeeId: duc },
    });
    expect(
      errorOf(
        await hire.client.post(`/notifications/${ducs.id}/read`).expect(404),
      ).code,
    ).toBe('NOT_FOUND');
    await hire.client.post(`/notifications/${randomUUID()}/read`).expect(404);
    await hire.client.post('/notifications/nope/read').expect(400);
    expect(
      listed(await hire.client.post('/notifications/read-all').expect(200))
        .unread,
    ).toBe(0);
    await server().get('/api/notifications').expect(401);
  });

  it('BR-N02 BR-S04 a task handed on tells the person who takes it, by email too, and the one who had it', async () => {
    const onboarding = await onboard();
    const hire = onboarding.employee.fullName;
    const laptop = taskOf(onboarding, 'Prepare laptop');
    await org.hr
      .post(`/tasks/${laptop.id}/reassign`, { employeeId: huy })
      .expect(200);
    expect(await about(huy, onboarding)).toEqual([
      {
        kind: 'ASSIGNED',
        taskId: laptop.id,
        title: 'Prepare laptop is yours now',
        body: `Lan Pham handed it to you from Duc Tran. For ${hire}, due ${day(7)}.`,
        link: '/tasks',
        dedupeKey: null,
      },
    ]);
    expect((await about(duc, onboarding)).at(-1)).toEqual({
      kind: 'UNASSIGNED',
      taskId: laptop.id,
      title: 'Prepare laptop went to Huy Le',
      body: "Lan Pham handed it on, so it's off your list.",
      link: '/tasks',
      dedupeKey: null,
    });
    expect(
      (await inbox(org.seeded.emails.it2)).filter(
        (email) => email.subject === `Prepare laptop for ${hire}'s onboarding`,
      ),
    ).toEqual([
      expect.objectContaining({
        body: [
          'Hi Huy,',
          `Lan Pham handed you Prepare laptop from Duc Tran. It opens ${day(3)} and is due ${day(7)}.`,
        ].join('\n\n'),
        linkLabel: 'Open My tasks',
        footer: smallPrint,
      }),
    ]);
  });

  it('BR-N02 BR-S03 a deadline HR sets, or puts back, tells the assignee', async () => {
    const onboarding = await onboard();
    const buddy = taskOf(onboarding, 'Assign an onboarding buddy');
    const handbook = taskOf(onboarding, 'Sign the employee handbook');
    const moveDue = (id: string, dueOn: string | null) =>
      org.hr.post(`/tasks/${id}/due-date`, { dueOn }).expect(200);
    await moveDue(buddy.id, org.day(9));
    await moveDue(buddy.id, null);
    await moveDue(handbook.id, org.day(9));
    const changed = {
      kind: 'DUE_CHANGED',
      taskId: buddy.id,
      title: 'New due date for Assign an onboarding buddy',
      link: '/tasks',
      dedupeKey: null,
    };
    expect(
      (await about(minh, onboarding)).filter(
        (note) => note.kind === 'DUE_CHANGED',
      ),
    ).toEqual([
      { ...changed, body: `Lan Pham moved it to ${day(9)}.` },
      {
        ...changed,
        body: `Lan Pham set it back to the template's date, ${day(6)}.`,
      },
    ]);
    expect(await about(onboarding.employee.id, onboarding)).toEqual([
      {
        kind: 'DUE_CHANGED',
        taskId: handbook.id,
        title: 'New due date for Sign the employee handbook',
        body: `Lan Pham moved it to ${day(9)}.`,
        link: '/my-onboarding',
        dedupeKey: null,
      },
    ]);
  });

  it('BR-N02 BR-S01 a new start date tells each person whose open tasks moved, the new hire too', async () => {
    const onboarding = await onboard();
    const hire = onboarding.employee.fullName;
    await org.hr
      .post(`/onboardings/${onboarding.id}/reschedule`, {
        startDate: org.day(12),
      })
      .expect(200);
    const moved = (body: string) => ({
      kind: 'RESCHEDULED',
      taskId: null,
      title: `${hire} now starts ${day(12)}`,
      body,
      link: '/tasks',
      dedupeKey: null,
    });
    expect((await about(duc, onboarding)).at(-1)).toEqual(
      moved("Your 2 tasks for Hire's onboarding moved with it."),
    );
    expect((await about(minh, onboarding)).at(-1)).toEqual(
      moved("Your 3 tasks for Hire's onboarding moved with it."),
    );
    expect(await about(onboarding.employee.id, onboarding)).toEqual([
      {
        kind: 'RESCHEDULED',
        taskId: null,
        title: `Your start date is now ${day(12)}`,
        body: 'Your 5 open tasks moved with it.',
        link: '/my-onboarding',
        dedupeKey: null,
      },
    ]);
    // HR moved it: their review moved too, unannounced.
    expect(await about(lan, onboarding)).toEqual([]);
  });

  it('BR-N02 BR-C01 the last task done tells HR and the manager, never the new hire', async () => {
    const onboarding = await onboard(checklistsTemplate, 0);
    // HR prints the badge, then the manager's welcome meeting finishes the onboarding.
    await org.hr
      .post(`/tasks/${taskOf(onboarding, 'Print a badge').id}/complete`)
      .expect(200);
    await org.others.manager
      .post(`/tasks/${taskOf(onboarding, 'Welcome meeting').id}/complete`)
      .expect(200);
    expect(await about(lan, onboarding)).toEqual([
      {
        kind: 'COMPLETED',
        taskId: null,
        title: `${onboarding.employee.fullName} finished onboarding`,
        body: 'All 2 tasks are done.',
        link: `/onboardings/${onboarding.id}`,
        dedupeKey: null,
      },
    ]);
    // The manager did the last task, so hears nothing of it.
    expect((await about(minh, onboarding)).map((note) => note.kind)).toEqual([
      'ASSIGNED',
    ]);
    expect(await about(onboarding.employee.id, onboarding)).toEqual([]);
  });

  it('BR-N02 BR-C03 a cancel tells whoever had open tasks in it, without the reason; not the new hire', async () => {
    const onboarding = await onboard();
    await org.hr
      .post(`/onboardings/${onboarding.id}/cancel`, {
        reason: 'A reason for HR alone',
      })
      .expect(200);
    const off = (body: string) => ({
      kind: 'CANCELED',
      taskId: null,
      title: `${onboarding.employee.fullName}'s onboarding was canceled`,
      body,
      link: `/onboardings/${onboarding.id}`,
      dedupeKey: null,
    });
    expect((await about(duc, onboarding)).at(-1)).toEqual(
      off('Your 2 open tasks for it were canceled.'),
    );
    expect((await about(minh, onboarding)).at(-1)).toEqual(
      off('Your 3 open tasks for it were canceled.'),
    );
    expect(await about(onboarding.employee.id, onboarding)).toEqual([]);
    expect(await about(lan, onboarding)).toEqual([]);
    expect(
      await org.prisma.notification.count({
        where: { body: { contains: 'A reason for HR alone' } },
      }),
    ).toBe(0);
  });

  it('BR-N01 a note stands or falls with the transaction of the change it tells of', async () => {
    const note = {
      to: duc,
      kind: 'READY' as const,
      title: `Rolled back ${randomUUID()}`,
      body: '',
      link: '/tasks',
    };
    const written = () =>
      org.prisma.notification.count({ where: { title: note.title } });
    await expect(
      org.prisma.$transaction(async (tx) => {
        await notify(tx, org.organizationId, [note]);
        throw new Error('The change failed');
      }),
    ).rejects.toThrow('The change failed');
    expect(await written()).toBe(0);
    await org.prisma.$transaction((tx) =>
      notify(tx, org.organizationId, [note]),
    );
    expect(await written()).toBe(1);
  });

  it('AT-24 BR-N04 BR-N03 two ticks on one day: one opening, due-soon and overdue per task, none for a blocked task, and one overdue email', async () => {
    ticked = await onboard(remindersTemplate, 0);
    const hire = ticked.employee.fullName;
    const late = taskOf(ticked, 'File the forms').id;
    const soon = taskOf(ticked, 'Order a desk').id;
    const open = taskOf(ticked, 'Read the handbook').id;
    await tickOrg(org.prisma, org.organizationId);
    await tickOrg(org.prisma, org.organizationId);

    // Book the training waits for File the forms: no reminder, though due tomorrow.
    expect(
      (await about(minh, ticked)).filter((note) => note.kind !== 'ASSIGNED'),
    ).toEqual([
      {
        kind: 'READY',
        taskId: late,
        title: 'File the forms is open',
        body: `Its start date has come. For ${hire}, due ${day(-1)}.`,
        link: '/tasks',
        dedupeKey: `ready:${late}`,
      },
      {
        kind: 'OVERDUE',
        taskId: late,
        title: `Overdue: File the forms for ${hire}`,
        body: `It was due ${day(-1)}. Book the training is waiting on it.`,
        link: '/tasks',
        dedupeKey: `overdue:${late}:${org.day(0)}`,
      },
    ]);
    expect(await about(lan, ticked)).toEqual([
      {
        kind: 'READY',
        taskId: soon,
        title: 'Order a desk is open',
        body: `Its start date has come. For ${hire}, due ${day(1)}.`,
        link: '/tasks',
        dedupeKey: `ready:${soon}`,
      },
      {
        kind: 'DUE_SOON',
        taskId: soon,
        title: 'Order a desk is due tomorrow',
        body: `For ${hire}, due ${day(1)}.`,
        link: '/tasks',
        dedupeKey: `due-soon:${soon}:${org.day(1)}`,
      },
    ]);
    expect(await about(ticked.employee.id, ticked)).toEqual([
      {
        kind: 'READY',
        taskId: open,
        title: 'Read the handbook is open',
        body: `Its start date has come. Due ${day(2)}.`,
        link: '/my-onboarding',
        dedupeKey: `ready:${open}`,
      },
    ]);
    expect(
      (await inbox(org.seeded.emails.manager)).filter(
        (email) => email.subject === `Overdue: File the forms for ${hire}`,
      ),
    ).toEqual([
      expect.objectContaining({
        body: [
          'Hi Minh,',
          `File the forms for ${hire} was due ${day(-1)}. Book the training is waiting on it.`,
        ].join('\n\n'),
        linkLabel: 'Open My tasks',
        footer: [
          "You get one reminder a day until it's done.",
          smallPrint,
        ].join('\n\n'),
      }),
    ]);
  });

  it('AT-25 BR-C04 BR-D03 once canceled, an onboarding gets no reminder; the demo clock ticks at once for the others', async () => {
    const canceled = await onboard(remindersTemplate, 0);
    await tickOrg(org.prisma, org.organizationId);
    const notesOn = (onboarding: OnboardingDetail) =>
      org.prisma.notification.count({
        where: { taskId: { in: onboarding.tasks.map((each) => each.id) } },
      });
    const before = await notesOn(canceled);
    expect(before).toBe(5);
    await org.hr
      .post(`/onboardings/${canceled.id}/cancel`, { reason: 'Not needed' })
      .expect(200);
    // A day on: File the forms is overdue again, but only where the onboarding still runs.
    await org.hr.post('/demo/clock/advance', { days: 1 }).expect(200);
    expect(await notesOn(canceled)).toBe(before);
    const overdueOn = (onboarding: OnboardingDetail) =>
      org.prisma.notification.count({
        where: {
          dedupeKey: `overdue:${taskOf(onboarding, 'File the forms').id}:${org.day(1)}`,
        },
      });
    expect(await overdueOn(ticked)).toBe(1);
    expect(await overdueOn(canceled)).toBe(0);
  });

  it('BR-D03 BR-N04 a task whose date fell on a day the clock skipped opens once; its overdue comes each day', async () => {
    // AT-25 moved the clock a day on; six more, and Plan week two opened two days ago.
    await org.hr.post('/demo/clock/advance', { days: 6 }).expect(200);
    const plan = taskOf(ticked, 'Plan week two').id;
    const notes = async () =>
      (
        await org.prisma.notification.findMany({
          where: { taskId: plan },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      ).map(({ kind, body, dedupeKey }) => ({ kind, body, dedupeKey }));
    expect(await notes()).toEqual([
      {
        kind: 'READY',
        body: `Its start date has come. For ${ticked.employee.fullName}, due ${day(6)}.`,
        dedupeKey: `ready:${plan}`,
      },
      {
        kind: 'OVERDUE',
        body: `It was due ${day(6)}.`,
        dedupeKey: `overdue:${plan}:${org.day(7)}`,
      },
    ]);
    await org.hr.post('/demo/clock/advance', { days: 1 }).expect(200);
    expect((await notes()).map((note) => note.dedupeKey)).toEqual([
      `ready:${plan}`,
      `overdue:${plan}:${org.day(7)}`,
      `overdue:${plan}:${org.day(8)}`,
    ]);
    // The new hire's own task is overdue too, but with no account yet they get no email:
    // its link would need a sign-in. The invitation is how they get in.
    const handbook = taskOf(ticked, 'Read the handbook').id;
    expect(
      await org.prisma.notification.count({
        where: { taskId: handbook, kind: 'OVERDUE' },
      }),
    ).toBe(2);
    expect(
      (await inbox(ticked.employee.email)).map((email) => email.subject),
    ).toEqual(["You're invited to join Acme Tech on Joinpath"]);
  });

  it('PLAN §6.5 the cron route takes its secret and nothing else', async () => {
    const tick = () => server().get('/api/internal/cron/tick');
    expect(errorOf(await tick().expect(401)).code).toBe('UNAUTHENTICATED');
    await tick().set('Authorization', 'Bearer wrong').expect(401);
    await tick().set('Authorization', `Bearer ${env.CRON_SECRET}x`).expect(401);
    // A session is no way in either.
    await org.hr.get('/internal/cron/tick').expect(401);
  });
});
