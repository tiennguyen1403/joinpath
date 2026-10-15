import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { apiErrorSchema } from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/modules/auth/password.js';
import type { PrismaService } from '../src/prisma.js';
import { setupApp } from '../src/setup.js';

export async function createApp(
  trustProxyHops?: number,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  return setupApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    trustProxyHops,
  ).init();
}

export const PASSWORD = 'test-password';
// Every test file seeds its own org; the slug keeps its logins apart (BR-D04).
export const newSlug = () => `t${randomBytes(4).toString('hex')}`;
export const errorOf = (res: { body: unknown }) =>
  apiErrorSchema.parse(res.body);

/** Requests sent as one person. */
export async function signIn(app: INestApplication<App>, email: string) {
  // A new agent per request: supertest starts the server for a request and stops it when
  // that request ends.
  const server = () => request(app.getHttpServer());
  const res = await server()
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(204);
  const cookie = res.get('Set-Cookie')![0].split(';')[0];
  return {
    get: (path: string) => server().get(`/api${path}`).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      server().post(`/api${path}`).set('Cookie', cookie).send(body),
    put: (path: string, body: object) =>
      server().put(`/api${path}`).set('Cookie', cookie).send(body),
    patch: (path: string, body: object) =>
      server().patch(`/api${path}`).set('Cookie', cookie).send(body),
  };
}
export type Client = Awaited<ReturnType<typeof signIn>>;

/** New hires get an account through their invitation (M2); tests give one directly. */
export async function giveAccount(
  prisma: PrismaService,
  organizationId: string,
  fullName: string,
) {
  const employee = await prisma.employee.findFirstOrThrow({
    where: { organizationId, fullName },
  });
  await prisma.user.create({
    data: {
      organizationId,
      employeeId: employee.id,
      email: employee.email,
      role: 'MEMBER',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return employee;
}
