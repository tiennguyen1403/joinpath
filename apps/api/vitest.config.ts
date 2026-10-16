import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    // DATABASE_URL and APP_ORIGIN come from .env locally; CI sets them directly. The cron's
    // secret has a default, so the tick route's test runs anywhere.
    env: { CRON_SECRET: 'cron-secret', ...loadEnv('test', process.cwd(), '') },
  },
});
