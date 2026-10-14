import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_NAME } from '@joinpath/core';
import { AppModule } from './app.module.js';
import { setupApp } from './setup.js';

async function bootstrap() {
  const app = setupApp(
    await NestFactory.create<NestExpressApplication>(AppModule),
  );
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  Logger.log(`${APP_NAME} API listening on http://localhost:${port}`);
}
// No top-level await: Vercel's launcher may require() this module, and require(esm)
// refuses modules that use it. Vercel picks up the server when listen() runs.
void bootstrap();
