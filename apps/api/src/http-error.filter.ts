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
    const [status, body] = toApiError(error);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}

function toApiError(error: unknown): [number, ApiError] {
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
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return [
      status,
      { code: CODE_BY_STATUS[status] ?? 'INTERNAL', message: error.message },
    ];
  }
  new Logger('HttpErrorFilter').error(error);
  return [500, { code: 'INTERNAL', message: 'Internal server error' }];
}
