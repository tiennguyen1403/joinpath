import { z } from 'zod';

export * from './template.js';

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

export const roleSchema = z.enum(['HR', 'IT', 'MEMBER']);
export type Role = z.infer<typeof roleSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});
export type Login = z.infer<typeof loginSchema>;

// Set by the API, read by the web server to ask the API who is signed in (ADR 007).
export const SESSION_COOKIE = '__Host-sid';

export const meSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  employee: z.object({
    id: z.uuid(),
    fullName: z.string(),
    jobTitle: z.string(),
  }),
  organization: z.object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
  }),
});
export type Me = z.infer<typeof meSchema>;
