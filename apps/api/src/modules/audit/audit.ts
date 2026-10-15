import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/session.js';

// Append-only audit trail (PLAN §7), written in the same transaction as the change.
export type AuditAction =
  | 'template.created'
  | 'template.version_created'
  | 'template.published'
  | 'template.archived';

export function recordAudit(
  tx: Prisma.TransactionClient,
  { userId, organizationId }: AuthContext,
  event: {
    action: AuditAction;
    entityType: 'template' | 'template_version';
    entityId: string;
    data?: Prisma.InputJsonObject;
  },
) {
  return tx.auditEvent.create({
    data: { organizationId, actorUserId: userId, ...event },
  });
}
