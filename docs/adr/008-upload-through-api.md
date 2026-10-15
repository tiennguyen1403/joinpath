# ADR 008: Upload documents through the API, 4 MB at most

- **Status:** Accepted
- **Date:** 2026-10-16 (session M2.2)
- **Builds on:** ADR 011 (the API runs as a Vercel Function)

## Context

New hires upload ID documents: real files that only a few people may read (BR-P03), up to 4 MB each and 5 a submission, PDF, PNG or JPEG only (BR-P04). The usual design for large files is an upload intent, a presigned PUT straight to storage, a finalize call and a job that sweeps abandoned uploads. That is two more endpoints and a scheduled job, and storage holds bytes before anything has checked them.

A Vercel Function takes a request body of 4.5 MB at most, so a 4 MB file still fits through the API.

MinIO, the S3-compatible server the plan named for local work, stopped publishing images in October 2025 and archived its repository in 2026. Its images can no longer be pulled.

## Decision

- **Multipart through the API, one file a request.** Multer, which `@nestjs/platform-express` already ships, holds the file in memory with a 4 MB limit. File names are read as UTF-8.
- **Checked before storage sees it.** The command checks who may upload (as for any work on a task), then the file's type by its first bytes (`sniffMimeType` in `core`: `%PDF`, the PNG signature, `FF D8 FF`). The name and the Content-Type sent never count. A file over the limit is a 400, like any refused file.
- **Storage first, then the row** (PLAN §6.4). The object goes to the bucket outside the transaction. The transaction then locks the onboarding, checks the task again, counts the files and writes the row. If it fails, the object is deleted at once.
- **Keys and links come from the server.** The key is `orgs/{orgId}/tasks/{taskId}/{random uuid}`. Downloads use a GET URL signed for 5 minutes, with `Content-Disposition: attachment` and the original name. The bucket stays private.
- **Any S3-compatible service, through `aws4fetch`.** This MIT library has no dependencies and signs Node's own `fetch`, presigned URLs included. Path-style URLs and the same `S3_*` variables work for every provider. Locally and in CI the server is RustFS 1.0.1 (Apache-2.0). It boots from environment variables alone, so GitHub Actions can run it as a service container.

## Consequences

- On Vercel, a body over 4.5 MB is refused with a 413 before the API sees it. The web must therefore check size and type before sending (M2.4a), using the same limits from `core`.
- An upload holds up to 4 MB in the function's memory: a small share of what a function has.
- The API reads `S3_*` at startup, as it reads its other variables. A host without them does not boot.
- Deleting the object after a failed transaction can itself fail. The object is then orphaned until its org's prefix is purged; outside a sandbox that is rare and accepted.
- Moving to files above 4.5 MB means presigned uploads: an intent, a PUT to storage, and a finalize step that checks the bytes.

## Alternatives considered

- **Presigned upload straight to storage:** works for any size, but costs two endpoints and a sweep job, and the bytes land before they are checked.
- **`@aws-sdk/client-s3`:** the official client, with many dependencies and a slower cold start. Since 2025 its default checksums also need turning off for some S3-compatible services.
- **Vercel Blob:** it is not S3-compatible and has no local server, so tests would need a real external store.
- **A MinIO fork, or MinIO built from source:** a community fork's images can't be trusted the same way, and building the server in every CI run is slow.
