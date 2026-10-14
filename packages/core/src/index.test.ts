import { describe, expect, it } from 'vitest';
import { healthSchema } from './index.js';

describe('healthSchema', () => {
  it('accepts ok and rejects any other status', () => {
    expect(healthSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(healthSchema.safeParse({ status: 'down' }).success).toBe(false);
  });
});
