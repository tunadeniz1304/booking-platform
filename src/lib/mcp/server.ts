/**
 * MCP sunucusu (P1-12, P1-11): platformu LLM istemcilerine (Claude Desktop, MCP Inspector…)
 * araç olarak açar. Transport'lar:
 *  - stdio: `npm run mcp:server` (`services/mcp/main.ts`);
 *  - streamable HTTP: `POST /api/mcp` (`services/mcp/http.ts`, bearer zorunlu, rate-limit'li).
 *
 * Araçlar:
 *  - `search_stays` — deterministik arama (`searchProperties`); anonim.
 *  - `get_quote`    — sunucu tarafı fiyat teklifi (`computeTotal`); anonim.
 *  - `create_hold`  — kimliği doğrulanmış kullanıcı adına HELD rezervasyon oluşturur.
 *    Hold ≠ ödeme: kart çekimi yoktur, süre dolarsa EXPIRED olur.
 *  - `get_price_insight` — fiyat aralığı/olay içgörüsü; anonim, deterministik, bilgi amaçlı.
 *  - `list_my_bookings`  — oturumdaki kullanıcının rezervasyonları.
 *  - `cancel_booking`    — iptal + politika iadesi; `confirm: true` ZORUNLU (geri alınamaz).
 *  - `checkout_stay`     — ACP checkout (teklif → HELD → ödeme) SPT + kullanıcının imzaladığı
 *    AP2 intent mandate ile (P1-11). Mandate yok/dolmuş/aşan tutar → reddedilir.
 *  `create_hold` ve `checkout_stay` doğrulanmış e-posta ister (v4#6, F7).
 *
 * Kaynak: `ui://stay-card` — `search_stays` sonucunu kart olarak çizen HTML şablonu
 * (MCP Apps `ui.resourceUri` / Apps SDK `outputTemplate`). Şablon veri üretmez.
 *
 * Kimlik (v3#12): kimlik bilgisi ASLA araç argümanı değildir (argümanlar modelin
 * bağlamına girer → token modele sızar). Kimlik transport seviyesinden gelir:
 *  - streamable HTTP: `Authorization: Bearer <token>` → SDK `extra.authInfo.token`;
 *  - stdio: süreç ortamındaki `MCP_ACCESS_TOKEN` (HTTP'de bu yedek KAPALIDIR).
 * Token yoksa, geçersizse veya iptal edilmişse araç UNAUTHORIZED döner; kullanıcı
 * YALNIZCA token'dan türetilir.
 *
 * Fiyat/uygunluk her zaman deterministik servislerden gelir; MCP katmanı
 * hesaplama yapmaz, yalnızca doğrular ve iletir. Model hiçbir kararı vermez.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { searchProperties, type SearchInput, type SearchResponse } from "@/lib/search";
import { computeTotal, type Quote, type QuoteRequest } from "@/lib/pricing/quote";
import { getPriceInsight, type PriceInsight } from "@/lib/pricing/insight";
import {
  createBooking,
  listUserBookings,
  type BookingResult,
  type CreateBookingInput,
} from "@/lib/booking-service";
import { cancelAndRefund, type CancellationOutcome } from "@/lib/payment/payment-service";
import { minorFromDb } from "@/lib/money/money";
import { verifyAccessToken, type AccessClaims } from "@/lib/auth/tokens";
import { isAccessTokenDenied } from "@/lib/auth/denylist";
import { isTokenVersionCurrent } from "@/lib/auth/token-version";
import { EmailNotVerifiedError, HttpError } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import {
  completeCheckoutSession,
  createCheckoutSession,
  type CheckoutSessionView,
} from "@/lib/agentic/checkout";
import { logger, errorFields } from "@/lib/observability/logger";

export interface BookingSummary {
  id: string;
  status: string;
  propertyTitle: string;
  city: string | null;
  roomName: string;
  checkIn: string;
  checkOut: string;
  totalMinor: number;
  currency: string;
}

export interface McpDeps {
  search(params: SearchInput): Promise<SearchResponse>;
  quote(req: QuoteRequest): Promise<Quote>;
  hold(input: CreateBookingInput): Promise<BookingResult>;
  authenticate(token: string): Promise<AccessClaims | null>;
  insight(input: { roomId: string; checkIn: string; checkOut: string }): Promise<PriceInsight>;
  listBookings(userId: string): Promise<BookingSummary[]>;
  cancel(bookingId: string, userId: string): Promise<CancellationOutcome>;
  /** v4#6: e-posta doğrulaması DB'den (token'a gömülmez). */
  isEmailVerified(userId: string): Promise<boolean>;
  checkout(input: AgentCheckoutInput): Promise<CheckoutSessionView>;
}

export interface AgentCheckoutInput {
  userId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  /** Paylaşılan ödeme token'ı (SPT). */
  spt: string;
  /** AP2 intent mandate (JWS). */
  mandate: string | null;
  idempotencyKey: string;
}

export interface McpServerOptions {
  /**
   * stdio'da `MCP_ACCESS_TOKEN` yedeğine izin verilir. HTTP transport'ta KAPALI olmalı:
   * aksi hâlde sunucu ortamındaki token anonim HTTP istemcisinin kimliği olur.
   */
  envTokenFallback?: boolean;
}

export async function authenticate(token: string): Promise<AccessClaims | null> {
  const claims = await verifyAccessToken(token);
  if (!claims || (await isAccessTokenDenied(claims.jti))) return null;
  if (!(await isTokenVersionCurrent(claims.userId, claims.tv))) return null;
  return claims;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

async function listBookingSummaries(userId: string): Promise<BookingSummary[]> {
  const rows = await listUserBookings(userId);
  return rows.map((b) => ({
    id: b.id,
    status: b.status,
    propertyTitle: b.property.title,
    city: b.property.location?.city ?? null,
    roomName: b.room.name,
    checkIn: dayOf(b.checkIn),
    checkOut: dayOf(b.checkOut),
    totalMinor: minorFromDb(b.totalPriceMinor),
    currency: b.currency,
  }));
}

async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  return Boolean(user?.emailVerifiedAt);
}

/** ACP servisleri üzerinden tek adımda checkout: oturum (idempotent) + tamamlama. */
async function agentCheckout(input: AgentCheckoutInput): Promise<CheckoutSessionView> {
  const { session } = await createCheckoutSession(input.userId, `mcp:${input.idempotencyKey}`, {
    room_id: input.roomId,
    check_in: input.checkIn,
    check_out: input.checkOut,
    guests: input.guests,
  });
  return completeCheckoutSession(input.userId, session.id, input.idempotencyKey, {
    token: input.spt,
    mandate: input.mandate,
  });
}

export const defaultDeps: McpDeps = {
  search: searchProperties,
  quote: (req) => computeTotal(req),
  hold: createBooking,
  authenticate,
  insight: getPriceInsight,
  listBookings: listBookingSummaries,
  cancel: (bookingId, userId) => cancelAndRefund(bookingId, userId),
  isEmailVerified,
  checkout: agentCheckout,
};

export const STAY_CARD_URI = "ui://stay-card";
const STAY_CARD_MIME = "text/html;profile=mcp-app";

/** `ui://stay-card` şablonu: araç çıktısını (`structuredContent`) textContent ile çizer (XSS yok). */
const STAY_CARD_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Konaklama kartı</title>
<style>
body{font:14px system-ui,sans-serif;margin:0;padding:8px;color:#111;background:#fff}
.card{border:1px solid #ddd;border-radius:12px;padding:12px;margin-bottom:8px}
.t{font-weight:600}.m{color:#555}.p{font-weight:600;margin-top:4px}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.card{border-color:#333}.m{color:#aaa}}
</style></head><body><div id="root" class="m">Sonuç yok</div>
<script>
(function(){
  function fmt(minor,cur){try{return new Intl.NumberFormat("tr-TR",{style:"currency",currency:cur}).format(minor/100)}catch(e){return (minor/100)+" "+cur}}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;e.textContent=text;return e}
  function render(data){
    var list=(data&&data.results)||[];var root=document.getElementById("root");
    if(!list.length)return;root.textContent="";root.className="";
    list.forEach(function(r){var c=el("div","card","");c.appendChild(el("div","t",r.title));
      c.appendChild(el("div","m",(r.city||"")+" · "+(r.rating!=null?r.rating+"★":"yeni")));
      if(r.quote)c.appendChild(el("div","p",fmt(r.quote.total,r.quote.currency)+" toplam"));
      root.appendChild(c)});
  }
  if(window.openai&&window.openai.toolOutput)render(window.openai.toolOutput);
  window.addEventListener("message",function(ev){var d=ev.data;
    if(d&&d.method==="ui/notifications/tool-result"&&d.params)render(d.params.structuredContent)});
})();
</script></body></html>`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor");
const id = z.string().min(1).max(64);

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function okStructured(data: Record<string, unknown>): CallToolResult {
  return { ...ok(data), structuredContent: data };
}

function fail(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] };
}

/** Transport'tan gelen kimlik (HTTP bearer); yoksa (yalnızca stdio'da) ortam değişkeni. */
export function transportToken(
  extra?: { authInfo?: { token?: string } },
  envFallback = true
): string | undefined {
  const fromTransport = extra?.authInfo?.token?.trim();
  if (fromTransport) return fromTransport;
  return envFallback ? process.env.MCP_ACCESS_TOKEN?.trim() || undefined : undefined;
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

export function createMcpServer(
  deps: McpDeps = defaultDeps,
  options: McpServerOptions = {}
): McpServer {
  const server = new McpServer({ name: "booking-platform", version: "3.0.0" });
  const envFallback = options.envTokenFallback ?? true;

  /** Kimlik yalnızca transport'tan; doğrulanamazsa null (araç UNAUTHORIZED döner). */
  async function userFrom(extra: { authInfo?: { token?: string } }): Promise<string | null> {
    const token = transportToken(extra, envFallback);
    if (!token) return null;
    const claims = await deps.authenticate(token);
    return claims?.userId ?? null;
  }

  /** Para etkili araçlar: kimlik + doğrulanmış e-posta; değilse hata sonucu. */
  async function verifiedUser(
    tool: string,
    extra: { authInfo?: { token?: string } }
  ): Promise<{ userId: string } | { error: CallToolResult }> {
    const token = transportToken(extra, envFallback);
    if (!token)
      return { error: fail("UNAUTHORIZED", `${tool} için oturum (bearer token) gerekli`) };
    const claims = await deps.authenticate(token);
    if (!claims) return { error: fail("UNAUTHORIZED", "Geçersiz veya süresi dolmuş token") };
    if (!(await deps.isEmailVerified(claims.userId))) {
      const e = new EmailNotVerifiedError();
      return { error: fail(e.code, e.message) };
    }
    return { userId: claims.userId };
  }

  server.registerResource(
    "stay-card",
    STAY_CARD_URI,
    {
      title: "Konaklama kartı",
      description: "search_stays sonuçlarını kart olarak gösteren arayüz şablonu",
      mimeType: STAY_CARD_MIME,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: STAY_CARD_MIME, text: STAY_CARD_HTML }],
    })
  );

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
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: STAY_CARD_URI }, "openai/outputTemplate": STAY_CARD_URI },
    },
    (args) =>
      guarded("search_stays", async () => {
        const res = await deps.search({ ...args, pageSize: args.pageSize ?? 10 });
        return okStructured({
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
      annotations: { readOnlyHint: true },
    },
    (args) => guarded("get_quote", async () => ok(await deps.quote(args)))
  );

  server.registerTool(
    "create_hold",
    {
      title: "Odayı tut (hold)",
      description:
        "Oturum açmış kullanıcı adına odayı süreli olarak tutar (HELD). Kimlik bağlantıdan (OAuth bearer / MCP_ACCESS_TOKEN) gelir, argüman olarak verilmez. Ödeme alınmaz; ödeme web arayüzünden veya /api/agentic/checkout_sessions ile tamamlanır, aksi hâlde hold süresi dolunca EXPIRED olur.",
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
        const who = await verifiedUser("create_hold", extra);
        if ("error" in who) return who.error;
        const { booking, paymentRequired } = await deps.hold({
          ...rest,
          guestCount: guests,
          userId: who.userId,
        });
        return ok({ booking, paymentRequired });
      })
  );

  server.registerTool(
    "get_price_insight",
    {
      title: "Fiyat içgörüsü",
      description:
        "Bir oda ve tarih aralığı için gece başı fiyatı, olaysız tahmini ve güven aralığını (minor-unit) döner. Bilgi amaçlıdır; fiyatı değiştirmez.",
      inputSchema: { roomId: id, checkIn: isoDate, checkOut: isoDate },
      annotations: { readOnlyHint: true },
    },
    (args) => guarded("get_price_insight", async () => ok(await deps.insight(args)))
  );

  server.registerTool(
    "list_my_bookings",
    {
      title: "Rezervasyonlarım",
      description:
        "Oturum açmış kullanıcının rezervasyonlarını (durum, tarihler, toplam minor-unit) listeler.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      guarded("list_my_bookings", async () => {
        const userId = await userFrom(extra);
        if (!userId) return fail("UNAUTHORIZED", "list_my_bookings için oturum gerekli");
        return ok({ bookings: await deps.listBookings(userId) });
      })
  );

  server.registerTool(
    "cancel_booking",
    {
      title: "Rezervasyonu iptal et",
      description:
        "Kullanıcının rezervasyonunu iptal eder; iade, rezervasyon anındaki politikaya göre hesaplanır. Geri alınamaz: kullanıcıdan açık onay alındıktan sonra confirm: true ile çağrılmalıdır.",
      inputSchema: {
        bookingId: id,
        confirm: z.literal(true, {
          errorMap: () => ({ message: "İptal için confirm: true zorunlu" }),
        }),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ bookingId }, extra) =>
      guarded("cancel_booking", async () => {
        const userId = await userFrom(extra);
        if (!userId) return fail("UNAUTHORIZED", "cancel_booking için oturum gerekli");
        return ok(await deps.cancel(bookingId, userId));
      })
  );

  server.registerTool(
    "checkout_stay",
    {
      title: "Mandate'li ödeme (ajan checkout)",
      description:
        "Kullanıcının imzaladığı AP2 intent mandate'i ve paylaşılan ödeme token'ı (SPT) ile odayı rezerve edip öder. Tutar, para birimi, ilan ve süre mandate'e karşı sunucuda doğrulanır; mandate yok/süresi dolmuş/tutar limiti aşıyorsa reddedilir (aşımda kullanıcı daha yüksek limitli yeni mandate onaylamalı). Platform merchant-of-record'dur; fiyatı ajan belirlemez.",
      inputSchema: {
        roomId: id,
        checkIn: isoDate,
        checkOut: isoDate,
        guests: z.number().int().min(1).max(20),
        spt: z.string().min(1).max(200),
        mandate: z.string().min(1).max(4096).optional(),
        idempotencyKey: z.string().min(1).max(128),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args, extra) =>
      guarded("checkout_stay", async () => {
        const who = await verifiedUser("checkout_stay", extra);
        if ("error" in who) return who.error;
        const view = await deps.checkout({
          ...args,
          mandate: args.mandate ?? null,
          userId: who.userId,
        });
        return ok(view);
      })
  );

  return server;
}
