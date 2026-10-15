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
import {
  acceptInvitationSchema,
  type Invitation,
  invitationTokenSchema,
  loginSchema,
  type Me,
} from '@joinpath/core';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import {
  clearSessionCookie,
  Public,
  readSessionToken,
  setSessionCookie,
} from './session.js';
import { ThrottleGuard } from './throttle.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottleGuard) // BR-P06
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

  // The invitation routes share the login's limit (BR-P06), which also stops token guessing.
  @Public()
  @UseGuards(ThrottleGuard)
  @Post('invitations/lookup')
  @HttpCode(200)
  lookupInvitation(@Body() body: unknown): Promise<Invitation> {
    return this.auth.lookupInvitation(invitationTokenSchema.parse(body));
  }

  @Public()
  @UseGuards(ThrottleGuard)
  @Post('invitations/accept')
  @HttpCode(204)
  async acceptInvitation(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    setSessionCookie(
      res,
      await this.auth.acceptInvitation(acceptInvitationSchema.parse(body)),
    );
  }
}
