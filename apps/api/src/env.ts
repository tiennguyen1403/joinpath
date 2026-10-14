function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// Read once at startup, so missing config fails the boot, not the first request.
export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  // Browsers send Origin without a trailing slash; normalize before comparing.
  APP_ORIGIN: new URL(required('APP_ORIGIN')).origin,
};
