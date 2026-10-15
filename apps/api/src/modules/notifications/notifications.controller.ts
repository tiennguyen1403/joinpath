import { Controller, Get, Req } from '@nestjs/common';
import type { MockEmail } from '@joinpath/core';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service.js';

// PLAN §8. In-app notifications come with M3.2.
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('mock-inbox')
  mockInbox(@Req() req: Request): Promise<MockEmail[]> {
    return this.notifications.mockInbox(req.auth!);
  }
}
