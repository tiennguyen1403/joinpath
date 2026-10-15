import { z } from 'zod';

export const roleSchema = z.enum(['HR', 'IT', 'MEMBER']);
export type Role = z.infer<typeof roleSchema>;

/** BR-D04: everyone in a sandbox has an address at its own domain, so no two sandboxes share a login. */
export const sandboxEmailDomain = (slug: string) => `${slug}.joinpath.demo`;

// Org API (PLAN §8), for HR only.
export const departmentSchema = z.object({ id: z.uuid(), name: z.string() });
export type Department = z.infer<typeof departmentSchema>;

// POST /departments and PATCH /departments/:id: a department is only ever renamed (PLAN §7).
export const departmentNameSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
});
export type DepartmentName = z.infer<typeof departmentNameSchema>;

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

// POST /employees. A department or manager of null means none.
export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter their full name').max(100),
  // Lowercase, as login reads it: users.email is unique as written (PLAN §7).
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email('Enter a valid email')),
  jobTitle: z.string().trim().min(1, 'Enter their job title').max(100),
  departmentId: z.uuid().nullable().optional(),
  managerId: z.uuid().nullable().optional(),
});
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;

// PATCH /employees/:id: a field left out stays as it is.
export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Nothing to change',
  );
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;

// Demo API (PLAN §8): in a sandbox, anyone moves the org's business date on (BR-D02).
export const advanceClockSchema = z.object({
  // Forward only (PLAN §4.6), and a month at most: the seeded workflows span a few weeks.
  days: z.int().min(1).max(30),
});
export type AdvanceClock = z.infer<typeof advanceClockSchema>;

// The org's business date once moved.
export const clockSchema = z.object({ today: z.iso.date() });
export type Clock = z.infer<typeof clockSchema>;
