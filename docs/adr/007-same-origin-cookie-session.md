# ADR 007: Same-origin cookie sessions

- **Status:** Accepted
- **Date:** 2026-10-14 (session M0.2)

## Context

The web app (Next.js) and the API (NestJS) may run on different hosts. If the API set a cookie on its own domain, the browser would treat it as a third-party cookie. Safari blocks third-party cookies by default, and so does Chrome in incognito, so login would break without any error.

Sessions must also be revocable on the spot: on logout, and when HR cancels an onboarding and locks the new hire's account (BR-C03). Stateless JWTs cannot do that without a revocation list.

## Decision

- **One origin.** The browser only ever talks to the web origin. Next.js rewrites `/api/*` to the API unchanged, and the API serves every route under the global prefix `/api`. In production, Vercel's router does this rewrite instead (ADR 011).
- **Opaque token.** Login creates 32 random bytes and returns them in a cookie: `__Host-sid`, `HttpOnly; Secure; SameSite=Lax; Path=/`, with no `Domain` attribute. The `__Host-` prefix makes the browser reject the cookie if any of those flags change. A session lives 7 days and is not extended.
- **Hash at rest.** The `sessions` table stores only the SHA-256 of the token. Logout deletes the row, so revocation takes effect on the next request. Passwords are hashed with Argon2id from `node:crypto`, with no native dependency.
- **CSRF.** On top of `SameSite=Lax`, a global guard refuses any non-GET request whose `Origin` header is not the app origin (`APP_ORIGIN`).
- **Secure by default.** Every route needs a live session unless it is marked `@Public()`. The organization and role come from the session, never from the request (BR-P01).

## Consequences

- No CORS configuration. Cookies stay first-party in every browser.
- Every authenticated request costs one indexed lookup on `sessions`.
- Never add a `Domain` attribute. It would tie the cookie to the API host and break login through the rewrite, again without any error.
- Requests reach the API through the web's proxy. The real client IP must therefore come from `X-Forwarded-For`, with the right `trust proxy` setting for the host. Without it, the login rate limit (BR-P06) counts every user as the same IP. On Vercel there is one hop (`TRUST_PROXY_HOPS=1`, ADR 011).
- In local development, `Secure` cookies work on `http://localhost` in Chrome and Firefox, but not in Safari.

## Alternatives considered

- **JWT in `localStorage`.** Any XSS can read the token, and tokens cannot be revoked before they expire.
- **Cross-site cookie (`SameSite=None`) with CORS.** Breaks in Safari and in Chrome incognito, which is the problem this ADR exists to avoid.
