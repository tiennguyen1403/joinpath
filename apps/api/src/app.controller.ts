import { Controller, Get } from '@nestjs/common';
import type { Health } from '@joinpath/core';

@Controller()
export class AppController {
  @Get('health')
  health(): Health {
    return { status: 'ok' };
  }
}
