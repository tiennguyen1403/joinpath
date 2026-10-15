import { Controller, Get, Query, Req } from '@nestjs/common';
import { type Department, type Employee, roleSchema } from '@joinpath/core';
import type { Request } from 'express';
import { z } from 'zod';
import { Roles } from '../auth/session.js';
import { OrgService } from './org.service.js';

// GET /employees?active=true&role=IT: both optional; `active` has no false form.
const employeeQuerySchema = z.object({
  active: z
    .literal('true')
    .transform(() => true as const)
    .optional(),
  role: roleSchema.optional(),
});

// PLAN §8. Employee records are HR's (PLAN §9).
@Roles('HR')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('employees')
  listEmployees(
    @Req() req: Request,
    @Query() query: unknown,
  ): Promise<Employee[]> {
    return this.org.listEmployees(req.auth!, employeeQuerySchema.parse(query));
  }

  @Get('departments')
  listDepartments(@Req() req: Request): Promise<Department[]> {
    return this.org.listDepartments(req.auth!);
  }
}
