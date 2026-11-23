import path from "node:path";
import type { NextConfig } from "next";

const hosted = !!process.env.VERCEL;

const securityHeaders = [
  ...(hosted ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_ENGINE: hosted ? "static" : "server" },
  poweredByHeader: false,
  turbopack: { root: path.resolve(".") },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
