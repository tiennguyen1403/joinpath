import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/session.js';

// Append-only audit trail (PLAN §7), written in the same transaction as the change.
export type AuditAction =
  | 'template.created'
  | 'template.version_created'
  | 'template.published'
  | 'template.draft_discarded'
  | 'template.archived'
  | 'onboarding.created'
  | 'onboarding.activated'
  | 'onboarding.completed'
  | 'onboarding.rescheduled'
  | 'onboarding.canceled'
  | 'task.started'
  | 'task.completed'
  | 'task.reassigned'
  | 'task.due_changed'
  | 'task.due_reset'
  | 'file.uploaded'
  | 'file.deleted'
  | 'document.submitted'
  | 'document.approved'
  | 'document.rejected'
  | 'invitation.sent'
  | 'invitation.resent'
  | 'invitation.accepted'
  | 'employee.created'
  | 'employee.updated'
  | 'department.created'
  | 'department.renamed';

export function recordAudit(
  tx: Prisma.TransactionClient,
  { userId, organizationId }: AuthContext,
  event: {
    action: AuditAction;
    entityType:
      | 'template'
      | 'template_version'
      | 'onboarding'
      | 'task'
      | 'document_file'
      | 'document_submission'
      | 'approval_decision'
      | 'invitation'
      | 'employee'
      | 'department';
    entityId: string;
    // Puts the event on that onboarding's timeline.
    onboardingId?: string;
    data?: Prisma.InputJsonObject;
  },
) {
  return tx.auditEvent.create({
    data: { organizationId, actorUserId: userId, ...event },
  });
}
