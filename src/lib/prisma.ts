import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Bağlantı havuzu yapılandırması:
 * - Next.js Route Handlers'ları aynı anda birden çok çalışabilir; Prisma'ya tek
 *   singleton istemci ve sınırlı bağlantı havuzu vererek "too many connections"
 *   riskini önleriz.
 * - pool_timeout: havuz doluysa bekleme süresi (saniye).
 */
const prismaClientSingleton = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
