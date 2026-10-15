import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type Onboarding,
  onboardingSchema,
  type Template,
  type TemplateDefinition,
  templateSchema,
  templateVersionSchema,
} from '@joinpath/core';
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

// The least a template needs to publish.
const definition: TemplateDefinition = {
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks: [
    {
      key: 'welcome',
      phase: 'day-1',
      title: 'Welcome',
      type: 'CHECKLIST',
      assignee: { kind: 'NEW_HIRE' },
      availableOffsetDays: 0,
      dueOffsetDays: 0,
      dependsOn: [],
    },
  ],
};

describe('onboardings', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof seedDemoOrg>>;
  let organizationId: string;
  let managerId: string;
  let engineering: Template;
  let general: Template;
  let hr: Client;
  // An Vo and Bao Ho, both new hires with an account.
  let others: Record<'IT' | 'manager' | 'An' | 'Bao', Client>;
  let anVo: { id: string };
  let baoHo: { id: string };

  // Someone new who reports to the seed's manager and has no account, so tests never
  // trip over each other's open onboardings (BR-A01).
  let hires = 0;
  const newHire = async () => {
    hires += 1;
    const employee = await prisma.employee.create({
      data: {
        organizationId,
        fullName: `Hire ${hires}`,
        email: `hire.${hires}@${seeded.organization.slug}.joinpath.demo`,
        jobTitle: 'Engineer',
        managerId,
      },
    });
    return employee.id;
  };
  const create = (body: object) => hr.post('/onboardings', body);
  const draftFor = async (
    employeeId: string,
    templateId = engineering.id,
    startDate = '2026-11-02',
  ) =>
    onboardingSchema.parse(
      (await create({ employeeId, templateId, startDate }).expect(201)).body,
    );
  const read = async (client: Client, id: string) =>
    onboardingSchema.parse(
      (await client.get(`/onboardings/${id}`).expect(200)).body,
    );
  const listed = async (client: Client) =>
    onboardingSchema
      .array()
      .parse((await client.get('/onboardings').expect(200)).body)
      .map((onboarding) => onboarding.id);
  // Activation comes in M1.4b. Until then a test moves the row itself, pinning the version
  // the draft shows, as activation will.
  const markActive = ({ id, templateVersion }: Onboarding) =>
    prisma.onboarding.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        templateVersionId: templateVersion.id,
      },
    });
  // A new template with one published version.
  let templates = 0;
  const publishedTemplate = async () => {
    templates += 1;
    const res = await hr
      .post('/templates', { name: `Test template ${templates}` })
      .expect(201);
    const { id, versions } = templateSchema.parse(res.body);
    await hr
      .put(`/template-versions/${versions[0].id}`, definition)
      .expect(200);
    await hr.post(`/template-versions/${versions[0].id}/publish`).expect(200);
    return id;
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    seeded = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    organizationId = seeded.organization.id;
    managerId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: seeded.emails.manager },
      })
    ).employeeId;
    const an = await giveAccount(prisma, organizationId, 'An Vo');
    const bao = await giveAccount(prisma, organizationId, 'Bao Ho');
    anVo = an;
    baoHo = bao;
    hr = await signIn(app, seeded.emails.hr);
    others = {
      IT: await signIn(app, seeded.emails.it),
      manager: await signIn(app, seeded.emails.manager),
      An: await signIn(app, an.email),
      Bao: await signIn(app, bao.email),
    };
    const all = templateSchema
      .array()
      .parse((await hr.get('/templates').expect(200)).body);
    engineering = all.find((t) => t.name === 'Engineering Onboarding')!;
    general = all.find((t) => t.name === 'General Onboarding')!;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await app.close();
  });

  it('FR-07 FR-21 HR creates a draft: the start date round-trips, the newest published version shows, and it is audited', async () => {
    const chi = await prisma.employee.findFirstOrThrow({
      where: { organizationId, fullName: 'Chi Dang' },
    });
    const res = await create({
      employeeId: chi.id,
      templateId: engineering.id,
      startDate: '2026-11-02',
    }).expect(201);
    const onboarding = onboardingSchema.parse(res.body);
    expect(onboarding).toEqual({
      id: expect.any(String),
      status: 'DRAFT',
      startDate: '2026-11-02',
      activatedAt: null,
      employee: {
        id: chi.id,
        fullName: 'Chi Dang',
        email: chi.email,
        jobTitle: 'QA Engineer',
        department: { id: chi.departmentId, name: 'Engineering' },
        manager: { id: managerId, fullName: 'Minh Nguyen' },
      },
      template: { id: engineering.id, name: 'Engineering Onboarding' },
      // Activating now would copy v2, the newest published (BR-A03).
      templateVersion: { id: engineering.versions[0].id, version: 2 },
    });
    expect(
      (await hr.get(`/onboardings/${onboarding.id}`).expect(200)).body,
    ).toEqual(res.body);
    // The database holds the same calendar day, whatever the machine's time zone.
    const [row] = await prisma.$queryRaw<{ start_date: string }[]>`
      SELECT start_date::text AS start_date FROM onboardings WHERE id = ${onboarding.id}::uuid`;
    expect(row.start_date).toBe('2026-11-02');

    const hrUser = await prisma.user.findUniqueOrThrow({
      where: { email: seeded.emails.hr },
    });
    expect(
      await prisma.auditEvent.findMany({
        where: { onboardingId: onboarding.id },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: hrUser.id,
        action: 'onboarding.created',
        entityType: 'onboarding',
        entityId: onboarding.id,
        data: {
          employeeId: chi.id,
          templateId: engineering.id,
          startDate: '2026-11-02',
        },
      }),
    ]);
  });

  it('AT-11 BR-A01 an employee has one open onboarding at most; a closed one does not count', async () => {
    const employeeId = await newHire();
    const first = await draftFor(employeeId);
    const again = {
      employeeId,
      templateId: general.id,
      startDate: '2026-11-09',
    };
    const refusal = {
      code: 'INVALID_STATE',
      message: 'Employee already has an open onboarding',
    };
    expect(errorOf(await create(again).expect(409))).toEqual(refusal);
    await markActive(first);
    expect(errorOf(await create(again).expect(409))).toEqual(refusal);
    // Canceling comes in M3.1. CANCELED and COMPLETED are closed: the index covers
    // DRAFT and ACTIVE only.
    await prisma.onboarding.update({
      where: { id: first.id },
      data: { status: 'CANCELED' },
    });
    await create(again).expect(201);
  });

  it('AT-11 BR-A01 two creates at once leave exactly one open onboarding', async () => {
    const employeeId = await newHire();
    const body = {
      employeeId,
      templateId: engineering.id,
      startDate: '2026-11-02',
    };
    const responses = await Promise.all([create(body), create(body)]);
    expect(responses.map((res) => res.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const loser = responses.find((res) => res.status === 409)!;
    expect(errorOf(loser).code).toBe('INVALID_STATE');
    expect(await prisma.onboarding.count({ where: { employeeId } })).toBe(1);
    // The partial unique index refuses it too, whatever the API checks first.
    await expect(
      prisma.onboarding.create({
        data: {
          organizationId,
          employeeId,
          templateId: engineering.id,
          startDate: new Date('2026-11-02T00:00:00Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('BR-A03 a draft shows the newest published version; an active onboarding keeps its own', async () => {
    const templateId = await publishedTemplate();
    const draft = await draftFor(await newHire(), templateId);
    const active = await draftFor(await newHire(), templateId);
    await markActive(active);
    expect(draft.templateVersion.version).toBe(1);

    const res = await hr.post(`/templates/${templateId}/versions`).expect(201);
    const v2 = templateVersionSchema.parse(res.body);
    // An unpublished v2 is not what activation would use.
    expect((await read(hr, draft.id)).templateVersion.version).toBe(1);
    await hr.post(`/template-versions/${v2.id}/publish`).expect(200);
    expect((await read(hr, draft.id)).templateVersion).toEqual({
      id: v2.id,
      version: 2,
    });
    expect((await read(hr, active.id)).templateVersion.version).toBe(1);
  });

  it('BR-T12 an archived template takes no new onboarding; a draft that has it can still change', async () => {
    const templateId = await publishedTemplate();
    const draft = await draftFor(await newHire(), templateId);
    const another = await draftFor(await newHire());
    await hr.post(`/templates/${templateId}/archive`).expect(200);

    const res = await create({
      employeeId: await newHire(),
      templateId,
      startDate: '2026-11-02',
    }).expect(409);
    expect(errorOf(res)).toEqual({
      code: 'INVALID_STATE',
      message: 'Template is archived',
    });
    const moved = await hr
      .patch(`/onboardings/${another.id}`, { templateId })
      .expect(409);
    expect(errorOf(moved).message).toBe('Template is archived');

    // HR can still edit the draft and give it another template (activating it with the
    // archived one is refused, M1.4b).
    await hr
      .patch(`/onboardings/${draft.id}`, { startDate: '2026-11-16' })
      .expect(200);
    await hr
      .patch(`/onboardings/${draft.id}`, { templateId: general.id })
      .expect(200);
    expect((await read(hr, draft.id)).template.id).toBe(general.id);
  });

  it('FR-07 a template without a published version takes no onboarding', async () => {
    const res = await hr
      .post('/templates', { name: 'Unpublished' })
      .expect(201);
    const templateId = templateSchema.parse(res.body).id;
    const refused = await create({
      employeeId: await newHire(),
      templateId,
      startDate: '2026-11-02',
    }).expect(409);
    expect(errorOf(refused)).toEqual({
      code: 'INVALID_STATE',
      message: 'Template has no published version',
    });
    const draft = await draftFor(await newHire());
    await hr.patch(`/onboardings/${draft.id}`, { templateId }).expect(409);
  });

  it('FR-07 PATCH edits a draft: start date, template, even the employee; it is not audited', async () => {
    const [first, second] = [await newHire(), await newHire()];
    const draft = await draftFor(first, general.id);
    const path = `/onboardings/${draft.id}`;

    const moved = await hr.patch(path, { startDate: '2026-11-09' }).expect(200);
    expect(onboardingSchema.parse(moved.body)).toEqual({
      ...draft,
      startDate: '2026-11-09',
    });
    const switched = await hr
      .patch(path, { templateId: engineering.id })
      .expect(200);
    expect(onboardingSchema.parse(switched.body)).toMatchObject({
      template: { id: engineering.id, name: 'Engineering Onboarding' },
      templateVersion: { version: 2 },
    });

    // Back at the wizard's first step, HR picks someone else, which frees the first.
    const handedOn = await hr.patch(path, { employeeId: second }).expect(200);
    expect(onboardingSchema.parse(handedOn.body).employee.id).toBe(second);
    // Keeping its own employee is no conflict.
    await hr.patch(path, { employeeId: second }).expect(200);
    await draftFor(first);
    const taken = await hr.patch(path, { employeeId: first }).expect(409);
    expect(errorOf(taken).message).toBe(
      'Employee already has an open onboarding',
    );

    // A draft is still being prepared: only its creation is on record.
    expect(
      await prisma.auditEvent.findMany({
        where: { onboardingId: draft.id },
        select: { action: true },
      }),
    ).toEqual([{ action: 'onboarding.created' }]);
  });

  it('FR-07 PATCH refuses a bad body, an unknown onboarding, and one that is no longer a draft', async () => {
    const draft = await draftFor(await newHire());
    const path = `/onboardings/${draft.id}`;
    for (const body of [
      {},
      { startDate: '2026-02-30' },
      { employeeId: 'nobody' },
    ]) {
      const res = await hr.patch(path, body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    await hr
      .patch(`/onboardings/${randomUUID()}`, { startDate: '2026-11-09' })
      .expect(404);

    await markActive(draft);
    const res = await hr.patch(path, { startDate: '2026-11-09' }).expect(409);
    expect(errorOf(res)).toEqual({
      code: 'INVALID_STATE',
      message: 'Only a draft can change',
    });
    expect((await read(hr, draft.id)).startDate).toBe(draft.startDate);
  });

  it('BR-P01 BR-P02 the employees, templates and onboardings of another org are 404', async () => {
    const other = await seedDemoOrg(prisma, {
      slug: newSlug(),
      password: PASSWORD,
    });
    try {
      const otherOrgId = other.organization.id;
      const outsider = await prisma.employee.findFirstOrThrow({
        where: { organizationId: otherOrgId, fullName: 'An Vo' },
      });
      const outsideTemplate = await prisma.template.findFirstOrThrow({
        where: { organizationId: otherOrgId },
      });
      const theirs = await prisma.onboarding.create({
        data: {
          organizationId: otherOrgId,
          employeeId: outsider.id,
          templateId: outsideTemplate.id,
          startDate: new Date('2026-11-02T00:00:00Z'),
        },
      });

      const byEmployee = await create({
        employeeId: outsider.id,
        templateId: engineering.id,
        startDate: '2026-11-02',
      }).expect(404);
      expect(errorOf(byEmployee)).toEqual({
        code: 'NOT_FOUND',
        message: 'Employee not found',
      });
      const byTemplate = await create({
        employeeId: await newHire(),
        templateId: outsideTemplate.id,
        startDate: '2026-11-02',
      }).expect(404);
      expect(errorOf(byTemplate).message).toBe('Template not found');
      const draft = await draftFor(await newHire());
      await hr
        .patch(`/onboardings/${draft.id}`, { employeeId: outsider.id })
        .expect(404);
      await hr
        .patch(`/onboardings/${draft.id}`, { templateId: outsideTemplate.id })
        .expect(404);

      await hr.get(`/onboardings/${theirs.id}`).expect(404);
      await hr
        .patch(`/onboardings/${theirs.id}`, { startDate: '2026-11-09' })
        .expect(404);
      expect(
        await prisma.onboarding.findUniqueOrThrow({ where: { id: theirs.id } }),
      ).toEqual(theirs);
      expect(await listed(hr)).not.toContain(theirs.id);
      const malformed = await hr.get('/onboardings/not-a-uuid').expect(400);
      expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');
    } finally {
      await prisma.organization.delete({
        where: { id: other.organization.id },
      });
    }
  });

  it("§9 BR-P02 HR sees every onboarding; others see no draft, then their own and their reports'", async () => {
    const an = await draftFor(anVo.id, engineering.id, '2026-11-16');
    const bao = await draftFor(baoHo.id, engineering.id, '2026-10-26');

    const all = onboardingSchema
      .array()
      .parse((await hr.get('/onboardings').expect(200)).body);
    expect(all.map((onboarding) => onboarding.id)).toEqual(
      expect.arrayContaining([an.id, bao.id]),
    );
    // The latest start date first.
    const dates = all.map((onboarding) => onboarding.startDate);
    expect(dates).toEqual([...dates].sort().reverse());

    // A draft is HR's to prepare.
    for (const client of Object.values(others)) {
      const ids = await listed(client);
      expect(ids).not.toContain(an.id);
      expect(ids).not.toContain(bao.id);
      await client.get(`/onboardings/${an.id}`).expect(404);
    }

    await markActive(an);
    await markActive(bao);
    expect(await listed(others.manager)).toEqual(
      expect.arrayContaining([an.id, bao.id]),
    );
    expect(await listed(others.An)).toEqual([an.id]);
    expect(await listed(others.Bao)).toEqual([bao.id]);
    await read(others.manager, bao.id);
    await read(others.An, an.id);
    await others.An.get(`/onboardings/${bao.id}`).expect(404);
    // IT sees an onboarding through its tasks (M1.4b); with none yet, it sees nothing.
    expect(await listed(others.IT)).toEqual([]);
    await others.IT.get(`/onboardings/${an.id}`).expect(404);
  });

  it('§9 only HR creates or edits an onboarding', async () => {
    const employeeId = await newHire();
    const draft = await draftFor(await newHire());
    for (const [who, client] of Object.entries(others)) {
      const created = await client.post('/onboardings', {
        employeeId,
        templateId: engineering.id,
        startDate: '2026-11-02',
      });
      const edited = await client.patch(`/onboardings/${draft.id}`, {
        startDate: '2026-11-09',
      });
      expect({ who, created: created.status, edited: edited.status }).toEqual({
        who,
        created: 403,
        edited: 403,
      });
    }
    expect(await prisma.onboarding.count({ where: { employeeId } })).toBe(0);
    expect((await read(hr, draft.id)).startDate).toBe('2026-11-02');
  });
});
