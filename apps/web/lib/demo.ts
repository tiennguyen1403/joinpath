import { type Me, meSchema } from '@joinpath/core';
import { ApiError, api } from '@/lib/api';
import { homeFor } from '@/lib/nav';

/** What a demo control that failed says: the API's words, when it had any to give. */
export const demoErrorOf = (error: unknown) =>
  !(error instanceof ApiError)
    ? "Couldn't reach Joinpath. Check your connection and try again."
    : error.status >= 500
      ? 'Something went wrong. Try again.'
      : error.message;

/**
 * Someone else is signed in now (BR-D01, BR-D02): their first page, loaded whole, so nothing of
 * the last person's stays on screen or in a cache.
 */
export const goHome = (me: Me) => window.location.assign(homeFor(me));

/** Try demo: a company of one's own for 24 hours, signed in as its HR (BR-D01, PLAN §11). */
export const startDemo = async () =>
  goHome(await api('/demo/sandboxes', meSchema, { method: 'POST' }));
