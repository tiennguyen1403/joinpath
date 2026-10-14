import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

// Shared by main.ts and the e2e tests, so tests hit the same app as production.
export function setupApp<T extends INestApplication>(app: T): T {
  // The web app rewrites /api/* to the API unchanged (PLAN §8).
  app.setGlobalPrefix('api');
  app.use(helmet());
  return app;
}
