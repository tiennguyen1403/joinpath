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
  createOnboardingSchema,
  type Onboarding,
  type OnboardingDetail,
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
  list(@Req() req: Request): Promise<Onboarding[]> {
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
}
