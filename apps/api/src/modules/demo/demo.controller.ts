import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  advanceClockSchema,
  type Clock,
  type Me,
  switchUserSchema,
} from '@joinpath/core';
import type { Request, Response } from 'express';
import { Public, readSessionToken, setSessionCookie } from '../auth/session.js';
import { DemoService, TooManyDemos } from './demo.service.js';

// PLAN §8. In a sandbox the demo controls are everyone's, so no route names a role (BR-D02).
@Controller()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  // Try demo needs no account; the service limits it per client IP (BR-P06).
  @Public()
  @Post('demo/sandboxes')
  async createSandbox(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    try {
      const { token, me } = await this.demo.createSandbox(
        req.ip ?? '',
        readSessionToken(req),
      );
      setSessionCookie(res, token);
      return me;
    } catch (error) {
      if (error instanceof TooManyDemos) {
        res.set('Retry-After', String(error.retryAfter));
      }
      throw error;
    }
  }

  @Post('demo/switch-user')
  @HttpCode(200)
  async switchUser(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    const { token, me } = await this.demo.switchUser(
      req.auth!,
      readSessionToken(req)!,
      switchUserSchema.parse(body).employeeId,
    );
    if (token) setSessionCookie(res, token);
    return me;
  }

  @Post('demo/clock/advance')
  @HttpCode(200)
  advanceClock(@Req() req: Request, @Body() body: unknown): Promise<Clock> {
    return this.demo.advanceClock(
      req.auth!,
      advanceClockSchema.parse(body).days,
    );
  }
}
