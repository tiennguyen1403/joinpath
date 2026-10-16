import { addDays, today } from '@joinpath/core';
import type {
  Organization,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type { AuthService } from '../auth/auth.service.js';
import { type AuthContext, newToken } from '../auth/session.js';
import type { DocumentsService } from '../documents/documents.service.js';
import type { OnboardingService } from '../onboarding/onboarding.service.js';
import type { TaskService } from '../onboarding/task.service.js';

/** The command handlers the scenarios run through. */
export type Handlers = {
  onboardings: OnboardingService;
  tasks: TaskService;
  documents: DocumentsService;
  auth: AuthService;
};

/**
 * Onboardings A, B and C (PLAN §11), each step through the real command handlers, so every
 * state is one the app reaches, and seeding smoke-tests the handlers. Dates follow the canvas's
 * dashboard, in days from the org's business date. Runs while Engineering Onboarding has only
 * v1 published: activation takes the newest version (BR-A03), so B and C stay on v1.
 */
export async function playScenarios(
  db: PrismaClient,
  { onboardings, tasks, documents, auth }: Handlers,
  {
    organization,
    emails,
  }: {
    organization: Pick<Organization, 'id' | 'timezone' | 'clockOffsetDays'>;
    emails: Record<'hr' | 'it' | 'it2' | 'manager', string>;
  },
) {
  const organizationId = organization.id;
  const day = today(
    organization.timezone,
    organization.clockOffsetDays,
    new Date(),
  );
  const authOf = async (email: string): Promise<AuthContext> => {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    return {
      userId: user.id,
      employeeId: user.employeeId,
      organizationId,
      role: user.role,
    };
  };
  const lan = await authOf(emails.hr);
  const duc = await authOf(emails.it);
  const huy = await authOf(emails.it2);
  const minh = await authOf(emails.manager);
  const { id: templateId } = await db.template.findFirstOrThrow({
    where: { organizationId, name: 'Engineering Onboarding' },
    select: { id: true },
  });
  const employeeOf = (fullName: string) =>
    db.employee.findFirstOrThrow({
      where: { organizationId, fullName },
      select: { id: true, email: true },
    });

  // HR drafts and activates, with IT's two tasks to one person; the new hire accepts the
  // invitation (BR-A07) and sends their ID for review (PLAN §4.5).
  const onboard = async (
    fullName: string,
    startsIn: number,
    it: AuthContext,
  ) => {
    const hire = await employeeOf(fullName);
    const draft = await onboardings.create(lan, {
      employeeId: hire.id,
      templateId,
      startDate: addDays(day, startsIn),
    });
    await onboardings.activate(lan, draft.id, {
      templateVersionId: draft.templateVersion.id,
      assignees: {
        'prepare-laptop': it.employeeId,
        'create-accounts': it.employeeId,
      },
    });
    const task = Object.fromEntries(
      (
        await db.task.findMany({
          where: { onboardingId: draft.id },
          select: { id: true, definitionKey: true },
        })
      ).map(({ id, definitionKey }) => [definitionKey, id]),
    );
    // The token lives only in the email's link (BR-P05). Accepting signs them in; the guest
    // plays them through switch-user instead, so that session goes.
    const { link } = await db.mockEmail.findFirstOrThrow({
      where: {
        organizationId,
        toEmail: hire.email,
        link: { contains: '/invite#' },
      },
      select: { link: true },
    });
    await auth.logout(
      await auth.acceptInvitation({
        token: new URL(link).hash.slice(1),
        password: newToken(),
      }),
    );
    const { id: userId } = await db.user.findUniqueOrThrow({
      where: { employeeId: hire.id },
      select: { id: true },
    });
    const newHire: AuthContext = {
      userId,
      employeeId: hire.id,
      organizationId,
      role: 'MEMBER',
    };
    await documents.upload(newHire, task['upload-id'], {
      originalname: 'id-card.pdf',
      buffer: idCard(fullName),
    });
    await documents.submit(newHire, task['upload-id']);
    return { task, newHire };
  };

  // C, done: started eleven days ago, its ID approved at the first try, every task completed.
  const c = await onboard('Chi Dang', -11, duc);
  const { id: submissionId } = await db.documentSubmission.findFirstOrThrow({
    where: { taskId: c.task['upload-id'] },
    select: { id: true },
  });
  await tasks.approve(lan, c.task['review-id'], { submissionId });
  for (const [who, key] of [
    [duc, 'prepare-laptop'],
    [duc, 'create-accounts'],
    [c.newHire, 'sign-handbook'],
    [minh, 'assign-buddy'],
    [minh, 'welcome-meeting'],
    [c.newHire, 'set-up-dev-env'],
    [c.newHire, 'ship-first-pr'],
    [minh, 'week-one-check-in'],
  ] as const) {
    await tasks.complete(who, c.task[key]);
  }
  // C is history: its people have read what it told them.
  await db.notification.updateMany({
    where: { organizationId },
    data: { readAt: new Date() },
  });

  // B, two days in: half done, and stuck on HR's review of the ID documents, overdue since
  // three days before the start, which IT's accounts and the new hire's first tasks wait on.
  const b = await onboard('Bao Ho', -2, huy);
  for (const [who, key] of [
    [b.newHire, 'sign-handbook'],
    [huy, 'prepare-laptop'],
    [minh, 'assign-buddy'],
    [minh, 'welcome-meeting'],
  ] as const) {
    await tasks.complete(who, b.task[key]);
  }

  // A, the draft the guest activates (golden path, step 2). IT's accounts task opens five days
  // before the start, so it is ready the moment HR approves the ID documents (step 7).
  await onboardings.create(lan, {
    employeeId: (await employeeOf('An Vo')).id,
    templateId,
    startDate: addDays(day, 5),
  });
}

/**
 * The new hire's ID: a one-page PDF that opens in any viewer and says what it is. The xref
 * table gives each object's byte offset.
 */
function idCard(fullName: string) {
  const text = `BT /F1 14 Tf 16 110 Td (${fullName}) Tj /F1 8 Tf 0 -22 Td (Sample ID for the Joinpath demo) Tj 0 -12 Td (Not a real document) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    // An ID-1 card, 85.6 × 54 mm.
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 243 153] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
