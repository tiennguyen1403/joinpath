import { AwsClient } from 'aws4fetch';
import { required } from '../../env.js';

// Documents sit in one private bucket on an S3-compatible service (PLAN §6.2): RustFS locally
// and in CI. Path-style URLs, which every provider accepts. Read at startup, like env.ts, but
// apart from it: the seed never touches storage.
const bucketUrl = `${new URL(required('S3_ENDPOINT')).origin}/${required('S3_BUCKET')}`;
const s3 = new AwsClient({
  accessKeyId: required('S3_ACCESS_KEY_ID'),
  secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  service: 's3',
  region: required('S3_REGION'),
});

async function send(method: 'PUT' | 'DELETE', url: string, init?: RequestInit) {
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
