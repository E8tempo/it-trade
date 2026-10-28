import type { NextConfig } from "next";

// FastAPI backend. In production Caddy routes /api and /media before requests reach
// Next.js; in development these rewrites make the API same-origin, so the httpOnly
// auth cookies work without CORS.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // the Docker image (frontend/Dockerfile) runs .next/standalone/server.js
  output: "standalone",
  // `next dev` blocks its scripts and HMR websocket for other hosts; let the site be opened
  // from a phone or another computer on the local network (http://192.168.x.x:3000).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/media/:path*", destination: `${API_URL}/media/:path*` },
    ];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  cacheLife: {
    // categories, shop settings: change rarely
    structure: { stale: 300, revalidate: 3600, expire: 86400 },
    // products, prices, stock: the backend syncs stock every 30 minutes
    catalog: { stale: 60, revalidate: 300, expire: 3600 },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
