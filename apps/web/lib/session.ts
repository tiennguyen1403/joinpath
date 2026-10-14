import { type Me, meSchema, SESSION_COOKIE } from '@joinpath/core';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

/** Server only: who is signed in, asked of the API directly with the session cookie. */
export const getMe = cache(async (): Promise<Me | null> => {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const res = await fetch(`${apiUrl}/api/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${sid}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /api/auth/me answered ${res.status}`);
  return meSchema.parse(await res.json());
});

export async function requireMe(): Promise<Me> {
  return (await getMe()) ?? redirect('/login');
}
