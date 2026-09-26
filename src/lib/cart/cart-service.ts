import { Prisma, BookingStatus, CartStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingExpiredPayload } from "@/lib/events/events";
import { ConflictError, HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { hashIdempotentRequest } from "@/lib/http/idempotency";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { invalidatePropertySearchCache } from "@/lib/search";
import { releaseInventory, reserveBookingInTx } from "@/lib/booking-service";
import { computeTotal, SoldOutError, type Quote } from "@/lib/pricing/quote";
import { getCurrentFx, getFxById, type FxTable } from "@/lib/fx/store";
import { minorFromDb, minorToDb } from "@/lib/money/money";
import { fromDate, toDbDate } from "@/lib/time/nights";
import { counter, histogram } from "@/lib/observability/metrics";
import { logger } from "@/lib/observability/logger";
import { withOrderedLocks } from "./locks";

/**
 * Çok odalı / grup sepeti (P1-1).
 *
 * - Kullanıcı başına tek aktif sepet (OPEN/HELD; kısmi benzersiz indeks). Kalemler yalnızca
 *   OPEN sepette değişir; her ekleme/güncelleme teklif motoruyla (`computeTotal`) fiyatlanır ve
 *   anlık görüntü (sepet biriminde toplam) saklanır.
 * - `holdCart` TÜMÜ-YA-HİÇ: oda tipleri kimliğe göre sıralı Redlock (deadlock yok) → tek
 *   SERIALIZABLE işlemde her kalem için `reserveBookingInTx` (koşullu `holdUnits` sayacı).
 *   Bir kalem bile yer bulamazsa işlem geri alınır → hiçbir tutma kalmaz.
 * - Tutma bitişi sepet düzeyindedir: tüm kalem rezervasyonları aynı `holdExpiresAt`'i taşır;
 *   `expireCarts` (expire-holds işi) sepeti tek işlemde EXPIRED yapar ve envanteri iade eder.
 */

const redlock = createRedlock(redis);

const cartHoldTotal = counter("cart_hold_total", "Sepet tutma denemeleri (sonuç)", [
  "outcome",
] as const);
/** P0-6: tutulan sepetin kalem sayısı (grup rezervasyonu büyüklüğü dağılımı). */
const cartHoldItems = histogram(
  "cart_hold_items",
  "Başarılı sepet tutmasındaki kalem sayısı",
  [],
  [1, 2, 3, 4, 5, 6, 8, 10, 20, 50]
);
const cartReleaseTotal = counter("cart_release_total", "Sepet tutmasının bırakılması", [
  "reason",
] as const);

const ACTIVE: CartStatus[] = [CartStatus.OPEN, CartStatus.HELD];

export class CartNotFoundError extends NotFoundError {
  constructor() {
    super("Sepet bulunamadı");
    this.name = "CartNotFoundError";
  }
}

export class CartLockedError extends ConflictError {
  constructor() {
    super("Sepet ödeme için tutuluyor; önce tutmayı bırakın", "CART_LOCKED");
    this.name = "CartLockedError";
  }
}

// ───────────────────────────── DTO ─────────────────────────────

const itemInclude = {
  roomType: {
    select: {
      name: true,
      maxOccupancy: true,
      property: { select: { title: true, location: { select: { city: true } } } },
    },
  },
} satisfies Prisma.CartItemInclude;

const cartInclude = {
  items: { include: itemInclude, orderBy: { createdAt: "asc" } },
  bookings: { select: { id: true, status: true } },
  payment: { select: { id: true, status: true, failureCode: true, amountMinor: true } },
} satisfies Prisma.CartInclude;

type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export interface CartItemDTO {
  id: string;
  propertyId: string;
  propertyTitle: string;
  city: string | null;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  quantity: number;
  /** Sepet (tahsilat) biriminde kalem toplamı. */
  totalMinor: number;
  propertyTotalMinor: number;
  propertyCurrency: string;
  bookingId: string | null;
  bookingStatus: BookingStatus | null;
}

export interface CartDTO {
  id: string;
  status: CartStatus;
  currency: string;
  holdExpiresAt: string | null;
  items: CartItemDTO[];
  totalMinor: number;
  payment: { status: string; failureCode: string | null } | null;
}

function nightsBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function presentCart(row: CartRow): CartDTO {
  const bookingStatus = new Map(row.bookings.map((b) => [b.id, b.status]));
  const items = row.items.map<CartItemDTO>((i) => ({
    id: i.id,
    propertyId: i.propertyId,
    propertyTitle: i.roomType.property.title,
    city: i.roomType.property.location?.city ?? null,
    roomTypeId: i.roomTypeId,
    roomTypeName: i.roomType.name,
    ratePlanId: i.ratePlanId,
    checkIn: fromDate(i.checkIn),
    checkOut: fromDate(i.checkOut),
    nights: nightsBetween(i.checkIn, i.checkOut),
    adults: i.adults,
    children: i.children,
    quantity: i.quantity,
    totalMinor: minorFromDb(i.quotedTotalMinor),
    propertyTotalMinor: minorFromDb(i.quotedPropertyTotalMinor),
    propertyCurrency: i.propertyCurrency,
    bookingId: i.bookingId,
    bookingStatus: i.bookingId ? (bookingStatus.get(i.bookingId) ?? null) : null,
  }));
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    items,
    totalMinor: items.reduce((sum, i) => sum + i.totalMinor, 0),
    payment: row.payment
      ? { status: row.payment.status, failureCode: row.payment.failureCode }
      : null,
  };
}

async function loadCart(cartId: string): Promise<CartRow> {
  const row = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
  if (!row) throw new CartNotFoundError();
  return row;
}

/** Sahibinin sepeti; başkasınınki 404 (IDOR: varlığı bile sızdırılmaz). */
export async function loadOwnedCart(cartId: string, userId: string): Promise<CartRow> {
  const row = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
  if (!row || row.userId !== userId) throw new CartNotFoundError();
  return row;
}

async function findActiveCart(userId: string): Promise<CartRow | null> {
  return prisma.cart.findFirst({
    where: { userId, status: { in: ACTIVE } },
    include: cartInclude,
    orderBy: { createdAt: "desc" },
  });
}

/** Kullanıcının aktif sepeti (yoksa null). */
export async function getActiveCart(userId: string): Promise<CartDTO | null> {
  const row = await findActiveCart(userId);
  return row ? presentCart(row) : null;
}

// ─────────────────────────── kalemler ───────────────────────────

export interface CartItemInput {
  propertyId: string;
  roomTypeId: string;
  ratePlanId?: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  quantity?: number;
  /** Yalnızca sepet henüz yokken: tahsilat birimi (izinliyse). */
  currency?: string;
}

function validateItem(input: CartItemInput): void {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new ValidationError("Oda adedi 1–10 olmalıdır");
  }
  if (!Number.isInteger(input.adults) || input.adults < 1) {
    throw new ValidationError("Her kalemde en az 1 yetişkin olmalıdır");
  }
  const children = input.children ?? 0;
  if (!Number.isInteger(children) || children < 0) {
    throw new ValidationError("Çocuk sayısı geçersiz");
  }
}

/** Kalemi teklif motoruyla fiyatlar (sepet birimi varsa o birimde tahsilat tutarı). */
async function quoteItem(input: CartItemInput, currency: string | undefined): Promise<Quote> {
  return computeTotal({
    roomId: input.roomTypeId,
    propertyId: input.propertyId,
    ratePlanId: input.ratePlanId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.adults + (input.children ?? 0),
    units: input.quantity ?? 1,
    currency,
  });
}

function snapshotOf(quote: Quote) {
  return {
    ratePlanId: quote.ratePlan.id,
    checkIn: toDbDate(quote.checkIn),
    checkOut: toDbDate(quote.checkOut),
    quotedTotalMinor: minorToDb(quote.charge.total),
    quotedPropertyTotalMinor: minorToDb(quote.total),
    propertyCurrency: quote.currency,
    quoteSnapshot: {
      nights: quote.nights,
      subtotal: quote.subtotal,
      fees: quote.fees,
      taxes: quote.taxes,
      total: quote.total,
      currency: quote.currency,
      charge: quote.charge,
      ratePlan: quote.ratePlan,
    } as unknown as Prisma.InputJsonValue,
    fxSnapshotId: quote.fxSnapshotId,
  };
}

function assertCartCurrency(quote: Quote, currency: string): void {
  if (quote.charge.currency !== currency) {
    throw new ConflictError(
      `Bu ilan sepetin para biriminde (${currency}) fiyatlanamıyor`,
      "CART_CURRENCY_MISMATCH"
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** OPEN sepetin sürümünü koşullu artırır; tutulmuş/kapanmış sepette 409. */
async function bumpOpenCart(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
  const bumped = await tx.cart.updateMany({
    where: { id: cartId, status: CartStatus.OPEN },
    data: { version: { increment: 1 } },
  });
  if (bumped.count !== 1) throw new CartLockedError();
}

/** Aktif sepete kalem ekler (sepet yoksa oluşturur). */
export async function addCartItem(userId: string, input: CartItemInput): Promise<CartDTO> {
  validateItem(input);
  let cart = await findActiveCart(userId);
  if (cart?.status === CartStatus.HELD) throw new CartLockedError();
  if (cart && cart.items.length >= getConfig().CART_MAX_ITEMS) {
    throw new ValidationError(`Sepette en fazla ${getConfig().CART_MAX_ITEMS} kalem olabilir`);
  }
  const quote = await quoteItem(input, cart?.currency ?? input.currency);
  if (!cart) {
    try {
      await prisma.cart.create({ data: { userId, currency: quote.charge.currency } });
    } catch (error) {
      // Eşzamanlı ilk ekleme: kısmi benzersiz indeks ikinci aktif sepeti reddeder.
      if (!isUniqueViolation(error)) throw error;
    }
    cart = await findActiveCart(userId);
    if (!cart) throw new CartNotFoundError();
  }
  assertCartCurrency(quote, cart.currency);
  const cartId = cart.id;
  // READ COMMITTED + sepet satır kilidi (SERIALIZABLE değil): `bumpOpenCart`'ın koşullu UPDATE'i
  // sepet satırını işlem sonuna dek kilitler. Aynı sepete eşzamanlı eklemeler bu kilitte sıralanır
  // (sayım kilit altında doğru), tutma/kapama da aynı satırı güncellediği için ardından gelen
  // ekleme `status = OPEN` koşulunu yeniden değerlendirip 409 alır. SSI'de ise farklı
  // kullanıcıların sepetleri küçük CartItem tablosundaki sayım/ekleme predikat kilitleri
  // yüzünden sahte rw-çakışması (P2034) üretiyordu (test-stabilization (c)3).
  await prisma.$transaction(
    async (tx) => {
      await bumpOpenCart(tx, cartId);
      const count = await tx.cartItem.count({ where: { cartId } });
      if (count >= getConfig().CART_MAX_ITEMS) {
        throw new ValidationError(`Sepette en fazla ${getConfig().CART_MAX_ITEMS} kalem olabilir`);
      }
      await tx.cartItem.create({
        data: {
          cartId,
          propertyId: quote.propertyId,
          roomTypeId: quote.roomId,
          adults: input.adults,
          children: input.children ?? 0,
          quantity: quote.units,
          ...snapshotOf(quote),
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 10000,
    }
  );
  return presentCart(await loadCart(cartId));
}

async function loadOwnedItem(userId: string, itemId: string) {
  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: { select: { id: true, userId: true, status: true, currency: true } } },
  });
  if (!item || item.cart.userId !== userId) throw new NotFoundError("Sepet kalemi bulunamadı");
  if (item.cart.status === CartStatus.HELD) throw new CartLockedError();
  if (item.cart.status !== CartStatus.OPEN) throw new CartNotFoundError();
  return item;
}

export type CartItemPatch = Partial<
  Pick<CartItemInput, "checkIn" | "checkOut" | "adults" | "children" | "quantity" | "ratePlanId">
>;

/** Kalemi günceller ve yeniden fiyatlar. */
export async function updateCartItem(
  userId: string,
  itemId: string,
  patch: CartItemPatch
): Promise<CartDTO> {
  const item = await loadOwnedItem(userId, itemId);
  const merged: CartItemInput = {
    propertyId: item.propertyId,
    roomTypeId: item.roomTypeId,
    ratePlanId: patch.ratePlanId ?? item.ratePlanId ?? undefined,
    checkIn: patch.checkIn ?? fromDate(item.checkIn),
    checkOut: patch.checkOut ?? fromDate(item.checkOut),
    adults: patch.adults ?? item.adults,
    children: patch.children ?? item.children,
    quantity: patch.quantity ?? item.quantity,
  };
  validateItem(merged);
  const quote = await quoteItem(merged, item.cart.currency);
  assertCartCurrency(quote, item.cart.currency);
  await withSerializableRetry(async (tx) => {
    await bumpOpenCart(tx, item.cartId);
    await tx.cartItem.update({
      where: { id: item.id },
      data: {
        adults: merged.adults,
        children: merged.children ?? 0,
        quantity: quote.units,
        ...snapshotOf(quote),
      },
    });
  });
  return presentCart(await loadCart(item.cartId));
}

export async function removeCartItem(userId: string, itemId: string): Promise<CartDTO> {
  const item = await loadOwnedItem(userId, itemId);
  await withSerializableRetry(async (tx) => {
    await bumpOpenCart(tx, item.cartId);
    await tx.cartItem.delete({ where: { id: item.id } });
  });
  return presentCart(await loadCart(item.cartId));
}

// ─────────────────────────── tutma ───────────────────────────

export interface PriceChange {
  itemId: string;
  previousTotal: number;
  currentTotal: number;
}

/** Kalem hatasına hangi kalemin başarısız olduğunu ekler (tümü-ya-hiç → hiçbiri tutulmadı). */
/**
 * Kilit zaman aşımı sonrası doluluk yeniden kontrolü: kendi adedi artık sığmayan ilk kalemin
 * kimliği (yoksa null). Yalnızca hata eşleme içindir; sorgu hatası "dolu değil" sayılır.
 */
async function firstSoldOutItem(
  items: ReadonlyArray<{
    id: string;
    roomTypeId: string;
    checkIn: Date;
    checkOut: Date;
    quantity: number;
  }>
): Promise<string | null> {
  for (const item of items) {
    const full = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "InventoryDay"
      WHERE "roomTypeId" = ${item.roomTypeId}
        AND date >= ${toDbDate(fromDate(item.checkIn))} AND date < ${toDbDate(fromDate(item.checkOut))}
        AND sold + held + ${item.quantity} > total`
      .then((r) => Number(r[0]?.n ?? 0) > 0)
      .catch(() => false);
    if (full) return item.id;
  }
  return null;
}

function withItem(error: unknown, itemId: string): unknown {
  if (!(error instanceof HttpError)) return error;
  const details =
    error.details && typeof error.details === "object"
      ? { ...(error.details as Record<string, unknown>), itemId }
      : { itemId };
  return new HttpError(error.status, error.code, error.message, details);
}

/**
 * Sepetin TÜM kalemlerini tek işlemde tutar (tümü-ya-hiç).
 *
 * 1. Her kalem kilitsiz yeniden fiyatlanır; anlık görüntüden farklıysa görüntüler güncellenir
 *    ve 409 PRICE_CHANGED (kullanıcı yeni toplamı onaylar). Dolu kalem → 409 + `itemId`.
 * 2. Oda tipi kilitleri kimlik sırasıyla alınır; tek SERIALIZABLE işlemde sepet OPEN→HELD
 *    (sürüm koşullu) ve her kalem için HELD rezervasyon + `holdUnits`. Hata → hepsi geri alınır.
 */
export async function holdCart(
  userId: string,
  opts: { cartId?: string; idempotencyKey?: string } = {}
): Promise<CartDTO> {
  const config = getConfig();
  let cart = opts.cartId ? await loadOwnedCart(opts.cartId, userId) : await findActiveCart(userId);
  if (!cart) throw new CartNotFoundError();
  if (cart.status === CartStatus.HELD) {
    if (cart.holdExpiresAt && cart.holdExpiresAt.getTime() > Date.now()) {
      return presentCart(cart); // idempotent: aynı tutma
    }
    await releaseCartHolds(cart.id, CartStatus.OPEN, "hold_timeout");
    cart = await loadCart(cart.id);
  }
  if (cart.status !== CartStatus.OPEN) {
    throw new ConflictError("Sepet artık tutulamaz", "CART_NOT_OPEN");
  }
  if (cart.items.length === 0) throw new ValidationError("Sepet boş");

  const requestHash = hashIdempotentRequest([
    cart.id,
    ...cart.items.flatMap((i) => [i.id, i.updatedAt.getTime()]),
  ]);
  if (opts.idempotencyKey) {
    const prior = await prisma.cart.findUnique({
      where: { userId_holdIdempotencyKey: { userId, holdIdempotencyKey: opts.idempotencyKey } },
      select: { id: true, holdRequestHash: true },
    });
    if (prior && (prior.id !== cart.id || prior.holdRequestHash !== requestHash)) {
      throw new ConflictError(
        "Bu Idempotency-Key farklı bir istekle kullanılmış",
        "IDEMPOTENCY_KEY_REUSED"
      );
    }
  }

  // 1) Kilitsiz yeniden fiyatlama (fiyat değişimi / dolu kalem erken yakalanır).
  const quotes = new Map<string, Quote>();
  const changes: PriceChange[] = [];
  for (const item of cart.items) {
    let quote: Quote;
    try {
      quote = await quoteItem(
        {
          propertyId: item.propertyId,
          roomTypeId: item.roomTypeId,
          ratePlanId: item.ratePlanId ?? undefined,
          checkIn: fromDate(item.checkIn),
          checkOut: fromDate(item.checkOut),
          adults: item.adults,
          children: item.children,
          quantity: item.quantity,
        },
        cart.currency
      );
      assertCartCurrency(quote, cart.currency);
    } catch (error) {
      cartHoldTotal.inc({ outcome: "unavailable" });
      throw withItem(error, item.id);
    }
    quotes.set(item.id, quote);
    const previous = minorFromDb(item.quotedTotalMinor);
    if (previous !== quote.charge.total) {
      changes.push({ itemId: item.id, previousTotal: previous, currentTotal: quote.charge.total });
    }
  }
  if (changes.length > 0) {
    await prisma.$transaction(
      changes.map((c) =>
        prisma.cartItem.update({
          where: { id: c.itemId },
          data: snapshotOf(quotes.get(c.itemId)!),
        })
      )
    );
    cartHoldTotal.inc({ outcome: "price_changed" });
    throw new ConflictError("Fiyat değişti, lütfen yeni toplamı onaylayın", "PRICE_CHANGED", {
      items: changes,
    });
  }

  const fxById = new Map<string | null, FxTable>();
  for (const q of quotes.values()) {
    if (fxById.has(q.fxSnapshotId)) continue;
    fxById.set(q.fxSnapshotId, (await getFxById(q.fxSnapshotId)) ?? (await getCurrentFx()));
  }

  // 2) Sıralı kilitler + tek SERIALIZABLE işlem.
  const holdExpiresAt = new Date(Date.now() + config.CART_HOLD_TTL_MINUTES * 60_000);
  // Kalemler de kilit sırasıyla işlenir (oda tipi, sonra kalem kimliği) → deterministik.
  const ordered = [...cart.items].sort((a, b) =>
    a.roomTypeId !== b.roomTypeId ? (a.roomTypeId < b.roomTypeId ? -1 : 1) : a.id < b.id ? -1 : 1
  );
  const cartRow = cart;
  try {
    const bookings = await withOrderedLocks(
      redlock,
      cart.items.map((i) => i.roomTypeId),
      () =>
        withSerializableRetry(
          async (tx) => {
            const moved = await tx.cart.updateMany({
              where: { id: cartRow.id, status: CartStatus.OPEN, version: cartRow.version },
              data: {
                status: CartStatus.HELD,
                holdExpiresAt,
                holdIdempotencyKey: opts.idempotencyKey ?? null,
                holdRequestHash: requestHash,
                version: { increment: 1 },
              },
            });
            if (moved.count !== 1) {
              throw new ConflictError("Sepet eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
            }
            const out: Array<{ id: string; propertyId: string }> = [];
            for (const item of ordered) {
              const quote = quotes.get(item.id)!;
              try {
                const booking = await reserveBookingInTx(
                  tx,
                  {
                    userId,
                    propertyId: item.propertyId,
                    roomId: item.roomTypeId,
                    checkIn: quote.checkIn,
                    checkOut: quote.checkOut,
                    guestCount: item.adults + item.children,
                    ratePlanId: quote.ratePlan.id,
                    units: item.quantity,
                    currency: cartRow.currency,
                    requestHash,
                  },
                  quote.checkIn,
                  quote.checkOut,
                  quote.nights.map((n) => n.date),
                  quote,
                  fxById.get(quote.fxSnapshotId)!,
                  { cartId: cartRow.id, holdExpiresAt }
                );
                await tx.cartItem.update({
                  where: { id: item.id },
                  data: { bookingId: booking.id },
                });
                out.push({ id: booking.id, propertyId: booking.propertyId });
              } catch (error) {
                throw withItem(error, item.id);
              }
            }
            return out;
          },
          { timeout: 30_000, maxWait: 10_000 }
        ),
      { ttlMs: 15_000, retryDelayMs: 25, waitMs: config.LOCK_WAIT_BUDGET_MS }
    );
    cartHoldTotal.inc({ outcome: "held" });
    cartHoldItems.observe(bookings.length);
    await afterBookingsWrite(bookings);
  } catch (error) {
    if (error instanceof LockError) {
      // Kilit bütçesi doldu: bu sürede bir kalemin odası dolduysa ROOM_BUSY değil SOLD_OUT.
      const fullItemId = await firstSoldOutItem(cartRow.items);
      if (fullItemId) {
        cartHoldTotal.inc({ outcome: "unavailable" });
        throw withItem(new SoldOutError(), fullItemId);
      }
      cartHoldTotal.inc({ outcome: "busy" });
      throw new ConflictError(
        "Odalardan biri şu anda başka bir misafir tarafından rezerve ediliyor. Tekrar deneyin.",
        "ROOM_BUSY"
      );
    }
    if (opts.idempotencyKey && isUniqueViolation(error)) {
      // Aynı anahtarla eşzamanlı ikinci istek: ilk tutmanın sonucu döner.
      return presentCart(await loadOwnedCart(cartRow.id, userId));
    }
    cartHoldTotal.inc({ outcome: "failed" });
    throw error;
  }
  return presentCart(await loadCart(cart.id));
}

async function afterBookingsWrite(
  bookings: ReadonlyArray<{ id: string; propertyId: string }>
): Promise<void> {
  for (const propertyId of new Set(bookings.map((b) => b.propertyId))) {
    await invalidatePropertySearchCache(propertyId).catch(() => undefined);
  }
  for (const b of bookings) await invalidateBookingCache(b.id).catch(() => undefined);
}

export type CartReleaseReason = BookingExpiredPayload["reason"];

/**
 * Sepetin HELD kalem rezervasyonlarını tek işlemde bırakır (HELD → EXPIRED + envanter iadesi +
 * outbox) ve sepeti `to` durumuna geçirir. Koşullu → idempotent; sepet HELD değilse (ör. ödeme
 * onaylandı) hiçbir şey yapmaz. `CANCELLED` OPEN sepette de uygulanır.
 * @returns bırakılan rezervasyon sayısı (sepet geçişi olmadıysa null)
 */
export async function releaseCartHolds(
  cartId: string,
  to: CartStatus,
  reason: CartReleaseReason,
  now: Date = new Date()
): Promise<number | null> {
  const from: CartStatus[] =
    to === CartStatus.CANCELLED ? [CartStatus.OPEN, CartStatus.HELD] : [CartStatus.HELD];
  const released = await withSerializableRetry(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cartId} FOR UPDATE`;
    const moved = await tx.cart.updateMany({
      where: { id: cartId, status: { in: from } },
      data: {
        status: to,
        holdExpiresAt: null,
        holdIdempotencyKey: null,
        version: { increment: 1 },
        ...(to === CartStatus.EXPIRED ? { expiredAt: now } : {}),
        ...(to === CartStatus.CANCELLED ? { cancelledAt: now } : {}),
      },
    });
    if (moved.count !== 1) return null;
    const bookings = await tx.booking.findMany({
      where: { cartId, status: BookingStatus.HELD },
      select: {
        id: true,
        userId: true,
        status: true,
        roomId: true,
        propertyId: true,
        checkIn: true,
        checkOut: true,
        units: true,
      },
      orderBy: { id: "asc" },
    });
    const done: typeof bookings = [];
    for (const booking of bookings) {
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.HELD },
        data: {
          status: transition(booking.status as BookingState, "EXPIRE") as BookingStatus,
          expiredAt: now,
          holdExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) continue;
      await releaseInventory(tx, booking);
      await appendOutbox(
        tx,
        makeEvent<BookingExpiredPayload>(EventTypes.BookingExpired, booking.id, "booking", {
          bookingId: booking.id,
          propertyId: booking.propertyId,
          roomId: booking.roomId,
          checkIn: fromDate(booking.checkIn),
          checkOut: fromDate(booking.checkOut),
          userId: booking.userId,
          reason,
        })
      );
      done.push(booking);
    }
    return done;
  });
  if (!released) return null;
  cartReleaseTotal.inc({ reason });
  await afterBookingsWrite(released);
  return released.length;
}

/** Kullanıcı tutmayı bırakır: rezervasyonlar düşer, sepet düzenlenebilir (OPEN) kalır. */
export async function releaseCart(userId: string, cartId: string): Promise<CartDTO> {
  const cart = await loadOwnedCart(cartId, userId);
  if (cart.status !== CartStatus.HELD) {
    throw new ConflictError("Sepet tutulmuyor", "CART_NOT_HELD");
  }
  await releaseCartHolds(cart.id, CartStatus.OPEN, "cart_released");
  return presentCart(await loadCart(cart.id));
}

/** Sepeti iptal eder (tutma varsa bırakılır). */
export async function cancelCart(userId: string, cartId: string): Promise<void> {
  const cart = await loadOwnedCart(cartId, userId);
  if (cart.status !== CartStatus.OPEN && cart.status !== CartStatus.HELD) {
    throw new ConflictError("Sepet artık iptal edilemez", "CART_NOT_OPEN");
  }
  const result = await releaseCartHolds(cart.id, CartStatus.CANCELLED, "cart_released");
  if (result === null) throw new ConflictError("Sepet eşzamanlı olarak değişti", "CONFLICT");
}

/**
 * Süresi dolan tutmalı sepetler (expire-holds işi): her sepet kendi işleminde bütün olarak
 * EXPIRED olur. Kalem rezervasyonlarını tekil `expireHolds` daha önce düşürmüşse yalnızca sepet
 * durumu kapanır (envanter iki kez iade edilmez: geçişler koşulludur).
 */
export async function expireCarts(now: Date = new Date(), limit = 100): Promise<number> {
  const due = await prisma.cart.findMany({
    where: {
      status: CartStatus.HELD,
      holdExpiresAt: { lte: now },
      // P1-2: aktif bölünmüş ödemeli sepeti süre sonu işi kapatır (void/iade + serbest bırakma).
      NOT: {
        payment: { is: { splitPlans: { some: { status: { in: ["COLLECTING", "FALLBACK"] } } } } },
      },
    },
    select: { id: true },
    orderBy: { holdExpiresAt: "asc" },
    take: limit,
  });
  let expired = 0;
  for (const { id } of due) {
    if ((await releaseCartHolds(id, CartStatus.EXPIRED, "hold_timeout", now)) !== null) {
      expired++;
    }
  }
  if (expired > 0) logger.info({ expired }, "expired cart holds");
  return expired;
}

/**
 * Süresi dolmuş / iptal edilmiş son sepetin kalemleriyle yeni OPEN sepet açar (fiyatlar tutmada
 * yeniden hesaplanır). Aktif sepet varsa onu döner.
 */
export async function reopenCart(userId: string): Promise<CartDTO | null> {
  const active = await findActiveCart(userId);
  if (active) return presentCart(active);
  const last = await prisma.cart.findFirst({
    where: { userId, status: { in: [CartStatus.EXPIRED] } },
    include: { items: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!last || last.items.length === 0) return null;
  try {
    await prisma.cart.create({
      data: {
        userId,
        currency: last.currency,
        items: {
          create: last.items.map((i) => ({
            propertyId: i.propertyId,
            roomTypeId: i.roomTypeId,
            ratePlanId: i.ratePlanId,
            checkIn: i.checkIn,
            checkOut: i.checkOut,
            adults: i.adults,
            children: i.children,
            quantity: i.quantity,
            quotedTotalMinor: i.quotedTotalMinor,
            quotedPropertyTotalMinor: i.quotedPropertyTotalMinor,
            propertyCurrency: i.propertyCurrency,
            quoteSnapshot: i.quoteSnapshot ?? undefined,
            fxSnapshotId: i.fxSnapshotId,
          })),
        },
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return getActiveCart(userId);
}
