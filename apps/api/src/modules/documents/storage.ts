import { AwsClient } from 'aws4fetch';
import { required } from '../../env.js';

// Documents sit in one private bucket on an S3-compatible service (PLAN §6.2): RustFS locally
// and in CI, Cloudflare R2 in production. Path-style URLs, which both accept. Read at startup,
// like env.ts, but apart from it: a seed without scenarios never loads this file, so
// production's seed needs no storage keys (src/seed.ts).
const bucketUrl = `${new URL(required('S3_ENDPOINT')).origin}/${required('S3_BUCKET')}`;
const s3 = new AwsClient({
  accessKeyId: required('S3_ACCESS_KEY_ID'),
  secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  service: 's3',
  region: required('S3_REGION'),
});

async function send(
  method: 'GET' | 'PUT' | 'DELETE',
  url: string,
  init?: RequestInit,
) {
  const res = await s3.fetch(url, { ...init, method });
  // An S3 error names itself in XML, e.g. <Code>NoSuchBucket</Code>.
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Storage ${method} ${url} failed: ${res.status} ${text}`);
  }
  return text;
}

export const putObject = (
  key: string,
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
) =>
  send('PUT', `${bucketUrl}/${key}`, {
    body,
    headers: { 'Content-Type': contentType },
  });

// S3 answers 204 for a missing object too.
export const deleteObject = (key: string) =>
  send('DELETE', `${bucketUrl}/${key}`);

/** Every key under `prefix`, a page of 1000 at a time (ListObjectsV2). */
export async function keysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(bucketUrl);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);
    const xml = await send('GET', url.toString());
    // The server names every object (orgs/{uuid}/tasks/{uuid}/{uuid}): no key needs unescaping.
    for (const [, key] of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(key);
    token = /<NextContinuationToken>([^<]+)</.exec(xml)?.[1];
  } while (token);
  return keys;
}

/** An org's files, once the org goes (PLAN §6.5). */
export async function deletePrefix(prefix: string) {
  for (const key of await keysUnder(prefix)) await deleteObject(key);
}

/** For `pnpm storage:init`, locally and in CI. Production's bucket is made by hand. */
export const createBucket = () => send('PUT', bucketUrl);

/**
 * A link that downloads the object under its file name for `seconds`, so the bucket stays
 * private (PLAN §9). Never logged.
 */
export async function signedDownloadUrl(
  key: string,
  fileName: string,
  seconds: number,
): Promise<string> {
  const url = new URL(`${bucketUrl}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(seconds));
  url.searchParams.set('response-content-disposition', attachment(fileName));
  const signed = await s3.sign(url, {
    method: 'GET',
    aws: { signQuery: true },
  });
  return signed.url;
}

// RFC 6266: an ASCII name for old clients, then the real one, percent-encoded (RFC 8187).
function attachment(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
