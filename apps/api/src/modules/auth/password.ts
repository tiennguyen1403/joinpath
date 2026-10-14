import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

// OWASP minimum for Argon2id: 19 MiB memory, 2 passes, 1 lane (PLAN §9).
const COST = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

// Stored in PHC string format, so the cost can change without breaking old hashes.
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const hash = await argon2Async('argon2id', {
    message: password,
    nonce,
    ...COST,
  });
  return `$argon2id$v=19$m=${COST.memory},t=${COST.passes},p=${COST.parallelism}$${b64(nonce)}$${b64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [, algorithm, , cost, salt, hash] = stored.split('$');
  const { m, t, p } = Object.fromEntries(
    cost.split(',').map((kv) => kv.split('=')),
  );
  const expected = Buffer.from(hash, 'base64');
  const actual = await argon2Async(algorithm as 'argon2id', {
    message: password,
    nonce: Buffer.from(salt, 'base64'),
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}
