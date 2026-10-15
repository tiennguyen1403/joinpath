import { inspect } from 'node:util';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@joinpath/core';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from './generated/prisma/client.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE',
  429: 'RATE_LIMITED',
};

// Every error leaves the API as { code, message, details? } (PLAN §8).
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = toApiError(error, res.get('X-Request-Id'));
    res.status(status).json(body);
  }
}

function toApiError(error: unknown, requestId?: string): [number, ApiError] {
  if (error instanceof ZodError) {
    return [
      400,
      {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        details: error.issues,
      },
    ];
  }
  // A unique index refused the write: a rule such as one draft per template (BR-T02),
  // or the loser of a race (PLAN §6.4).
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return [
      409,
      { code: 'INVALID_STATE', message: 'Conflicts with the current state' },
    ];
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    // A service may name the code and attach details:
    // new BadRequestException({ message, details }).
    const { code, details } = error.getResponse() as Partial<ApiError>;
    return [
      status,
      {
        code: code ?? CODE_BY_STATUS[status] ?? 'INTERNAL',
        message: error.message,
        ...(details !== undefined && { details }),
      },
    ];
  }
  new Logger('HttpErrorFilter').error(`(req ${requestId}) ${inspect(error)}`);
  return [500, { code: 'INTERNAL', message: 'Internal server error' }];
}
