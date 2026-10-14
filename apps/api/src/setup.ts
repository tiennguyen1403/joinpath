import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { env } from './env.js';

const http = new Logger('HTTP');

// Shared by main.ts and the e2e tests, so tests hit the same app as production.
export function setupApp<T extends NestExpressApplication>(
  app: T,
  trustProxyHops = env.TRUST_PROXY_HOPS,
): T {
  // The web app rewrites /api/* to the API unchanged (PLAN §8).
  app.setGlobalPrefix('api');
  // req.ip, which the login throttle counts (BR-P06), becomes the address that many
  // hops back in X-Forwarded-For. Never `true`: clients could then forge it.
  app.set('trust proxy', trustProxyHops);
  app.use(logRequest);
  app.use(helmet());
  return app;
}

// One line per request, tagged with an id that is also sent back as X-Request-Id.
// Path only: a query string may carry a token, and tokens are never logged (PLAN §9).
function logRequest(req: Request, res: Response, next: NextFunction) {
  const id = randomUUID();
  const start = performance.now();
  res.set('X-Request-Id', id);
  res.on('finish', () => {
    const ms = Math.round(performance.now() - start);
    const path = req.originalUrl.split('?')[0];
    http.log(`${req.method} ${path} ${res.statusCode} ${ms}ms (req ${id})`);
  });
  next();
}
