# ADR 011: Deploy web and API as Vercel Services

- **Status:** Accepted
- **Date:** 2026-10-15 (session M0.4)
- **Supplements:** ADR 007 (how `/api/*` reaches the API in production)

## Context

PLAN §6.6 left the host open: serverless (A, Vercel for both apps) or a container host (B), to be chosen once NestJS cold starts were measured. The budget is $0. Free container hosts put idle services to sleep, so whoever opens the demo link waits for a whole container to boot.

Measured on Vercel Hobby, functions in `sin1`, from Vietnam (time to first byte):

| Case | Result |
|---|---|
| First request after a deploy | `/api/health` 0.75–0.81 s, `/login` 0.99 s |
| First request after 8 hours idle | `/api/health` 2.45 s (Nest boots in about 2 s), web `/` 1.45 s |
| Postgres asleep (Neon suspends after 5 minutes) | login takes 989 ms inside the function, against 63–66 ms awake |
| Warm | `/api/health` 0.23–0.71 s, `/` 0.48 s, `/login` 0.18 s (static, from the CDN) |

## Decision

- **Option A, as one Vercel project with Services.** `web` (`apps/web`, Next.js) and `api` (`apps/api`, NestJS) build separately but ship in one deployment, so they never skew and roll back together. Region `sin1`. Postgres is Neon Free in Singapore, provisioned through the Vercel Marketplace.
- **Vercel's router replaces the Next.js rewrite in production.** Top-level rewrites in `vercel.json` send `/api/(.*)` to `api` and everything else to `web`. The browser still sees one origin, so ADR 007 holds. The rewrite in `next.config.ts` only runs locally: on Vercel it never sees `/api/*`, and its destination is fixed at build time, before the binding below exists.
- **The web's server code calls the API through a binding.** Vercel sets `API_URL` to the `api` service's private URL at runtime.
- **One trusted proxy hop** (`TRUST_PROXY_HOPS=1`), so `req.ip` is the client address that Vercel's edge saw. Checked in production: a forged `X-Forwarded-For` does not change it.
- **Vercel compiles `src/main.ts` itself.** The api build command only builds `core`, generates the Prisma client and, in production builds, runs `prisma migrate deploy` over the direct (unpooled) connection. The `dist/` from `nest build` is only for local runs and the seed. Each service pins its `framework`, because Vitest's Vite dependency confuses detection. `ENABLE_EXPERIMENTAL_COREPACK=1` makes builds use the pinned pnpm.
- **Deploys come only from pushes to `main`.** Running `vercel deploy` from a laptop would upload the local `apps/api/.env`. The demo org is seeded by a manual GitHub Actions workflow (`seed.yml`) whose `SEED_PASSWORD` is a repository secret.

## Consequences

- On Vercel, CommonJS code cannot `require()` an ES module (`ERR_REQUIRE_ESM`), although Node 24 itself allows it. Nest 12's packages are ESM, so a CommonJS Nest package such as `@nestjs/throttler` 6 crashes at boot. The login limit is therefore a small `ThrottleGuard` of our own. Check the module format before adding any Nest package.
- `main.ts` must not `await bootstrap()` at the top level. Vercel serves the app only once the module has loaded, so awaiting `listen()` there hangs every request.
- The throttle counts in each instance's memory. PLAN §6.6 keeps state out of process memory, but §9 accepts this exception for login. Limits that must hold across instances, such as sandbox creation, count in Postgres.
- Calls through the binding skip the public edge, so the API sees an internal address for them. Only throttle routes that the browser itself calls through `/api/*`.
- A preview deployment has its own origin, not `APP_ORIGIN`, so every write there gets 403. Previews also share the production database unless Neon branching is set up.
- Hobby runs a cron job at most once a day, so the hourly tick (PLAN §6.5) needs another scheduler, most likely GitHub Actions.
- Every push to `main`, docs included, redeploys production.

## Alternatives considered

- **Two Vercel projects**, with the web rewriting `/api/*` to the API's own domain: every API call takes an extra hop, and two independent deploys can skew.
- **Container host (option B):** free tiers sleep after inactivity and then boot the whole container; paid tiers break the $0 budget.
