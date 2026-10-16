import { z } from 'zod';
import { demoSchema, roleSchema } from './org.js';

export * from './dates.js';
export * from './documents.js';
export * from './onboarding.js';
export * from './org.js';
export * from './template.js';
export * from './text.js';

export const APP_NAME = 'Joinpath';

export const healthSchema = z.object({ status: z.literal('ok') });
export type Health = z.infer<typeof healthSchema>;

// Every API error has this shape (PLAN §8).
export const errorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_STATE',
  'TASK_NOT_ELIGIBLE',
  'STALE_SUBMISSION',
  'TEMPLATE_VERSION_CHANGED',
  'ASSIGNEE_UNRESOLVED',
  'INVITATION_INVALID',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});
export type Login = z.infer<typeof loginSchema>;

// Set by the API, read by the web server to ask the API who is signed in (ADR 007).
export const SESSION_COOKIE = '__Host-sid';

// An invitation link's token, always sent in a body: the link carries it after #, which never
// reaches a server, so no log holds it (PLAN §8).
export const invitationTokenSchema = z.object({
  token: z.string().min(1).max(100),
});
export type InvitationToken = z.infer<typeof invitationTokenSchema>;

// POST /auth/invitations/accept. Length is the only rule; the strength meter only advises (PLAN §9).
export const acceptInvitationSchema = invitationTokenSchema.extend({
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;

// POST /auth/invitations/lookup: what the accept page shows before the password is set.
export const invitationSchema = z.object({
  organization: z.object({ name: z.string(), timezone: z.string() }),
  employee: z.object({ fullName: z.string(), email: z.email() }),
  manager: z.object({ fullName: z.string() }).nullable(),
  startDate: z.iso.date(),
  // The org's business date (PLAN §4.6), which tells the tasks open now.
  today: z.iso.date(),
  expiresAt: z.iso.datetime(),
  // The new hire's own tasks, in the order they open.
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      availableOn: z.iso.date(),
      dueOn: z.iso.date(),
    }),
  ),
});
export type Invitation = z.infer<typeof invitationSchema>;

// GET /mock-inbox: an email Joinpath would have sent, newest first (PLAN §6.5).
export const mockEmailSchema = z.object({
  id: z.uuid(),
  toEmail: z.email(),
  toName: z.string(),
  subject: z.string(),
  // Plain text, a blank line between paragraphs.
  body: z.string(),
  // The button under the text.
  link: z.url(),
  linkLabel: z.string(),
  // Under the button, like body: the small print, its last paragraph below a rule.
  footer: z.string(),
  sentAt: z.iso.datetime(),
});
export type MockEmail = z.infer<typeof mockEmailSchema>;

// What a notification tells (BR-N02, BR-N03), for the web to pick its icon.
export const notificationKindSchema = z.enum([
  'ASSIGNED',
  'UNASSIGNED',
  'READY',
  'APPROVED',
  'REJECTED',
  'DUE_CHANGED',
  'RESCHEDULED',
  'COMPLETED',
  'CANCELED',
  'DUE_SOON',
  'OVERDUE',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  // The task it is about, if one.
  taskId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
  // A path in the web app: /my-onboarding, /tasks or an onboarding's page.
  link: z.string(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

// GET /notifications, and what marking them read answers: the newest, and how many are unread.
export const notificationsSchema = z.object({
  unread: z.number().int().nonnegative(),
  notifications: z.array(notificationSchema),
});
export type Notifications = z.infer<typeof notificationsSchema>;

export const meSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  employee: z.object({
    id: z.uuid(),
    fullName: z.string(),
    jobTitle: z.string(),
  }),
  // Their own onboarding, which their portal shows (PLAN §10): the running one, else the last
  // finished. Null for anyone never onboarded here, and while theirs is a draft.
  onboardingId: z.uuid().nullable(),
  organization: z.object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    // Its business date (PLAN §4.6), the demo clock's offset included.
    today: z.iso.date(),
    // What follows the @ in every address of a sandbox (BR-D04); null outside one.
    emailDomain: z.string().nullable(),
    // For the demo controls (PLAN §10); null outside a sandbox (BR-D02).
    demo: demoSchema.nullable(),
  }),
});
export type Me = z.infer<typeof meSchema>;
