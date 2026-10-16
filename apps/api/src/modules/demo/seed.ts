import { sandboxEmailDomain } from '@joinpath/core';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { hashPassword } from '../auth/password.js';
import { type Handlers, playScenarios } from './scenarios.js';
import { seedTemplates } from './templates.js';

/**
 * Creates the demo org, its people and templates (PLAN §11). One roster for local dev,
 * test fixtures and every sandbox. Names follow the design canvas.
 * BR-D04: emails end in @{slug}.joinpath.demo, so every org gets its own logins.
 */
export async function seedDemoOrg(
  db: PrismaClient,
  {
    slug,
    password,
    expiresAt,
    createdIpHash,
    scenarios,
  }: {
    slug: string;
    password: string;
    /** A sandbox from Try demo lasts 24 hours (BR-D01); the fixed org and test orgs stay. */
    expiresAt?: Date;
    /** Who asked for the sandbox, for the limit on new demos (BR-P06). */
    createdIpHash?: string;
    /** Onboardings A, B and C too, through these handlers (PLAN §11). */
    scenarios?: Handlers;
  },
) {
  const passwordHash = await hashPassword(password);
  const email = (fullName: string) =>
    `${fullName.toLowerCase().replace(' ', '.')}@${sandboxEmailDomain(slug)}`;

  const { held, ...seeded } = await db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Acme Tech',
          slug,
          timezone: 'Asia/Ho_Chi_Minh',
          isSandbox: true,
          expiresAt,
          createdIpHash,
        },
      });
      const organizationId = org.id;
      const department = async (name: string) =>
        (await tx.department.create({ data: { organizationId, name } })).id;
      const engineering = await department('Engineering');
      const people = await department('People Operations');
      const it = await department('IT');

      const person = async (
        fullName: string,
        jobTitle: string,
        departmentId: string,
        {
          managerId,
          role,
        }: { managerId?: string; role?: 'HR' | 'IT' | 'MEMBER' } = {},
      ) => {
        const employee = await tx.employee.create({
          data: {
            organizationId,
            fullName,
            email: email(fullName),
            jobTitle,
            departmentId,
            managerId,
            // New hires get an account later, through their invitation (M2).
            user: role && {
              create: {
                organizationId,
                email: email(fullName),
                role,
                passwordHash,
              },
            },
          },
        });
        return employee.id;
      };

      await person('Lan Pham', 'HR Specialist', people, { role: 'HR' });
      await person('Duc Tran', 'IT Support', it, { role: 'IT' });
      await person('Huy Le', 'IT Support', it, { role: 'IT' });
      const managerId = await person(
        'Minh Nguyen',
        'Engineering Manager',
        engineering,
        { role: 'MEMBER' },
      );
      await person('An Vo', 'Frontend Developer', engineering, { managerId });
      await person('Bao Ho', 'Backend Developer', engineering, { managerId });
      await person('Chi Dang', 'QA Engineer', engineering, { managerId });

      // Every version is published now; with scenarios, only each template's first, as B and
      // C are activated on Engineering v1 before v2 comes out.
      const publishedAt = new Date();
      const held: Prisma.TemplateVersionCreateManyInput[] = [];
      for (const { name, description, versions } of seedTemplates) {
        const { id: templateId } = await tx.template.create({
          data: { organizationId, name, description },
          select: { id: true },
        });
        const rows = versions.map((definition, i) => ({
          organizationId,
          templateId,
          version: i + 1,
          status: 'PUBLISHED' as const,
          publishedAt,
          definition,
        }));
        const now = scenarios ? 1 : rows.length;
        await tx.templateVersion.createMany({ data: rows.slice(0, now) });
        held.push(...rows.slice(now));
      }

      return {
        organization: org,
        emails: {
          hr: email('Lan Pham'),
          it: email('Duc Tran'),
          it2: email('Huy Le'),
          manager: email('Minh Nguyen'),
        },
        held,
      };
    },
    // The production seed runs on GitHub Actions, far from the database: a round trip per
    // row adds up to more than Prisma's 5 s default.
    { timeout: 30_000 },
  );

  if (scenarios) {
    await playScenarios(db, scenarios, seeded);
    await db.templateVersion.createMany({
      data: held.map((row) => ({ ...row, publishedAt: new Date() })),
    });
  }
  return seeded;
}
