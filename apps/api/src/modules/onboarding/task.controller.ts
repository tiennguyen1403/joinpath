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
  type MyTasks,
  type OnboardingDetail,
  rejectSubmissionSchema,
} from '@joinpath/core';
import type { Request } from 'express';
import { TaskService } from './task.service.js';

// PLAN §8. Anyone works on the tasks assigned to them (PLAN §9), so no route names a role.
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
}
