import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const LIMIT = 10;
const WINDOW_MS = 60_000;

// At most 10 requests a minute per client IP on the routes it guards (BR-P06); req.ip
// is the client's only with the right TRUST_PROXY_HOPS (ADR 007). Not @nestjs/throttler:
// it is CommonJS, and Vercel's runtime cannot require() Nest 12's ESM packages (ADR 011).
// ponytail: counts in this instance's memory, so each serverless instance counts on its
// own (PLAN §9 accepts this for login); count in Postgres like sandbox creation if abused.
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const ip = http.getRequest<Request>().ip ?? '';
    const now = Date.now();
    let window = this.windows.get(ip);
    if (!window || window.resetAt <= now) {
      // Forget expired windows now and then, so the map does not keep every IP ever seen.
      if (this.windows.size > 10_000) {
        for (const [key, w] of this.windows) {
          if (w.resetAt <= now) this.windows.delete(key);
        }
      }
      window = { count: 0, resetAt: now + WINDOW_MS };
      this.windows.set(ip, window);
    }
    if (++window.count <= LIMIT) return true;
    const retryAfter = Math.ceil((window.resetAt - now) / 1000);
    http.getResponse<Response>().set('Retry-After', String(retryAfter));
    throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
