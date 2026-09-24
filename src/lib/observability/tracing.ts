/**
 * OpenTelemetry izleme — yalnızca `OTEL_EXPORTER_OTLP_ENDPOINT` tanımlıysa etkin
 * (yoksa hiçbir şey kaydedilmez = no-op). Enstrümantasyonlar: HTTP/fetch (Next),
 * Prisma (sorgu span'leri), ioredis. Span attribute'larına sır/anahtar yazılmaz.
 */
let registered = false;

export async function registerTracing(serviceName: string): Promise<boolean> {
  if (registered || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;
  registered = true;
  const [{ registerOTel }, { PrismaInstrumentation }, { IORedisInstrumentation }] =
    await Promise.all([
      import("@vercel/otel"),
      import("@prisma/instrumentation"),
      import("@opentelemetry/instrumentation-ioredis"),
    ]);
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || serviceName,
    instrumentations: ["fetch", new PrismaInstrumentation(), new IORedisInstrumentation()],
  });
  return true;
}
