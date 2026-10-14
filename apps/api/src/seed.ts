// Seeds the fixed demo org used until sandboxes arrive in M3 (PLAN §11). Runs from the build:
// `pnpm build && pnpm db:seed`. Each run recreates the org from scratch.
import { seedDemoOrg } from './modules/demo/seed.js';
import { PrismaService } from './prisma.js';

const password = process.env.SEED_PASSWORD;
if (!password) throw new Error('Missing environment variable SEED_PASSWORD');

const db = new PrismaService();
// Every FK cascades, so this removes the previous copy and everything in it.
await db.organization.deleteMany({ where: { slug: 'acme' } });
const { emails } = await seedDemoOrg(db, { slug: 'acme', password });
console.log(
  `Seeded Acme Tech. Sign in as ${emails.hr} (HR), ${emails.it} (IT) or ${emails.manager} (manager).`,
);
await db.$disconnect();
