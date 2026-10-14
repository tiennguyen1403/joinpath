function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function count(name: string): number {
  const value = Number(process.env[name] ?? 0);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number`);
  }
  return value;
}

// Read once at startup, so missing config fails the boot, not the first request.
export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  // Browsers send Origin without a trailing slash; normalize before comparing.
  APP_ORIGIN: new URL(required('APP_ORIGIN')).origin,
  // Proxies between the browser and the API: 0 locally, set per host (ADR 007).
  TRUST_PROXY_HOPS: count('TRUST_PROXY_HOPS'),
};
