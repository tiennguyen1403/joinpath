import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  downloadUrlSchema,
  MAX_FILE_BYTES,
  myTasksSchema,
  type OnboardingDetail,
  onboardingDetailSchema,
  type TemplateDefinition,
} from '@joinpath/core';
import { AwsClient } from 'aws4fetch';
import type { App } from 'supertest/types.js';
import {
  type Client,
  createApp,
  errorOf,
  giveAccount,
  type Org,
  seedOrg,
  signIn,
} from './app.js';

// A document the new hire's manager reviews, and a task for IT, who therefore sees the
// onboarding. The IT task's key takes seedOrg's pick for it.
const reviewedByManager: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [
    {
      key: 'contract',
      phase: 'day-1',
      title: 'Upload the signed contract',
      type: 'DOCUMENT',
      assignee: { kind: 'NEW_HIRE' },
      availableOffsetDays: 0,
      dueOffsetDays: 0,
      dependsOn: [],
    },
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
    {
      key: 'prepare-laptop',
      phase: 'day-1',
      title: 'Hand over a laptop',
      type: 'CHECKLIST',
      assignee: { kind: 'ROLE', role: 'IT' },
      availableOffsetDays: 0,
      dueOffsetDays: 0,
      dependsOn: [],
    },
  ],
};

// Bytes that open as BR-P04's types, whatever comes after.
const pdf = (size = 64) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 0x20)]);
const png = () =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

// What the bucket holds under a task, read straight from storage (ListObjectsV2).
const s3 = new AwsClient({
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  service: 's3',
  region: process.env.S3_REGION!,
});

// Logins in one app share a throttle bucket (10 per minute, BR-P06): seedOrg signs in six
// people, so this file signs in four more at most.
describe('documents', () => {
  let app: INestApplication<App>;
  let org: Org;

  const detailOf = (res: { body: unknown }) =>
    onboardingDetailSchema.parse(res.body);
  // A title is unique within a template (BR-T04).
  const taskOf = (onboarding: OnboardingDetail, title: string) =>
    onboarding.tasks.find((task) => task.title === title)!;
  const read = async (client: Client, { id }: { id: string }) =>
    detailOf(await client.get(`/onboardings/${id}`).expect(200));
  const upload = (
    client: Client,
    { id }: { id: string },
    bytes: Buffer,
    fileName: string,
  ) => client.upload(`/tasks/${id}/files`, bytes, fileName);
  const linkOf = async (client: Client, { id }: { id: string }) =>
    downloadUrlSchema.parse(
      (await client.get(`/files/${id}/download-url`).expect(200)).body,
    );
  const rowsOf = ({ id }: { id: string }) =>
    org.prisma.documentFile.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    });
  const keysOf = async ({ id }: { id: string }) => {
    const url = new URL(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', `orgs/${org.organizationId}/tasks/${id}/`);
    const xml = await (await s3.fetch(url)).text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
  };
  // Activated from Engineering Onboarding, starting `startsIn` days from today. Its ID upload
  // is the new hire's, open from two weeks before the start, and HR reviews it.
  const onboard = async (employeeId: string, startsIn = 0) =>
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

  beforeAll(async () => {
    app = await createApp();
    org = await seedOrg(app);
  });

  afterAll(async () => {
    await org.prisma.organization.delete({ where: { id: org.organizationId } });
    await app.close();
  });

  it('BR-E04 FR-11 the first upload starts a document; each answers with the onboarding, which lists the files to their uploader', async () => {
    const { An } = org.others;
    const onboarding = await onboard(org.anVo.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    expect(ids).toMatchObject({
      status: 'PENDING',
      availability: 'READY',
      files: [],
    });

    const first = await upload(An, ids, pdf(), 'Hộ chiếu.pdf').expect(201);
    // The onboarding as its detail now reads.
    expect(first.body).toEqual(
      (await An.get(`/onboardings/${onboarding.id}`).expect(200)).body,
    );
    const started = taskOf(detailOf(first), 'Upload ID documents');
    expect(started).toEqual({
      ...ids,
      status: 'IN_PROGRESS',
      startedAt: expect.any(String),
      files: [
        {
          id: expect.any(String),
          fileName: 'Hộ chiếu.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 64,
          uploadedAt: expect.any(String),
        },
      ],
    });

    // The type comes from the bytes, never the name (BR-P04).
    const res = await upload(An, ids, png(), 'selfie.pdf').expect(201);
    const second = taskOf(detailOf(res), 'Upload ID documents');
    expect(second).toEqual({
      ...started,
      files: [
        ...started.files,
        {
          id: expect.any(String),
          fileName: 'selfie.pdf',
          mimeType: 'image/png',
          sizeBytes: 12,
          uploadedAt: expect.any(String),
        },
      ],
    });
    const mine = myTasksSchema.parse(
      (await An.get('/tasks/mine').expect(200)).body,
    );
    expect(mine.tasks.find((task) => task.id === ids.id)?.files).toEqual(
      second.files,
    );

    // Each object sits under its org and task, named by the server (BR-P04).
    const rows = await rowsOf(ids);
    expect(rows.map((row) => row.storageKey)).toEqual(
      rows.map(() =>
        expect.stringMatching(
          new RegExp(
            `^orgs/${org.organizationId}/tasks/${ids.id}/[0-9a-f-]{36}$`,
          ),
        ),
      ),
    );
    expect((await keysOf(ids)).toSorted()).toEqual(
      rows.map((row) => row.storageKey).toSorted(),
    );
    const anUser = await org.prisma.user.findUniqueOrThrow({
      where: { email: org.anVo.email },
    });
    expect(
      await org.prisma.auditEvent.findMany({
        where: { onboardingId: onboarding.id, entityType: 'document_file' },
        orderBy: { createdAt: 'asc' },
        select: { actorUserId: true, action: true, entityId: true, data: true },
      }),
    ).toEqual(
      second.files.map((file) => ({
        actorUserId: anUser.id,
        action: 'file.uploaded',
        entityId: file.id,
        data: { taskId: ids.id, fileName: file.fileName },
      })),
    );
  });

  it('AT-29 BR-P04 a file is refused unless its first bytes make it a PDF, PNG or JPEG, and above 4 MB; nothing is kept', async () => {
    const hire = await hireWithAccount();
    const onboarding = await onboard(hire.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    // A Windows program, renamed to pass for a PDF.
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00', 'latin1');
    expect(
      errorOf(await upload(hire.client, ids, exe, 'passport.pdf').expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Upload a PDF, PNG or JPEG',
    });
    const tooBig = pdf(MAX_FILE_BYTES + 1);
    expect(
      errorOf(await upload(hire.client, ids, tooBig, 'scan.pdf').expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'A file can be 4 MB at most',
    });
    expect(
      errorOf(await hire.client.post(`/tasks/${ids.id}/files`).expect(400)),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Choose a file to upload',
    });

    // Nothing stored, nothing started, nothing on record.
    expect(await rowsOf(ids)).toEqual([]);
    expect(await keysOf(ids)).toEqual([]);
    expect(
      taskOf(await read(org.hr, onboarding), 'Upload ID documents'),
    ).toEqual(ids);
    expect(
      await org.prisma.auditEvent.count({
        where: { onboardingId: onboarding.id, entityType: 'document_file' },
      }),
    ).toBe(0);
    // Exactly 4 MB is fine.
    await upload(hire.client, ids, pdf(MAX_FILE_BYTES), 'scan.pdf').expect(201);
  });

  it('BR-P04 PLAN §6.4 a submission takes five files at most, counted under the lock: of two uploads at once for the last place, one gets it', async () => {
    const hire = await hireWithAccount();
    const ids = taskOf(await onboard(hire.id), 'Upload ID documents');
    for (const page of [1, 2, 3, 4]) {
      await upload(hire.client, ids, pdf(), `page-${page}.pdf`).expect(201);
    }
    const both = await Promise.all([
      upload(hire.client, ids, pdf(), 'page-5.pdf'),
      upload(hire.client, ids, pdf(), 'page-6.pdf'),
    ]);
    expect(both.map((res) => res.status).toSorted((a, b) => a - b)).toEqual([
      201, 400,
    ]);
    expect(errorOf(both.find((res) => res.status === 400)!)).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'A submission takes 5 files at most',
    });
    const res = await upload(hire.client, ids, png(), 'page-7.png').expect(400);
    expect(errorOf(res).message).toBe('A submission takes 5 files at most');
    // The refused ones left nothing in the bucket.
    const rows = await rowsOf(ids);
    expect(rows).toHaveLength(5);
    expect((await keysOf(ids)).toSorted()).toEqual(
      rows.map((row) => row.storageKey).toSorted(),
    );
  });

  it('AT-26 AT-27 BR-P02 BR-P03 FR-11 a file is seen by its uploader, the approver of its review and HR; to anyone else it is a 404, even who sees the onboarding', async () => {
    const templateId = await org.publishedTemplate(reviewedByManager);
    const hire = await hireWithAccount();
    const onboarding = await org.activate(
      await org.draftFor(hire.id, templateId, org.day(0)),
    );
    const contract = taskOf(onboarding, 'Upload the signed contract');
    const bytes = pdf(100);
    const fileName = 'Hợp đồng "đã ký".pdf';
    const res = await upload(hire.client, contract, bytes, fileName).expect(
      201,
    );
    const [file] = taskOf(detailOf(res), 'Upload the signed contract').files;

    // The new hire, the manager who reviews it and HR each get a link that downloads it.
    for (const client of [hire.client, org.others.manager, org.hr]) {
      const asked = Date.now();
      const { url, expiresAt } = await linkOf(client, file);
      const answered = Date.now();
      // Five minutes (PLAN §9), from the moment the API signed it.
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
      expect(Date.parse(expiresAt)).toBeGreaterThanOrEqual(asked + 300_000);
      expect(Date.parse(expiresAt)).toBeLessThanOrEqual(answered + 300_000);
      const download = await fetch(url);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('application/pdf');
      const disposition = download.headers.get('content-disposition')!;
      expect(disposition).toMatch(
        /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/,
      );
      expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe(
        fileName,
      );
      expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    }

    // Duc has a task in the onboarding but doesn't review the contract (AT-27); Huy has
    // nothing in it; An is another new hire who knows the id (AT-26).
    for (const client of [org.others.IT, org.others.IT2, org.others.An]) {
      const refused = await client.get(`/files/${file.id}/download-url`);
      expect(refused.status).toBe(404);
      expect(errorOf(refused)).toEqual({
        code: 'NOT_FOUND',
        message: 'File not found',
      });
    }
    await org.hr.get(`/files/${randomUUID()}/download-url`).expect(404);
    const malformed = await org.hr.get('/files/not-a-uuid/download-url');
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');

    // The onboarding lists the file only to those who may see it.
    const listed = async (client: Client) =>
      taskOf(await read(client, onboarding), 'Upload the signed contract')
        .files;
    expect(await listed(org.hr)).toEqual([file]);
    expect(await listed(org.others.manager)).toEqual([file]);
    expect(await listed(org.others.IT)).toEqual([]);
  });

  it('PLAN §7 BR-R07 the assignee deletes a file not yet submitted, object and all; a submitted one is kept', async () => {
    const hire = await hireWithAccount();
    const onboarding = await onboard(hire.id);
    const ids = taskOf(onboarding, 'Upload ID documents');
    await upload(hire.client, ids, pdf(), 'front.pdf').expect(201);
    const uploaded = await upload(hire.client, ids, png(), 'back.png').expect(
      201,
    );
    const [front, back] = taskOf(
      detailOf(uploaded),
      'Upload ID documents',
    ).files;
    const { url } = await linkOf(org.hr, front);
    const remove = (client: Client, { id }: { id: string }) =>
      client.delete(`/tasks/${ids.id}/files/${id}`);

    // Only the assignee, like any work on the task (BR-E01).
    expect(errorOf(await remove(org.hr, front).expect(403))).toEqual({
      code: 'FORBIDDEN',
      message: 'This task is assigned to someone else',
    });
    const res = await remove(hire.client, front).expect(200);
    // Still started, though fewer files.
    expect(taskOf(detailOf(res), 'Upload ID documents')).toMatchObject({
      status: 'IN_PROGRESS',
      files: [back],
    });
    // Out of the bucket too: a link signed before finds nothing.
    expect((await fetch(url)).status).toBe(404);
    expect(await keysOf(ids)).toHaveLength(1);
    expect(errorOf(await remove(hire.client, front).expect(404))).toEqual({
      code: 'NOT_FOUND',
      message: 'File not found',
    });
    await remove(hire.client, { id: randomUUID() }).expect(404);

    // Submitting comes in M2.3: a revision made by hand takes the other file.
    await org.prisma.documentSubmission.create({
      data: {
        organizationId: org.organizationId,
        taskId: ids.id,
        revision: 1,
        submittedById: hire.id,
        submittedAt: new Date(),
        files: { connect: { id: back.id } },
      },
    });
    expect(errorOf(await remove(hire.client, back).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: "A submitted file can't be deleted",
    });
    // A submitted file is no longer one for the next submission.
    expect(
      taskOf(await read(org.hr, onboarding), 'Upload ID documents').files,
    ).toEqual([]);
    expect(
      await org.prisma.auditEvent.findMany({
        where: { onboardingId: onboarding.id, action: 'file.deleted' },
        select: { entityId: true, data: true },
      }),
    ).toEqual([
      { entityId: front.id, data: { taskId: ids.id, fileName: 'front.pdf' } },
    ]);
  });

  it('BR-E01 PLAN §8 only the assignee uploads, to a document that is open: 404, 403, 409 as for start and complete; nothing is kept', async () => {
    // Twenty days ahead: the upload opens in six.
    const onboarding = await onboard(org.baoHo.id, 20);
    const ids = taskOf(onboarding, 'Upload ID documents');
    const { Bao, IT2 } = org.others;
    expect(
      errorOf(await upload(Bao, ids, pdf(), 'id.pdf').expect(409)),
    ).toEqual({
      code: 'TASK_NOT_ELIGIBLE',
      message: `This task opens on ${org.day(6)}`,
    });
    expect(
      errorOf(await upload(org.hr, ids, pdf(), 'id.pdf').expect(403)),
    ).toEqual({
      code: 'FORBIDDEN',
      message: 'This task is assigned to someone else',
    });
    expect(
      errorOf(await upload(IT2, ids, pdf(), 'id.pdf').expect(404)),
    ).toEqual({
      code: 'NOT_FOUND',
      message: 'Task not found',
    });
    // Neither a checklist nor the review takes a file.
    const others: [Client, string][] = [
      [Bao, 'Sign the employee handbook'],
      [org.hr, 'Review ID documents'],
    ];
    for (const [client, title] of others) {
      const task = taskOf(onboarding, title);
      expect(
        errorOf(await upload(client, task, pdf(), 'id.pdf').expect(409)),
      ).toEqual({
        code: 'INVALID_STATE',
        message: 'Only a document task takes files',
      });
    }

    expect(await rowsOf(ids)).toEqual([]);
    expect(await keysOf(ids)).toEqual([]);
    expect(
      taskOf(await read(org.hr, onboarding), 'Upload ID documents'),
    ).toEqual(ids);
  });
});
