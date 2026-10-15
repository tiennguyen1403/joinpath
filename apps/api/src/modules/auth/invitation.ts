import { GoneException } from '@nestjs/common';
import { capitalized, inWords } from '@joinpath/core';
import { env } from '../../env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { recordAudit } from '../audit/audit.js';
import { type AuthContext, hashToken, newToken } from './session.js';

// BR-P05: a link works once, for 72 hours, until a resend or a change of email replaces it.
const TTL_MS = 72 * 60 * 60 * 1000;

/** Still works at `now`: not used, replaced or expired. */
export const usable = (now: Date) =>
  ({
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { gt: now },
  }) satisfies Prisma.InvitationWhereInput;

export const invalidInvitation = () =>
  new GoneException({
    code: 'INVITATION_INVALID',
    message: 'This invitation link no longer works. Ask HR for a new one.',
  });

const firstName = (fullName: string) => fullName.split(' ')[0];

// "Monday, October 26, 2026": a business date is a calendar day (PLAN §4.6).
const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Sat, Oct 17 at 09:41 (GMT+7)", where the company is. */
function formatMoment(moment: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return `${part('weekday')}, ${part('month')} ${part('day')} at ${part('hour')}:${part('minute')} (${part('timeZoneName')})`;
}

/**
 * Emails the onboarding's new hire a link to set a password (BR-A07), in the caller's
 * transaction (BR-N01). The token travels after # in the link only, so no server log sees it.
 */
export async function sendInvitation(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  onboardingId: string,
  action: 'invitation.sent' | 'invitation.resent',
) {
  const { organizationId } = auth;
  // One relation per read: Prisma loads sibling relations at once, which a transaction's
  // single connection can't (docs/ENVIRONMENT.md).
  const { startDate, employeeId } = await tx.onboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    select: { startDate: true, employeeId: true },
  });
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, timezone: true },
  });
  const person = { fullName: true, department: { select: { name: true } } };
  const employee = await tx.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { ...person, email: true, jobTitle: true },
  });
  const sender = await tx.employee.findUniqueOrThrow({
    where: { id: auth.employeeId },
    select: person,
  });
  // The new hire's before day 1, which the email names, as the canvas does.
  const early = await tx.task.findMany({
    where: {
      onboardingId,
      assigneeEmployeeId: employeeId,
      availableOn: { lt: startDate },
    },
    orderBy: [
      { availableOn: 'asc' },
      { phaseOrder: 'asc' },
      { position: 'asc' },
    ],
    select: { title: true },
  });
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const { id } = await tx.invitation.create({
    data: {
      organizationId,
      onboardingId,
      email: employee.email,
      tokenHash: hashToken(token),
      expiresAt,
    },
    select: { id: true },
  });

  // Worded as the canvas has it.
  const titles = early.map((task) => task.title);
  const from = sender.department
    ? `${sender.fullName} from ${sender.department.name}`
    : sender.fullName;
  const team = employee.department
    ? ` on the ${employee.department.name} team`
    : '';
  const body = [
    `Hi ${firstName(employee.fullName)}, welcome aboard.`,
    `${from} has set up your onboarding. You start on ${LONG_DATE.format(startDate)}, as ${employee.jobTitle}${team}.`,
    titles.length > 0 &&
      `${capitalized(inWords(titles.length))} ${titles.length === 1 ? 'task is' : 'tasks are'} waiting for you before your first day: ${new Intl.ListFormat('en-US').format(titles)}.`,
    `This link works once and expires on ${formatMoment(expiresAt, organization.timezone)}. If it runs out, ask ${firstName(sender.fullName)} to send a new one.`,
    `You're receiving this because ${organization.name} added you as a new hire in Joinpath.`,
  ];
  await tx.mockEmail.create({
    data: {
      organizationId,
      toEmail: employee.email,
      toName: employee.fullName,
      subject: `You're invited to join ${organization.name} on Joinpath`,
      body: body.filter(Boolean).join('\n\n'),
      link: `${env.APP_ORIGIN}/invite#${token}`,
      linkLabel: 'Accept invitation',
    },
  });
  await recordAudit(tx, auth, {
    action,
    entityType: 'invitation',
    entityId: id,
    onboardingId,
    data: { email: employee.email },
  });
}
