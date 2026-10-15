import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  activationPreviewSchema,
  type Onboarding,
  onboardingDetailSchema,
  onboardingSchema,
  onboardingSummarySchema,
  type Template,
  type TemplateDefinition,
  templateSchema,
  templateVersionSchema,
  today,
} from '@joinpath/core';
import type { App } from 'supertest/types.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import type { PrismaService } from '../src/prisma.js';
import {
  checklists,
  type Client,
  createApp,
  errorOf,
  newSlug,
  type Org,
  PASSWORD,
  seedOrg,
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
  let seeded: Org['seeded'];
  let organizationId: string;
  let managerId: string;
  let engineering: Template;
  let general: Template;
  let hr: Client;
  let others: Org['others'];
  let anVo: { id: string };
  let baoHo: { id: string };
  let itPicks: Record<string, string>;
  let day: Org['day'];
  let newHire: Org['newHire'];
  let draftFor: Org['draftFor'];
  let activate: Org['activate'];
  let publishedTemplate: Org['publishedTemplate'];

  const create = (body: object) => hr.post('/onboardings', body);
  const read = async (client: Client, id: string) =>
    onboardingDetailSchema.parse(
      (await client.get(`/onboardings/${id}`).expect(200)).body,
    );
  const listed = async (client: Client) =>
    onboardingSchema
      .array()
      .parse((await client.get('/onboardings').expect(200)).body)
      .map((onboarding) => onboarding.id);
  const preview = async (id: string) =>
    activationPreviewSchema.parse(
      (await hr.get(`/onboardings/${id}/activation-preview`).expect(200)).body,
    );

  beforeAll(async () => {
    app = await createApp();
    ({
      prisma,
      seeded,
      organizationId,
      managerId,
      engineering,
      general,
      hr,
      others,
      anVo,
      baoHo,
      itPicks,
      day,
      newHire,
      draftFor,
      activate,
      publishedTemplate,
    } = await seedOrg(app));
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
      completedAt: null,
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
    // Nothing else exists until activation.
    expect(onboardingDetailSchema.parse(res.body)).toMatchObject({
      today: day(0),
      tasks: [],
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
    await activate(first);
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

  it('AT-05 BR-A03 BR-A08 a newly published version changes what a draft would get, never a running onboarding', async () => {
    const templateId = await publishedTemplate(definition);
    const draft = await draftFor(await newHire(), templateId);
    const active = await activate(await draftFor(await newHire(), templateId));
    expect(draft.templateVersion.version).toBe(1);

    const res = await hr.post(`/templates/${templateId}/versions`).expect(201);
    const v2 = templateVersionSchema.parse(res.body);
    // An unpublished v2 is not what activation would use.
    expect((await read(hr, draft.id)).templateVersion.version).toBe(1);
    const [welcome] = definition.tasks;
    await hr
      .put(`/template-versions/${v2.id}`, {
        ...definition,
        tasks: [{ ...welcome, title: 'Welcome aboard', dueOffsetDays: 2 }],
      })
      .expect(200);
    await hr.post(`/template-versions/${v2.id}/publish`).expect(200);
    expect((await read(hr, draft.id)).templateVersion).toEqual({
      id: v2.id,
      version: 2,
    });
    expect((await preview(draft.id)).tasks).toMatchObject([
      { title: 'Welcome aboard' },
    ]);
    // The running onboarding keeps its version, and its tasks as activation made them.
    expect(await read(hr, active.id)).toEqual(active);
    expect(active).toMatchObject({
      templateVersion: { version: 1 },
      tasks: [{ title: 'Welcome', dueOn: active.startDate }],
    });
  });

  it('BR-T12 an archived template takes no new onboarding and activates no draft; a draft that has it can still change', async () => {
    const templateId = await publishedTemplate(definition);
    const draft = await draftFor(await newHire(), templateId);
    const another = await draftFor(await newHire());
    await hr.post(`/templates/${templateId}/archive`).expect(200);

    const res = await create({
      employeeId: await newHire(),
      templateId,
      startDate: '2026-11-02',
    }).expect(409);
    const archived = { code: 'INVALID_STATE', message: 'Template is archived' };
    expect(errorOf(res)).toEqual(archived);
    const moved = await hr
      .patch(`/onboardings/${another.id}`, { templateId })
      .expect(409);
    expect(errorOf(moved)).toEqual(archived);
    const previewed = await hr
      .get(`/onboardings/${draft.id}/activation-preview`)
      .expect(409);
    expect(errorOf(previewed)).toEqual(archived);
    const activated = await hr
      .post(`/onboardings/${draft.id}/activate`, {
        templateVersionId: draft.templateVersion.id,
      })
      .expect(409);
    expect(errorOf(activated)).toEqual(archived);
    expect((await read(hr, draft.id)).status).toBe('DRAFT');

    // HR can still edit the draft and give it another template, which activates.
    await hr
      .patch(`/onboardings/${draft.id}`, { startDate: '2026-11-16' })
      .expect(200);
    await hr
      .patch(`/onboardings/${draft.id}`, { templateId: general.id })
      .expect(200);
    expect((await activate(draft)).template.id).toBe(general.id);
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

  it('FR-07 BR-E05 PATCH refuses a bad body, a status, an unknown onboarding, and one that is no longer a draft', async () => {
    const draft = await draftFor(await newHire());
    const path = `/onboardings/${draft.id}`;
    // BR-E05: status is not a field, so { status } changes as little as {}.
    for (const body of [
      {},
      { status: 'ACTIVE' },
      { startDate: '2026-02-30' },
      { employeeId: 'nobody' },
    ]) {
      const res = await hr.patch(path, body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    expect((await read(hr, draft.id)).status).toBe('DRAFT');
    await hr
      .patch(`/onboardings/${randomUUID()}`, { startDate: '2026-11-09' })
      .expect(404);

    await activate(draft);
    const res = await hr.patch(path, { startDate: '2026-11-09' }).expect(409);
    expect(errorOf(res)).toEqual({
      code: 'INVALID_STATE',
      message: 'Only a draft can change',
    });
    expect((await read(hr, draft.id)).startDate).toBe(draft.startDate);
  });

  it('FR-26 BR-A06 the preview plans every task: its dates, whom the rules found, and what HR must pick', async () => {
    const hire = await newHire();
    const draft = await draftFor(hire, engineering.id, '2026-11-02');
    const plan = await preview(draft.id);
    expect(plan.onboarding).toEqual(draft);
    expect(plan.today).toBe(day(0));
    // In template order, dated from the start date.
    expect(
      plan.tasks.map(({ key, availableOn, dueOn }) => [
        key,
        availableOn,
        dueOn,
      ]),
    ).toEqual([
      ['upload-id', '2026-10-19', '2026-10-28'],
      ['review-id', '2026-10-19', '2026-10-30'],
      ['sign-handbook', '2026-10-19', '2026-10-30'],
      ['prepare-laptop', '2026-10-26', '2026-10-30'],
      ['create-accounts', '2026-10-28', '2026-10-30'],
      ['assign-buddy', '2026-10-26', '2026-10-29'],
      ['welcome-meeting', '2026-11-02', '2026-11-02'],
      ['set-up-dev-env', '2026-11-02', '2026-11-04'],
      ['security-training', '2026-11-02', '2026-11-06'],
      ['ship-first-pr', '2026-11-03', '2026-11-06'],
      ['week-one-check-in', '2026-11-06', '2026-11-06'],
    ]);
    // Whom each rule found, by name. Only the two IT tasks wait for HR.
    const name = (id: string) =>
      plan.people.find((person) => person.id === id)!.fullName;
    const owners = Object.fromEntries(
      plan.tasks.map((task) => [
        task.key,
        [
          task.assigneeId && name(task.assigneeId),
          task.candidates.map(name).sort(),
          task.problem,
        ],
      ]),
    );
    const hireName = name(hire);
    expect(owners).toMatchObject({
      'upload-id': [hireName, [hireName], undefined],
      'review-id': ['Lan Pham', ['Lan Pham'], undefined],
      'prepare-laptop': [null, ['Duc Tran', 'Huy Le'], 'PICK_NEEDED'],
      'create-accounts': [null, ['Duc Tran', 'Huy Le'], 'PICK_NEEDED'],
      'assign-buddy': ['Minh Nguyen', ['Minh Nguyen'], undefined],
    });
    expect(
      plan.tasks.filter((task) => task.problem).map((task) => task.key),
    ).toEqual(['prepare-laptop', 'create-accounts']);
    expect(plan.people.map((person) => person.fullName).sort()).toEqual(
      ['Duc Tran', 'Huy Le', 'Lan Pham', 'Minh Nguyen', hireName].sort(),
    );
    expect(
      plan.tasks.find((task) => task.key === 'set-up-dev-env'),
    ).toMatchObject({ dependsOn: ['prepare-laptop', 'create-accounts'] });
    expect(plan.tasks.find((task) => task.key === 'review-id')).toMatchObject({
      reviews: 'upload-id',
      dependsOn: ['upload-id'],
    });

    // A start date already past still activates; the preview flags what is overdue.
    const late = await draftFor(await newHire(), engineering.id, day(-3));
    const overdue = (await preview(late.id)).tasks
      .filter((task) => task.overdue)
      .map((task) => task.key);
    expect(overdue).toEqual([
      'upload-id',
      'review-id',
      'sign-handbook',
      'prepare-laptop',
      'create-accounts',
      'assign-buddy',
      'welcome-meeting',
      'set-up-dev-env',
    ]);
    const activated = await activate(late);
    expect(activated.tasks.filter((task) => task.overdue)).toHaveLength(8);
  });

  it("AT-10 BR-A04 BR-A05 activation creates the planned tasks and dependencies, the new hire's though they have no account; it is audited", async () => {
    const hire = await newHire();
    const draft = await draftFor(hire, engineering.id, day(30));
    const plan = await preview(draft.id);
    const templateVersionId = plan.onboarding.templateVersion.id;
    const res = await hr
      .post(`/onboardings/${draft.id}/activate`, {
        templateVersionId,
        assignees: itPicks,
      })
      .expect(200);
    const active = onboardingDetailSchema.parse(res.body);
    expect(active).toMatchObject({
      status: 'ACTIVE',
      activatedAt: expect.any(String),
      templateVersion: { id: templateVersionId, version: 2 },
      today: day(0),
    });
    expect((await hr.get(`/onboardings/${draft.id}`).expect(200)).body).toEqual(
      res.body,
    );

    // Each task is the one planned. A title is unique within a template (BR-T04).
    const idOf = (key: string) => {
      const { title } = plan.tasks.find((task) => task.key === key)!;
      return active.tasks.find((task) => task.title === title)!.id;
    };
    const nameOf = (id: string) =>
      plan.people.find((person) => person.id === id)!.fullName;
    expect(active.tasks).toEqual(
      plan.tasks.map((planned) => {
        const assignee = planned.assigneeId ?? itPicks[planned.key];
        return {
          id: idOf(planned.key),
          phaseKey: planned.phaseKey,
          phaseName: planned.phaseName,
          phaseOrder: planned.phaseOrder,
          position: planned.position,
          title: planned.title,
          description: planned.description ?? null,
          type: planned.type,
          assignee: { id: assignee, fullName: nameOf(assignee) },
          reviewsTaskId: planned.reviews ? idOf(planned.reviews) : null,
          dependsOn: planned.dependsOn.map(idOf),
          availableOn: planned.availableOn,
          dueOn: planned.dueOn,
          status: 'PENDING',
          startedAt: null,
          completedAt: null,
          // A month ahead, nothing has opened yet.
          availability: 'LOCKED_BY_DATE',
          overdue: false,
          files: [],
        };
      }),
    );
    // The new hire takes their tasks without an account; invitations.e2e-spec.ts covers
    // the invitation it sends them.
    expect(await prisma.user.count({ where: { employeeId: hire } })).toBe(0);
    expect(
      active.tasks.filter((task) => task.assignee.id === hire),
    ).toHaveLength(5);

    const hrUser = await prisma.user.findUniqueOrThrow({
      where: { email: seeded.emails.hr },
    });
    expect(
      await prisma.auditEvent.findMany({
        where: { onboardingId: draft.id, action: 'onboarding.activated' },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: hrUser.id,
        entityType: 'onboarding',
        entityId: draft.id,
        data: { templateVersionId, assignees: itPicks },
      }),
    ]);
  });

  it('AT-07 BR-A04 activation needs an owner for every task: a 422 names the tasks, and nothing is created', async () => {
    const unresolved = async (draft: Onboarding, assignees: object) => {
      const { onboarding } = await preview(draft.id);
      const res = await hr
        .post(`/onboardings/${draft.id}/activate`, {
          templateVersionId: onboarding.templateVersion.id,
          assignees,
        })
        .expect(422);
      expect((await read(hr, draft.id)).status).toBe('DRAFT');
      expect(
        await prisma.task.count({ where: { onboardingId: draft.id } }),
      ).toBe(0);
      return errorOf(res);
    };

    // Two people have the IT role and HR picked one task's owner only: the new hire,
    // who takes no work but their own.
    const hire = await newHire();
    const draft = await draftFor(hire);
    expect(await unresolved(draft, { 'prepare-laptop': hire })).toEqual({
      code: 'ASSIGNEE_UNRESOLVED',
      message: 'Fix the owner of 2 tasks to activate',
      details: [
        { taskKey: 'prepare-laptop', problem: 'PICK_INVALID' },
        { taskKey: 'create-accounts', problem: 'PICK_NEEDED' },
      ],
    });
    // The new hire has no manager.
    const managerless = await draftFor(await newHire(null));
    expect((await unresolved(managerless, itPicks)).details).toEqual([
      { taskKey: 'assign-buddy', problem: 'NO_CANDIDATE' },
      { taskKey: 'welcome-meeting', problem: 'NO_CANDIDATE' },
      { taskKey: 'week-one-check-in', problem: 'NO_CANDIDATE' },
    ]);
    // Nobody has an active IT account.
    const itUsers = { organizationId, role: 'IT' as const };
    await prisma.user.updateMany({
      where: itUsers,
      data: { status: 'DISABLED' },
    });
    try {
      expect((await unresolved(draft, {})).details).toEqual([
        { taskKey: 'prepare-laptop', problem: 'NO_CANDIDATE' },
        { taskKey: 'create-accounts', problem: 'NO_CANDIDATE' },
      ]);
    } finally {
      await prisma.user.updateMany({
        where: itUsers,
        data: { status: 'ACTIVE' },
      });
    }
    // The refusals left nothing behind: with an owner for each task, it activates.
    expect((await activate(draft)).tasks).toHaveLength(11);
  });

  it('AT-08 BR-A05 two activations at once create one set of tasks', async () => {
    const draft = await draftFor(await newHire());
    const { onboarding } = await preview(draft.id);
    const activation = () =>
      hr.post(`/onboardings/${draft.id}/activate`, {
        templateVersionId: onboarding.templateVersion.id,
        assignees: itPicks,
      });
    const responses = await Promise.all([activation(), activation()]);
    expect(responses.map((res) => res.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const loser = responses.find((res) => res.status === 409)!;
    expect(errorOf(loser)).toEqual({
      code: 'INVALID_STATE',
      message: 'Only a draft can be activated',
    });
    expect(await prisma.task.count({ where: { onboardingId: draft.id } })).toBe(
      11,
    );
    expect(
      await prisma.auditEvent.count({
        where: { onboardingId: draft.id, action: 'onboarding.activated' },
      }),
    ).toBe(1);
  });

  it('BR-A05 a PATCH racing activation: the tasks follow whichever start date was committed', async () => {
    const draft = await draftFor(await newHire(), engineering.id, day(30));
    const { onboarding } = await preview(draft.id);
    const [patched, activated] = await Promise.all([
      hr.patch(`/onboardings/${draft.id}`, { startDate: day(40) }),
      hr.post(`/onboardings/${draft.id}/activate`, {
        templateVersionId: onboarding.templateVersion.id,
        assignees: itPicks,
      }),
    ]);
    expect(activated.status).toBe(200);
    // The PATCH either landed before activation locked the draft, or found it active.
    expect([200, 409]).toContain(patched.status);
    const active = await read(hr, draft.id);
    expect(active.startDate).toBe(patched.status === 200 ? day(40) : day(30));
    // The welcome meeting opens on the start date itself.
    const welcome = active.tasks.find(
      (task) => task.title === 'Welcome meeting',
    );
    expect(welcome?.availableOn).toBe(active.startDate);
  });

  it('AT-09 BR-A03 activating the version the preview showed, once a newer one is published, is a 409', async () => {
    const templateId = await publishedTemplate(definition);
    const draft = await draftFor(await newHire(), templateId);
    const shown = (await preview(draft.id)).onboarding.templateVersion;
    const res = await hr.post(`/templates/${templateId}/versions`).expect(201);
    const v2 = templateVersionSchema.parse(res.body);
    await hr.post(`/template-versions/${v2.id}/publish`).expect(200);

    const refused = await hr
      .post(`/onboardings/${draft.id}/activate`, {
        templateVersionId: shown.id,
      })
      .expect(409);
    expect(errorOf(refused)).toEqual({
      code: 'TEMPLATE_VERSION_CHANGED',
      message: 'The template has a newer version: preview again',
    });
    expect((await read(hr, draft.id)).status).toBe('DRAFT');
    expect(await prisma.task.count({ where: { onboardingId: draft.id } })).toBe(
      0,
    );
    // Previewed again, the draft shows v2 and activates with it.
    expect((await activate(draft)).templateVersion).toEqual({
      id: v2.id,
      version: 2,
    });
  });

  it('FR-26 BR-A02 preview and activate refuse a bad body, an unknown onboarding, and one already activated', async () => {
    const draft = await draftFor(await newHire());
    const { onboarding } = await preview(draft.id);
    const templateVersionId = onboarding.templateVersion.id;
    const path = `/onboardings/${draft.id}/activate`;
    for (const body of [
      {},
      { templateVersionId: 'v2' },
      { templateVersionId, assignees: { 'prepare-laptop': 'Duc Tran' } },
    ]) {
      const res = await hr.post(path, body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    await hr.get(`/onboardings/${randomUUID()}/activation-preview`).expect(404);
    // Picks are optional: the body is valid, the onboarding unknown.
    await hr
      .post(`/onboardings/${randomUUID()}/activate`, { templateVersionId })
      .expect(404);

    await activate(draft);
    const previewed = await hr
      .get(`/onboardings/${draft.id}/activation-preview`)
      .expect(409);
    expect(errorOf(previewed)).toEqual({
      code: 'INVALID_STATE',
      message: 'Only a draft can be activated',
    });
    await hr.post(path, { templateVersionId, assignees: itPicks }).expect(409);
  });

  it("§4.6 BR-E06 tasks open on the org's business date, in its time zone and by its demo clock; overdue can go with BLOCKED", async () => {
    // Twenty days ahead, so the first tasks open in six days (14 before the start).
    const active = await activate(
      await draftFor(await newHire(), engineering.id, day(20)),
    );
    const on = async (clockOffsetDays: number) => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { clockOffsetDays },
      });
      const detail = await read(hr, active.id);
      return {
        today: detail.today,
        ...Object.fromEntries(
          detail.tasks.map((task) => [
            task.title,
            [task.availability, task.overdue],
          ]),
        ),
      };
    };
    try {
      expect(active.today).toBe(day(0));
      expect(new Set(active.tasks.map((task) => task.availability))).toEqual(
        new Set(['LOCKED_BY_DATE']),
      );
      expect(await on(6)).toMatchObject({
        today: day(6),
        'Upload ID documents': ['READY', false],
        'Review ID documents': ['BLOCKED', false],
        'Sign the employee handbook': ['READY', false],
        'Prepare laptop': ['LOCKED_BY_DATE', false],
      });
      // Past both due dates (start − 5 and start − 3), the review is overdue while it still
      // waits for the upload.
      expect(await on(18)).toMatchObject({
        today: day(18),
        'Upload ID documents': ['READY', true],
        'Review ID documents': ['BLOCKED', true],
        'Prepare laptop': ['READY', true],
        'Welcome meeting': ['LOCKED_BY_DATE', false],
      });
      // The date is the org's own. These two zones are 25 hours apart, so at any hour at
      // least one of them is on another date than UTC.
      for (const timezone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { timezone, clockOffsetDays: 0 },
        });
        expect((await read(hr, active.id)).today).toBe(
          today(timezone, 0, new Date()),
        );
      }
    } finally {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { timezone: seeded.organization.timezone, clockOffsetDays: 0 },
      });
    }
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
      // Someone of another org is no owner to pick.
      const { onboarding } = await preview(draft.id);
      const picked = await hr
        .post(`/onboardings/${draft.id}/activate`, {
          templateVersionId: onboarding.templateVersion.id,
          assignees: { ...itPicks, 'prepare-laptop': outsider.id },
        })
        .expect(422);
      expect(errorOf(picked).details).toEqual([
        { taskKey: 'prepare-laptop', problem: 'PICK_INVALID' },
      ]);

      await hr.get(`/onboardings/${theirs.id}`).expect(404);
      await hr
        .patch(`/onboardings/${theirs.id}`, { startDate: '2026-11-09' })
        .expect(404);
      await hr.get(`/onboardings/${theirs.id}/activation-preview`).expect(404);
      await hr
        .post(`/onboardings/${theirs.id}/activate`, {
          templateVersionId: randomUUID(),
        })
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

  it("§9 BR-P02 HR sees every onboarding; others see no draft, then their own, their reports', and those they have a task in", async () => {
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

    await activate(an);
    await activate(bao);
    expect(await listed(others.manager)).toEqual(
      expect.arrayContaining([an.id, bao.id]),
    );
    expect(await listed(others.An)).toEqual([an.id]);
    expect(await listed(others.Bao)).toEqual([bao.id]);
    await read(others.manager, bao.id);
    await read(others.An, an.id);
    await others.An.get(`/onboardings/${bao.id}`).expect(404);
    // Duc has IT tasks in both, so he sees them, with every task for context. Huy, the other
    // IT person, has none.
    expect(await listed(others.IT)).toEqual(
      expect.arrayContaining([an.id, bao.id]),
    );
    expect((await read(others.IT, an.id)).tasks).toHaveLength(11);
    expect(await listed(others.IT2)).toEqual([]);
    await others.IT2.get(`/onboardings/${an.id}`).expect(404);
  });

  it('FR-19 BR-E06 BR-C01 the list counts tasks done and overdue and names the next one; a finished onboarding has none next', async () => {
    const rows = async (client: Client) =>
      onboardingSummarySchema
        .array()
        .parse((await client.get('/onboardings').expect(200)).body);
    const rowOf = async (client: Client, id: string) =>
      (await rows(client)).find((row) => row.id === id)!;

    // Starting today: six tasks before day 1 are past due on activation (BR-A06).
    const draft = await draftFor(await newHire(), engineering.id, day(0));
    expect(await rowOf(hr, draft.id)).toMatchObject({
      status: 'DRAFT',
      completedAt: null,
      progress: { completed: 0, total: 0, overdue: 0 },
      nextTask: null,
    });
    const active = await activate(draft);
    const byTitle = (title: string) => ({
      id: active.tasks.find((task) => task.title === title)!.id,
      title,
    });
    expect(active.tasks.filter((task) => task.overdue)).toHaveLength(6);
    expect(await rowOf(hr, draft.id)).toMatchObject({
      status: 'ACTIVE',
      progress: { completed: 0, total: 11, overdue: 6 },
      nextTask: byTitle('Upload ID documents'),
    });

    // The upload is done (its command comes in M2) and the manager assigns a buddy. Four
    // tasks are then due three days before the start: template order puts the review first,
    // though it was created after the other three.
    await prisma.task.update({
      where: { id: byTitle('Upload ID documents').id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await others.manager
      .post(`/tasks/${byTitle('Assign an onboarding buddy').id}/complete`)
      .expect(200);
    const progressed = await rowOf(hr, draft.id);
    expect(progressed).toMatchObject({
      progress: { completed: 2, total: 11, overdue: 4 },
      nextTask: byTitle('Review ID documents'),
    });
    // Duc has tasks in it, so he sees it, counted the same.
    expect(await rowOf(others.IT, draft.id)).toEqual(progressed);

    // Same start date: the newer onboarding is listed first.
    const templateId = await publishedTemplate(checklists);
    const short = await activate(
      await draftFor(await newHire(), templateId, day(0)),
    );
    const ids = (await rows(hr)).map((row) => row.id);
    expect(ids.indexOf(short.id)).toBeLessThan(ids.indexOf(draft.id));

    // A task in progress is still open, and not yet done.
    await hr.post(`/tasks/${short.tasks[1].id}/start`).expect(200);
    await others.manager
      .post(`/tasks/${short.tasks[0].id}/complete`)
      .expect(200);
    expect(await rowOf(hr, short.id)).toMatchObject({
      progress: { completed: 1, total: 2, overdue: 0 },
      nextTask: { id: short.tasks[1].id, title: 'Print a badge' },
    });
    const done = onboardingDetailSchema.parse(
      (await hr.post(`/tasks/${short.tasks[1].id}/complete`).expect(200)).body,
    );
    expect(await rowOf(hr, short.id)).toMatchObject({
      status: 'COMPLETED',
      completedAt: done.tasks[1].completedAt,
      progress: { completed: 2, total: 2, overdue: 0 },
      nextTask: null,
    });
  });

  it('AT-06 BR-A02 §9 only HR creates, edits, previews or activates an onboarding', async () => {
    const employeeId = await newHire();
    const draft = await draftFor(await newHire());
    const { onboarding } = await preview(draft.id);
    for (const [who, client] of Object.entries(others)) {
      const created = await client.post('/onboardings', {
        employeeId,
        templateId: engineering.id,
        startDate: '2026-11-02',
      });
      const edited = await client.patch(`/onboardings/${draft.id}`, {
        startDate: '2026-11-09',
      });
      const previewed = await client.get(
        `/onboardings/${draft.id}/activation-preview`,
      );
      const activated = await client.post(`/onboardings/${draft.id}/activate`, {
        templateVersionId: onboarding.templateVersion.id,
        assignees: itPicks,
      });
      expect({
        who,
        created: created.status,
        edited: edited.status,
        previewed: previewed.status,
        activated: activated.status,
      }).toEqual({
        who,
        created: 403,
        edited: 403,
        previewed: 403,
        activated: 403,
      });
    }
    expect(await prisma.onboarding.count({ where: { employeeId } })).toBe(0);
    expect(await read(hr, draft.id)).toMatchObject({
      status: 'DRAFT',
      startDate: '2026-11-02',
      tasks: [],
    });
  });
});
