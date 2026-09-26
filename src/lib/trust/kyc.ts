import "server-only";
import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { IdentityVerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, HttpError } from "@/lib/http/errors";
import { getJwtSecret } from "@/lib/auth/tokens";
import { counter } from "@/lib/observability/metrics";
import { logger } from "@/lib/observability/logger";

/**
 * P1-6 KYC (kimlik doğrulama).
 *
 *  - `IdentityProvider` arayüzü: `start()` sağlayıcıda bir doğrulama oturumu açar,
 *    `verifyWebhook()` imzalı olayı doğrular ve iç olaya çevirir.
 *  - Stripe Identity adaptörü: yalnızca `STRIPE_SECRET_KEY` + `STRIPE_IDENTITY_WEBHOOK_SECRET`
 *    varken (ve `KYC_PROVIDER` auto|stripe) kullanılır; yoksa deterministik mock.
 *  - Mock: sonuç test belgesine göre deterministiktir (valid → VERIFIED, blurry/expired →
 *    REQUIRES_INPUT, fake → FAILED). "Sağlayıcı" sonucu HMAC imzalı webhook olarak gönderir;
 *    süreç içi teslim de aynı imza doğrulama yolundan geçer.
 *  - Webhook yalnızca AKTİF sağlayıcının imzasıyla kabul edilir (F1-B/v4#16 kuralı): başka
 *    sağlayıcının imzası veya imzasız → 401, aktif şemada bozuk imza → 400.
 *  - Belge görüntüsü/kimlik numarası platforma HİÇ gelmez ve saklanmaz; yalnızca oturum
 *    kimliği, durum ve sağlayıcının makine hata kodu tutulur. KYC sonucu LLM'e bağlı değildir.
 */

export type KycStatus = IdentityVerificationStatus;
export type KycProviderName = "mock" | "stripe";

/** Doğrulanmış, sağlayıcıdan bağımsız iç olay. */
export interface KycEvent {
  providerRef: string;
  status: KycStatus;
  /** Sağlayıcının makine hata kodu (kişisel veri değil). */
  errorCode: string | null;
}

export interface KycStartInput {
  userId: string;
  verificationId: string;
  returnUrl: string;
  /** Yalnızca mock: deterministik sonuç için test belgesi. */
  testDocument?: MockTestDocument;
}

export interface KycSession {
  providerRef: string;
  /** Sağlayıcının barındırdığı doğrulama sayfası (mock: yok). */
  redirectUrl: string | null;
}

export interface IdentityProvider {
  readonly name: KycProviderName;
  start(input: KycStartInput): Promise<KycSession>;
  /** İmza başlığını doğrular; ilgisiz olay türü → null. */
  verifyWebhook(rawBody: string, headers: Headers): KycEvent | null;
}

export class KycWebhookSignatureError extends HttpError {
  constructor(message: string) {
    super(400, "INVALID_SIGNATURE", message);
    this.name = "KycWebhookSignatureError";
  }
}

export class KycWrongProviderError extends HttpError {
  constructor(active: string) {
    super(
      401,
      "WRONG_PROVIDER_SIGNATURE",
      `Webhook imzası aktif KYC sağlayıcısına (${active}) ait değil`
    );
    this.name = "KycWrongProviderError";
  }
}

export class IdentityVerificationRequiredError extends HttpError {
  constructor(role: "HOST" | "GUEST") {
    super(
      403,
      "IDENTITY_VERIFICATION_REQUIRED",
      role === "HOST"
        ? "İlan oluşturmak için kimliğinizi doğrulamanız gerekiyor"
        : "Rezervasyon için kimliğinizi doğrulamanız gerekiyor"
    );
    this.name = "IdentityVerificationRequiredError";
  }
}

const kycEvents = counter("kyc_events_total", "KYC olayları", ["provider", "outcome"] as const);

// --- Mock sağlayıcı -------------------------------------------------------------------

export const MOCK_TEST_DOCUMENTS = ["valid", "blurry", "expired", "fake"] as const;
export type MockTestDocument = (typeof MOCK_TEST_DOCUMENTS)[number];

/** Test belgesi → deterministik sonuç. */
export const MOCK_OUTCOMES: Readonly<
  Record<MockTestDocument, { status: KycStatus; errorCode: string | null }>
> = {
  valid: { status: "VERIFIED", errorCode: null },
  blurry: { status: "REQUIRES_INPUT", errorCode: "document_unreadable" },
  expired: { status: "REQUIRES_INPUT", errorCode: "document_expired" },
  fake: { status: "FAILED", errorCode: "document_fraudulent" },
};

export const MOCK_SIGNATURE_HEADER = "x-kyc-signature";
export const KYC_WEBHOOK_TOLERANCE_SECONDS = 300;

const mockEventSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.literal("identity.verification.updated"),
  data: z.object({
    providerRef: z.string().min(1).max(200),
    status: z.enum(["PENDING", "VERIFIED", "REQUIRES_INPUT", "FAILED"]),
    errorCode: z.string().max(100).nullable().optional(),
  }),
});

function mockSecret(): Buffer {
  const configured = process.env.KYC_MOCK_WEBHOOK_SECRET ?? "";
  if (configured.length >= 32) return Buffer.from(configured);
  // Ayrı bağlamla JWT sırrından türetilir (JWT imzasıyla karışmaz).
  return Buffer.from(
    hkdfSync("sha256", getJwtSecret(), Buffer.alloc(0), "booking-platform:kyc-mock-webhook:v1", 32)
  );
}

export function signMockKycWebhook(rawBody: string, timestamp: number): string {
  const sig = createHmac("sha256", mockSecret()).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function verifyMockKycSignature(
  rawBody: string,
  header: string,
  now = Date.now()
): KycEvent {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1)) {
    throw new KycWebhookSignatureError("İmza biçimi geçersiz");
  }
  if (Math.abs(now / 1000 - t) > KYC_WEBHOOK_TOLERANCE_SECONDS) {
    throw new KycWebhookSignatureError("İmza zaman aşımına uğradı");
  }
  const expected = createHmac("sha256", mockSecret()).update(`${t}.${rawBody}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(v1, "hex"))) {
    throw new KycWebhookSignatureError("İmza doğrulanamadı");
  }
  let parsed: z.infer<typeof mockEventSchema>;
  try {
    parsed = mockEventSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new KycWebhookSignatureError("Olay gövdesi geçersiz");
  }
  return {
    providerRef: parsed.data.providerRef,
    status: parsed.data.status,
    errorCode: parsed.data.errorCode ?? null,
  };
}

/** Mock "sağlayıcının" göndereceği imzalı webhook (gövde + başlıklar). */
export function buildMockKycWebhook(
  providerRef: string,
  testDocument: MockTestDocument,
  now = Date.now()
): { rawBody: string; headers: Headers } {
  const outcome = MOCK_OUTCOMES[testDocument];
  const rawBody = JSON.stringify({
    id: `evt_kyc_${randomUUID()}`,
    type: "identity.verification.updated",
    data: { providerRef, status: outcome.status, errorCode: outcome.errorCode },
  });
  const headers = new Headers({
    [MOCK_SIGNATURE_HEADER]: signMockKycWebhook(rawBody, Math.floor(now / 1000)),
  });
  return { rawBody, headers };
}

export class MockIdentityProvider implements IdentityProvider {
  readonly name = "mock" as const;

  async start(input: KycStartInput): Promise<KycSession> {
    return { providerRef: `kyc_mock_${input.verificationId}`, redirectUrl: null };
  }

  verifyWebhook(rawBody: string, headers: Headers): KycEvent | null {
    const header = headers.get(MOCK_SIGNATURE_HEADER);
    if (!header) throw new KycWrongProviderError(this.name);
    return verifyMockKycSignature(rawBody, header);
  }
}

// --- Stripe Identity ------------------------------------------------------------------

const STRIPE_STATUS: Readonly<Record<string, KycStatus>> = {
  "identity.verification_session.verified": "VERIFIED",
  "identity.verification_session.requires_input": "REQUIRES_INPUT",
  "identity.verification_session.canceled": "FAILED",
  "identity.verification_session.processing": "PENDING",
};

export class StripeIdentityProvider implements IdentityProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    fetchImpl: typeof fetch = fetch
  ) {
    this.stripe = new Stripe(secretKey, {
      httpClient: Stripe.createFetchHttpClient(fetchImpl),
      maxNetworkRetries: 0,
      telemetry: false,
    });
  }

  async start(input: KycStartInput): Promise<KycSession> {
    const session = await this.stripe.identity.verificationSessions.create(
      {
        type: "document",
        return_url: input.returnUrl,
        // Kişisel veri değil, yalnızca iç kimlikler.
        metadata: { userId: input.userId, verificationId: input.verificationId },
      },
      { idempotencyKey: `kyc-start:${input.verificationId}` }
    );
    return { providerRef: session.id, redirectUrl: session.url ?? null };
  }

  verifyWebhook(rawBody: string, headers: Headers): KycEvent | null {
    const header = headers.get("stripe-signature");
    if (!header) throw new KycWrongProviderError(this.name);
    let event: ReturnType<typeof Stripe.webhooks.constructEvent>;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, header, this.webhookSecret);
    } catch {
      throw new KycWebhookSignatureError("Stripe imzası doğrulanamadı");
    }
    const status = STRIPE_STATUS[event.type];
    if (!status) return null;
    const object = event.data.object as unknown as {
      id: string;
      last_error?: { code?: string | null } | null;
    };
    return { providerRef: object.id, status, errorCode: object.last_error?.code ?? null };
  }
}

// --- Seçim ----------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** Aktif sağlayıcı adı: Stripe yalnızca anahtar + Identity webhook sırrı varken. */
export function resolveKycProviderName(
  env: Env = process.env,
  mode = getConfig().KYC_PROVIDER
): KycProviderName {
  const stripeReady = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_IDENTITY_WEBHOOK_SECRET);
  if (mode === "mock") return "mock";
  if (mode === "stripe" && !stripeReady) {
    logger.warn("KYC_PROVIDER=stripe ama Stripe Identity yapılandırılmamış; mock kullanılıyor");
  }
  return stripeReady ? "stripe" : "mock";
}

let override: IdentityProvider | null = null;

/** Yalnızca testler için. */
export function setIdentityProviderForTests(provider: IdentityProvider | null): void {
  override = provider;
}

export function getIdentityProvider(): IdentityProvider {
  if (override) return override;
  return resolveKycProviderName() === "stripe"
    ? new StripeIdentityProvider(
        process.env.STRIPE_SECRET_KEY ?? "",
        process.env.STRIPE_IDENTITY_WEBHOOK_SECRET ?? ""
      )
    : new MockIdentityProvider();
}

// --- Servis ---------------------------------------------------------------------------

const TERMINAL: ReadonlySet<KycStatus> = new Set(["VERIFIED", "FAILED"]);

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export async function isIdentityVerified(userId: string): Promise<boolean> {
  const row = await prisma.identityVerification.findFirst({
    where: { userId, status: "VERIFIED" },
    select: { id: true },
  });
  return row !== null;
}

/** Config ile istenen rolde doğrulama yoksa 403 IDENTITY_VERIFICATION_REQUIRED. */
export async function assertIdentityRequirement(
  userId: string,
  role: "HOST" | "GUEST"
): Promise<void> {
  const cfg = getConfig();
  const required = role === "HOST" ? cfg.KYC_REQUIRED_FOR_HOSTS : cfg.KYC_REQUIRED_FOR_GUESTS;
  if (!required) return;
  if (!(await isIdentityVerified(userId))) throw new IdentityVerificationRequiredError(role);
}

export async function getIdentityStatus(userId: string) {
  const cfg = getConfig();
  const provider = getIdentityProvider().name;
  const [verified, latest] = await Promise.all([
    prisma.identityVerification.findFirst({
      where: { userId, status: "VERIFIED" },
      orderBy: { verifiedAt: "desc" },
    }),
    prisma.identityVerification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const current = verified ?? latest;
  return {
    status: (current?.status ?? "NOT_STARTED") as KycStatus | "NOT_STARTED",
    provider,
    verifiedAt: verified?.verifiedAt?.toISOString() ?? null,
    lastError: current && current.status !== "VERIFIED" ? current.lastError : null,
    required: { host: cfg.KYC_REQUIRED_FOR_HOSTS, guest: cfg.KYC_REQUIRED_FOR_GUESTS },
    testDocuments: provider === "mock" ? [...MOCK_TEST_DOCUMENTS] : [],
  };
}

export const startKycSchema = z.object({
  testDocument: z.enum(MOCK_TEST_DOCUMENTS).optional(),
});

/**
 * Doğrulama başlatır. Stripe: barındırılan sayfaya yönlendirme URL'si döner, sonuç
 * webhook'la gelir. Mock: sonuç imzalı webhook olarak hemen (süreç içi) teslim edilir.
 */
export async function startIdentityVerification(
  userId: string,
  input: z.infer<typeof startKycSchema>
) {
  const cfg = getConfig();
  if (await isIdentityVerified(userId)) {
    throw new ConflictError("Kimliğiniz zaten doğrulandı", "ALREADY_VERIFIED");
  }
  const since = new Date(Date.now() - 86_400_000);
  const recent = await prisma.identityVerification.count({
    where: { userId, createdAt: { gte: since } },
  });
  if (recent >= cfg.KYC_MAX_STARTS_PER_DAY) {
    throw new HttpError(
      429,
      "KYC_RATE_LIMITED",
      "Bugün için çok fazla doğrulama denemesi yapıldı, lütfen yarın tekrar deneyin"
    );
  }
  const provider = getIdentityProvider();
  const verificationId = randomUUID();
  const session = await provider.start({
    userId,
    verificationId,
    returnUrl: `${appUrl()}/account?kyc=return`,
    testDocument: input.testDocument,
  });
  const row = await prisma.identityVerification.create({
    data: { userId, provider: provider.name, providerRef: session.providerRef },
  });
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: "kyc.started",
      entity: "user",
      entityId: userId,
      meta: { provider: provider.name, verificationId: row.id },
    },
  });
  kycEvents.inc({ provider: provider.name, outcome: "started" });
  if (provider.name === "mock") {
    const hook = buildMockKycWebhook(session.providerRef, input.testDocument ?? "valid");
    await handleIdentityWebhook(hook.rawBody, hook.headers);
  }
  const fresh = await prisma.identityVerification.findUniqueOrThrow({ where: { id: row.id } });
  return {
    id: fresh.id,
    provider: provider.name,
    status: fresh.status,
    lastError: fresh.lastError,
    redirectUrl: session.redirectUrl,
  };
}

/**
 * Webhook'u AKTİF sağlayıcıyla doğrular ve durumu uygular. Sonuç durumlar (VERIFIED/FAILED)
 * değişmez; tekrar eden/sırasız olay etkisizdir (idempotent).
 */
export async function handleIdentityWebhook(
  rawBody: string,
  headers: Headers
): Promise<{ applied: boolean; status?: KycStatus }> {
  const provider = getIdentityProvider();
  let event: KycEvent | null;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch (error) {
    kycEvents.inc({
      provider: provider.name,
      outcome: error instanceof KycWrongProviderError ? "wrong_provider" : "bad_signature",
    });
    throw error;
  }
  if (!event) return { applied: false };
  const row = await prisma.identityVerification.findUnique({
    where: { provider_providerRef: { provider: provider.name, providerRef: event.providerRef } },
  });
  if (!row) {
    kycEvents.inc({ provider: provider.name, outcome: "unknown_ref" });
    return { applied: false };
  }
  if (TERMINAL.has(row.status) || row.status === event.status) {
    return { applied: false, status: row.status };
  }
  const updated = await prisma.identityVerification.updateMany({
    where: { id: row.id, status: row.status },
    data: {
      status: event.status,
      lastError: event.status === "VERIFIED" ? null : event.errorCode,
      verifiedAt: event.status === "VERIFIED" ? new Date() : null,
    },
  });
  if (updated.count === 0) return { applied: false };
  await prisma.auditLog.create({
    data: {
      actorId: "system:kyc-webhook",
      action: "kyc.status_changed",
      entity: "user",
      entityId: row.userId,
      meta: {
        provider: provider.name,
        verificationId: row.id,
        from: row.status,
        to: event.status,
        errorCode: event.errorCode,
      },
    },
  });
  kycEvents.inc({ provider: provider.name, outcome: event.status.toLowerCase() });
  return { applied: true, status: event.status };
}
