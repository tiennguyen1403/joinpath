import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createEmployeeSchema,
  type Department,
  departmentNameSchema,
  type Employee,
  roleSchema,
  updateEmployeeSchema,
} from '@joinpath/core';
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

// PLAN §8. Employee records and departments are HR's (PLAN §9, FR-03).
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

  @Get('employees/:id')
  getEmployee(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Employee> {
    return this.org.getEmployee(req.auth!, id);
  }

  @Post('employees')
  createEmployee(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<Employee> {
    return this.org.createEmployee(req.auth!, createEmployeeSchema.parse(body));
  }

  // Any of the fields; the email only while they have no account.
  @Patch('employees/:id')
  updateEmployee(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<Employee> {
    return this.org.updateEmployee(
      req.auth!,
      id,
      updateEmployeeSchema.parse(body),
    );
  }

  @Get('departments')
  listDepartments(@Req() req: Request): Promise<Department[]> {
    return this.org.listDepartments(req.auth!);
  }

  @Post('departments')
  createDepartment(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<Department> {
    return this.org.createDepartment(
      req.auth!,
      departmentNameSchema.parse(body),
    );
  }

  // Renames it: a department is never removed (PLAN §7).
  @Patch('departments/:id')
  renameDepartment(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<Department> {
    return this.org.renameDepartment(
      req.auth!,
      id,
      departmentNameSchema.parse(body),
    );
  }
}
