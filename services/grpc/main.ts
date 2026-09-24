/**
 * gRPC servis süreci: `npm run grpc:server`
 *
 * Varsayılan bind `127.0.0.1` (yalnızca yerel). Compose'da servis iç ağda
 * `GRPC_HOST=0.0.0.0` ile çalışır ve host'a port açılmaz.
 */
import { loadEnv } from "@/lib/config/load-env";
import { logger, errorFields } from "@/lib/observability/logger";
import { createGrpcServer, startGrpcServer } from "./server";

loadEnv();

const host = process.env.GRPC_HOST || "127.0.0.1";
const port = Number(process.env.GRPC_PORT ?? "50051");

const server = createGrpcServer();

startGrpcServer(server, host, port)
  .then((bound) => logger.info({ host, port: bound }, "grpc server ready"))
  .catch((error) => {
    logger.fatal(errorFields(error), "grpc bind failed");
    process.exit(1);
  });

function shutdown(): void {
  server.tryShutdown(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
