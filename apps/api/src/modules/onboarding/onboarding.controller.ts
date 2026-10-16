import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  activateOnboardingSchema,
  type ActivationPreview,
  type ActivityEvent,
  cancelOnboardingSchema,
  createOnboardingSchema,
  type Dashboard,
  type OnboardingDetail,
  type OnboardingSummary,
  rescheduleOnboardingSchema,
  updateOnboardingSchema,
} from '@joinpath/core';
import type { Request } from 'express';
import { Roles } from '../auth/session.js';
import { OnboardingService } from './onboarding.service.js';

// PLAN §8. Everyone reads within their scope (onboarding.policy.ts); only HR writes (§9).
@Controller()
export class OnboardingController {
  constructor(private readonly onboardings: OnboardingService) {}

  @Get('onboardings')
  list(@Req() req: Request): Promise<OnboardingSummary[]> {
    return this.onboardings.list(req.auth!);
  }

  @Roles('HR')
  @Post('onboardings')
  create(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.onboardings.create(
      req.auth!,
      createOnboardingSchema.parse(body),
    );
  }

  @Get('onboardings/:id')
  get(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnboardingDetail> {
    return this.onboardings.get(req.auth!, id);
  }

  @Get('onboardings/:id/activity')
  activity(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ActivityEvent[]> {
    return this.onboardings.activity(req.auth!, id);
  }

  // HR's home (PLAN §10).
  @Roles('HR')
  @Get('dashboard')
  dashboard(@Req() req: Request): Promise<Dashboard> {
    return this.onboardings.dashboard(req.auth!);
  }

  // A draft only; the body changes any of employeeId, templateId, startDate.
  @Roles('HR')
  @Patch('onboardings/:id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.onboardings.update(
      req.auth!,
      id,
      updateOnboardingSchema.parse(body),
    );
  }

  @Roles('HR')
  @Get('onboardings/:id/activation-preview')
  preview(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ActivationPreview> {
    return this.onboardings.preview(req.auth!, id);
  }

  @Roles('HR')
  @Post('onboardings/:id/activate')
  @HttpCode(200)
  activate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.onboardings.activate(
      req.auth!,
      id,
      activateOnboardingSchema.parse(body),
    );
  }

  @Roles('HR')
  @Post('onboardings/:id/reschedule')
  @HttpCode(200)
  reschedule(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.onboardings.reschedule(
      req.auth!,
      id,
      rescheduleOnboardingSchema.parse(body),
    );
  }

  @Roles('HR')
  @Post('onboardings/:id/cancel')
  @HttpCode(200)
  cancel(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OnboardingDetail> {
    return this.onboardings.cancel(
      req.auth!,
      id,
      cancelOnboardingSchema.parse(body),
    );
  }

  @Roles('HR')
  @Post('onboardings/:id/resend-invitation')
  @HttpCode(200)
  resendInvitation(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnboardingDetail> {
    return this.onboardings.resendInvitation(req.auth!, id);
  }
}
