import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateTemplate,
  type Template,
  type TemplateDefinition,
  templateDefinitionSchema,
  type TemplateIssue,
  type TemplateVersion,
  validateTemplate,
} from '@joinpath/core';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/session.js';

const templateSelect = {
  id: true,
  name: true,
  description: true,
  archivedAt: true,
  versions: {
    select: { id: true, version: true, status: true, publishedAt: true },
    orderBy: { version: 'desc' },
  },
} satisfies Prisma.TemplateSelect;

const versionSelect = {
  id: true,
  templateId: true,
  version: true,
  status: true,
  publishedAt: true,
  definition: true,
} satisfies Prisma.TemplateVersionSelect;

type TemplateRow = Prisma.TemplateGetPayload<{ select: typeof templateSelect }>;
type VersionRow = Prisma.TemplateVersionGetPayload<{
  select: typeof versionSelect;
}>;

const toTemplate = ({
  archivedAt,
  versions,
  ...template
}: TemplateRow): Template => ({
  ...template,
  archivedAt: archivedAt?.toISOString() ?? null,
  versions: versions.map(({ publishedAt, ...version }) => ({
    ...version,
    publishedAt: publishedAt?.toISOString() ?? null,
  })),
});

// Every write stores what templateDefinitionSchema.parse() returned, so reads trust it.
const toVersion = ({
  publishedAt,
  definition,
  ...version
}: VersionRow): TemplateVersion => ({
  ...version,
  publishedAt: publishedAt?.toISOString() ?? null,
  definition: definition as TemplateDefinition,
});

// Each command writes its audit event in the same transaction, and changes state only
// through compare-and-set (PLAN §6.4).
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ organizationId }: AuthContext): Promise<Template[]> {
    const templates = await this.prisma.template.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: templateSelect,
    });
    return templates.map(toTemplate);
  }

  async get({ organizationId }: AuthContext, id: string): Promise<Template> {
    return toTemplate(await findTemplate(this.prisma, organizationId, id));
  }

  /** A new template starts with an empty DRAFT v1. */
  create(auth: AuthContext, input: CreateTemplate): Promise<Template> {
    const { organizationId } = auth;
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.template.create({
        data: {
          ...input,
          organizationId,
          versions: {
            create: {
              organizationId,
              version: 1,
              definition: { phases: [], tasks: [] },
            },
          },
        },
        select: templateSelect,
      });
      await recordAudit(tx, auth, {
        action: 'template.created',
        entityType: 'template',
        entityId: template.id,
        data: { name: template.name, versionId: template.versions[0].id },
      });
      return toTemplate(template);
    });
  }

  /** BR-T02: a new DRAFT copies the newest published version. */
  createVersion(
    auth: AuthContext,
    templateId: string,
  ): Promise<TemplateVersion> {
    const { organizationId } = auth;
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.template.findFirst({
        where: { id: templateId, organizationId },
        select: {
          archivedAt: true,
          versions: {
            select: versionSelect,
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      if (!template) throw new NotFoundException('Template not found');
      if (template.archivedAt) {
        throw new ConflictException('Template is archived');
      }
      // A draft is always the newest version, and a template has at most one. Two
      // requests at once both get here: the partial unique index lets only one insert.
      const [latest] = template.versions;
      if (latest.status === 'DRAFT') {
        throw new ConflictException('Template already has a draft');
      }
      const draft = await tx.templateVersion.create({
        data: {
          organizationId,
          templateId,
          version: latest.version + 1,
          definition: latest.definition as Prisma.InputJsonValue,
        },
        select: versionSelect,
      });
      await recordAudit(tx, auth, {
        action: 'template.version_created',
        entityType: 'template_version',
        entityId: draft.id,
        data: { templateId, version: draft.version, copiedFrom: latest.id },
      });
      return toVersion(draft);
    });
  }

  async getVersion(
    { organizationId }: AuthContext,
    id: string,
  ): Promise<TemplateVersion> {
    return toVersion(await findVersion(this.prisma, organizationId, id));
  }

  /** Saves a draft even when it breaks rules, and returns them (PLAN §4.2). Not audited. */
  async saveDraft(
    { organizationId }: AuthContext,
    id: string,
    body: unknown,
  ): Promise<TemplateVersion & { issues: TemplateIssue[] }> {
    const version = await findVersion(this.prisma, organizationId, id);
    const definition = templateDefinitionSchema.parse(body);
    const { count } = await this.prisma.templateVersion.updateMany({
      where: { id, status: 'DRAFT', template: { archivedAt: null } },
      data: { definition },
    });
    // AT-04: a published version never changes (BR-T02).
    if (count === 0) {
      throw new ConflictException(
        'Only a draft of an active template can change',
      );
    }
    return {
      ...toVersion({ ...version, definition }),
      issues: validateTemplate(definition),
    };
  }

  /** BR-T03: publishes only a definition without issues. */
  publish(auth: AuthContext, id: string): Promise<TemplateVersion> {
    return this.prisma.$transaction(async (tx) => {
      const version = await findVersion(tx, auth.organizationId, id);
      // Parsed again in case the schema got stricter after the draft was saved.
      const issues = validateTemplate(
        templateDefinitionSchema.parse(version.definition),
      );
      if (issues.length > 0) {
        throw new BadRequestException({
          message: `Fix ${issues.length} problem${issues.length === 1 ? '' : 's'} to publish`,
          details: issues,
        });
      }
      const publishedAt = new Date();
      const { count } = await tx.templateVersion.updateMany({
        where: { id, status: 'DRAFT', template: { archivedAt: null } },
        data: { status: 'PUBLISHED', publishedAt },
      });
      if (count === 0) {
        throw new ConflictException(
          'Only a draft of an active template can be published',
        );
      }
      await recordAudit(tx, auth, {
        action: 'template.published',
        entityType: 'template_version',
        entityId: id,
        data: { templateId: version.templateId, version: version.version },
      });
      return toVersion({ ...version, status: 'PUBLISHED', publishedAt });
    });
  }

  /** Final: no new versions or edits, and no new onboardings (BR-T12). */
  archive(auth: AuthContext, id: string): Promise<Template> {
    return this.prisma.$transaction(async (tx) => {
      const template = await findTemplate(tx, auth.organizationId, id);
      const archivedAt = new Date();
      const { count } = await tx.template.updateMany({
        where: { id, archivedAt: null },
        data: { archivedAt },
      });
      if (count === 0) {
        throw new ConflictException('Template is already archived');
      }
      await recordAudit(tx, auth, {
        action: 'template.archived',
        entityType: 'template',
        entityId: id,
      });
      return toTemplate({ ...template, archivedAt });
    });
  }
}

// BR-P02: another org's template is a 404, as if it did not exist.
async function findTemplate(
  db: Prisma.TransactionClient,
  organizationId: string,
  id: string,
) {
  const template = await db.template.findFirst({
    where: { id, organizationId },
    select: templateSelect,
  });
  if (!template) throw new NotFoundException('Template not found');
  return template;
}

async function findVersion(
  db: Prisma.TransactionClient,
  organizationId: string,
  id: string,
) {
  const version = await db.templateVersion.findFirst({
    where: { id, organizationId },
    select: versionSelect,
  });
  if (!version) throw new NotFoundException('Template version not found');
  return version;
}
