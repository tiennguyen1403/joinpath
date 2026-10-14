import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_NAME } from '@joinpath/core';
import { AppModule } from './app.module.js';
import { setupApp } from './setup.js';

async function bootstrap() {
  const app = setupApp(await NestFactory.create(AppModule));
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  Logger.log(`${APP_NAME} API listening on http://localhost:${port}`);
}
await bootstrap();
