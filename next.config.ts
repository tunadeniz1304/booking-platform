import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: [
    "pino",
    "@prisma/client",
    "ioredis",
    "bullmq",
    "pdfkit",
    // İsteğe bağlı LTR çalışma zamanı (P1-2): paketlenmez, yoksa ağırlıklı sıralamaya düşülür.
    "onnxruntime-node",
  ],
  outputFileTracingExcludes: { "*": ["node_modules/onnxruntime-node/**"] },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
