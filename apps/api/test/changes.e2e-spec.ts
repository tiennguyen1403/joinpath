import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  mockEmailSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  type TemplateDefinition,
} from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  type Client,
  clientFor,
  createApp,
  errorOf,
  type Org,
  pdf,
  seedOrg,
} from './app.js';

// A form the new hire's manager uploads and HR reviews: a document HR can hand on, since it is
// not the new hire's own (BR-S04).
const managerForm: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [
    {
      key: 'form',
      phase: 'day-1',
      title: 'Upload the equipment form',
      type: 'DOCUMENT',
      assignee: { kind: 'DIRECT_MANAGER' },
      availableOffsetDays: 0,
      dueOffsetDays: 0,
      dependsOn: [],
    },
    {
      key: 'review-form',
      phase: 'day-1',
      title: 'Review the equipment form',
      type: 'APPROVAL',
      assignee: { kind: 'ROLE', role: 'HR' },
      reviews: 'form',
      availableOffsetDays: 0,
      dueOffsetDays: 1,
      dependsOn: [],
    },
  ],
};

const tokenOf = (link: string) => new URL(link).hash.slice(1);

// HR's changes to an onboarding under way (PLAN §9): its start date, a task's assignee or
// deadline, or calling it off. Acceptances and logins here come each from its own address,
// behind one proxy, so they never meet the limit seedOrg's sign-ins share (BR-P06).
describe('changes', () => {
  let app: INestApplication<App>;
  let org: Org;
  // seedOrg picks Duc Tran for both IT tasks of Engineering Onboarding; Huy Le is the other
  // IT, Lan Pham HR.
  let duc: string;
  let huy: string;
  let lan: string;
  let formTemplate: string;
  let lastIp = 0;
  const server = () => request(app.getHttpServer());
  const accept = (token: string) =>
    server()
      .post('/api/auth/invitations/accept')
      .set('X-Forwarded-For', `198.51.100.${++lastIp}`)
      .send({ token, password: 'correct horse' });
  const login = (email: string) =>
    server()
      .post('/api/auth/login')
      .set('X-Forwarded-For', `198.51.100.${++lastIp}`)
      .send({ email, password: 'correct horse' });

  const detailOf = (res: { body: unknown }) =>
    onboardingDetailSchema.parse(res.body);
  const read = async (client: Client, { id }: { id: string }) =>
    detailOf(await client.get(`/onboardings/${id}`).expect(200));
  // A title is unique within a template (BR-T04).
  const taskOf = (onboarding: OnboardingDetail, title: string) =>
    onboarding.tasks.find((task) => task.title === title)!;
  const reschedule = (
    client: Client,
    { id }: { id: string },
    startDate: string,
  ) => client.post(`/onboardings/${id}/reschedule`, { startDate });
  const cancel = (
    client: Client,
    { id }: { id: string },
    reason = 'The candidate took another offer',
  ) => client.post(`/onboardings/${id}/cancel`, { reason });
  const reassign = (
    client: Client,
    { id }: { id: string },
    employeeId: string,
  ) => client.post(`/tasks/${id}/reassign`, { employeeId });
  const moveDue = (
    client: Client,
    { id }: { id: string },
    dueOn: string | null,
  ) => client.post(`/tasks/${id}/due-date`, { dueOn });
  const complete = (client: Client, { id }: { id: string }) =>
    client.post(`/tasks/${id}/complete`);
  const auditOf = (onboardingId: string, ...actions: string[]) =>
    org.prisma.auditEvent.findMany({
      where: { onboardingId, action: { in: actions } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  // What the mock inbox holds for an onboarding's new hire.
  const emailsTo = async ({ employee }: OnboardingDetail) =>
    mockEmailSchema
      .array()
      .parse((await org.hr.get('/mock-inbox').expect(200)).body)
      .filter((email) => email.toEmail === employee.email);
  // Engineering Onboarding, starting today unless told otherwise, for someone new with no
  // account, whom it therefore invites.
  const onboard = async (startsIn = 0) =>
    org.activate(
      await org.draftFor(
        await org.newHire(),
        org.engineering.id,
        org.day(startsIn),
      ),
    );

  beforeAll(async () => {
    app = await createApp(1);
    org = await seedOrg(app);
    const { emails } = org.seeded;
    const employeeOf = async (email: string) =>
      (await org.prisma.user.findUniqueOrThrow({ where: { email } }))
        .employeeId;
    duc = await employeeOf(emails.it);
    huy = await employeeOf(emails.it2);
    lan = await employeeOf(emails.hr);
    formTemplate = await org.publishedTemplate(managerForm);
  });

  afterAll(async () => {
    await org.prisma.organization.delete({ where: { id: org.organizationId } });
    await app.close();
  });

  it('AT-20 BR-S01 FR-15 a later or an earlier start date moves both dates of every task not done; one in progress is never locked again; a task done keeps its dates', async () => {
    const { hr, others } = org;
    // A draft only takes the date, unaudited, like PATCH.
    const draft = await org.draftFor(await org.newHire());
    expect(
      detailOf(await reschedule(hr, draft, org.day(9)).expect(200)),
    ).toMatchObject({ status: 'DRAFT', startDate: org.day(9), tasks: [] });
    expect(await auditOf(draft.id, 'onboarding.rescheduled')).toEqual([]);
    await reschedule(hr, { id: randomUUID() }, org.day(9)).expect(404);

    const onboarding = await onboard();
    // Both open a week before the start: Duc starts on the laptop, Minh on the buddy. Minh
    // also holds the welcome meeting.
    await others.IT.post(
      `/tasks/${taskOf(onboarding, 'Prepare laptop').id}/start`,
    ).expect(200);
    await others.manager
      .post(
        `/tasks/${taskOf(onboarding, 'Assign an onboarding buddy').id}/start`,
      )
      .expect(200);
    await complete(
      others.manager,
      taskOf(onboarding, 'Welcome meeting'),
    ).expect(200);
    const datesOf = (detail: OnboardingDetail, title: string) => {
      const { status, availableOn, dueOn, availability } = taskOf(
        detail,
        title,
      );
      return { status, availableOn, dueOn, availability };
    };

    // Two weeks later.
    const later = detailOf(
      await reschedule(hr, onboarding, org.day(14)).expect(200),
    );
    expect(later.startDate).toBe(org.day(14));
    expect(datesOf(later, 'Prepare laptop')).toEqual({
      status: 'IN_PROGRESS',
      availableOn: org.day(7),
      dueOn: org.day(11),
      availability: 'READY',
    });
    expect(datesOf(later, 'Assign an onboarding buddy')).toEqual({
      status: 'IN_PROGRESS',
      availableOn: org.day(7),
      dueOn: org.day(10),
      availability: 'READY',
    });
    // Not started, so it waits for its new date.
    expect(datesOf(later, 'Security awareness training')).toEqual({
      status: 'PENDING',
      availableOn: org.day(14),
      dueOn: org.day(18),
      availability: 'LOCKED_BY_DATE',
    });
    expect(datesOf(later, 'Welcome meeting')).toEqual({
      status: 'COMPLETED',
      availableOn: org.day(0),
      dueOn: org.day(0),
      availability: 'COMPLETED',
    });
    // Work under way goes on.
    await complete(
      others.manager,
      taskOf(later, 'Assign an onboarding buddy'),
    ).expect(200);

    // Then three days before the first date: both dates come forward.
    const sooner = detailOf(
      await reschedule(hr, onboarding, org.day(-3)).expect(200),
    );
    expect(datesOf(sooner, 'Prepare laptop')).toEqual({
      status: 'IN_PROGRESS',
      availableOn: org.day(-10),
      dueOn: org.day(-6),
      availability: 'READY',
    });
    expect(taskOf(sooner, 'Prepare laptop').overdue).toBe(true);
    expect(datesOf(sooner, 'Security awareness training')).toEqual({
      status: 'PENDING',
      availableOn: org.day(-3),
      dueOn: org.day(1),
      availability: 'READY',
    });
    expect(datesOf(sooner, 'Assign an onboarding buddy')).toEqual({
      status: 'COMPLETED',
      availableOn: org.day(7),
      dueOn: org.day(10),
      availability: 'COMPLETED',
    });
    expect(datesOf(sooner, 'Welcome meeting')).toMatchObject({
      availableOn: org.day(0),
      dueOn: org.day(0),
    });
    await complete(others.IT, taskOf(sooner, 'Prepare laptop')).expect(200);

    // The same date again changes nothing.
    await reschedule(hr, onboarding, org.day(-3)).expect(200);
    expect(
      (await auditOf(onboarding.id, 'onboarding.rescheduled')).map(
        (event) => event.data,
      ),
    ).toEqual([
      { from: org.day(0), to: org.day(14), dueReset: [] },
      { from: org.day(14), to: org.day(-3), dueReset: [] },
    ]);
  });

  it("AT-21 BR-S02 a deadline HR moved stays when the start date moves, unless the task would open after it: then the template's comes back, on record", async () => {
    const { hr } = org;
    const onboarding = await onboard();
    // Opens on the start date, due four days after it.
    const training = taskOf(onboarding, 'Security awareness training');
    await moveDue(hr, training, org.day(10)).expect(200);

    // Five days later, it opens before HR's deadline, which stays.
    let moved = detailOf(
      await reschedule(hr, onboarding, org.day(5)).expect(200),
    );
    expect(taskOf(moved, training.title)).toMatchObject({
      availableOn: org.day(5),
      dueOn: org.day(10),
      dueOverridden: true,
    });
    expect(taskOf(moved, 'Welcome meeting')).toMatchObject({
      dueOn: org.day(5),
      dueOverridden: false,
    });

    // Twelve days on, it would open after it.
    moved = detailOf(await reschedule(hr, onboarding, org.day(12)).expect(200));
    expect(taskOf(moved, training.title)).toMatchObject({
      availableOn: org.day(12),
      dueOn: org.day(16),
      dueOverridden: false,
    });
    expect(
      (await auditOf(onboarding.id, 'onboarding.rescheduled')).map(
        (event) => event.data,
      ),
    ).toEqual([
      { from: org.day(0), to: org.day(5), dueReset: [] },
      {
        from: org.day(5),
        to: org.day(12),
        dueReset: [{ taskId: training.id, from: org.day(10), to: org.day(16) }],
      },
    ]);
  });

  it("BR-S03 FR-14 HR moves the deadline of a task not done, never before it opens, and can put the template's back; each change is on record", async () => {
    const { hr, others } = org;
    const onboarding = await onboard();
    // Opens on the start date, due four days after it.
    const training = taskOf(onboarding, 'Security awareness training');

    const moved = detailOf(await moveDue(hr, training, org.day(9)).expect(200));
    expect(taskOf(moved, training.title)).toMatchObject({
      dueOn: org.day(9),
      dueOverridden: true,
    });
    expect(
      errorOf(await moveDue(hr, training, org.day(-1)).expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: `Pick ${org.day(0)} or later: the task opens then`,
    });
    const reset = detailOf(await moveDue(hr, training, null).expect(200));
    expect(taskOf(reset, training.title)).toMatchObject({
      dueOn: org.day(4),
      dueOverridden: false,
    });
    // Resetting again changes nothing.
    await moveDue(hr, training, null).expect(200);

    // An overdue task gets more time.
    const laptop = taskOf(onboarding, 'Prepare laptop');
    expect(laptop.overdue).toBe(true);
    const extended = detailOf(
      await moveDue(hr, laptop, org.day(2)).expect(200),
    );
    expect(taskOf(extended, laptop.title).overdue).toBe(false);

    // A task done keeps its deadline.
    const welcome = taskOf(onboarding, 'Welcome meeting');
    await complete(others.manager, welcome).expect(200);
    expect(errorOf(await moveDue(hr, welcome, org.day(3)).expect(409))).toEqual(
      { code: 'INVALID_STATE', message: 'A task done keeps its deadline' },
    );
    await moveDue(hr, { id: randomUUID() }, org.day(3)).expect(404);

    expect(
      (await auditOf(onboarding.id, 'task.due_changed', 'task.due_reset')).map(
        (event) => [event.action, event.entityId, event.data],
      ),
    ).toEqual([
      ['task.due_changed', training.id, { from: org.day(4), to: org.day(9) }],
      ['task.due_reset', training.id, { from: org.day(9), to: org.day(4) }],
      ['task.due_changed', laptop.id, { from: org.day(-3), to: org.day(2) }],
    ]);
  });

  it('BR-S04 FR-14 HR hands a task not done to someone else with an active account: from then on it is theirs to do, not the one before', async () => {
    const { hr, others } = org;
    const onboarding = await onboard();
    const laptop = taskOf(onboarding, 'Prepare laptop');

    const moved = detailOf(await reassign(hr, laptop, huy).expect(200));
    expect(taskOf(moved, laptop.title).assignee).toEqual({
      id: huy,
      fullName: 'Huy Le',
    });
    // Duc still sees it, through his other task here.
    expect(errorOf(await complete(others.IT, laptop).expect(403))).toEqual({
      code: 'FORBIDDEN',
      message: 'This task is assigned to someone else',
    });
    await complete(others.IT2, laptop).expect(200);
    expect(
      (await auditOf(onboarding.id, 'task.reassigned')).map((event) => [
        event.entityId,
        event.data,
      ]),
    ).toEqual([[laptop.id, { from: duc, to: huy }]]);

    // A task done stays with whoever did it.
    expect(errorOf(await reassign(hr, laptop, duc).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'A task done stays with whoever did it',
    });
    expect(
      errorOf(
        await reassign(
          hr,
          taskOf(onboarding, 'Sign the employee handbook'),
          huy,
        ).expect(409),
      ),
    ).toEqual({
      code: 'INVALID_STATE',
      message: "A new hire's own task stays theirs",
    });
    // Waiting on the review, but not done: it can change hands, though not to just anyone.
    const accounts = taskOf(onboarding, 'Create work accounts');
    expect(
      errorOf(await reassign(hr, accounts, await org.newHire()).expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Pick someone with an active account',
    });
    expect(
      errorOf(await reassign(hr, accounts, onboarding.employee.id).expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'The new hire only takes their own tasks',
    });
    await reassign(hr, accounts, randomUUID()).expect(404);
    await reassign(hr, { id: randomUUID() }, huy).expect(404);
    // Its own assignee: nothing changes.
    await reassign(hr, accounts, duc).expect(200);
    expect(await auditOf(onboarding.id, 'task.reassigned')).toHaveLength(1);
  });

  it('BR-S04 PLAN §6.4 a task handed on while its assignee completes it: one of the two goes through, never both', async () => {
    const onboarding = await onboard();
    const laptop = taskOf(onboarding, 'Prepare laptop');
    const [moved, done] = await Promise.all([
      reassign(org.hr, laptop, huy),
      complete(org.others.IT, laptop),
    ]);
    // Handed on first, Duc may no longer complete it; completed first, it stays his.
    expect([
      [200, 403],
      [409, 200],
    ]).toContainEqual([moved.status, done.status]);
    expect(taskOf(await read(org.hr, onboarding), laptop.title)).toMatchObject(
      done.status === 200
        ? { status: 'COMPLETED', assignee: { id: duc } }
        : { status: 'PENDING', assignee: { id: huy } },
    );
  });

  it('AT-19 BR-R01 an approval is never handed to whoever uploads the document it reviews, nor the document to its approver', async () => {
    const { hr } = org;
    const onboarding = await org.activate(
      await org.draftFor(await org.newHire(), formTemplate, org.day(0)),
    );
    // Minh, the new hire's manager, uploads it, and Lan reviews it.
    const form = taskOf(onboarding, 'Upload the equipment form');
    const review = taskOf(onboarding, 'Review the equipment form');
    expect(
      errorOf(await reassign(hr, review, org.managerId).expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'The approver cannot be whoever uploads the document',
    });
    expect(errorOf(await reassign(hr, form, lan).expect(400))).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Whoever uploads the document cannot be its approver',
    });
    // The check follows the review to its new approver.
    await reassign(hr, review, duc).expect(200);
    await reassign(hr, form, duc).expect(400);
    await reassign(hr, form, lan).expect(200);
    const after = await read(hr, onboarding);
    expect([
      taskOf(after, form.title).assignee.id,
      taskOf(after, review.title).assignee.id,
    ]).toEqual([lan, duc]);
  });

  it('BR-P03 BR-S04 a document handed on: its new assignee sees the files left to submit, and submits them', async () => {
    const { hr, others } = org;
    const onboarding = await org.activate(
      await org.draftFor(await org.newHire(), formTemplate, org.day(0)),
    );
    const form = taskOf(onboarding, 'Upload the equipment form');
    await others.manager
      .upload(`/tasks/${form.id}/files`, pdf(), 'form.pdf')
      .expect(201);
    await reassign(hr, form, duc).expect(200);

    // Duc sees what Minh left, and Minh, who uploaded it, still does.
    const [file] = taskOf(await read(others.IT, onboarding), form.title).files;
    expect(file).toMatchObject({ fileName: 'form.pdf' });
    await others.IT.get(`/files/${file.id}/download-url`).expect(200);
    expect(
      taskOf(await read(others.manager, onboarding), form.title).files,
    ).toHaveLength(1);
    // Minh no longer works on it; Duc submits it.
    await others.manager
      .upload(`/tasks/${form.id}/files`, pdf(), 'more.pdf')
      .expect(403);
    const submitted = detailOf(
      await others.IT.post(`/tasks/${form.id}/submit`).expect(200),
    );
    expect(taskOf(submitted, form.title).submissions).toMatchObject([
      { revision: 1, submittedBy: { id: duc }, files: [{ id: file.id }] },
    ]);
  });

  it('AT-22 BR-C03 FR-16 canceling an active onboarding cancels the tasks not done and keeps what was done; the account its invitation made is locked and signed out', async () => {
    const { hr, others, prisma } = org;
    const onboarding = await onboard();
    const [email] = await emailsTo(onboarding);
    const accepted = await accept(tokenOf(email.link)).expect(204);
    const newHire = clientFor(
      app,
      accepted.get('Set-Cookie')![0].split(';')[0],
    );
    // The new hire signs the handbook, and uploads an ID they never submit.
    await complete(
      newHire,
      taskOf(onboarding, 'Sign the employee handbook'),
    ).expect(200);
    const ids = taskOf(onboarding, 'Upload ID documents');
    await newHire.upload(`/tasks/${ids.id}/files`, pdf(), 'id.pdf').expect(201);

    const canceled = detailOf(
      await cancel(
        hr,
        onboarding,
        '  The candidate took another offer  ',
      ).expect(200),
    );
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.tasks).toHaveLength(11);
    expect(
      canceled.tasks
        .filter((task) => task.status !== 'CANCELED')
        .map((task) => [task.title, task.status]),
    ).toEqual([['Sign the employee handbook', 'COMPLETED']]);
    expect(
      await prisma.onboarding.findUniqueOrThrow({
        where: { id: onboarding.id },
        select: { cancelReason: true, canceledAt: true },
      }),
    ).toEqual({
      cancelReason: 'The candidate took another offer',
      canceledAt: expect.any(Date),
    });
    // The file and the audit trail stay.
    expect(await prisma.documentFile.count({ where: { taskId: ids.id } })).toBe(
      1,
    );
    expect(
      (
        await auditOf(
          onboarding.id,
          'invitation.accepted',
          'task.completed',
          'file.uploaded',
          'onboarding.canceled',
        )
      ).map((event) => event.action),
    ).toEqual([
      'invitation.accepted',
      'task.completed',
      'file.uploaded',
      'onboarding.canceled',
    ]);

    // Locked and signed out.
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { employeeId: onboarding.employee.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'DISABLED' });
    expect(errorOf(await newHire.get('/auth/me').expect(401)).code).toBe(
      'UNAUTHENTICATED',
    );
    await login(onboarding.employee.email).expect(401);

    // Nothing moves any more.
    expect(
      errorOf(
        await complete(
          others.manager,
          taskOf(onboarding, 'Welcome meeting'),
        ).expect(409),
      ),
    ).toEqual({
      code: 'INVALID_STATE',
      message: 'This onboarding is no longer active',
    });
    expect(errorOf(await cancel(hr, onboarding).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'This onboarding is already finished',
    });
    expect(
      errorOf(await reschedule(hr, onboarding, org.day(7)).expect(409)),
    ).toEqual({
      code: 'INVALID_STATE',
      message: 'A finished onboarding keeps its dates',
    });
    const laptop = taskOf(onboarding, 'Prepare laptop');
    await reassign(hr, laptop, huy).expect(409);
    await moveDue(hr, laptop, org.day(2)).expect(409);
  });

  it('AT-22 BR-C03 BR-P05 a draft or an active onboarding is canceled once, with a reason; its link stops working; whoever had an account before keeps it', async () => {
    const { hr, others, prisma } = org;
    // A draft has nothing else to cancel.
    const draft = await org.draftFor(await org.newHire());
    expect(errorOf(await cancel(hr, draft, '   ').expect(400)).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(detailOf(await cancel(hr, draft).expect(200))).toMatchObject({
      status: 'CANCELED',
      tasks: [],
    });
    await cancel(hr, { id: randomUUID() }).expect(404);

    // A link not yet used stops working.
    const invited = await onboard();
    const [email] = await emailsTo(invited);
    await cancel(hr, invited).expect(200);
    expect((await read(hr, invited)).invitation).toMatchObject({
      acceptedAt: null,
      revokedAt: expect.any(String),
    });
    expect(errorOf(await accept(tokenOf(email.link)).expect(410)).code).toBe(
      'INVITATION_INVALID',
    );

    // An Vo had an account before this onboarding, which stays.
    const anVo = await org.activate(
      await org.draftFor(org.anVo.id, org.engineering.id, org.day(0)),
    );
    await cancel(hr, anVo).expect(200);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { employeeId: org.anVo.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'ACTIVE' });
    await others.An.get('/auth/me').expect(200);
  });

  it('BR-C03 BR-A07 a new hire locked out by a canceled onboarding gets back in with their password once HR activates a new one, with no new invitation', async () => {
    const first = await onboard();
    const [email] = await emailsTo(first);
    await accept(tokenOf(email.link)).expect(204);
    await cancel(org.hr, first).expect(200);
    await login(first.employee.email).expect(401);

    const second = await org.activate(
      await org.draftFor(first.employee.id, org.engineering.id, org.day(7)),
    );
    expect(second.invitation).toBeNull();
    expect(await emailsTo(second)).toHaveLength(1);
    await login(first.employee.email).expect(204);
  });

  it('AT-06 BR-C03 BR-S03 BR-S04 §9 only HR reschedules or cancels an onboarding, hands on a task or moves its deadline', async () => {
    const onboarding = await onboard();
    const laptop = taskOf(onboarding, 'Prepare laptop');
    for (const [who, client] of Object.entries(org.others)) {
      const rescheduled = await reschedule(client, onboarding, org.day(7));
      const canceled = await cancel(client, onboarding);
      const reassigned = await reassign(client, laptop, huy);
      const dueMoved = await moveDue(client, laptop, org.day(2));
      expect({
        who,
        rescheduled: rescheduled.status,
        canceled: canceled.status,
        reassigned: reassigned.status,
        dueMoved: dueMoved.status,
      }).toEqual({
        who,
        rescheduled: 403,
        canceled: 403,
        reassigned: 403,
        dueMoved: 403,
      });
    }
    const after = await read(org.hr, onboarding);
    expect(after).toMatchObject({ status: 'ACTIVE', startDate: org.day(0) });
    expect(taskOf(after, laptop.title)).toMatchObject({
      assignee: { id: duc },
      dueOn: org.day(-3),
      dueOverridden: false,
    });
  });
});
