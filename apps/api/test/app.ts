import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/setup.js';

export async function createApp(
  trustProxyHops?: number,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  return setupApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    trustProxyHops,
  ).init();
}
