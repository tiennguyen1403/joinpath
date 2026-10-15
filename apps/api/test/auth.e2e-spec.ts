import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, meSchema, today } from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import { PrismaService } from '../src/prisma.js';
import { createApp } from './app.js';

const PASSWORD = 'test-password';

// Logins in one app share a throttle bucket (10 per minute, BR-P06): keep this file under 10.
describe('auth', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof seedDemoOrg>>;

  const login = (email: string, password = PASSWORD) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
  const signIn = async (email: string) => {
    const res = await login(email).expect(204);
    return res.get('Set-Cookie')![0].split(';')[0];
  };
  const me = (cookie?: string) => {
    const req = request(app.getHttpServer()).get('/api/auth/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    seeded = await seedDemoOrg(prisma, {
      slug: `t${randomBytes(4).toString('hex')}`,
      password: PASSWORD,
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: seeded.organization.id } });
    await app.close();
  });

  it('FR-01 login sets an HttpOnly, Secure, SameSite=Lax session cookie without Domain', async () => {
    const res = await login(seeded.emails.hr).expect(204);
    const cookie = res.get('Set-Cookie')![0];
    expect(cookie).toMatch(/^__Host-sid=[\w-]{43};/);
    expect(cookie).toMatch(/; HttpOnly(;|$)/);
    expect(cookie).toMatch(/; Secure(;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('FR-01 wrong password, unknown email and disabled user get the same generic 401', async () => {
    await prisma.user.update({
      where: { email: seeded.emails.it2 },
      data: { status: 'DISABLED' },
    });
    const responses = await Promise.all([
      login(seeded.emails.hr, 'wrong-password'),
      login(`nobody@${seeded.organization.slug}.joinpath.demo`),
      login(seeded.emails.it2),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.get('Set-Cookie')).toBeUndefined();
      expect(apiErrorSchema.parse(res.body)).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      });
    }
  });

  it('FR-01 BR-P01 FR-28 me returns the user, role, organization and business date of the session', async () => {
    const cases = [
      {
        email: seeded.emails.hr,
        role: 'HR',
        employee: { fullName: 'Lan Pham', jobTitle: 'HR Specialist' },
      },
      {
        email: seeded.emails.it,
        role: 'IT',
        employee: { fullName: 'Duc Tran', jobTitle: 'IT Support' },
      },
      {
        email: seeded.emails.manager,
        role: 'MEMBER',
        employee: { fullName: 'Minh Nguyen', jobTitle: 'Engineering Manager' },
      },
    ];
    let cookie = '';
    for (const { email, role, employee } of cases) {
      // Emails are trimmed and lowercased before lookup.
      cookie = await signIn(` ${email.toUpperCase()} `);
      const res = await me(cookie).expect(200);
      expect(meSchema.parse(res.body)).toMatchObject({
        email,
        role,
        employee,
        organization: {
          id: seeded.organization.id,
          name: 'Acme Tech',
          timezone: 'Asia/Ho_Chi_Minh',
          today: today('Asia/Ho_Chi_Minh', 0, new Date()),
        },
      });
    }

    // The demo clock moves the business date (PLAN §4.6).
    await prisma.organization.update({
      where: { id: seeded.organization.id },
      data: { clockOffsetDays: 5 },
    });
    const moved = await me(cookie).expect(200);
    expect(meSchema.parse(moved.body).organization.today).toBe(
      today('Asia/Ho_Chi_Minh', 5, new Date()),
    );
  });

  it('FR-01 logout revokes the session server-side and clears the cookie', async () => {
    const cookie = await signIn(seeded.emails.it);
    await me(cookie).expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    expect(res.get('Set-Cookie')![0]).toMatch(
      /^__Host-sid=;.*Expires=Thu, 01 Jan 1970/,
    );

    // The old cookie no longer works, even if the browser kept it.
    expect(apiErrorSchema.parse((await me(cookie).expect(401)).body).code).toBe(
      'UNAUTHENTICATED',
    );
    expect(apiErrorSchema.parse((await me().expect(401)).body).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('FR-01 refuses writes sent from another origin (CSRF, PLAN §9)', async () => {
    const res = await login(seeded.emails.hr)
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN');
    await login(seeded.emails.hr)
      .set('Origin', process.env.APP_ORIGIN!)
      .expect(204);
  });
});

describe('login rate limit', () => {
  const attempt = (app: INestApplication<App>, forwardedFor: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: 'nobody@x.joinpath.demo', password: 'x' });

  it('BR-P06 the 11th login from one IP within a minute gets 429', async () => {
    const app = await createApp();
    try {
      // No trusted proxy: X-Forwarded-For is whatever the client sent, so it is ignored.
      for (let i = 0; i < 10; i++) {
        await attempt(app, `198.51.100.${i}`).expect(401);
      }
      const limited = await attempt(app, '198.51.100.99').expect(429);
      expect(apiErrorSchema.parse(limited.body).code).toBe('RATE_LIMITED');
      expect(Number(limited.get('Retry-After'))).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('BR-P06 behind one trusted proxy, each client IP has its own limit', async () => {
    const app = await createApp(1);
    try {
      // The proxy appends the address it saw; entries before it are the client's own.
      for (let i = 0; i < 10; i++) {
        await attempt(app, `198.51.100.${i}, 203.0.113.1`).expect(401);
      }
      await attempt(app, '203.0.113.1').expect(429);
      await attempt(app, '203.0.113.2').expect(401);
    } finally {
      await app.close();
    }
  });
});
