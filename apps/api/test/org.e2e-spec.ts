import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  departmentSchema,
  employeeSchema,
  meSchema,
  sandboxEmailDomain,
} from '@joinpath/core';
import type { App } from 'supertest/types.js';
import { purgeOrg } from '../src/modules/demo/sandbox.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import { PrismaService } from '../src/prisma.js';
import {
  type Client,
  createApp,
  errorOf,
  giveAccount,
  newSlug,
  PASSWORD,
  signIn,
} from './app.js';

describe('org', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof seedDemoOrg>>;
  // Another org in the same database, whose people must never show (BR-P01).
  let other: Awaited<ReturnType<typeof seedDemoOrg>>;
  let hr: Client;
  let others: Record<'IT' | 'manager' | 'new hire', Client>;
  // What follows the @ in every address of the seeded org (BR-D04).
  let domain: string;
  // HR's user, the actor of every audit event here.
  let actorUserId: string;

  const namesListed = async (query: string) => {
    const res = await hr.get(`/employees${query}`).expect(200);
    return employeeSchema
      .array()
      .parse(res.body)
      .map((employee) => employee.fullName);
  };
  const idOf = async (fullName: string, org = seeded) =>
    (
      await prisma.employee.findFirstOrThrow({
        where: { organizationId: org.organization.id, fullName },
      })
    ).id;
  const departmentOf = async (name: string, org = seeded) =>
    (
      await prisma.department.findFirstOrThrow({
        where: { organizationId: org.organization.id, name },
      })
    ).id;
  // The row as stored, to show a refused write changed nothing.
  const rowOf = (id: string) =>
    prisma.employee.findUniqueOrThrow({ where: { id } });
  const eventsOf = (entityId: string) =>
    prisma.auditEvent.findMany({
      where: { entityId },
      select: { actorUserId: true, action: true, entityType: true, data: true },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    seeded = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    other = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    domain = sandboxEmailDomain(seeded.organization.slug);
    actorUserId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: seeded.emails.hr },
      })
    ).id;
    const anVo = await giveAccount(prisma, seeded.organization.id, 'An Vo');
    hr = await signIn(app, seeded.emails.hr);
    others = {
      IT: await signIn(app, seeded.emails.it),
      manager: await signIn(app, seeded.emails.manager),
      'new hire': await signIn(app, anVo.email),
    };
  });

  afterAll(async () => {
    for (const { organization } of [seeded, other]) {
      await purgeOrg(prisma, organization.id);
    }
    await app.close();
  });

  it('§8 GET /employees lists the org by name, with department, manager and account', async () => {
    const res = await hr.get('/employees').expect(200);
    const employees = employeeSchema.array().parse(res.body);
    expect(employees.map((employee) => employee.fullName)).toEqual([
      'An Vo',
      'Bao Ho',
      'Chi Dang',
      'Duc Tran',
      'Huy Le',
      'Lan Pham',
      'Minh Nguyen',
    ]);
    const named = (fullName: string) =>
      employees.find((employee) => employee.fullName === fullName)!;
    expect(named('Bao Ho')).toEqual({
      id: expect.any(String),
      fullName: 'Bao Ho',
      email: `bao.ho@${seeded.organization.slug}.joinpath.demo`,
      jobTitle: 'Backend Developer',
      department: { id: expect.any(String), name: 'Engineering' },
      manager: { id: named('Minh Nguyen').id, fullName: 'Minh Nguyen' },
      // No account until the invitation is accepted.
      user: null,
    });
    expect(named('Duc Tran')).toMatchObject({
      department: { name: 'IT' },
      manager: null,
      user: { role: 'IT', status: 'ACTIVE' },
    });
  });

  it('§8 GET /employees filters by active account and by role', async () => {
    // A disabled account no longer counts as active, but keeps its role.
    await prisma.user.update({
      where: { email: seeded.emails.it2 },
      data: { status: 'DISABLED' },
    });
    try {
      expect(await namesListed('?active=true')).toEqual([
        'An Vo',
        'Duc Tran',
        'Lan Pham',
        'Minh Nguyen',
      ]);
      expect(await namesListed('?role=IT')).toEqual(['Duc Tran', 'Huy Le']);
      expect(await namesListed('?active=true&role=IT')).toEqual(['Duc Tran']);
    } finally {
      await prisma.user.update({
        where: { email: seeded.emails.it2 },
        data: { status: 'ACTIVE' },
      });
    }
    // `active` has no false form.
    for (const query of ['?active=false', '?role=CEO']) {
      const res = await hr.get(`/employees${query}`).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('§8 GET /departments lists the org by name', async () => {
    const res = await hr.get('/departments').expect(200);
    expect(
      departmentSchema
        .array()
        .parse(res.body)
        .map((department) => department.name),
    ).toEqual(['Engineering', 'IT', 'People Operations']);
  });

  it('§9 only HR reads and writes employees and departments', async () => {
    const bao = await idOf('Bao Ho');
    const it = await departmentOf('IT');
    // Thunks: supertest starts the server for a request and stops it when that request ends.
    const routes = (client: Client) => ({
      'GET /employees': () => client.get('/employees'),
      'GET /employees/:id': () => client.get(`/employees/${bao}`),
      'POST /employees': () =>
        client.post('/employees', {
          fullName: 'Not Allowed',
          email: `not.allowed@${domain}`,
          jobTitle: 'Engineer',
        }),
      'PATCH /employees/:id': () =>
        client.patch(`/employees/${bao}`, { jobTitle: 'Not allowed' }),
      'GET /departments': () => client.get('/departments'),
      'POST /departments': () =>
        client.post('/departments', { name: 'Not allowed' }),
      'PATCH /departments/:id': () =>
        client.patch(`/departments/${it}`, { name: 'Not allowed' }),
    });
    const org = async () => {
      const where = { organizationId: seeded.organization.id };
      return {
        employees: await prisma.employee.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        departments: await prisma.department.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
      };
    };
    const before = await org();
    for (const [who, client] of Object.entries(others)) {
      for (const [route, send] of Object.entries(routes(client))) {
        const res = await send();
        expect({ who, route, status: res.status }).toEqual({
          who,
          route,
          status: 403,
        });
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    }
    expect(await org()).toEqual(before);
  });

  it('BR-D04 GET /auth/me gives the email domain of a sandbox, and none outside one', async () => {
    const domainOf = async () =>
      meSchema.parse((await hr.get('/auth/me').expect(200)).body).organization
        .emailDomain;
    expect(await domainOf()).toBe(`${seeded.organization.slug}.joinpath.demo`);
    await prisma.organization.update({
      where: { id: seeded.organization.id },
      data: { isSandbox: false },
    });
    try {
      expect(await domainOf()).toBeNull();
    } finally {
      await prisma.organization.update({
        where: { id: seeded.organization.id },
        data: { isSandbox: true },
      });
    }
  });

  it('FR-03 BR-D04 POST /employees adds someone, trimmed and with a lowercase email; GET /employees/:id reads them back', async () => {
    const engineering = await departmentOf('Engineering');
    const minh = await idOf('Minh Nguyen');
    const res = await hr
      .post('/employees', {
        fullName: '  Dung Le ',
        email: ` Dung.Le@${domain.toUpperCase()} `,
        jobTitle: ' Product Designer ',
        departmentId: engineering,
        managerId: minh,
      })
      .expect(201);
    const dung = employeeSchema.parse(res.body);
    expect(dung).toEqual({
      id: expect.any(String),
      fullName: 'Dung Le',
      email: `dung.le@${domain}`,
      jobTitle: 'Product Designer',
      department: { id: engineering, name: 'Engineering' },
      manager: { id: minh, fullName: 'Minh Nguyen' },
      user: null,
    });
    expect((await hr.get(`/employees/${dung.id}`).expect(200)).body).toEqual(
      dung,
    );
    expect(await eventsOf(dung.id)).toEqual([
      {
        actorUserId,
        action: 'employee.created',
        entityType: 'employee',
        data: { fullName: 'Dung Le' },
      },
    ]);

    // Department and manager are optional.
    const em = await hr
      .post('/employees', {
        fullName: 'Em Tran',
        email: `em.tran@${domain}`,
        jobTitle: 'Designer',
        managerId: null,
      })
      .expect(201);
    expect(employeeSchema.parse(em.body)).toMatchObject({
      department: null,
      manager: null,
    });
  });

  it('FR-03 BR-D04 POST /employees refuses a bad body, and an email outside the sandbox (400)', async () => {
    const count = () =>
      prisma.employee.count({
        where: { organizationId: seeded.organization.id },
      });
    const before = await count();
    const valid = {
      fullName: 'Giang Ho',
      email: `giang.ho@${domain}`,
      jobTitle: 'Engineer',
    };
    for (const email of [
      'giang.ho@example.com',
      `giang.ho@${sandboxEmailDomain(other.organization.slug)}`,
      `giang.ho@x.${domain}`,
    ]) {
      const res = await hr.post('/employees', { ...valid, email }).expect(400);
      expect(errorOf(res)).toEqual({
        code: 'VALIDATION_FAILED',
        message: `Use an @${domain} email`,
      });
    }
    for (const body of [
      { ...valid, fullName: '  ' },
      { ...valid, email: `giang ho@${domain}` },
      { ...valid, jobTitle: undefined },
      { ...valid, managerId: 'nobody' },
    ]) {
      const res = await hr.post('/employees', body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    expect(await count()).toBe(before);
  });

  it('FR-03 POST /employees refuses an email someone already has, in any case (409)', async () => {
    const res = await hr
      .post('/employees', {
        fullName: 'Bao Ho Junior',
        email: `BAO.HO@${domain}`,
        jobTitle: 'Engineer',
      })
      .expect(409);
    expect(errorOf(res)).toEqual({
      code: 'INVALID_STATE',
      message: 'Bao Ho already has this email',
    });
  });

  it("FR-03 BR-P01 BR-P02 another org's employee, department or manager is not found (404)", async () => {
    const theirs = {
      employee: await idOf('Bao Ho', other),
      department: await departmentOf('IT', other),
    };
    const valid = {
      fullName: 'Hoa Mai',
      email: `hoa.mai@${domain}`,
      jobTitle: 'Engineer',
    };
    for (const [body, message] of [
      [{ ...valid, departmentId: theirs.department }, 'Department not found'],
      [{ ...valid, managerId: theirs.employee }, 'Manager not found'],
    ] as const) {
      const res = await hr.post('/employees', body).expect(404);
      expect(errorOf(res)).toEqual({ code: 'NOT_FOUND', message });
    }
    const theirBao = await rowOf(theirs.employee);
    await hr.get(`/employees/${theirs.employee}`).expect(404);
    await hr
      .patch(`/employees/${theirs.employee}`, { jobTitle: 'Moved' })
      .expect(404);
    expect(await rowOf(theirs.employee)).toEqual(theirBao);
    await hr
      .patch(`/departments/${theirs.department}`, { name: 'Moved' })
      .expect(404);
    expect(
      (
        await prisma.department.findUniqueOrThrow({
          where: { id: theirs.department },
        })
      ).name,
    ).toBe('IT');
    await hr
      .patch(`/employees/${randomUUID()}`, { jobTitle: 'Nobody' })
      .expect(404);
    // An id that is no UUID is a bad request.
    await hr.get('/employees/nobody').expect(400);
    await hr.patch('/departments/nobody', { name: 'Nobody' }).expect(400);
  });

  it('FR-03 PATCH /employees/:id changes the fields given, clears with null, and audits only what changed', async () => {
    const chi = await idOf('Chi Dang');
    const res = await hr
      .patch(`/employees/${chi}`, { jobTitle: ' QA Lead ', departmentId: null })
      .expect(200);
    expect(employeeSchema.parse(res.body)).toMatchObject({
      fullName: 'Chi Dang',
      jobTitle: 'QA Lead',
      department: null,
      manager: { fullName: 'Minh Nguyen' },
    });
    // The same values again change nothing, so they leave no event.
    await hr
      .patch(`/employees/${chi}`, { jobTitle: 'QA Lead', departmentId: null })
      .expect(200);
    expect(await eventsOf(chi)).toEqual([
      {
        actorUserId,
        action: 'employee.updated',
        entityType: 'employee',
        data: { jobTitle: 'QA Lead', departmentId: null },
      },
    ]);
    const empty = await hr.patch(`/employees/${chi}`, {}).expect(400);
    expect(errorOf(empty).code).toBe('VALIDATION_FAILED');
  });

  it('FR-03 PATCH /employees/:id changes the email only of someone with no account yet (409)', async () => {
    const duc = await idOf('Duc Tran');
    const ducBefore = await rowOf(duc);
    const refused = await hr
      .patch(`/employees/${duc}`, { email: `duc.t@${domain}` })
      .expect(409);
    expect(errorOf(refused)).toEqual({
      code: 'INVALID_STATE',
      message: "Duc Tran signs in with this email, so it can't be changed here",
    });
    // Their own email, in any case, is no change.
    await hr
      .patch(`/employees/${duc}`, { email: ducBefore.email.toUpperCase() })
      .expect(200);
    expect(await rowOf(duc)).toEqual(ducBefore);

    const chi = await idOf('Chi Dang');
    const res = await hr
      .patch(`/employees/${chi}`, { email: `Chi.D@${domain}` })
      .expect(200);
    expect(employeeSchema.parse(res.body).email).toBe(`chi.d@${domain}`);
    const taken = await hr
      .patch(`/employees/${chi}`, { email: `bao.ho@${domain}` })
      .expect(409);
    expect(errorOf(taken).message).toBe('Bao Ho already has this email');
  });

  it('FR-03 PATCH /employees/:id refuses a manager who reports to them, directly or not, and themself (400)', async () => {
    const [minh, chi, lan] = [
      await idOf('Minh Nguyen'),
      await idOf('Chi Dang'),
      await idOf('Lan Pham'),
    ];
    const refused = async (id: string, managerId: string, message: string) => {
      const before = await rowOf(id);
      const res = await hr.patch(`/employees/${id}`, { managerId }).expect(400);
      expect(errorOf(res)).toEqual({ code: 'VALIDATION_FAILED', message });
      expect(await rowOf(id)).toEqual(before);
    };
    await refused(minh, minh, "Minh Nguyen can't be their own manager");
    await refused(
      minh,
      chi,
      "Chi Dang reports to Minh Nguyen, so Chi Dang can't be Minh Nguyen's manager",
    );
    // Chi → Minh → Lan: Chi now reports to Lan through Minh.
    await hr.patch(`/employees/${minh}`, { managerId: lan }).expect(200);
    await refused(
      lan,
      chi,
      "Chi Dang reports to Lan Pham, so Chi Dang can't be Lan Pham's manager",
    );
    // Once Minh no longer reports to Lan, nothing links Chi to Lan.
    await hr.patch(`/employees/${minh}`, { managerId: null }).expect(200);
    await hr.patch(`/employees/${lan}`, { managerId: chi }).expect(200);
  });

  it('FR-03 POST, PATCH /departments add and rename, refusing a name taken in any case (409)', async () => {
    const design = departmentSchema.parse(
      (await hr.post('/departments', { name: '  Design ' }).expect(201)).body,
    );
    expect(design.name).toBe('Design');
    for (const name of ['it', ' IT ']) {
      const res = await hr.post('/departments', { name }).expect(409);
      expect(errorOf(res)).toEqual({
        code: 'INVALID_STATE',
        message: "There's already a department called IT",
      });
    }
    const blank = await hr.post('/departments', { name: ' ' }).expect(400);
    expect(errorOf(blank).code).toBe('VALIDATION_FAILED');

    // Its own name in another case is fine; another department's is not.
    await hr.patch(`/departments/${design.id}`, { name: 'design' }).expect(200);
    const taken = await hr
      .patch(`/departments/${design.id}`, { name: 'ENGINEERING' })
      .expect(409);
    expect(errorOf(taken).message).toBe(
      "There's already a department called Engineering",
    );
    const it = await departmentOf('IT');
    const renamed = await hr
      .patch(`/departments/${it}`, { name: 'Information Technology' })
      .expect(200);
    expect(renamed.body).toEqual({ id: it, name: 'Information Technology' });
    // People show their department's new name.
    const duc = await hr
      .get(`/employees/${await idOf('Duc Tran')}`)
      .expect(200);
    expect(employeeSchema.parse(duc.body).department).toEqual({
      id: it,
      name: 'Information Technology',
    });
    const listed = departmentSchema
      .array()
      .parse((await hr.get('/departments').expect(200)).body);
    expect(listed.map(({ name }) => name).toSorted()).toEqual(
      [
        'design',
        'Engineering',
        'Information Technology',
        'People Operations',
      ].toSorted(),
    );
    expect(await eventsOf(design.id)).toEqual([
      {
        actorUserId,
        action: 'department.created',
        entityType: 'department',
        data: { name: 'Design' },
      },
      {
        actorUserId,
        action: 'department.renamed',
        entityType: 'department',
        data: { from: 'Design', to: 'design' },
      },
    ]);
  });
});
