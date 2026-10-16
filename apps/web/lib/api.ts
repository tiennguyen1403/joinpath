import { type ApiError as ApiErrorBody, apiErrorSchema } from '@joinpath/core';

/** A request the API refused, with the body it sent (PLAN §8). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

/** What a refused write says, or what to do when the API was out of reach. */
export const messageOf = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Check your connection and try again.';

/**
 * Browser only: asks the API through this origin's /api (ADR 007) and checks the answer.
 * A write sends its body as JSON, or a file as multipart form data.
 */
export async function api<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  write?: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  const res = await fetch(
    `/api${path}`,
    write &&
      (write.body instanceof FormData
        ? { method: write.method, body: write.body }
        : {
            method: write.method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(write.body ?? {}),
          }),
  );
  if (res.status === 401) {
    // The session ended: it expired, or a sign-out elsewhere revoked it.
    window.location.assign('/login');
  }
  if (!res.ok) {
    const body = apiErrorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      res.status,
      body.success
        ? body.data
        : { code: 'INTERNAL', message: 'Something went wrong' },
    );
  }
  return schema.parse(await res.json());
}
