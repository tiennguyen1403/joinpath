import { z } from 'zod';

export const roleSchema = z.enum(['HR', 'IT', 'MEMBER']);
export type Role = z.infer<typeof roleSchema>;

// Org API (PLAN §8), for HR only.
export const departmentSchema = z.object({ id: z.uuid(), name: z.string() });
export type Department = z.infer<typeof departmentSchema>;

export const employeeSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.email(),
  jobTitle: z.string(),
  department: departmentSchema.nullable(),
  manager: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
  // The sign-in account; a new hire has none until they accept their invitation.
  user: z
    .object({ role: roleSchema, status: z.enum(['ACTIVE', 'DISABLED']) })
    .nullable(),
});
export type Employee = z.infer<typeof employeeSchema>;

// Demo API (PLAN §8): in a sandbox, anyone moves the org's business date on (BR-D02).
export const advanceClockSchema = z.object({
  // Forward only (PLAN §4.6), and a month at most: the seeded workflows span a few weeks.
  days: z.int().min(1).max(30),
});
export type AdvanceClock = z.infer<typeof advanceClockSchema>;

// The org's business date once moved.
export const clockSchema = z.object({ today: z.iso.date() });
export type Clock = z.infer<typeof clockSchema>;
