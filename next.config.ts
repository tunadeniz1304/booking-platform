import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pino", "@prisma/client", "ioredis", "bullmq"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default nextConfig;
