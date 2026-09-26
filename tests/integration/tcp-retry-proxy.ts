/**
 * Entegrasyon testleri için bağlantı-kurulumunu yeniden deneyen yerel TCP vekili.
 *
 * Neden: Docker Desktop (Windows) yayımlanan port yönlendiricisi makine yükü altında
 * (paralel ajanların konteynerleri) zaman zaman 10–25 sn'lik pencerelerde yeni bağlantıların
 * bir kısmını kabul edip hiç yanıtlamıyor ve ~30 sn sonra RST ile kesiyor. Ölçüm (tam suite
 * sırasında konteyner portuna 20 bağlantı/sn yoklama): 5 735 denemenin 83'ü bu şekilde düştü,
 * diğerlerinin hepsi < 1 sn. Prisma bunu P1001 "Can't reach database server" olarak raporlar ve
 * bağlantı kurulumunu yeniden denemez; `connect_timeout` büyütmek işe yaramaz.
 *
 * Ne yapar: istemci bağlantısını kabul eder, hedefe bağlanır ve istemcinin ilk baytlarını
 * (Postgres SSLRequest/StartupMessage, ioredis hazır-kontrolü INFO) iletir. Hedeften
 * `firstByteTimeoutMs` içinde tek bayt gelmezse o hedef bağlantıyı atıp yenisini açar ve
 * tamponlanan baytları yeniden gönderir. İlk yanıt baytı geldikten sonra iki yön düz borudur:
 * sorgu/komut düzeyinde HİÇBİR yeniden deneme yoktur (yanıt gelmeden önce gönderilen yalnızca
 * el sıkışma baytlarıdır; yarış/işlem semantiği değişmez).
 */
import net from "net";

export interface RetryProxy {
  readonly port: number;
  readonly stats: { connections: number; retries: number; gaveUp: number };
  close(): Promise<void>;
}

export async function startRetryProxy(
  target: { host: string; port: number },
  opts: { firstByteTimeoutMs?: number; maxAttempts?: number } = {}
): Promise<RetryProxy> {
  const firstByteTimeoutMs = opts.firstByteTimeoutMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 12;
  const stats = { connections: 0, retries: 0, gaveUp: 0 };
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    stats.connections++;
    sockets.add(client);
    client.setNoDelay(true);
    const pending: Buffer[] = [];
    let upstream: net.Socket | undefined;
    let established = false;
    let closed = false;
    let attempts = 0;
    let timer: NodeJS.Timeout | undefined;

    const onClientData = (chunk: Buffer) => {
      pending.push(chunk);
      if (upstream && !upstream.connecting && !upstream.destroyed) upstream.write(chunk);
    };
    client.on("data", onClientData);
    const shutdown = () => {
      closed = true;
      clearTimeout(timer);
      upstream?.destroy();
      client.destroy();
      sockets.delete(client);
    };
    client.on("error", shutdown);
    client.on("close", shutdown);

    const attempt = () => {
      if (closed) return;
      attempts++;
      const up = net.connect(target);
      upstream = up;
      sockets.add(up);
      up.setNoDelay(true);
      const retry = () => {
        if (established || upstream !== up) return;
        clearTimeout(timer);
        up.destroy();
        sockets.delete(up);
        if (closed) return;
        if (attempts >= maxAttempts) {
          stats.gaveUp++;
          shutdown();
          return;
        }
        stats.retries++;
        setTimeout(attempt, 200);
      };
      timer = setTimeout(retry, firstByteTimeoutMs);
      up.on("connect", () => {
        for (const chunk of pending) up.write(chunk);
      });
      up.once("data", (first) => {
        if (upstream !== up || closed) return;
        clearTimeout(timer);
        established = true;
        pending.length = 0;
        client.off("data", onClientData);
        client.write(first);
        client.pipe(up);
        up.pipe(client);
      });
      up.on("error", () => (established ? shutdown() : retry()));
      up.on("close", () => {
        sockets.delete(up);
        if (established) shutdown();
        else retry();
      });
    };
    attempt();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
