import type { NextConfig } from 'next';

// The browser only talks to this origin; /api/* goes to NestJS unchanged (ADR 007).
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Bottom-left would cover the user's avatar at the foot of the sidebar.
  devIndicators: { position: 'bottom-right' },
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
  ],
};

export default nextConfig;
