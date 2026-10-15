// Creates the documents bucket (PLAN §6.2): once per fresh RustFS volume locally, and in CI.
// Runs from the build: `pnpm build && pnpm storage:init`. RustFS accepts it again for a
// bucket that exists, so a rerun is harmless.
import { createBucket } from './modules/documents/storage.js';

await createBucket();
console.log(`Bucket ${process.env.S3_BUCKET} is ready.`);
