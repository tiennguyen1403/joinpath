import { Controller, Get } from '@nestjs/common';
import type { Health } from '@joinpath/core';
import { Public } from './modules/auth/session.js';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health(): Health {
    return { status: 'ok' };
  }
}
