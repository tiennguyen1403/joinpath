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
