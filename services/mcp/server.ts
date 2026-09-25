/**
 * MCP sunucusu (P1-12): platformu LLM istemcilerine (Claude Desktop, MCP Inspector…)
 * araç olarak açar. Başlatma: `npm run mcp:server` (stdio, `services/mcp/main.ts`).
 *
 * Araçlar:
 *  - `search_stays` — deterministik arama (`searchProperties`); anonim.
 *  - `get_quote`    — sunucu tarafı fiyat teklifi (`computeTotal`); anonim.
 *  - `create_hold`  — kimliği doğrulanmış kullanıcı adına HELD rezervasyon oluşturur.
 *    Hold ≠ ödeme: kart çekimi yoktur, süre dolarsa EXPIRED olur.
 *
 * Kimlik (v3#12): kimlik bilgisi ASLA araç argümanı değildir (argümanlar modelin
 * bağlamına girer → token modele sızar). Kimlik transport seviyesinden gelir:
 *  - streamable HTTP: `Authorization: Bearer <token>` → SDK `extra.authInfo.token`;
 *  - stdio: süreç ortamındaki `MCP_ACCESS_TOKEN`.
 * Token yoksa, geçersizse veya iptal edilmişse araç UNAUTHORIZED döner; kullanıcı
 * YALNIZCA token'dan türetilir.
 *
 * Fiyat/uygunluk her zaman deterministik servislerden gelir; MCP katmanı
 * hesaplama yapmaz, yalnızca doğrular ve iletir.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { searchProperties, type SearchInput, type SearchResponse } from "@/lib/search";
import { computeTotal, type Quote, type QuoteRequest } from "@/lib/pricing/quote";
import { createBooking, type BookingResult, type CreateBookingInput } from "@/lib/booking-service";
import { verifyAccessToken, type AccessClaims } from "@/lib/auth/tokens";
import { isAccessTokenDenied } from "@/lib/auth/denylist";
import { isTokenVersionCurrent } from "@/lib/auth/token-version";
import { HttpError } from "@/lib/http/errors";
import { logger, errorFields } from "@/lib/observability/logger";

export interface McpDeps {
  search(params: SearchInput): Promise<SearchResponse>;
  quote(req: QuoteRequest): Promise<Quote>;
  hold(input: CreateBookingInput): Promise<BookingResult>;
  authenticate(token: string): Promise<AccessClaims | null>;
}

async function authenticate(token: string): Promise<AccessClaims | null> {
  const claims = await verifyAccessToken(token);
  if (!claims || (await isAccessTokenDenied(claims.jti))) return null;
  if (!(await isTokenVersionCurrent(claims.userId, claims.tv))) return null;
  return claims;
}

export const defaultDeps: McpDeps = {
  search: searchProperties,
  quote: (req) => computeTotal(req),
  hold: createBooking,
  authenticate,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor");
const id = z.string().min(1).max(64);

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] };
}

/** Transport'tan gelen kimlik (HTTP bearer) yoksa stdio ortam değişkeni. */
export function transportToken(extra?: { authInfo?: { token?: string } }): string | undefined {
  return extra?.authInfo?.token?.trim() || process.env.MCP_ACCESS_TOKEN?.trim() || undefined;
}

async function guarded(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message);
    logger.error({ ...errorFields(error), tool }, "mcp tool failed");
    return fail("INTERNAL", "Beklenmeyen hata");
  }
}

export function createMcpServer(deps: McpDeps = defaultDeps): McpServer {
  const server = new McpServer({ name: "booking-platform", version: "2.0.0" });

  server.registerTool(
    "search_stays",
    {
      title: "Konaklama ara",
      description:
        "Şehir/tarih/misafir ve isteğe bağlı fiyat aralığıyla konaklama arar. Tarih verilirse her sonuç en ucuz odanın vergi dahil teklifini (minor-unit) içerir.",
      inputSchema: {
        query: z.string().max(200).optional(),
        city: z.string().max(100).optional(),
        checkIn: isoDate.optional(),
        checkOut: isoDate.optional(),
        guests: z.number().int().min(1).max(20).optional(),
        minPrice: z.number().nonnegative().optional(),
        maxPrice: z.number().positive().optional(),
        pageSize: z.number().int().min(1).max(20).optional(),
      },
    },
    (args) =>
      guarded("search_stays", async () => {
        const res = await deps.search({ ...args, pageSize: args.pageSize ?? 10 });
        return ok({
          total: res.total,
          results: res.results.map((r) => ({
            propertyId: r.id,
            title: r.title,
            city: r.location.city,
            propertyType: r.propertyType,
            rating: r.ratingAvg,
            basePrice: r.basePrice,
            currency: r.currency,
            quote: r.quote ?? null,
          })),
        });
      })
  );

  server.registerTool(
    "get_quote",
    {
      title: "Fiyat teklifi al",
      description:
        "Bir oda için gece gece fiyat, vergi ve toplamı (minor-unit) hesaplar. Dönen quoteId, create_hold'a verilirse fiyat değişmişse rezervasyon PRICE_CHANGED ile reddedilir.",
      inputSchema: {
        roomId: id,
        checkIn: isoDate,
        checkOut: isoDate,
        guests: z.number().int().min(1).max(20),
      },
    },
    (args) => guarded("get_quote", async () => ok(await deps.quote(args)))
  );

  server.registerTool(
    "create_hold",
    {
      title: "Odayı tut (hold)",
      description:
        "Oturum açmış kullanıcı adına odayı süreli olarak tutar (HELD). Kimlik bağlantıdan (OAuth bearer / MCP_ACCESS_TOKEN) gelir, argüman olarak verilmez. Ödeme alınmaz; ödeme web arayüzünden tamamlanır, aksi hâlde hold süresi dolunca EXPIRED olur.",
      inputSchema: {
        propertyId: id,
        roomId: id,
        checkIn: isoDate,
        checkOut: isoDate,
        guests: z.number().int().min(1).max(20),
        quoteId: z.string().uuid().optional(),
        idempotencyKey: z.string().min(1).max(128).optional(),
      },
    },
    ({ guests, ...rest }, extra) =>
      guarded("create_hold", async () => {
        const token = transportToken(extra);
        if (!token) return fail("UNAUTHORIZED", "create_hold için oturum (bearer token) gerekli");
        const claims = await deps.authenticate(token);
        if (!claims) return fail("UNAUTHORIZED", "Geçersiz veya süresi dolmuş token");
        const { booking, paymentRequired } = await deps.hold({
          ...rest,
          guestCount: guests,
          userId: claims.userId,
        });
        return ok({ booking, paymentRequired });
      })
  );

  return server;
}
