import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  type Me,
  meSchema,
  myTasksSchema,
  notificationsSchema,
  onboardingSummarySchema,
  SESSION_COOKIE,
  templateSchema,
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
