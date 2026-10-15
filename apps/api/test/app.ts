import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  activationPreviewSchema,
  addDays,
  apiErrorSchema,
  onboardingDetailSchema,
  onboardingSchema,
  type TemplateDefinition,
  templateSchema,
  today,
} from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { seedDemoOrg } from '../src/modules/demo/seed.js';
import { PrismaService } from '../src/prisma.js';
import { setupApp } from '../src/setup.js';

export async function createApp(
  trustProxyHops?: number,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  return setupApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    trustProxyHops,
  ).init();
}

export const PASSWORD = 'test-password';
// Every test file seeds its own org; the slug keeps its logins apart (BR-D04).
export const newSlug = () => `t${randomBytes(4).toString('hex')}`;
export const errorOf = (res: { body: unknown }) =>
  apiErrorSchema.parse(res.body);

/** Requests sent as one person. */
export async function signIn(app: INestApplication<App>, email: string) {
  // A new agent per request: supertest starts the server for a request and stops it when
  // that request ends.
  const server = () => request(app.getHttpServer());
  const res = await server()
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(204);
  const cookie = res.get('Set-Cookie')![0].split(';')[0];
  return {
    get: (path: string) => server().get(`/api${path}`).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      server().post(`/api${path}`).set('Cookie', cookie).send(body),
    put: (path: string, body: object) =>
      server().put(`/api${path}`).set('Cookie', cookie).send(body),
    patch: (path: string, body: object) =>
      server().patch(`/api${path}`).set('Cookie', cookie).send(body),
  };
}
export type Client = Awaited<ReturnType<typeof signIn>>;

/** New hires get an account through their invitation (M2); tests give one directly. */
export async function giveAccount(
  prisma: PrismaService,
  organizationId: string,
  fullName: string,
) {
  const employee = await prisma.employee.findFirstOrThrow({
    where: { organizationId, fullName },
  });
  await prisma.user.create({
    data: {
      organizationId,
      employeeId: employee.id,
      email: employee.email,
      role: 'MEMBER',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return employee;
}

/**
 * The demo org for one test file (PLAN §12), signed in as its people, with HR's steps to an
 * active onboarding. Delete the org when done: everything in it cascades.
 */
export async function seedOrg(app: INestApplication<App>) {
  const prisma = app.get(PrismaService);
  const seeded = await seedDemoOrg(prisma, {
    slug: newSlug(),
    password: PASSWORD,
  });
  const { organization, emails } = seeded;
  const organizationId = organization.id;
  const employeeOf = async (email: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).employeeId;
  const managerId = await employeeOf(emails.manager);
  const duc = await employeeOf(emails.it);
  // HR's picks for the two IT tasks of Engineering Onboarding, which two people could take.
  const itPicks = { 'prepare-laptop': duc, 'create-accounts': duc };
  const anVo = await giveAccount(prisma, organizationId, 'An Vo');
  const baoHo = await giveAccount(prisma, organizationId, 'Bao Ho');
  const hr = await signIn(app, emails.hr);
  const templates = templateSchema
    .array()
    .parse((await hr.get('/templates').expect(200)).body);
  const engineering = templates.find(
    (t) => t.name === 'Engineering Onboarding',
  )!;

  // Someone new with no account, who reports to the seed's manager unless told otherwise, so
  // tests never trip over each other's open onboardings (BR-A01).
  let hires = 0;
  const newHire = async (manager: string | null = managerId) => {
    hires += 1;
    const employee = await prisma.employee.create({
      data: {
        organizationId,
        fullName: `Hire ${hires}`,
        email: `hire.${hires}@${organization.slug}.joinpath.demo`,
        jobTitle: 'Engineer',
        managerId: manager,
      },
    });
    return employee.id;
  };
  const draftFor = async (
    employeeId: string,
    templateId = engineering.id,
    startDate = '2026-11-02',
  ) =>
    onboardingSchema.parse(
      (
        await hr
          .post('/onboardings', { employeeId, templateId, startDate })
          .expect(201)
      ).body,
    );
  // As the wizard does: the version the preview shows, and the IT picks, which a template
  // without those tasks ignores.
  const activate = async ({ id }: { id: string }) => {
    const { onboarding } = activationPreviewSchema.parse(
      (await hr.get(`/onboardings/${id}/activation-preview`).expect(200)).body,
    );
    const res = await hr
      .post(`/onboardings/${id}/activate`, {
        templateVersionId: onboarding.templateVersion.id,
        assignees: itPicks,
      })
      .expect(200);
    return onboardingDetailSchema.parse(res.body);
  };
  // A new template with one published version.
  let created = 0;
  const publishedTemplate = async (definition: TemplateDefinition) => {
    created += 1;
    const res = await hr
      .post('/templates', { name: `Test template ${created}` })
      .expect(201);
    const { id, versions } = templateSchema.parse(res.body);
    await hr
      .put(`/template-versions/${versions[0].id}`, definition)
      .expect(200);
    await hr.post(`/template-versions/${versions[0].id}/publish`).expect(200);
    return id;
  };

  return {
    prisma,
    seeded,
    organizationId,
    managerId,
    itPicks,
    anVo,
    baoHo,
    hr,
    // IT is Duc Tran, IT2 Huy Le. An Vo and Bao Ho are new hires with an account.
    others: {
      IT: await signIn(app, emails.it),
      IT2: await signIn(app, emails.it2),
      manager: await signIn(app, emails.manager),
      An: await signIn(app, anVo.email),
      Bao: await signIn(app, baoHo.email),
    },
    engineering,
    general: templates.find((t) => t.name === 'General Onboarding')!,
    // The org's business date, `offset` days on, while its demo clock is untouched.
    day: (offset: number) =>
      addDays(today(organization.timezone, 0, new Date()), offset),
    newHire,
    draftFor,
    activate,
    publishedTemplate,
  };
}
export type Org = Awaited<ReturnType<typeof seedOrg>>;
