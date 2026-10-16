// Seeds the fixed demo org, acme (PLAN §11), from the build: `pnpm build && pnpm db:seed`.
// Each run recreates it from scratch, with onboardings A, B and C, whose ID uploads need
// storage. Production's seed passes --no-scenarios: its runner has no storage keys (seed.yml).
import { seedDemoOrg } from './modules/demo/seed.js';
import { PrismaService } from './prisma.js';

const password = process.env.SEED_PASSWORD;
if (!password) throw new Error('Missing environment variable SEED_PASSWORD');
const scenarios = !process.argv.includes('--no-scenarios');

const db = new PrismaService();
// Storage reads its keys when loaded, so only a seed with scenarios loads it.
const sandbox = scenarios ? await import('./modules/demo/sandbox.js') : null;
const old = await db.organization.findUnique({
  where: { slug: 'acme' },
  select: { id: true },
});
// Every FK cascades, so this removes the previous copy and everything in it; its files too,
// when storage is at hand.
if (old) {
  await (sandbox
    ? sandbox.purgeOrg(db, old.id)
    : db.organization.delete({ where: { id: old.id } }));
}
const { emails } = await seedDemoOrg(db, {
  slug: 'acme',
  password,
  scenarios: sandbox?.handlersFor(db),
});
console.log(
  `Seeded Acme Tech${scenarios ? ' with onboardings A, B and C' : ''}. Sign in as ${emails.hr} (HR), ${emails.it} (IT) or ${emails.manager} (manager).`,
);
await db.$disconnect();
