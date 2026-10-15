import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateOnboarding,
  IsoDate,
  Onboarding,
  UpdateOnboarding,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/session.js';
import { personSelect } from '../org/org.service.js';
import { visibleOnboardings } from './onboarding.policy.js';

// DATE columns travel as midnight UTC; the API speaks 'YYYY-MM-DD' (PLAN §4.6).
const toIsoDate = (date: Date): IsoDate => date.toISOString().slice(0, 10);
const fromIsoDate = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

const onboardingSelect = {
  id: true,
  status: true,
  startDate: true,
  activatedAt: true,
  employee: { select: personSelect },
  template: {
    select: {
      id: true,
      name: true,
      versions: {
        where: { status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true },
      },
    },
  },
  templateVersion: { select: { id: true, version: true } },
} satisfies Prisma.OnboardingSelect;

type OnboardingRow = Prisma.OnboardingGetPayload<{
  select: typeof onboardingSelect;
}>;

function toOnboarding({
  startDate,
  activatedAt,
  template: { versions, ...template },
  templateVersion,
  ...onboarding
}: OnboardingRow): Onboarding {
  // A draft's template always has a published version: create and update refuse one
  // without, and published versions are never deleted.
  const version = templateVersion ?? versions.at(0);
  if (!version) {
    throw new Error(`Onboarding ${onboarding.id} has no template version`);
  }
  return {
    ...onboarding,
    startDate: toIsoDate(startDate),
    activatedAt: activatedAt?.toISOString() ?? null,
    template,
    templateVersion: version,
  };
}

// Only HR writes (PLAN §9). Each command checks what it refers to, then changes state only
// through compare-and-set (PLAN §6.4).
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext): Promise<Onboarding[]> {
    const onboardings = await this.prisma.onboarding.findMany({
      where: visibleOnboardings(auth),
      orderBy: { startDate: 'desc' },
      select: onboardingSelect,
    });
    return onboardings.map(toOnboarding);
  }

  async get(auth: AuthContext, id: string): Promise<Onboarding> {
    const onboarding = await this.prisma.onboarding.findFirst({
      where: { id, ...visibleOnboardings(auth) },
      select: onboardingSelect,
    });
    if (!onboarding) throw new NotFoundException('Onboarding not found');
    return toOnboarding(onboarding);
  }

  // Commands answer with a read after the commit: inside a transaction, Prisma loads the
  // relations of onboardingSelect concurrently on one connection, which pg deprecates.

  /** A draft: nothing else exists until activation (PLAN §4.3). */
  async create(
    auth: AuthContext,
    input: CreateOnboarding,
  ): Promise<Onboarding> {
    const { organizationId } = auth;
    const { employeeId, templateId, startDate } = input;
    const { id } = await this.prisma.$transaction(async (tx) => {
      await checkEmployee(tx, organizationId, employeeId);
      await checkTemplate(tx, organizationId, templateId);
      const onboarding = await tx.onboarding.create({
        data: {
          organizationId,
          employeeId,
          templateId,
          startDate: fromIsoDate(startDate),
        },
        select: { id: true },
      });
      await recordAudit(tx, auth, {
        action: 'onboarding.created',
        entityType: 'onboarding',
        entityId: onboarding.id,
        onboardingId: onboarding.id,
        data: input,
      });
      return onboarding;
    });
    return this.get(auth, id);
  }

  /** Not audited: like a template draft, a draft is still being prepared. */
  async update(
    auth: AuthContext,
    id: string,
    { employeeId, templateId, startDate }: UpdateOnboarding,
  ): Promise<Onboarding> {
    const { organizationId } = auth;
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.onboarding.count({
        where: { id, organizationId },
      });
      if (!found) throw new NotFoundException('Onboarding not found');
      if (employeeId) await checkEmployee(tx, organizationId, employeeId, id);
      if (templateId) await checkTemplate(tx, organizationId, templateId);
      const { count } = await tx.onboarding.updateMany({
        where: { id, organizationId, status: 'DRAFT' },
        data: {
          employeeId,
          templateId,
          startDate: startDate && fromIsoDate(startDate),
        },
      });
      if (count === 0) throw new ConflictException('Only a draft can change');
    });
    return this.get(auth, id);
  }
}

// BR-P02: an employee or template of another org is a 404, as if it did not exist.
async function checkEmployee(
  tx: Prisma.TransactionClient,
  organizationId: string,
  employeeId: string,
  // The onboarding being edited, which may keep its own employee.
  editing?: string,
) {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: {
      onboardings: {
        where: { status: { in: ['DRAFT', 'ACTIVE'] }, id: { not: editing } },
        select: { id: true },
      },
    },
  });
  if (!employee) throw new NotFoundException('Employee not found');
  // BR-A01. Two requests at once both pass here: the partial unique index lets one write.
  if (employee.onboardings.length > 0) {
    throw new ConflictException('Employee already has an open onboarding');
  }
}

async function checkTemplate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  templateId: string,
) {
  const template = await tx.template.findFirst({
    where: { id: templateId, organizationId },
    select: {
      archivedAt: true,
      versions: {
        where: { status: 'PUBLISHED' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!template) throw new NotFoundException('Template not found');
  if (template.archivedAt) throw new ConflictException('Template is archived');
  // Activation copies the newest published version (BR-A03).
  if (template.versions.length === 0) {
    throw new ConflictException('Template has no published version');
  }
}
