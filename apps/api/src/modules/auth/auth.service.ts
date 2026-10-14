import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Login, Me } from '@joinpath/core';
import { PrismaService } from '../../prisma.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  type AuthContext,
  hashToken,
  newSessionToken,
  SESSION_TTL_MS,
} from './session.js';

@Injectable()
export class AuthService {
  // Checked when the email is unknown, so every failed login takes the same time.
  private readonly dummyHash = hashPassword(newSessionToken());

  constructor(private readonly prisma: PrismaService) {}

  /** Returns the new session token. Every failure gets the same generic 401. */
  async login({ email, password }: Login): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const token = newSessionToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  async logout(token: string | undefined) {
    if (token)
      await this.prisma.session.deleteMany({
        where: { tokenHash: hashToken(token) },
      });
  }

  me({ userId }: AuthContext): Promise<Me> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        employee: { select: { id: true, fullName: true } },
        organization: { select: { id: true, name: true } },
      },
    });
  }
}
