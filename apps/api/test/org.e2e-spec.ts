import type { INestApplication } from '@nestjs/common';
import { departmentSchema, employeeSchema } from '@joinpath/core';
import type { App } from 'supertest/types.js';
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

  const namesListed = async (query: string) => {
    const res = await hr.get(`/employees${query}`).expect(200);
    return employeeSchema
      .array()
      .parse(res.body)
      .map((employee) => employee.fullName);
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    seeded = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    other = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    const anVo = await giveAccount(prisma, seeded.organization.id, 'An Vo');
    hr = await signIn(app, seeded.emails.hr);
    others = {
      IT: await signIn(app, seeded.emails.it),
      manager: await signIn(app, seeded.emails.manager),
      'new hire': await signIn(app, anVo.email),
    };
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [seeded.organization.id, other.organization.id] } },
    });
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

  it('§9 only HR lists employees and departments', async () => {
    for (const [who, client] of Object.entries(others)) {
      for (const path of ['/employees', '/departments']) {
        const res = await client.get(path);
        expect({ who, path, status: res.status }).toEqual({
          who,
          path,
          status: 403,
        });
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    }
  });
});
