import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  activationPreviewSchema,
  addDays,
  clockSchema,
  invitationSchema,
  type Me,
  meSchema,
  mockEmailSchema,
  myTasksSchema,
  type Notifications,
  notificationsSchema,
  onboardingDetailSchema,
  onboardingSummarySchema,
  SESSION_COOKIE,
  templateSchema,
  today,
} from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createSession } from '../src/modules/auth/auth.service.js';
import {
  purgeExpiredSandboxes,
  purgeOrg,
} from '../src/modules/demo/sandbox.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import { keysUnder, putObject } from '../src/modules/documents/storage.js';
import { PrismaService } from '../src/prisma.js';
import {
  clientFor,
  createApp,
  errorOf,
  newSlug,
  PASSWORD,
  pdf,
} from './app.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const hashOf = (ip: string) => createHash('sha256').update(ip).digest('hex');
// The limit on new demos counts per client IP in the database, across runs (BR-P06), so each
// client here gets an address of its own.
const newIp = () => `198.18.${randomBytes(2).join('.')}`;
const cookieOf = (res: request.Response) =>
  res.get('Set-Cookie')![0].split(';')[0];

describe('demo', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // Try demo's sandbox, started once for the file.
  let sandbox: { id: string; ip: string; me: Me; cookie: string };
  // Another company, which never expires.
  let other: Awaited<ReturnType<typeof seedDemoOrg>>;
  // Every org this file makes, purged when it ends.
  const made: string[] = [];

  const startDemo = (ip: string, cookie?: string) => {
    const req = request(app.getHttpServer())
      .post('/api/demo/sandboxes')
      .set('X-Forwarded-For', ip);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const meWith = (cookie: string) =>
    request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie);

  beforeAll(async () => {
    // Behind one trusted proxy, so each request names its client IP.
    app = await createApp(1);
    prisma = app.get(PrismaService);
    other = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    made.push(other.organization.id);
    const ip = newIp();
    const res = await startDemo(ip).expect(201);
    const me = meSchema.parse(res.body);
    made.push(me.organization.id);
    sandbox = { id: me.organization.id, ip, me, cookie: cookieOf(res) };
  }, 30_000);

  afterAll(async () => {
    for (const id of made) await purgeOrg(prisma, id);
    await app.close();
  });

  it('BR-D01 FR-27 Try demo seeds a company of its own for 24 hours, with onboardings A, B and C, and signs its HR in', async () => {
    const { me } = sandbox;
    expect(me).toMatchObject({
      role: 'HR',
      employee: { fullName: 'Lan Pham' },
      organization: {
        name: 'Acme Tech',
        emailDomain: expect.stringMatching(
          /^demo-[0-9a-f]{10}\.joinpath\.demo$/,
        ),
      },
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: sandbox.id },
    });
    expect(org).toMatchObject({
      isSandbox: true,
      clockOffsetDays: 0,
      createdIpHash: hashOf(sandbox.ip),
    });
    expect(
      Math.abs(
        org.expiresAt!.getTime() - org.createdAt.getTime() - 24 * HOUR_MS,
      ),
    ).toBeLessThan(5000);

    // A drafted, B waiting on HR's review, C done (PLAN §11), dated from the business date.
    const lan = clientFor(app, sandbox.cookie);
    const day = (offset: number) => addDays(me.organization.today, offset);
    const onboardings = onboardingSummarySchema
      .array()
      .parse((await lan.get('/onboardings').expect(200)).body);
    expect(
      onboardings.map((onboarding) => ({
        who: onboarding.employee.fullName,
        status: onboarding.status,
        startDate: onboarding.startDate,
        version: onboarding.templateVersion.version,
        progress: onboarding.progress,
        next: onboarding.nextTask?.title ?? null,
      })),
    ).toEqual([
      {
        who: 'An Vo',
        status: 'DRAFT',
        startDate: day(5),
        version: 2,
        progress: { completed: 0, total: 0, overdue: 0 },
        next: null,
      },
      {
        who: 'Bao Ho',
        status: 'ACTIVE',
        startDate: day(-2),
        version: 1,
        progress: { completed: 5, total: 10, overdue: 2 },
        next: 'Review ID documents',
      },
      {
        who: 'Chi Dang',
        status: 'COMPLETED',
        startDate: day(-11),
        version: 1,
        progress: { completed: 10, total: 10, overdue: 0 },
        next: null,
      },
    ]);
    const mine = myTasksSchema.parse(
      (await lan.get('/tasks/mine').expect(200)).body,
    );
    expect(
      mine.tasks.map((task) => [
        task.title,
        task.onboarding.employee.fullName,
        task.availability,
        task.overdue,
      ]),
    ).toEqual([
      ['Review ID documents', 'Chi Dang', 'COMPLETED', false],
      ['Review ID documents', 'Bao Ho', 'READY', true],
    ]);
    // C's notes are read; HR's one new note is B's revision to review.
    const notes = notificationsSchema.parse(
      (await lan.get('/notifications').expect(200)).body,
    );
    expect(notes.unread).toBe(1);
    expect(notes.notifications.find((note) => !note.readAt)).toMatchObject({
      kind: 'READY',
      title: 'Review ID documents is ready',
      body: expect.stringContaining('Bao Ho sent revision 1.'),
    });
    // v2 came out after B and C were activated on v1 (BR-A03).
    const engineering = templateSchema
      .array()
      .parse((await lan.get('/templates').expect(200)).body)
      .find((template) => template.name === 'Engineering Onboarding')!;
    expect(
      engineering.versions.map(({ version, status }) => [version, status]),
    ).toEqual([
      [2, 'PUBLISHED'],
      [1, 'PUBLISHED'],
    ]);
    // B's and C's ID, one PDF each.
    expect(await keysUnder(`orgs/${sandbox.id}/`)).toHaveLength(2);
  });

  it('BR-D05 once the demo clock moves, the API dates what happens by the business day; what came before keeps its date', async () => {
    const lan = clientFor(app, sandbox.cookie);
    const { timezone, today: started } = sandbox.me.organization;
    // The day a moment the API sends falls on, where the company is.
    const dayOf = (moment: string) => today(timezone, 0, new Date(moment));
    // Every moment a response holds, field by field, but expiries, which are still to come.
    const pastOf = (body: unknown) =>
      JSON.stringify(body).match(/"(?!expiresAt)\w+At":"[^"]+"/g)!;
    const listed = async () =>
      onboardingSummarySchema
        .array()
        .parse((await lan.get('/onboardings').expect(200)).body);
    const ids = Object.fromEntries(
      (await listed()).map((each) => [each.employee.fullName, each.id]),
    );
    const read = async (fullName: string) =>
      onboardingDetailSchema.parse(
        (await lan.get(`/onboardings/${ids[fullName]}`).expect(200)).body,
      );
    const [bao, chi] = [await read('Bao Ho'), await read('Chi Dang')];

    const moved = clockSchema.parse(
      (await lan.post('/demo/clock/advance', { days: 3 }).expect(200)).body,
    );
    expect(moved.today).toBe(addDays(started, 3));
    // On record with the move, as the offset now stands.
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: sandbox.id },
      select: {
        clockOffsetDays: true,
        clockAdvances: { select: { offsetDays: true, createdAt: true } },
      },
    });
    expect(org.clockOffsetDays).toBe(3);
    expect(org.clockAdvances.map((advance) => advance.offsetDays)).toEqual([3]);
    const [{ createdAt: movedAt }] = org.clockAdvances;

    // C's story keeps its dates; a link not run out yet goes by the clock as it is now.
    const chiNow = await read('Chi Dang');
    expect(pastOf(chiNow)).toEqual(pastOf(chi));
    expect(
      Date.parse(chiNow.invitation!.expiresAt) -
        Date.parse(chi.invitation!.expiresAt),
    ).toBe(3 * DAY_MS);

    // HR approves B's ID: done today, the business day, in the detail and in My tasks.
    const review = bao.tasks.find(
      (task) => task.title === 'Review ID documents',
    )!;
    const upload = bao.tasks.find(
      (task) => task.title === 'Upload ID documents',
    )!;
    const approved = onboardingDetailSchema.parse(
      (
        await lan
          .post(`/tasks/${review.id}/approve`, {
            submissionId: upload.submissions[0].id,
          })
          .expect(200)
      ).body,
    );
    const { completedAt } = approved.tasks.find(
      (task) => task.id === review.id,
    )!;
    expect(dayOf(completedAt!)).toBe(moved.today);
    const [revision] = approved.tasks.find(
      (task) => task.id === upload.id,
    )!.submissions;
    expect(dayOf(revision.decision!.decidedAt)).toBe(moved.today);
    expect(pastOf(approved)).toEqual(expect.arrayContaining(pastOf(bao)));
    const mine = myTasksSchema.parse(
      (await lan.get('/tasks/mine').expect(200)).body,
    );
    expect(mine.tasks.find((task) => task.id === review.id)!.completedAt).toBe(
      completedAt,
    );

    // HR activates A: activated and invited today, the link good for 72 hours (BR-P05).
    const { onboarding: draft } = activationPreviewSchema.parse(
      (
        await lan
          .get(`/onboardings/${ids['An Vo']}/activation-preview`)
          .expect(200)
      ).body,
    );
    const { id: duc } = await prisma.employee.findFirstOrThrow({
      where: { organizationId: sandbox.id, fullName: 'Duc Tran' },
    });
    const activated = onboardingDetailSchema.parse(
      (
        await lan
          .post(`/onboardings/${draft.id}/activate`, {
            templateVersionId: draft.templateVersion.id,
            assignees: { 'prepare-laptop': duc, 'create-accounts': duc },
          })
          .expect(200)
      ).body,
    );
    expect(dayOf(activated.activatedAt!)).toBe(moved.today);
    expect(
      (await listed()).find((each) => each.id === activated.id)!.activatedAt,
    ).toBe(activated.activatedAt);
    const { sentAt, expiresAt } = activated.invitation!;
    expect(dayOf(sentAt)).toBe(moved.today);
    expect(
      Math.abs(Date.parse(expiresAt) - Date.parse(sentAt) - 72 * HOUR_MS),
    ).toBeLessThan(5000);
    // An's email too, whose small print gives the expiry by the same clock, as the page its
    // link opens does.
    const invite = mockEmailSchema
      .array()
      .parse((await lan.get('/mock-inbox').expect(200)).body)
      .find((email) => email.toName === 'An Vo')!;
    expect(dayOf(invite.sentAt)).toBe(moved.today);
    const expiry = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(expiresAt));
    expect(invite.footer).toContain(`expires on ${expiry} at`);
    const page = await request(app.getHttpServer())
      .post('/api/auth/invitations/lookup')
      .set('X-Forwarded-For', newIp())
      .send({ token: new URL(invite.link).hash.slice(1) })
      .expect(200);
    expect(invitationSchema.parse(page.body)).toMatchObject({
      today: moved.today,
      expiresAt,
    });

    // Templates published as the demo began; one archived today.
    const general = templateSchema
      .array()
      .parse((await lan.get('/templates').expect(200)).body)
      .find((template) => template.name === 'General Onboarding')!;
    expect(
      general.versions.map((version) => dayOf(version.publishedAt!)),
    ).toEqual(general.versions.map(() => started));
    const archived = templateSchema.parse(
      (await lan.post(`/templates/${general.id}/archive`).expect(200)).body,
    );
    expect(dayOf(archived.archivedAt!)).toBe(moved.today);

    // Lan's notes as on record: 3 days on for what came after the move (the tick's reminders,
    // and reading them), as they were for the rest.
    const shifted = (moment: Date | null) =>
      moment &&
      new Date(
        moment.getTime() + (moment >= movedAt ? 3 * DAY_MS : 0),
      ).toISOString();
    const onRecord = async () =>
      (
        await prisma.notification.findMany({
          where: { recipientEmployeeId: sandbox.me.employee.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, createdAt: true, readAt: true },
        })
      ).map(({ id, createdAt, readAt }) => ({
        id,
        createdAt: shifted(createdAt),
        readAt: shifted(readAt),
      }));
    const sent = ({ notifications }: Notifications) =>
      notifications.map(({ id, createdAt, readAt }) => ({
        id,
        createdAt,
        readAt,
      }));
    const notes = notificationsSchema.parse(
      (await lan.get('/notifications').expect(200)).body,
    );
    const reminders = notes.notifications.filter(
      (note) => note.kind === 'OVERDUE',
    );
    expect(reminders).not.toEqual([]);
    expect(reminders.map((note) => dayOf(note.createdAt))).toEqual(
      reminders.map(() => moved.today),
    );
    expect(sent(notes)).toEqual(await onRecord());
    const allRead = notificationsSchema.parse(
      (await lan.post('/notifications/read-all').expect(200)).body,
    );
    expect(
      new Set(allRead.notifications.map((note) => dayOf(note.readAt!))),
    ).toEqual(new Set([started, moved.today]));
    expect(sent(allRead)).toEqual(await onRecord());
  });

  it('AT-31 BR-D02 FR-27 in a sandbox, anyone plays anyone with an account, whose session replaces theirs; outside one, 403', async () => {
    const idOf = async (fullName: string) =>
      (
        await prisma.employee.findFirstOrThrow({
          where: { organizationId: sandbox.id, fullName },
        })
      ).id;
    const play = (cookie: string, body: object) =>
      request(app.getHttpServer())
        .post('/api/demo/switch-user')
        .set('Cookie', cookie)
        .send(body);

    // HR plays IT: a new session, and the old one ends.
    const asDuc = await play(sandbox.cookie, {
      employeeId: await idOf('Duc Tran'),
    }).expect(200);
    expect(meSchema.parse(asDuc.body)).toMatchObject({
      role: 'IT',
      employee: { fullName: 'Duc Tran' },
    });
    await meWith(sandbox.cookie).expect(401);
    const duc = cookieOf(asDuc);
    // A new hire with an account, whose portal opens on their onboarding.
    const bao = await idOf('Bao Ho');
    const asBao = await play(duc, { employeeId: bao }).expect(200);
    expect(meSchema.parse(asBao.body)).toMatchObject({
      role: 'MEMBER',
      employee: { fullName: 'Bao Ho' },
      onboardingId: expect.any(String),
    });
    await meWith(duc).expect(401);
    sandbox.cookie = cookieOf(asBao);
    // Playing oneself changes nothing.
    const same = await play(sandbox.cookie, { employeeId: bao }).expect(200);
    expect(same.get('Set-Cookie')).toBeUndefined();
    await meWith(sandbox.cookie).expect(200);

    // No account yet, or a locked one: nobody to play (409).
    const anVo = await play(sandbox.cookie, {
      employeeId: await idOf('An Vo'),
    }).expect(409);
    expect(errorOf(anVo)).toEqual({
      code: 'INVALID_STATE',
      message: 'An Vo has no account yet',
    });
    const huy = await idOf('Huy Le');
    await prisma.user.update({
      where: { employeeId: huy },
      data: { status: 'DISABLED' },
    });
    try {
      const locked = await play(sandbox.cookie, { employeeId: huy }).expect(
        409,
      );
      expect(errorOf(locked)).toEqual({
        code: 'INVALID_STATE',
        message: "Huy Le's account is locked",
      });
    } finally {
      await prisma.user.update({
        where: { employeeId: huy },
        data: { status: 'ACTIVE' },
      });
    }
    // Someone of another company is nobody here (BR-P02); a body without an id is refused.
    const elsewhere = await prisma.user.findUniqueOrThrow({
      where: { email: other.emails.hr },
    });
    const outsider = await play(sandbox.cookie, {
      employeeId: elsewhere.employeeId,
    }).expect(404);
    expect(errorOf(outsider)).toEqual({
      code: 'NOT_FOUND',
      message: 'Person not found',
    });
    for (const body of [{}, { employeeId: 'lan' }]) {
      const res = await play(sandbox.cookie, body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }

    // Outside a sandbox nobody switches, and the session stays.
    await prisma.organization.update({
      where: { id: sandbox.id },
      data: { isSandbox: false },
    });
    try {
      const res = await play(sandbox.cookie, {
        employeeId: await idOf('Lan Pham'),
      }).expect(403);
      expect(errorOf(res)).toEqual({
        code: 'FORBIDDEN',
        message: 'Switching people works in a sandbox only',
      });
      await meWith(sandbox.cookie).expect(200);
    } finally {
      await prisma.organization.update({
        where: { id: sandbox.id },
        data: { isSandbox: true },
      });
    }
    await request(app.getHttpServer())
      .post('/api/demo/switch-user')
      .send({ employeeId: huy })
      .expect(401);
  });

  it('BR-D01 a sandbox past its 24 hours goes, files and all; a running one, and an org that never expires, stay', async () => {
    const expired = await seedDemoOrg(prisma, {
      slug: newSlug(),
      password: PASSWORD,
      expiresAt: new Date(Date.now() - 1000),
    });
    made.push(expired.organization.id);
    const prefix = `orgs/${expired.organization.id}/`;
    await putObject(
      `${prefix}tasks/${randomUUID()}/${randomUUID()}`,
      pdf(),
      'application/pdf',
    );

    await purgeExpiredSandboxes(prisma);
    expect(
      await prisma.organization.findUnique({
        where: { id: expired.organization.id },
      }),
    ).toBeNull();
    expect(await keysUnder(prefix)).toEqual([]);
    expect(
      await prisma.organization.count({
        where: { id: { in: [sandbox.id, other.organization.id] } },
      }),
    ).toBe(2);
    expect(await keysUnder(`orgs/${sandbox.id}/`)).toHaveLength(2);
  });

  it('BR-P06 BR-D01 a client starts five demos an hour; a new one ends the session it came with and clears expired sandboxes', async () => {
    const ip = newIp();
    const now = Date.now();
    // Four demos this client started within the hour, and one before, which no longer counts.
    const startedAgo = (minutes: number) => ({
      name: 'Acme Tech',
      slug: newSlug(),
      timezone: 'Asia/Ho_Chi_Minh',
      isSandbox: true,
      createdAt: new Date(now - minutes * 60_000),
      expiresAt: new Date(now - minutes * 60_000 + 24 * HOUR_MS),
      createdIpHash: hashOf(ip),
    });
    const earlier = await prisma.organization.createManyAndReturn({
      data: [10, 20, 30, 50, 61].map(startedAgo),
      select: { id: true },
    });
    made.push(...earlier.map(({ id }) => id));
    const expired = await seedDemoOrg(prisma, {
      slug: newSlug(),
      password: PASSWORD,
      expiresAt: new Date(0),
    });
    made.push(expired.organization.id);
    // Someone's session in a company that stays, so only the new demo can end it.
    const { id: userId } = await prisma.user.findUniqueOrThrow({
      where: { email: other.emails.hr },
    });
    const old = `${SESSION_COOKIE}=${await createSession(prisma, userId)}`;
    await meWith(old).expect(200);

    const res = await startDemo(ip, old).expect(201);
    made.push(meSchema.parse(res.body).organization.id);
    await meWith(cookieOf(res)).expect(200);
    await meWith(old).expect(401);
    expect(
      await prisma.organization.findUnique({
        where: { id: expired.organization.id },
      }),
    ).toBeNull();

    // That was the fifth within the hour: the next waits until the oldest of them, 50 minutes
    // old, is an hour old.
    const limited = await startDemo(ip).expect(429);
    expect(errorOf(limited)).toEqual({
      code: 'RATE_LIMITED',
      message: "You've started 5 demos in the last hour. Try again later.",
    });
    const retryAfter = Number(limited.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(9 * 60);
    expect(retryAfter).toBeLessThanOrEqual(10 * 60);
  }, 30_000);

  it('BR-P06 with 200 sandboxes running, no demo starts until the first of them expires', async () => {
    const now = Date.now();
    const running = await prisma.organization.count({
      where: { isSandbox: true, expiresAt: { gt: new Date(now) } },
    });
    const filler = await prisma.organization.createManyAndReturn({
      data: Array.from({ length: 200 - running }, () => ({
        name: 'Acme Tech',
        slug: newSlug(),
        timezone: 'Asia/Ho_Chi_Minh',
        isSandbox: true,
        expiresAt: new Date(now + HOUR_MS / 2),
      })),
      select: { id: true },
    });
    try {
      const limited = await startDemo(newIp()).expect(429);
      expect(errorOf(limited)).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many demos are running. Try again later.',
      });
      const retryAfter = Number(limited.get('Retry-After'));
      expect(retryAfter).toBeGreaterThan(29 * 60);
      expect(retryAfter).toBeLessThanOrEqual(30 * 60);
    } finally {
      await prisma.organization.deleteMany({
        where: { id: { in: filler.map(({ id }) => id) } },
      });
    }
  });
});
