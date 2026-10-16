import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  approveSubmissionSchema,
  changeDueDateSchema,
  type MyTasks,
  type OnboardingDetail,
  reassignTaskSchema,
  rejectSubmissionSchema,
} from '@joinpath/core';
import type { Request } from 'express';
import { Roles } from '../auth/session.js';
import { TaskService } from './task.service.js';

// PLAN §8. Anyone works on the tasks assigned to them (PLAN §9), so those routes name no role;
// only HR hands a task on or moves its deadline.
@Controller()
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  @Get('tasks/mine')
  mine(@Req() req: Request): Promise<MyTasks> {
    return this.tasks.mine(req.auth!);
  }

  @Post('tasks/:id/start')
  @HttpCode(200)
  start(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnboardingDetail> {
    return this.tasks.start(req.auth!, id);
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  complete(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnboardingDetail> {
    return this.tasks.complete(req.auth!, id);
  }

  @Post('tasks/:id/approve')
  @HttpCode(200)
  approve(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.tasks.approve(
      req.auth!,
      id,
      approveSubmissionSchema.parse(body),
    );
  }

  @Post('tasks/:id/reject')
  @HttpCode(200)
  reject(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.tasks.reject(req.auth!, id, rejectSubmissionSchema.parse(body));
  }

  @Roles('HR')
  @Post('tasks/:id/reassign')
  @HttpCode(200)
  reassign(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.tasks.reassign(req.auth!, id, reassignTaskSchema.parse(body));
  }

  // A day, or null to put the template's back.
  @Roles('HR')
  @Post('tasks/:id/due-date')
  @HttpCode(200)
  changeDueDate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.tasks.changeDueDate(
      req.auth!,
      id,
      changeDueDateSchema.parse(body),
    );
  }
}
