import type { INestApplication } from '@nestjs/common';
import {
  type TaskDef,
  type TemplateDefinition,
  templateSchema,
  templateVersionSchema,
  validateTemplate,
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

const task = (key: string, fields: Partial<TaskDef> = {}): TaskDef => ({
  key,
  phase: 'day-1',
  title: key,
  type: 'CHECKLIST',
  assignee: { kind: 'NEW_HIRE' },
  availableOffsetDays: 0,
  dueOffsetDays: 0,
  dependsOn: [],
  ...fields,
});
const definitionOf = (...tasks: TaskDef[]): TemplateDefinition => ({
  phases: [{ key: 'day-1', name: 'Day 1' }],
  tasks,
});

describe('templates', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof seedDemoOrg>>;
  let hr: Client;
  let others: Record<'IT' | 'manager' | 'new hire', Client>;

  const templateNamed = async (name: string) => {
    const res = await hr.get('/templates').expect(200);
    return templateSchema
      .array()
      .parse(res.body)
      .find((template) => template.name === name)!;
  };
  // A new template whose draft v1 holds the definition.
  let created = 0;
  const draftOf = async (definition: TemplateDefinition) => {
    const res = await hr
      .post('/templates', { name: `Test template ${++created}` })
      .expect(201);
    const template = templateSchema.parse(res.body);
    const versionId = template.versions[0].id;
    await hr.put(`/template-versions/${versionId}`, definition).expect(200);
    return { templateId: template.id, versionId };
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    seeded = await seedDemoOrg(prisma, { slug: newSlug(), password: PASSWORD });
    const anVo = await giveAccount(prisma, seeded.organization.id, 'An Vo');
    hr = await signIn(app, seeded.emails.hr);
    others = {
      IT: await signIn(app, seeded.emails.it),
      manager: await signIn(app, seeded.emails.manager),
      'new hire': await signIn(app, anVo.email),
    };
  });

  afterAll(async () => {
    await purgeOrg(prisma, seeded.organization.id);
    await app.close();
  });

  it('PLAN §11 the seed publishes Engineering Onboarding v1 and v2 and General Onboarding v1', async () => {
    const res = await hr.get('/templates').expect(200);
    const templates = templateSchema.array().parse(res.body);
    expect(
      templates.map(({ name, versions }) => ({
        name,
        versions: versions.map(({ version, status }) => ({ version, status })),
      })),
    ).toEqual([
      {
        name: 'Engineering Onboarding',
        versions: [
          { version: 2, status: 'PUBLISHED' },
          { version: 1, status: 'PUBLISHED' },
        ],
      },
      {
        name: 'General Onboarding',
        versions: [{ version: 1, status: 'PUBLISHED' }],
      },
    ]);

    const taskCounts = [];
    for (const template of templates) {
      for (const { id } of template.versions) {
        const version = templateVersionSchema.parse(
          (await hr.get(`/template-versions/${id}`).expect(200)).body,
        );
        expect(validateTemplate(version.definition)).toEqual([]);
        taskCounts.push(version.definition.tasks.length);
      }
    }
    // Engineering v2 adds security training to v1 (11 vs 10 tasks, as on the canvas).
    expect(taskCounts).toEqual([11, 10, 8]);
  });

  it('FR-04 BR-T03 a new template starts as an empty draft; PUT saves the parsed definition and returns its issues', async () => {
    const res = await hr
      .post('/templates', {
        name: '  Sales Onboarding ',
        description: ' For account executives ',
      })
      .expect(201);
    const template = templateSchema.parse(res.body);
    expect(template).toMatchObject({
      name: 'Sales Onboarding',
      description: 'For account executives',
      archivedAt: null,
      versions: [{ version: 1, status: 'DRAFT', publishedAt: null }],
    });
    const path = `/template-versions/${template.versions[0].id}`;
    expect(
      templateVersionSchema.parse((await hr.get(path).expect(200)).body),
    ).toMatchObject({
      templateId: template.id,
      definition: { phases: [], tasks: [] },
    });

    // A draft may break rules (here BR-T06): it is saved, and the issues come back.
    const saved = await hr
      .put(
        path,
        definitionOf(
          task('kickoff', {
            title: '  Kickoff call ',
            availableOffsetDays: 2,
            dueOffsetDays: 1,
          }),
        ),
      )
      .expect(200);
    const parsed = definitionOf(
      task('kickoff', {
        title: 'Kickoff call',
        availableOffsetDays: 2,
        dueOffsetDays: 1,
      }),
    );
    // Raw bodies: parsing them with the schema would trim them again and hide a miss.
    expect(saved.body.definition).toEqual(parsed);
    expect(saved.body.issues).toEqual(validateTemplate(parsed));
    expect(saved.body.issues).toEqual([
      expect.objectContaining({ rule: 'BR-T06', taskKeys: ['kickoff'] }),
    ]);
    expect((await hr.get(path).expect(200)).body.definition).toEqual(parsed);

    // A body that is not a definition is refused and not saved.
    const malformed = await hr.put(path, { phases: 'none' }).expect(400);
    expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');
    expect((await hr.get(path).expect(200)).body.definition).toEqual(parsed);
  });

  it.each([
    {
      at: 'AT-01',
      rule: 'BR-T05',
      what: 'tasks that wait for each other',
      definition: definitionOf(
        task('first', { dependsOn: ['second'] }),
        task('second', { dependsOn: ['first'] }),
      ),
      taskKeys: ['first', 'second'],
    },
    {
      at: 'AT-02',
      rule: 'BR-T09',
      what: 'a task waiting on a document under review',
      definition: definitionOf(
        task('upload', { type: 'DOCUMENT' }),
        task('approve', {
          type: 'APPROVAL',
          assignee: { kind: 'ROLE', role: 'HR' },
          reviews: 'upload',
        }),
        task('use', { dependsOn: ['upload'] }),
      ),
      taskKeys: ['use'],
    },
    {
      at: 'AT-03',
      rule: 'BR-T10',
      what: 'an approval for the new hire',
      definition: definitionOf(
        task('upload', { type: 'DOCUMENT' }),
        task('approve', { type: 'APPROVAL', reviews: 'upload' }),
      ),
      taskKeys: ['approve'],
    },
  ])(
    '$at $rule publishing $what gets 400 naming the tasks, and the version stays a draft',
    async ({ rule, definition, taskKeys }) => {
      const { versionId } = await draftOf(definition);
      const res = await hr
        .post(`/template-versions/${versionId}/publish`)
        .expect(400);
      expect(errorOf(res)).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'Fix 1 problem to publish',
        details: validateTemplate(definition),
      });
      expect(errorOf(res).details).toEqual([
        expect.objectContaining({ rule, taskKeys }),
      ]);
      const version = await hr
        .get(`/template-versions/${versionId}`)
        .expect(200);
      expect(templateVersionSchema.parse(version.body).status).toBe('DRAFT');
    },
  );

  it('BR-T03 publishing a draft without issues makes it the newest published version', async () => {
    const { templateId, versionId } = await draftOf(
      definitionOf(task('read-wiki', { dueOffsetDays: 2 })),
    );
    const res = await hr
      .post(`/template-versions/${versionId}/publish`)
      .expect(200);
    const published = templateVersionSchema.parse(res.body);
    expect(published).toMatchObject({ status: 'PUBLISHED', version: 1 });
    expect(published.publishedAt).not.toBeNull();

    const template = templateSchema.parse(
      (await hr.get(`/templates/${templateId}`).expect(200)).body,
    );
    expect(template.versions).toEqual([
      {
        id: versionId,
        version: 1,
        status: 'PUBLISHED',
        publishedAt: published.publishedAt,
      },
    ]);
    // Publishing twice: the compare-and-set finds no draft.
    const again = await hr
      .post(`/template-versions/${versionId}/publish`)
      .expect(409);
    expect(errorOf(again).code).toBe('INVALID_STATE');
  });

  it('AT-04 BR-T02 a published version cannot be edited', async () => {
    const engineering = await templateNamed('Engineering Onboarding');
    const path = `/template-versions/${engineering.versions[0].id}`;
    const before = (await hr.get(path).expect(200)).body;

    const res = await hr.put(path, definitionOf(task('anything'))).expect(409);
    expect(errorOf(res).code).toBe('INVALID_STATE');
    expect((await hr.get(path).expect(200)).body).toEqual(before);
  });

  it('BR-T02 a new version is a draft copied from the newest published one; one draft at most', async () => {
    const engineering = await templateNamed('Engineering Onboarding');
    const v2 = templateVersionSchema.parse(
      (
        await hr
          .get(`/template-versions/${engineering.versions[0].id}`)
          .expect(200)
      ).body,
    );

    const res = await hr
      .post(`/templates/${engineering.id}/versions`)
      .expect(201);
    expect(templateVersionSchema.parse(res.body)).toMatchObject({
      templateId: engineering.id,
      version: 3,
      status: 'DRAFT',
      publishedAt: null,
      definition: v2.definition,
    });

    const second = await hr
      .post(`/templates/${engineering.id}/versions`)
      .expect(409);
    expect(errorOf(second).code).toBe('INVALID_STATE');
    const template = templateSchema.parse(
      (await hr.get(`/templates/${engineering.id}`).expect(200)).body,
    );
    expect(
      template.versions.map(({ version, status }) => [version, status]),
    ).toEqual([
      [3, 'DRAFT'],
      [2, 'PUBLISHED'],
      [1, 'PUBLISHED'],
    ]);
  });

  it('BR-T02 two new-version requests at once leave exactly one draft', async () => {
    const general = await templateNamed('General Onboarding');
    const path = `/templates/${general.id}/versions`;
    const responses = await Promise.all([hr.post(path), hr.post(path)]);

    expect(responses.map((res) => res.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const loser = responses.find((res) => res.status === 409)!;
    expect(errorOf(loser).code).toBe('INVALID_STATE');
    expect(
      await prisma.templateVersion.count({
        where: { templateId: general.id, status: 'DRAFT' },
      }),
    ).toBe(1);

    // The database enforces it too: a second draft written past the API is refused.
    await expect(
      prisma.templateVersion.create({
        data: {
          organizationId: seeded.organization.id,
          templateId: general.id,
          version: 99,
          definition: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('AT-06 BR-T01 IT, the manager and a new hire get 403 from every template route', async () => {
    const { templateId, versionId } = await draftOf(
      definitionOf(task('read-wiki')),
    );
    // Thunks: supertest starts the server for the first request and stops it when that
    // request ends, so a request built early and sent later finds no server.
    const routes = (client: Client) => ({
      'GET /templates': () => client.get('/templates'),
      'POST /templates': () =>
        client.post('/templates', { name: 'Not allowed' }),
      'GET /templates/:id': () => client.get(`/templates/${templateId}`),
      'POST /templates/:id/versions': () =>
        client.post(`/templates/${templateId}/versions`),
      'POST /templates/:id/archive': () =>
        client.post(`/templates/${templateId}/archive`),
      'GET /template-versions/:id': () =>
        client.get(`/template-versions/${versionId}`),
      'PUT /template-versions/:id': () =>
        client.put(`/template-versions/${versionId}`, definitionOf(task('x'))),
      'POST /template-versions/:id/publish': () =>
        client.post(`/template-versions/${versionId}/publish`),
    });
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

    // Nothing changed.
    const template = templateSchema.parse(
      (await hr.get(`/templates/${templateId}`).expect(200)).body,
    );
    expect(template).toMatchObject({
      archivedAt: null,
      versions: [{ id: versionId, status: 'DRAFT' }],
    });
    expect(
      templateVersionSchema.parse(
        (await hr.get(`/template-versions/${versionId}`).expect(200)).body,
      ).definition,
    ).toEqual(definitionOf(task('read-wiki')));
  });

  it('BR-P01 BR-P02 templates of another org are 404, and the list leaves them out', async () => {
    const other = await seedDemoOrg(prisma, {
      slug: newSlug(),
      password: PASSWORD,
    });
    try {
      const { id, versions } = await prisma.template.findFirstOrThrow({
        where: { organizationId: other.organization.id },
        include: { versions: true },
      });
      const versionId = versions[0].id;
      const routes = {
        'GET /templates/:id': () => hr.get(`/templates/${id}`),
        'POST /templates/:id/versions': () =>
          hr.post(`/templates/${id}/versions`),
        'POST /templates/:id/archive': () =>
          hr.post(`/templates/${id}/archive`),
        'GET /template-versions/:id': () =>
          hr.get(`/template-versions/${versionId}`),
        'PUT /template-versions/:id': () =>
          hr.put(`/template-versions/${versionId}`, definitionOf(task('x'))),
        'POST /template-versions/:id/publish': () =>
          hr.post(`/template-versions/${versionId}/publish`),
      };
      for (const [route, send] of Object.entries(routes)) {
        const res = await send();
        expect({ route, status: res.status }).toEqual({ route, status: 404 });
        expect(errorOf(res).code).toBe('NOT_FOUND');
      }
      const listed = templateSchema
        .array()
        .parse((await hr.get('/templates').expect(200)).body);
      expect(listed.map((template) => template.id)).not.toContain(id);

      // An id that is not a UUID never reaches the database.
      const malformed = await hr.get('/templates/not-a-uuid').expect(400);
      expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');
    } finally {
      await prisma.organization.delete({
        where: { id: other.organization.id },
      });
    }
  });

  it('FR-04 archiving is final: no more edits, publishing or versions, and no second archive', async () => {
    // One template still has its draft; the other only a published version, so a new
    // version would be allowed but for the archive.
    const withDraft = await draftOf(definitionOf(task('read-wiki')));
    const published = await draftOf(definitionOf(task('read-wiki')));
    await hr
      .post(`/template-versions/${published.versionId}/publish`)
      .expect(200);
    const archive = async (templateId: string) => {
      const res = await hr.post(`/templates/${templateId}/archive`).expect(200);
      const archived = templateSchema.parse(res.body);
      expect(archived.archivedAt).not.toBeNull();
      return archived;
    };
    const archived = await archive(withDraft.templateId);
    await archive(published.templateId);

    const draftPath = `/template-versions/${withDraft.versionId}`;
    const routes = {
      'PUT /template-versions/:id': () =>
        hr.put(draftPath, definitionOf(task('x'))),
      'POST /template-versions/:id/publish': () =>
        hr.post(`${draftPath}/publish`),
      'POST /templates/:id/versions': () =>
        hr.post(`/templates/${published.templateId}/versions`),
      'POST /templates/:id/archive': () =>
        hr.post(`/templates/${withDraft.templateId}/archive`),
    };
    for (const [route, send] of Object.entries(routes)) {
      const res = await send();
      expect({ route, status: res.status }).toEqual({ route, status: 409 });
      expect(errorOf(res).code).toBe('INVALID_STATE');
    }
    expect(
      templateSchema.parse(
        (await hr.get(`/templates/${withDraft.templateId}`).expect(200)).body,
      ),
    ).toEqual(archived);
    expect(
      templateVersionSchema.parse((await hr.get(draftPath).expect(200)).body)
        .definition,
    ).toEqual(definitionOf(task('read-wiki')));
  });

  it('FR-21 template commands record audit events by the HR user; saving a draft does not', async () => {
    const { templateId, versionId } = await draftOf(
      definitionOf(task('read-wiki')),
    );
    await hr.post(`/template-versions/${versionId}/publish`).expect(200);
    const draft = templateVersionSchema.parse(
      (await hr.post(`/templates/${templateId}/versions`).expect(201)).body,
    );
    await hr
      .put(`/template-versions/${draft.id}`, definitionOf(task('x')))
      .expect(200);
    await hr.post(`/templates/${templateId}/archive`).expect(200);

    const { id: actorUserId } = await prisma.user.findUniqueOrThrow({
      where: { email: seeded.emails.hr },
    });
    const events = await prisma.auditEvent.findMany({
      where: { entityId: { in: [templateId, versionId, draft.id] } },
      select: {
        organizationId: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        data: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const by = { organizationId: seeded.organization.id, actorUserId };
    expect(events).toEqual([
      {
        ...by,
        action: 'template.created',
        entityType: 'template',
        entityId: templateId,
        data: { name: expect.any(String), versionId },
      },
      {
        ...by,
        action: 'template.published',
        entityType: 'template_version',
        entityId: versionId,
        data: { templateId, version: 1 },
      },
      {
        ...by,
        action: 'template.version_created',
        entityType: 'template_version',
        entityId: draft.id,
        data: { templateId, version: 2, copiedFrom: versionId },
      },
      {
        ...by,
        action: 'template.archived',
        entityType: 'template',
        entityId: templateId,
        data: {},
      },
    ]);
  });
});
