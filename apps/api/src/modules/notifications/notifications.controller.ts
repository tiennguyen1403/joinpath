import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { MockEmail, Notifications } from '@joinpath/core';
import type { Request } from 'express';
import { Public } from '../auth/session.js';
import { NotificationsService } from './notifications.service.js';

// PLAN §8. Everyone reads their own notifications.
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@Req() req: Request): Promise<Notifications> {
    return this.notifications.list(req.auth!);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@Req() req: Request): Promise<Notifications> {
    return this.notifications.readAll(req.auth!);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Notifications> {
    return this.notifications.read(req.auth!, id);
  }

  @Get('mock-inbox')
  mockInbox(@Req() req: Request): Promise<MockEmail[]> {
    return this.notifications.mockInbox(req.auth!);
  }

  // GET, as Vercel Cron calls it (vercel.json), once a day; no session, a secret instead.
  @Get('internal/cron/tick')
  @Public()
  @HttpCode(204)
  tick(@Headers('authorization') authorization?: string): Promise<void> {
    return this.notifications.tick(authorization);
  }
}
