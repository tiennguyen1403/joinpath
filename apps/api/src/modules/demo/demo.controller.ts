import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { advanceClockSchema, type Clock } from '@joinpath/core';
import type { Request } from 'express';
import { DemoService } from './demo.service.js';

// PLAN §8. In a sandbox the demo controls are everyone's, so no route names a role (BR-D02).
@Controller()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post('demo/clock/advance')
  @HttpCode(200)
  advanceClock(@Req() req: Request, @Body() body: unknown): Promise<Clock> {
    return this.demo.advanceClock(
      req.auth!,
      advanceClockSchema.parse(body).days,
    );
  }
}
