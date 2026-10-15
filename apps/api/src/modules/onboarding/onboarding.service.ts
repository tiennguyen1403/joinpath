import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ActivateOnboarding,
  type ActivationPreview,
  availability,
  type CreateOnboarding,
  type IsoDate,
  isOverdue,
  type Onboarding,
  type OnboardingDetail,
  type OnboardingStatus,
  planActivation,
  type Task,
  type TaskStatus,
  type TemplateDefinition,
  type UpdateOnboarding,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/session.js';
import { orgToday, personSelect } from '../org/org.service.js';
import { visibleOnboardings } from './onboarding.policy.js';

// DATE columns travel as midnight UTC; the API speaks 'YYYY-MM-DD' (PLAN §4.6).
export const toIsoDate = (date: Date): IsoDate =>
  date.toISOString().slice(0, 10);
const fromIsoDate = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

export const onboardingSelect = {
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

export const taskSelect = {
  id: true,
  phaseKey: true,
  phaseName: true,
  phaseOrder: true,
  position: true,
  title: true,
  description: true,
  type: true,
  assignee: { select: { id: true, fullName: true } },
  reviewsTaskId: true,
  dependsOn: {
    orderBy: { dependsOn: { position: 'asc' } },
    select: { dependsOnTaskId: true },
  },
  availableOn: true,
  dueOn: true,
  status: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.TaskSelect;

const detailSelect = {
  ...onboardingSelect,
  tasks: {
    orderBy: [{ phaseOrder: 'asc' }, { position: 'asc' }],
    select: taskSelect,
  },
} satisfies Prisma.OnboardingSelect;

type OnboardingRow = Prisma.OnboardingGetPayload<{
  select: typeof onboardingSelect;
}>;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type DetailRow = Prisma.OnboardingGetPayload<{ select: typeof detailSelect }>;

export function toOnboarding({
  id,
  status,
  startDate,
  activatedAt,
  employee,
  template: { versions, ...template },
  templateVersion,
}: OnboardingRow): Onboarding {
  // A draft's template always has a published version: create and update refuse one
  // without, and published versions are never deleted.
  const version = templateVersion ?? versions.at(0);
  if (!version) throw new Error(`Onboarding ${id} has no template version`);
  return {
    id,
    status,
    startDate: toIsoDate(startDate),
    activatedAt: activatedAt?.toISOString() ?? null,
    employee,
    template,
    templateVersion: version,
  };
}

// Availability and overdue are worked out on each read, from the org's today (PLAN §4.4).
export function toTask(
  { dependsOn, availableOn, dueOn, startedAt, completedAt, ...task }: TaskRow,
  onboardingStatus: OnboardingStatus,
  prereqStatuses: TaskStatus[],
  today: IsoDate,
): Task {
  const dates = {
    availableOn: toIsoDate(availableOn),
    dueOn: toIsoDate(dueOn),
  };
  return {
    ...task,
    ...dates,
    dependsOn: dependsOn.map((dep) => dep.dependsOnTaskId),
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    availability: availability(
      { status: task.status, ...dates },
      onboardingStatus,
      prereqStatuses,
      today,
    ),
    overdue: isOverdue({ status: task.status, ...dates }, today),
  };
}

function toDetail(row: DetailRow, today: IsoDate): OnboardingDetail {
  const statusById = new Map(row.tasks.map((task) => [task.id, task.status]));
  return {
    ...toOnboarding(row),
    today,
    tasks: row.tasks.map((task) =>
      toTask(
        task,
        row.status,
        task.dependsOn.map((dep) => statusById.get(dep.dependsOnTaskId)!),
        today,
      ),
    ),
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

  async get(auth: AuthContext, id: string): Promise<OnboardingDetail> {
    const onboarding = await this.prisma.onboarding.findFirst({
      where: { id, ...visibleOnboardings(auth) },
      select: detailSelect,
    });
    if (!onboarding) throw new NotFoundException('Onboarding not found');
    return toDetail(
      onboarding,
      await orgToday(this.prisma, auth.organizationId),
    );
  }

  /** What activating the draft now would create, before HR's picks (PLAN §4.7). */
  async preview(auth: AuthContext, id: string): Promise<ActivationPreview> {
    const { organizationId } = auth;
    const row = await this.prisma.onboarding.findFirst({
      where: { id, ...visibleOnboardings(auth) },
      select: onboardingSelect,
    });
    if (!row) throw new NotFoundException('Onboarding not found');
    const onboarding = toOnboarding(row);
    if (onboarding.status !== 'DRAFT') {
      throw new ConflictException('Only a draft can be activated');
    }
    await checkTemplate(this.prisma, organizationId, onboarding.template.id);
    // The version shown is the one planned, even if a newer one lands meanwhile: activate
    // then refuses it (BR-A03).
    const plan = await planFor(
      this.prisma,
      organizationId,
      {
        employeeId: onboarding.employee.id,
        templateVersionId: onboarding.templateVersion.id,
        startDate: onboarding.startDate,
      },
      {},
    );
    return { onboarding, ...plan };
  }

  // Commands answer with a read after the commit: inside a transaction, Prisma loads the
  // relations of onboardingSelect concurrently on one connection, which pg deprecates.

  /** A draft: nothing else exists until activation (PLAN §4.3). */
  async create(
    auth: AuthContext,
    input: CreateOnboarding,
  ): Promise<OnboardingDetail> {
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
  ): Promise<OnboardingDetail> {
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

  /**
   * DRAFT → ACTIVE with every task and dependency, in one transaction (BR-A05). Any refusal
   * rolls the status back too, so a failed activation creates nothing (BR-A04).
   */
  async activate(
    auth: AuthContext,
    id: string,
    input: ActivateOnboarding,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    const { templateVersionId, assignees } = input;
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.onboarding.count({
        where: { id, organizationId },
      });
      if (!found) throw new NotFoundException('Onboarding not found');
      // Compare-and-set first: it locks the row, so a second activate waits here and then
      // finds no draft (AT-08), and no PATCH can change what is read below.
      const [draft] = await tx.onboarding.updateManyAndReturn({
        where: { id, organizationId, status: 'DRAFT' },
        data: { status: 'ACTIVE', activatedAt: new Date() },
        select: { employeeId: true, templateId: true, startDate: true },
      });
      if (!draft) throw new ConflictException('Only a draft can be activated');
      const newest = await checkTemplate(tx, organizationId, draft.templateId);
      // BR-A03: HR activates what the preview showed, or nothing.
      if (newest.id !== templateVersionId) {
        throw new ConflictException({
          code: 'TEMPLATE_VERSION_CHANGED',
          message: 'The template has a newer version: preview again',
        });
      }
      const { tasks } = await planFor(
        tx,
        organizationId,
        {
          employeeId: draft.employeeId,
          templateVersionId,
          startDate: toIsoDate(draft.startDate),
        },
        assignees,
      );
      const unresolved = tasks.filter((task) => task.problem !== undefined);
      if (unresolved.length > 0) {
        throw new UnprocessableEntityException({
          code: 'ASSIGNEE_UNRESOLVED',
          message: `Fix the owner of ${unresolved.length} task${unresolved.length === 1 ? '' : 's'} to activate`,
          details: unresolved.map(({ key, problem }) => ({
            taskKey: key,
            problem,
          })),
        });
      }

      // An approval points at the document it reviews, and never at another approval
      // (BR-T08), so the tasks that review nothing go in first.
      const idOf = new Map<string, string>();
      for (const batch of [
        tasks.filter((task) => task.reviews === undefined),
        tasks.filter((task) => task.reviews !== undefined),
      ]) {
        const created = await tx.task.createManyAndReturn({
          data: batch.map((task) => ({
            organizationId,
            onboardingId: id,
            definitionKey: task.key,
            phaseKey: task.phaseKey,
            phaseName: task.phaseName,
            phaseOrder: task.phaseOrder,
            position: task.position,
            title: task.title,
            description: task.description,
            type: task.type,
            assigneeEmployeeId: task.assigneeId!,
            reviewsTaskId: task.reviews && idOf.get(task.reviews),
            availableOn: fromIsoDate(task.availableOn),
            dueOn: fromIsoDate(task.dueOn),
          })),
          select: { id: true, definitionKey: true },
        });
        for (const task of created) idOf.set(task.definitionKey, task.id);
      }
      await tx.taskDependency.createMany({
        data: tasks.flatMap((task) =>
          task.dependsOn.map((prereq) => ({
            organizationId,
            taskId: idOf.get(task.key)!,
            dependsOnTaskId: idOf.get(prereq)!,
          })),
        ),
      });
      await tx.onboarding.update({
        where: { id },
        data: { templateVersionId },
      });
      // HR's picks go on record with the activation: the version is immutable, so they
      // still say which tasks they were for.
      await recordAudit(tx, auth, {
        action: 'onboarding.activated',
        entityType: 'onboarding',
        entityId: id,
        onboardingId: id,
        data: input,
      });
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

/** Returns the version an activation would copy: the newest published (BR-A03). */
async function checkTemplate(
  db: Prisma.TransactionClient,
  organizationId: string,
  templateId: string,
) {
  const template = await db.template.findFirst({
    where: { id: templateId, organizationId },
    select: {
      archivedAt: true,
      versions: {
        where: { status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!template) throw new NotFoundException('Template not found');
  // BR-T12: no new onboarding, and no activation, on an archived template.
  if (template.archivedAt) throw new ConflictException('Template is archived');
  const [newest] = template.versions;
  if (!newest) {
    throw new ConflictException('Template has no published version');
  }
  return newest;
}

/** Reads planActivation's inputs. Preview and activate plan alike (PLAN §4.7). */
async function planFor(
  db: Prisma.TransactionClient,
  organizationId: string,
  {
    employeeId,
    templateVersionId,
    startDate,
  }: { employeeId: string; templateVersionId: string; startDate: IsoDate },
  assignees: Record<string, string>,
) {
  const version = await db.templateVersion.findFirstOrThrow({
    where: { id: templateVersionId, organizationId },
    select: { definition: true },
  });
  const newHire = await db.employee.findFirstOrThrow({
    where: { id: employeeId, organizationId },
    select: { fullName: true, managerId: true },
  });
  // Only people with an active account take work that isn't the new hire's own.
  const people = await db.employee.findMany({
    where: { organizationId, user: { status: 'ACTIVE' } },
    select: { id: true, fullName: true, user: { select: { role: true } } },
  });
  const today = await orgToday(db, organizationId);
  const tasks = planActivation({
    // Published, so it passed the schema and every rule (BR-T03).
    definition: version.definition as TemplateDefinition,
    startDate,
    today,
    newHireId: employeeId,
    managerId: newHire.managerId,
    people: people.map(({ id, user }) => ({
      employeeId: id,
      role: user!.role,
    })),
    assignees,
  });
  // Without picks every assignee is a candidate, so candidates name everyone.
  const names = new Map(people.map(({ id, fullName }) => [id, fullName]));
  names.set(employeeId, newHire.fullName);
  const named = new Set(tasks.flatMap((task) => task.candidates));
  return {
    today,
    tasks,
    people: [...named].map((id) => ({ id, fullName: names.get(id)! })),
  };
}
