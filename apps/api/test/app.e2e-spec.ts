import type { INestApplication } from '@nestjs/common';
import { healthSchema } from '@joinpath/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from './app.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET) is public and sends helmet headers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(healthSchema.parse(res.body)).toEqual({ status: 'ok' });
    expect(res.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
