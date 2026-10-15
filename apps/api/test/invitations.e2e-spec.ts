import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  activationPreviewSchema,
  employeeSchema,
  invitationSchema,
  meSchema,
  mockEmailSchema,
  myTasksSchema,
  onboardingDetailSchema,
  onboardingSchema,
  templateSchema,
} from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import {
  type Client,
  createApp,
  errorOf,
  newSlug,
  type Org,
  PASSWORD,
  seedOrg,
  signIn,
} from './app.js';

const HOUR = 60 * 60 * 1000;
const tokenOf = (link: string) => new URL(link).hash.slice(1);

// Logins, lookups and acceptances share one limit per IP (BR-P06). The sign-ins of seedOrg
// come from 127.0.0.1; every other call here comes from its own address, behind one proxy.
describe('invitations', () => {
  let app: INestApplication<App>;
  let org: Org;
  let lastIp = 0;
  const nextIp = () => `198.51.100.${++lastIp}`;
  const server = () => request(app.getHttpServer());
  const lookup = (token: string) =>
    server()
      .post('/api/auth/invitations/lookup')
      .set('X-Forwarded-For', nextIp())
      .send({ token });
  const accept = (token: string, password = 'correct horse') =>
    server()
      .post('/api/auth/invitations/accept')
      .set('X-Forwarded-For', nextIp())
      .send({ token, password });
  const login = (email: string, password: string) =>
    server()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email, password });
  const inbox = async (client: Client) =>
    mockEmailSchema
      .array()
      .parse((await client.get('/mock-inbox').expect(200)).body);
  const read = async (client: Client, id: string) =>
    onboardingDetailSchema.parse(
      (await client.get(`/onboardings/${id}`).expect(200)).body,
    );
  const resend = (client: Client, id: string) =>
    client.post(`/onboardings/${id}/resend-invitation`);

  /** Activates Engineering Onboarding, two weeks out, for someone new with no account. */
  async function invite() {
    const hire = await org.newHire();
    const active = await org.activate(
      await org.draftFor(hire, org.engineering.id, org.day(14)),
    );
    const employee = await org.prisma.employee.findUniqueOrThrow({
      where: { id: hire },
    });
    const emails = (await inbox(org.hr)).filter(
      (email) => email.toEmail === employee.email,
    );
    expect(emails).toHaveLength(1);
    return { employee, active, token: tokenOf(emails[0].link) };
  }

  beforeAll(async () => {
    app = await createApp(1);
    org = await seedOrg(app);
  });

  afterAll(async () => {
    await org.prisma.organization.delete({ where: { id: org.organizationId } });
    await app.close();
  });

  it("AT-10 BR-A07 BR-N01 BR-P05 activating for a new hire with no account emails them a link, in the activation's transaction; only its token's hash is stored", async () => {
    const { prisma, hr } = org;
    const hire = await org.newHire();
    // On a team, as the canvas's An Vo is.
    const engineering = await prisma.department.findFirstOrThrow({
      where: { organizationId: org.organizationId, name: 'Engineering' },
    });
    await prisma.employee.update({
      where: { id: hire },
      data: { departmentId: engineering.id },
    });
    const draft = await org.draftFor(hire, org.engineering.id, org.day(14));
    const { onboarding, sendsInvitation } = activationPreviewSchema.parse(
      (await hr.get(`/onboardings/${draft.id}/activation-preview`).expect(200))
        .body,
    );
    expect(sendsInvitation).toBe(true);
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: hire },
    });
    const sentTo = async () =>
      (await inbox(hr)).filter((email) => email.toEmail === employee.email);

    // A refused activation rolls the invitation back with everything else.
    await hr
      .post(`/onboardings/${draft.id}/activate`, {
        templateVersionId: onboarding.templateVersion.id,
      })
      .expect(422);
    expect(
      await prisma.invitation.count({ where: { onboardingId: draft.id } }),
    ).toBe(0);
    expect(await sentTo()).toEqual([]);

    const before = Date.now();
    const active = await org.activate(draft);
    expect(active.invitation).toEqual({
      email: employee.email,
      sentAt: expect.any(String),
      expiresAt: expect.any(String),
      acceptedAt: null,
      revokedAt: null,
    });
    // Valid for 72 hours (BR-P05).
    const expiresAt = Date.parse(active.invitation!.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 72 * HOUR);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 72 * HOUR);
    // Only HR, who resends it, sees it.
    expect((await read(org.others.manager, draft.id)).invitation).toBeNull();

    const [email] = await sentTo();
    const token = tokenOf(email.link);
    expect(token).toMatch(/^[\w-]{43}$/);
    const longDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${org.day(14)}T00:00:00Z`));
    expect(email).toEqual({
      id: expect.any(String),
      toEmail: employee.email,
      toName: employee.fullName,
      subject: "You're invited to join Acme Tech on Joinpath",
      body: expect.any(String),
      // The token after #, which browsers never send to a server.
      link: `${new URL(process.env.APP_ORIGIN!).origin}/invite#${token}`,
      linkLabel: 'Accept invitation',
      footer: expect.any(String),
      sentAt: expect.any(String),
    });
    expect(email.body.split('\n\n')).toEqual([
      'Hi Hire, welcome aboard.',
      `Lan Pham from People Operations has set up your onboarding. You start on ${longDate}, as Engineer on the Engineering team.`,
      'Two tasks are waiting for you before your first day: Upload ID documents and Sign the employee handbook.',
    ]);
    // Under the button, as the design canvas has it.
    expect(email.footer.split('\n\n')).toEqual([
      expect.stringMatching(
        /^This link works once and expires on \w{3}, \w{3} \d{1,2} at \d{2}:\d{2} \(GMT\+7\)\. If it runs out, ask Lan to send a new one\.$/,
      ),
      "You're receiving this because Acme Tech added you as a new hire in Joinpath.",
    ]);

    const [invitation] = await prisma.invitation.findMany({
      where: { onboardingId: draft.id },
    });
    expect(invitation.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify(invitation)).not.toContain(token);
    const hrUser = await prisma.user.findUniqueOrThrow({
      where: { email: org.seeded.emails.hr },
    });
    expect(
      await prisma.auditEvent.findMany({
        where: { onboardingId: draft.id, action: 'invitation.sent' },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: hrUser.id,
        entityType: 'invitation',
        entityId: invitation.id,
        data: { email: employee.email },
      }),
    ]);
  });

  it('BR-A07 a new hire who already has an account gets no invitation', async () => {
    const draft = await org.draftFor(
      org.anVo.id,
      org.engineering.id,
      org.day(14),
    );
    const { sendsInvitation } = activationPreviewSchema.parse(
      (
        await org.hr
          .get(`/onboardings/${draft.id}/activation-preview`)
          .expect(200)
      ).body,
    );
    expect(sendsInvitation).toBe(false);
    expect((await org.activate(draft)).invitation).toBeNull();
    expect(
      await org.prisma.invitation.count({ where: { onboardingId: draft.id } }),
    ).toBe(0);
    expect(
      (await inbox(org.hr)).filter((email) => email.toEmail === org.anVo.email),
    ).toEqual([]);
  });

  it('FR-02 the accept page reads the invitation before the password is set', async () => {
    const { employee, active, token } = await invite();
    const res = await lookup(token).expect(200);
    // The new hire's own tasks, in the order they open (a stable sort keeps template order).
    const theirs = active.tasks
      .filter((task) => task.assignee.id === employee.id)
      .toSorted((a, b) => a.availableOn.localeCompare(b.availableOn));
    expect(invitationSchema.parse(res.body)).toEqual({
      organization: { name: 'Acme Tech', timezone: 'Asia/Ho_Chi_Minh' },
      employee: { fullName: employee.fullName, email: employee.email },
      manager: { fullName: 'Minh Nguyen' },
      startDate: org.day(14),
      today: org.day(0),
      expiresAt: active.invitation!.expiresAt,
      tasks: theirs.map(({ title, description, availableOn, dueOn }) => ({
        title,
        description,
        availableOn,
        dueOn,
      })),
    });
    expect(theirs).toHaveLength(5);
  });

  it('FR-02 AT-30 accepting sets the password and signs the new hire in as MEMBER, once', async () => {
    const { prisma, hr } = org;
    const { employee, active, token } = await invite();

    // Too short a password is refused, and the link still works.
    expect(errorOf(await accept(token, 'short').expect(400)).code).toBe(
      'VALIDATION_FAILED',
    );
    const res = await accept(token, 'correct horse').expect(204);
    const cookie = res.get('Set-Cookie')![0].split(';')[0];
    const as = (path: string) =>
      server().get(`/api${path}`).set('Cookie', cookie).expect(200);
    expect(meSchema.parse((await as('/auth/me')).body)).toMatchObject({
      email: employee.email,
      role: 'MEMBER',
      employee: { id: employee.id, fullName: employee.fullName },
      // Their portal shows it.
      onboardingId: active.id,
    });
    const { tasks } = myTasksSchema.parse((await as('/tasks/mine')).body);
    expect(tasks).toHaveLength(5);
    // From now on they sign in with it.
    await login(employee.email, 'correct horse').expect(204);

    // HR sees it accepted; the audit names the new hire.
    expect((await read(hr, active.id)).invitation).toMatchObject({
      acceptedAt: expect.any(String),
      revokedAt: null,
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { employeeId: employee.id },
    });
    expect(
      await prisma.auditEvent.findMany({
        where: { onboardingId: active.id, action: 'invitation.accepted' },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: user.id,
        entityType: 'invitation',
      }),
    ]);

    // AT-30: used once.
    expect(errorOf(await accept(token).expect(410))).toEqual({
      code: 'INVITATION_INVALID',
      message: 'This invitation link no longer works. Ask HR for a new one.',
    });
    await lookup(token).expect(410);
    // FR-25: there is nothing left to resend.
    await resend(hr, active.id).expect(409);
  });

  it('AT-30 BR-P05 FR-25 a link that a resend replaced, or that expired, gets 410', async () => {
    const { prisma, hr } = org;
    const { employee, active, token } = await invite();
    const res = await resend(hr, active.id).expect(200);
    const { invitation } = onboardingDetailSchema.parse(res.body);
    expect(invitation).toMatchObject({
      email: employee.email,
      acceptedAt: null,
      revokedAt: null,
    });
    expect(invitation!.sentAt > active.invitation!.sentAt).toBe(true);
    await lookup(token).expect(410);
    await accept(token).expect(410);

    // The new link, newest first in the inbox, works.
    const emails = (await inbox(hr)).filter(
      (email) => email.toEmail === employee.email,
    );
    expect(emails).toHaveLength(2);
    const newer = tokenOf(emails[0].link);
    await lookup(newer).expect(200);
    expect(
      await prisma.auditEvent.count({
        where: { onboardingId: active.id, action: 'invitation.resent' },
      }),
    ).toBe(1);

    // 72 hours on, it has expired.
    await prisma.invitation.updateMany({
      where: { onboardingId: active.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await lookup(newer).expect(410);
    await accept(newer).expect(410);
  });

  it('FR-25 only HR resends, and only for an active onboarding', async () => {
    const { active } = await invite();
    for (const client of [org.others.IT, org.others.manager, org.others.An]) {
      expect(errorOf(await resend(client, active.id).expect(403)).code).toBe(
        'FORBIDDEN',
      );
    }
    const draft = await org.draftFor(await org.newHire());
    expect(errorOf(await resend(org.hr, draft.id).expect(409))).toEqual({
      code: 'INVALID_STATE',
      message: 'Only an active onboarding has an invitation to resend',
    });
    await resend(org.hr, '00000000-0000-7000-8000-000000000000').expect(404);
  });

  it("BR-P05 changing a new hire's email revokes their link; the resend goes to the new address", async () => {
    const { hr } = org;
    const { employee, active, token } = await invite();
    const renamed = `renamed.${employee.email}`;
    await hr.patch(`/employees/${employee.id}`, { email: renamed }).expect(200);
    await lookup(token).expect(410);
    expect((await read(hr, active.id)).invitation).toMatchObject({
      email: employee.email,
      revokedAt: expect.any(String),
    });

    const { invitation } = onboardingDetailSchema.parse(
      (await resend(hr, active.id).expect(200)).body,
    );
    expect(invitation).toMatchObject({ email: renamed, revokedAt: null });
    const [email] = (await inbox(hr)).filter(
      (email) => email.toEmail === renamed,
    );
    const res = await accept(tokenOf(email.link)).expect(204);
    const cookie = res.get('Set-Cookie')![0].split(';')[0];
    const me = await server()
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(meSchema.parse(me.body).email).toBe(renamed);
  });

  it('AT-32 BR-D04 BR-P01 two sandboxes each invite an "an": two addresses, both sign in, each inbox its own', async () => {
    const other = await seedDemoOrg(org.prisma, {
      slug: newSlug(),
      password: PASSWORD,
    });
    try {
      const sides = [
        { hr: org.hr, ...org.seeded },
        { hr: await signIn(app, other.emails.hr), ...other },
      ];
      const employeeOf = async (email: string) =>
        (await org.prisma.user.findUniqueOrThrow({ where: { email } }))
          .employeeId;
      const invited: string[] = [];
      for (const { hr, organization, emails } of sides) {
        const an = employeeSchema.parse(
          (
            await hr
              .post('/employees', {
                fullName: 'An',
                email: `an@${organization.slug}.joinpath.demo`,
                jobTitle: 'Engineer',
                managerId: await employeeOf(emails.manager),
              })
              .expect(201)
          ).body,
        );
        const general = templateSchema
          .array()
          .parse((await hr.get('/templates').expect(200)).body)
          .find((template) => template.name === 'General Onboarding')!;
        const draft = onboardingSchema.parse(
          (
            await hr
              .post('/onboardings', {
                employeeId: an.id,
                templateId: general.id,
                startDate: org.day(14),
              })
              .expect(201)
          ).body,
        );
        const it = await employeeOf(emails.it);
        await hr
          .post(`/onboardings/${draft.id}/activate`, {
            templateVersionId: draft.templateVersion.id,
            assignees: { 'prepare-laptop': it, 'create-accounts': it },
          })
          .expect(200);
        // BR-P01: each HR reads its own org's mail.
        const mail = await inbox(hr);
        expect(
          mail.every((email) =>
            email.toEmail.endsWith(`@${organization.slug}.joinpath.demo`),
          ),
        ).toBe(true);
        const [email] = mail.filter((email) => email.toEmail === an.email);
        await accept(tokenOf(email.link), 'an password').expect(204);
        invited.push(an.email);
      }
      expect(new Set(invited).size).toBe(2);
      for (const email of invited) {
        await login(email, 'an password').expect(204);
      }
    } finally {
      await org.prisma.organization.delete({
        where: { id: other.organization.id },
      });
    }
  });

  it('BR-P06 lookups and acceptances count toward the login limit: the 11th from one IP in a minute gets 429', async () => {
    const attempt = (path: 'lookup' | 'accept') =>
      server()
        .post(`/api/auth/invitations/${path}`)
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ token: 'not-a-token', password: 'long enough' });
    for (let i = 0; i < 5; i++) {
      await attempt('lookup').expect(410);
      await attempt('accept').expect(410);
    }
    expect(errorOf(await attempt('lookup').expect(429)).code).toBe(
      'RATE_LIMITED',
    );
  });

  it("FR-17 §9 the mock inbox is HR's, and in a sandbox everyone's", async () => {
    const { prisma, organizationId, others } = org;
    await invite();
    for (const client of [org.hr, others.IT, others.manager, others.An]) {
      expect((await inbox(client)).length).toBeGreaterThan(0);
    }
    await server().get('/api/mock-inbox').expect(401);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { isSandbox: false },
    });
    try {
      for (const client of [others.IT, others.manager, others.An]) {
        expect(errorOf(await client.get('/mock-inbox').expect(403)).code).toBe(
          'FORBIDDEN',
        );
      }
      await org.hr.get('/mock-inbox').expect(200);
    } finally {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { isSandbox: true },
      });
    }
  });
});
