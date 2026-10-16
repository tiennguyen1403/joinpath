import type { AuthContext } from '../auth/session.js';

/**
 * Who sees a document's file (BR-P03): whoever uploaded it, the document's assignee, who
 * submits it next even when HR handed it on, the approver of the APPROVAL that reviews the
 * document, and HR. Not the manager or IT as such: to anyone else the file is a 404, as if it
 * did not exist (BR-P02), even when they see the onboarding.
 */
export function canSeeFile(
  { employeeId, role }: AuthContext,
  file: {
    uploadedById: string;
    assigneeId: string;
    approverId: string | undefined;
  },
): boolean {
  return (
    role === 'HR' ||
    employeeId === file.uploadedById ||
    employeeId === file.assigneeId ||
    employeeId === file.approverId
  );
}
