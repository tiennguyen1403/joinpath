import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  myTasksSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  type TaskDef,
  type TemplateDefinition,
} from '@joinpath/core';
import type { App } from 'supertest/types.js';
import {
  type Client,
  createApp,
  errorOf,
  type Org,
  pdf,
  png,
  seedOrg,
} from './app.js';

// A contract the new hire uploads, with or without the manager's review: either way it can be
// the last task.
const contract: TaskDef = {
  key: 'contract',
  phase: 'day-1',
  title: 'Upload the signed contract',
  type: 'DOCUMENT',
  assignee: { kind: 'NEW_HIRE' },
  availableOffsetDays: 0,
  dueOffsetDays: 0,
  dependsOn: [],
};
const unreviewed: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [contract],
};
const reviewed: TemplateDefinition = {
  ...unreviewed,
  tasks: [
    contract,
    {
      key: 'review-contract',
      phase: 'day-1',
      title: 'Review the contract',
      type: 'APPROVAL',
      assignee: { kind: 'DIRECT_MANAGER' },
      reviews: 'contract',
      availableOffsetDays: 0,
      dueOffsetDays: 1,
      dependsOn: [],
    },
  ],
};

const forbidden = {
  code: 'FORBIDDEN',
  message: 'This task is assigned to someone else',
};
const notFound = { code: 'NOT_FOUND', message: 'Task not found' };

// Logins in one app share a throttle bucket (10 per minute, BR-P06): seedOrg signs in six
// people, so this file signs in four more at most.
describe('reviews', () => {
  let app: INestApplication<App>;
  let org: Org;
  // HR, who reviews the ID documents of Engineering Onboarding.
  let lan: { id: string; fullName: string };

  const detailOf = (res: { body: unknown }) =>
    onboardingDetailSchema.parse(res.body);
  const read = async (client: Client, { id }: { id: string }) =>
    detailOf(await client.get(`/onboardings/${id}`).expect(200));
  // A title is unique within a template (BR-T04).
  const taskOf = (onboarding: OnboardingDetail, title: string) =>
    onboarding.tasks.find((task) => task.title === title)!;
  const upload = (
    client: Client,
    { id }: { id: string },
    bytes: Buffer,
    fileName: string,
  ) => client.upload(`/tasks/${id}/files`, bytes, fileName);
  const submit = (client: Client, { id }: { id: string }) =>
    client.post(`/tasks/${id}/submit`);
  const approve = (
    client: Client,
    { id }: { id: string },
    submissionId: string,
  ) => client.post(`/tasks/${id}/approve`, { submissionId });
  const reject = (
    client: Client,
    { id }: { id: string },
    submissionId: string,
    reason: string,
  ) => client.post(`/tasks/${id}/reject`, { submissionId, reason });
  const decisionsOn = ({ id }: { id: string }) =>
    org.prisma.approvalDecision.findMany({ where: { approvalTaskId: id } });
  // Activated from Engineering Onboarding unless told otherwise, starting today.
  const onboard = async (employeeId: string, templateId = org.engineering.id) =>
    org.activate(await org.draftFor(employeeId, templateId, org.day(0)));
  // The new hire has submitted their ID: revision 1 waits for HR's review.
  const submitted = async (hire: { id: string; client: Client }) => {
    const onboarding = await onboard(hire.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    await upload(hire.client, ids, pdf(), 'id.pdf').expect(201);
    const res = await submit(hire.client, ids).expect(200);
    const [revision] = taskOf(detailOf(res), 'Upload ID documents').submissions;
    return {
      onboarding,
      ids,
      review: taskOf(onboarding, 'Review ID documents'),
      revision,
    };
  };

  beforeAll(async () => {
    app = await createApp();
    org = await seedOrg(app);
    lan = await org.prisma.employee.findFirstOrThrow({
      where: { organizationId: org.organizationId, fullName: 'Lan Pham' },
      select: { id: true, fullName: true },
    });
  });

  afterAll(async () => {
    await org.prisma.organization.delete({ where: { id: org.organizationId } });
    await app.close();
  });

  it('AT-15 BR-R05 BR-R06 BR-R07 FR-12 FR-13 sent back, the document reopens with its files and the reason; revision 2 is approved, which opens what waited on the review, and both decisions stay on record', async () => {
    const hire = await org.hireWithAccount();
    const onboarding = await onboard(hire.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    const review = taskOf(onboarding, 'Review ID documents');
    await upload(hire.client, ids, pdf(), 'id-card-front.pdf').expect(201);
    const uploaded = await upload(
      hire.client,
      ids,
      pdf(),
      'tax-registration.pdf',
    ).expect(201);
    const draft = taskOf(detailOf(uploaded), 'Upload ID documents').files;

    // Submitted, the document is done and its review opens (PLAN §4.5).
    const first = detailOf(await submit(hire.client, ids).expect(200));
    const done = taskOf(first, 'Upload ID documents');
    expect(done).toMatchObject({
      status: 'COMPLETED',
      availability: 'COMPLETED',
      files: [],
    });
    expect(done.submissions).toEqual([
      {
        id: expect.any(String),
        revision: 1,
        submittedBy: { id: hire.id, fullName: hire.fullName },
        submittedAt: done.completedAt,
        files: draft,
        decision: null,
      },
    ]);
    expect(taskOf(first, 'Review ID documents').availability).toBe('READY');

    // HR sends it back with a reason (BR-R06).
    const [revision1] = done.submissions;
    const reason =
      'The back of your ID card is missing. Please add a photo of both sides.';
    const sentBack = detailOf(
      await reject(org.hr, review, revision1.id, reason).expect(200),
    );
    const rejected = {
      ...revision1,
      decision: {
        decision: 'REJECTED',
        reason,
        decidedBy: lan,
        decidedAt: expect.any(String),
      },
    };
    // Open again, with copies of revision 1's files to start the next one from.
    const reopened = taskOf(sentBack, 'Upload ID documents');
    expect(reopened).toMatchObject({
      status: 'IN_PROGRESS',
      availability: 'READY',
      completedAt: null,
      submissions: [rejected],
    });
    expect(reopened.files).toEqual(
      draft.map((file) => ({
        ...file,
        id: expect.any(String),
        carriedOver: true,
      })),
    );
    expect(reopened.files.map((file) => file.id)).not.toContain(draft[0].id);
    // The review waits for that next revision, and so does what waits on the review.
    expect(taskOf(sentBack, 'Review ID documents')).toMatchObject({
      status: 'PENDING',
      availability: 'BLOCKED',
    });
    expect(taskOf(sentBack, 'Create work accounts').availability).toBe(
      'BLOCKED',
    );
    // The new hire finds the reason with their task.
    const mine = myTasksSchema.parse(
      (await hire.client.get('/tasks/mine').expect(200)).body,
    );
    expect(
      mine.tasks.find((task) => task.id === ids.id)?.submissions,
    ).toMatchObject([{ decision: { decision: 'REJECTED', reason } }]);

    // They add the back: revision 2 keeps the two files it didn't change.
    await upload(hire.client, ids, png(), 'id-card-back.png').expect(201);
    const second = detailOf(await submit(hire.client, ids).expect(200));
    const [revision2, before] = taskOf(
      second,
      'Upload ID documents',
    ).submissions;
    expect(revision2).toMatchObject({ revision: 2, decision: null });
    expect(
      revision2.files.map(({ fileName, carriedOver }) => [
        fileName,
        carriedOver,
      ]),
    ).toEqual([
      ['id-card-front.pdf', true],
      ['tax-registration.pdf', true],
      ['id-card-back.png', false],
    ]);
    // Revision 1 is as it was (BR-R07).
    expect(before).toEqual(rejected);

    // HR approves it (BR-R05), which opens the accounts IT creates.
    const approved = detailOf(
      await approve(org.hr, review, revision2.id).expect(200),
    );
    expect(taskOf(approved, 'Review ID documents')).toMatchObject({
      status: 'COMPLETED',
      availability: 'COMPLETED',
    });
    expect(taskOf(approved, 'Create work accounts').availability).toBe('READY');
    const history = taskOf(approved, 'Upload ID documents');
    expect(history.status).toBe('COMPLETED');
    expect(
      history.submissions.map(({ revision, decision }) => [
        revision,
        decision?.decision,
        decision?.reason,
        decision?.decidedBy,
      ]),
    ).toEqual([
      [2, 'APPROVED', null, lan],
      [1, 'REJECTED', reason, lan],
    ]);
    expect(
      await org.prisma.auditEvent.findMany({
        where: {
          onboardingId: onboarding.id,
          action: { startsWith: 'document.' },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, data: true },
      }),
    ).toEqual([
      { action: 'document.submitted', data: { taskId: ids.id, revision: 1 } },
      { action: 'document.rejected', data: { taskId: review.id, revision: 1 } },
      { action: 'document.submitted', data: { taskId: ids.id, revision: 2 } },
      { action: 'document.approved', data: { taskId: review.id, revision: 2 } },
    ]);
  });

  it('AT-16 BR-R04 a rejection says why: without a reason it is refused and nothing changes; the reason is kept trimmed', async () => {
    const hire = await org.hireWithAccount();
    const { onboarding, review, revision } = await submitted(hire);
    for (const reason of [undefined, '', '   ', 'x'.repeat(1001)]) {
      const res = await org.hr
        .post(`/tasks/${review.id}/reject`, {
          submissionId: revision.id,
          reason,
        })
        .expect(400);
      expect(errorOf(res)).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ path: ['reason'] })],
      });
    }
    // Nothing decided: the document stays submitted, its review open.
    expect(await decisionsOn(review)).toEqual([]);
    const unchanged = await read(org.hr, onboarding);
    expect(taskOf(unchanged, 'Upload ID documents').status).toBe('COMPLETED');
    expect(taskOf(unchanged, 'Review ID documents').availability).toBe('READY');
    // The table refuses one too (PLAN §7).
    await expect(
      org.prisma.approvalDecision.create({
        data: {
          organizationId: org.organizationId,
          approvalTaskId: review.id,
          submissionId: revision.id,
          decision: 'REJECTED',
          decidedById: lan.id,
          decidedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/approval_decisions_reason_check/);

    await reject(
      org.hr,
      review,
      revision.id,
      '  The photo is blurry.  ',
    ).expect(200);
    expect(await decisionsOn(review)).toMatchObject([
      { decision: 'REJECTED', reason: 'The photo is blurry.' },
    ]);
  });

  it('AT-17 BR-R02 a decision is on the newest revision only: an older one is stale, and while the document is reworked there is none to decide on', async () => {
    const hire = await org.hireWithAccount();
    const { ids, review, revision: first } = await submitted(hire);
    await reject(org.hr, review, first.id, 'Add the back').expect(200);
    // The review waits for the next revision, as for any prerequisite (BR-E01).
    const waits = {
      code: 'TASK_NOT_ELIGIBLE',
      message: 'This task waits for other tasks to be done',
    };
    expect(
      errorOf(await approve(org.hr, review, first.id).expect(409)),
    ).toEqual(waits);
    expect(
      errorOf(await reject(org.hr, review, first.id, 'Again').expect(409)),
    ).toEqual(waits);

    await upload(hire.client, ids, png(), 'back.png').expect(201);
    await submit(hire.client, ids).expect(200);
    const stale = {
      code: 'STALE_SUBMISSION',
      message: 'Revision 2 replaced this one',
    };
    expect(
      errorOf(await approve(org.hr, review, first.id).expect(409)),
    ).toEqual(stale);
    expect(
      errorOf(await reject(org.hr, review, first.id, 'Again').expect(409)),
    ).toEqual(stale);
    // Not a revision of the reviewed document at all.
    expect(
      errorOf(await approve(org.hr, review, randomUUID()).expect(404)),
    ).toEqual({ code: 'NOT_FOUND', message: 'Submission not found' });
    expect(await decisionsOn(review)).toMatchObject([
      { submissionId: first.id, decision: 'REJECTED' },
    ]);
  });

  it('AT-18 BR-R03 PLAN §6.4 an approval and a rejection at once on one revision: one decision is kept, and the tasks follow it', async () => {
    const hire = await org.hireWithAccount();
    const { onboarding, review, revision } = await submitted(hire);
    const both = await Promise.all([
      approve(org.hr, review, revision.id),
      reject(org.hr, review, revision.id, 'The photo is blurry.'),
    ]);
    expect(both.map((res) => res.status).toSorted((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const decisions = await decisionsOn(review);
    expect(decisions).toHaveLength(1);
    const after = await read(org.hr, onboarding);
    expect({
      document: taskOf(after, 'Upload ID documents').status,
      review: taskOf(after, 'Review ID documents').status,
    }).toEqual(
      decisions[0].decision === 'APPROVED'
        ? { document: 'COMPLETED', review: 'COMPLETED' }
        : { document: 'IN_PROGRESS', review: 'PENDING' },
    );
  });

  it('BR-E04 BR-E01 PLAN §8 the new hire submits what they uploaded, one file at least, and then changes nothing; only the approver decides, once', async () => {
    const { An, IT2 } = org.others;
    const onboarding = await onboard(org.anVo.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    const review = taskOf(onboarding, 'Review ID documents');
    expect(errorOf(await submit(An, ids).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'Upload a file before submitting',
    });
    await upload(An, ids, pdf(), 'id.pdf').expect(201);
    // As any work on a task (BR-E01): HR sees it, Huy doesn't.
    expect(errorOf(await submit(org.hr, ids).expect(403))).toEqual(forbidden);
    expect(errorOf(await submit(IT2, ids).expect(404))).toEqual(notFound);
    const handbook = taskOf(onboarding, 'Sign the employee handbook');
    expect(errorOf(await submit(An, handbook).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'Only a document task takes files',
    });
    const res = await submit(An, ids).expect(200);
    const [revision] = taskOf(detailOf(res), 'Upload ID documents').submissions;

    // Submitted, no file comes or goes until a rejection reopens it (BR-E04).
    const submittedAlready = {
      code: 'INVALID_STATE',
      message: 'The document is already submitted',
    };
    expect(
      errorOf(await upload(An, ids, pdf(), 'more.pdf').expect(409)),
    ).toEqual(submittedAlready);
    const [file] = revision.files;
    expect(
      errorOf(await An.delete(`/tasks/${ids.id}/files/${file.id}`).expect(409)),
    ).toEqual(submittedAlready);
    expect(errorOf(await submit(An, ids).expect(409))).toEqual(
      submittedAlready,
    );

    // HR reviews it (PLAN §9): An sees the review but doesn't decide; Huy doesn't see it.
    expect(errorOf(await approve(An, review, revision.id).expect(403))).toEqual(
      forbidden,
    );
    expect(
      errorOf(await reject(IT2, review, revision.id, 'No').expect(404)),
    ).toEqual(notFound);
    expect(errorOf(await approve(An, ids, revision.id).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'Only an approval task is approved or rejected',
    });
    await approve(org.hr, review, revision.id).expect(200);
    // Once (BR-R03).
    const approvedAlready = {
      code: 'INVALID_STATE',
      message: 'The document is already approved',
    };
    expect(
      errorOf(await approve(org.hr, review, revision.id).expect(409)),
    ).toEqual(approvedAlready);
    expect(
      errorOf(
        await reject(org.hr, review, revision.id, 'Too late').expect(409),
      ),
    ).toEqual(approvedAlready);
    expect(await decisionsOn(review)).toHaveLength(1);
  });

  it('BR-C01 BR-R05 the last task done completes the onboarding, be it an approval or a document no approval reviews', async () => {
    const { Bao, manager } = org.others;
    const lastOf = async (onboarding: OnboardingDetail) => {
      const doc = taskOf(onboarding, 'Upload the signed contract');
      await upload(Bao, doc, pdf(), 'contract.pdf').expect(201);
      return detailOf(await submit(Bao, doc).expect(200));
    };

    // The manager approves last.
    const first = await onboard(
      org.baoHo.id,
      await org.publishedTemplate(reviewed),
    );
    const [revision] = taskOf(
      await lastOf(first),
      'Upload the signed contract',
    ).submissions;
    const approved = detailOf(
      await approve(
        manager,
        taskOf(first, 'Review the contract'),
        revision.id,
      ).expect(200),
    );
    expect(approved).toMatchObject({
      status: 'COMPLETED',
      completedAt: taskOf(approved, 'Review the contract').completedAt,
    });

    // Nobody reviews this one: submitted, it is done at once, with no decision to come.
    const second = await lastOf(
      await onboard(org.baoHo.id, await org.publishedTemplate(unreviewed)),
    );
    const done = taskOf(second, 'Upload the signed contract');
    expect(second).toMatchObject({
      status: 'COMPLETED',
      completedAt: done.completedAt,
    });
    expect(done.submissions).toMatchObject([{ revision: 1, decision: null }]);
    expect(
      await org.prisma.auditEvent.count({
        where: {
          onboardingId: { in: [first.id, second.id] },
          action: 'onboarding.completed',
        },
      }),
    ).toBe(2);
  });
});
