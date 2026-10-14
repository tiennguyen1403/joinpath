import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env. Locally it holds DATABASE_URL; CI and the host set it directly.
if (existsSync('.env')) process.loadEnvFile();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Not env(): that throws when unset, and `prisma generate` needs no database.
  datasource: { url: process.env.DATABASE_URL },
});
