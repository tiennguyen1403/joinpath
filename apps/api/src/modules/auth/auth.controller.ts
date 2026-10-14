import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { loginSchema, type Me } from '@joinpath/core';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import {
  clearSessionCookie,
  Public,
  readSessionToken,
  setSessionCookie,
} from './session.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard) // BR-P06
  @Post('login')
  @HttpCode(204)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    setSessionCookie(res, await this.auth.login(loginSchema.parse(body)));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readSessionToken(req));
    clearSessionCookie(res);
  }

  @Get('me')
  me(@Req() req: Request): Promise<Me> {
    return this.auth.me(req.auth!);
  }
}
