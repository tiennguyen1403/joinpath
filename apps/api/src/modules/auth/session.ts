import { createHash, randomBytes } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Role, SESSION_COOKIE as COOKIE } from '@joinpath/core';
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../env.js';
import { PrismaService } from '../../prisma.js';

// Cookie session, same origin as the web app (PLAN §9, ADR 007). The __Host- prefix
// makes the browser enforce Secure, Path=/ and no Domain attribute.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export const newSessionToken = () => randomBytes(32).toString('base64url');
// Only the hash is stored, so a database leak does not leak live sessions.
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export function readSessionToken(req: Request): string | undefined {
  const pair = req.headers.cookie
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`));
  return pair?.slice(COOKIE.length + 1);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, cookieOptions);
}

export interface AuthContext {
  userId: string;
  employeeId: string;
  organizationId: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Global guard: every route needs a live session unless it is marked @Public().
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // CSRF on top of SameSite=Lax (PLAN §9): browsers send Origin on every write.
    const { origin } = req.headers;
    if (
      !SAFE_METHODS.has(req.method) &&
      origin !== undefined &&
      origin !== env.APP_ORIGIN
    ) {
      throw new ForbiddenException('Cross-origin request refused');
    }

    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const token = readSessionToken(req);
    const session = token
      ? await this.prisma.session.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { user: true },
        })
      : null;
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Not signed in');
    }
    const { user } = session;
    // BR-P01: org and role come from the session, never from the client.
    req.auth = {
      userId: user.id,
      employeeId: user.employeeId,
      organizationId: user.organizationId,
      role: user.role,
    };
    return true;
  }
}
