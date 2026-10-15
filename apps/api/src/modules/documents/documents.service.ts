import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type DownloadUrl,
  MAX_FILES_PER_SUBMISSION,
  type OnboardingDetail,
  sniffMimeType,
} from '@joinpath/core';
import { PrismaService } from '../../prisma.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/session.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { checkTask, findTask } from '../onboarding/task.service.js';
import { canSeeFile } from './documents.policy.js';
import { deleteObject, putObject, signedDownloadUrl } from './storage.js';

// The part multer keeps in memory, within MAX_FILE_BYTES. Only these fields are read.
export type Upload = { originalname: string; buffer: Buffer<ArrayBuffer> };

// A download link lives 5 minutes (PLAN §9).
const LINK_SECONDS = 5 * 60;

// The files of a DOCUMENT task (PLAN §4.5). Only its assignee adds or removes them, like any
// work on a task (BR-E01); fewer people may read them than see the onboarding (BR-P03).
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardings: OnboardingService,
  ) {}

  /**
   * A file for the next submission; the first one starts the task (BR-E04). The bytes reach the
   * bucket before the row is written, never inside the transaction (PLAN §6.4).
   */
  async upload(
    auth: AuthContext,
    taskId: string,
    file: Upload | undefined,
  ): Promise<OnboardingDetail> {
    const { organizationId } = auth;
    // Nothing is stored for a task out of reach.
    await findTask(this.prisma, auth, taskId, 'DOCUMENT');
    if (!file) throw new BadRequestException('Choose a file to upload');
    const mimeType = sniffMimeType(file.buffer);
    if (!mimeType) throw new BadRequestException('Upload a PDF, PNG or JPEG');
    if (file.originalname.length > 255) {
      throw new BadRequestException('Name the file in 255 characters or fewer');
    }

    const storageKey = `orgs/${organizationId}/tasks/${taskId}/${randomUUID()}`;
    await putObject(storageKey, file.buffer, mimeType);
    let onboardingId: string;
    try {
      onboardingId = await this.prisma.$transaction(async (tx) => {
        const task = await checkTask(tx, auth, taskId, 'DOCUMENT', [
          'PENDING',
          'IN_PROGRESS',
        ]);
        // Counted under the lock, so two uploads at once never make one too many.
        const count = await tx.documentFile.count({
          where: { taskId, submissionId: null },
        });
        if (count >= MAX_FILES_PER_SUBMISSION) {
          throw new BadRequestException(
            `A submission takes ${MAX_FILES_PER_SUBMISSION} files at most`,
          );
        }
        const { id } = await tx.documentFile.create({
          data: {
            organizationId,
            taskId,
            storageKey,
            fileName: file.originalname,
            mimeType,
            sizeBytes: file.buffer.length,
            uploadedById: auth.employeeId,
          },
          select: { id: true },
        });
        if (task.status === 'PENDING') {
          await tx.task.update({
            where: { id: taskId },
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
          });
        }
        await recordAudit(tx, auth, {
          action: 'file.uploaded',
          entityType: 'document_file',
          entityId: id,
          onboardingId: task.onboardingId,
          data: { taskId, fileName: file.originalname },
        });
        return task.onboardingId;
      });
    } catch (error) {
      // No row refers to the object, so it goes now rather than wait for a purge.
      await this.forget(storageKey);
      throw error;
    }
    return this.onboardings.get(auth, onboardingId);
  }

  /** Only a file not yet submitted (PLAN §7). The task stays IN_PROGRESS. */
  async remove(
    auth: AuthContext,
    taskId: string,
    fileId: string,
  ): Promise<OnboardingDetail> {
    const { onboardingId, storageKey } = await this.prisma.$transaction(
      async (tx) => {
        const task = await checkTask(tx, auth, taskId, 'DOCUMENT', [
          'PENDING',
          'IN_PROGRESS',
        ]);
        const file = await tx.documentFile.findFirst({
          where: { id: fileId, taskId },
          select: { storageKey: true, fileName: true, submissionId: true },
        });
        if (!file) throw new NotFoundException('File not found');
        // Revisions and their files are kept (BR-R07).
        if (file.submissionId !== null) {
          throw new ConflictException("A submitted file can't be deleted");
        }
        await tx.documentFile.delete({ where: { id: fileId } });
        await recordAudit(tx, auth, {
          action: 'file.deleted',
          entityType: 'document_file',
          entityId: fileId,
          onboardingId: task.onboardingId,
          data: { taskId, fileName: file.fileName },
        });
        return { onboardingId: task.onboardingId, storageKey: file.storageKey };
      },
    );
    await this.forget(storageKey);
    return this.onboardings.get(auth, onboardingId);
  }

  /** A short-lived link straight to the bucket (PLAN §9), for those who may see the file. */
  async downloadUrl(auth: AuthContext, id: string): Promise<DownloadUrl> {
    const file = await this.prisma.documentFile.findFirst({
      where: { id, organizationId: auth.organizationId },
      select: {
        storageKey: true,
        fileName: true,
        uploadedById: true,
        task: {
          select: { reviewedBy: { select: { assigneeEmployeeId: true } } },
        },
      },
    });
    if (
      !file ||
      !canSeeFile(auth, {
        uploadedById: file.uploadedById,
        approverId: file.task.reviewedBy.at(0)?.assigneeEmployeeId,
      })
    ) {
      throw new NotFoundException('File not found');
    }
    // Taken before signing, so the link never outlives it.
    const expiresAt = new Date(Date.now() + LINK_SECONDS * 1000).toISOString();
    return {
      url: await signedDownloadUrl(
        file.storageKey,
        file.fileName,
        LINK_SECONDS,
      ),
      expiresAt,
    };
  }

  // A failure leaves an object no row refers to: rare, and swept with the org's prefix
  // (PLAN §6.4).
  private async forget(storageKey: string) {
    await deleteObject(storageKey).catch((error: unknown) => {
      this.logger.warn(`Left ${storageKey} in the bucket: ${String(error)}`);
    });
  }
}
