/**
 * P2-2 v5 demo senaryoları (15–20) — süreç içi (in-process) servis çağrıları.
 *
 * v4 senaryolarıyla aynı desen (`scripts/demo/v4-scenarios.ts`): doğrudan `DATABASE_URL` +
 * `REDIS_URL`'e bağlanır, zaman ileri sarma (RNPL vadesi / ek süre) ve PSP hata enjeksiyonu
 * (RNPL tahsilat reddi, sepet onay adımı hatası) süreç içinde yapılır. Her senaryo kendi izole
 * verisini kurar ("Demo v5 …" ilanları; bitince pasife alınır), beklenen sonucu ASSERT eder ve
 * sonunda defteri denetler (mizan dengede + ilgili günlerde mutabakat farkı 0).
 *
 * Ödeme her zaman MockPsp, payout MockPayoutProvider, KYC MockIdentityProvider'dır; LLM çağrısı
 * ve ağ erişimi yoktur → anahtarsız. Yalnızca demo modunda (`DEMO_MODE=true`) çalışır.
 *
 *  15. RNPL: biri vadede tahsil, diğeri reddedilir → yeniden deneme → ek süre sonunda iptal
 *  16. Sepet onay adımı hatası → telafi (iade) jurnali → mutabakat temiz
 *  17. KYC'siz devir satıcısı: devir payout'u kimlik doğrulanana kadar bekler
 *  18. Destek ajanı: para talebi ve insan isteği → talep (ticket), iade yok
 *  19. Üçüncü taraf mandate doğrulaması (JWKS) + OpenAPI/UCP keşfi
 *  20. İndirim referans fiyatı: TR (10 gün) ve AB (30 gün) pazar kuralı
 */
import { SignJWT, decodeProtectedHeader } from "jose";
import { createBooking } from "@/lib/booking-service";
import {
  CART_PAYMENT_SAGA,
  addCartItem,
  confirmCartChallenge,
  holdCart,
  payCart,
} from "@/lib/cart";
import { injectSagaFaultForTests } from "@/lib/saga/saga";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { chargeRnplSchedule, reserveNowPayLater } from "@/lib/payment/rnpl";
import { EventTypes } from "@/lib/events/events";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";
import { JournalKinds, account, getAccountBalance } from "@/lib/ledger";
import { claimTransfer, listBookingForTransfer } from "@/lib/transfer/transfer-service";
import { runPayoutEngine } from "@/lib/payout/payout-engine";
import { onboardHostAccount, payoutBlockReason } from "@/lib/payout/host-account";
import { MockPayoutProvider, setPayoutProviderForTests } from "@/lib/payout";
import {
  MockIdentityProvider,
  isIdentityVerified,
  setIdentityProviderForTests,
  startIdentityVerification,
} from "@/lib/trust/kyc";
import { runSupportChat } from "@/lib/support/agent";
import { classifyIntent } from "@/lib/support/intent";
import { signMandate, verifyMandateToken } from "@/lib/agentic/mandate";
import { publicJwks } from "@/lib/agentic/mandate-keys";
import { ucpProfile } from "@/lib/agentic/ucp";
import { buildOpenApiDocument } from "@/lib/http/openapi";
import { marketRulesFor } from "@/lib/compliance/market-rules";
import { lowestNightInputs } from "@/lib/pricing/price-history";
import { computeTotal } from "@/lib/pricing/quote";
import { parseIsoDate } from "@/lib/time/nights";
import { verifyMandate, MANDATE_ALG as VERIFIER_ALG } from "../verify-mandate";
import {
  RUN,
  assertBooks,
  card,
  check,
  ctx,
  db,
  demoStay,
  demoUser,
  holdAndPay,
  iso,
  setDemoLabel,
  touched,
  utcDay,
  type DemoStay,
  type DemoUser,
  type V4Outcome,
  type V4Scenario,
} from "./v4-scenarios";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Fraud "yeni hesap" kuralı RNPL'yi (yalnız `allow`) ve sepeti engellemesin. */
const AGED_ACCOUNT_DAYS = 400;
/** Seed'deki PAY_LATER tarifesiyle aynı: +%3, orta politika (girişten 5 gün önceye tam iade). */
const PAY_LATER_BPS = 300;
const PAY_LATER_POLICY = "policy_moderate_v1";
/** Devir fiyatı: rezervasyon toplamının 4/5'i. */
const ASK_NUMERATOR = 4;
const ASK_DENOMINATOR = 5;
/** Senaryo 20 gece fiyatları (minor): bugün 150.000, 15 gün önce 200.000, 25 gün önce 100.000. */
const PRICE_NOW = 150_000n;
const PRICE_15D_AGO = 200_000n;
const PRICE_25D_AGO = 100_000n;
const DAYS_AGO_HIGH = 15;
const DAYS_AGO_LOW = 25;
const DEMO_ORIGIN = "https://stay.example";

let seq = 0;

async function ageUser(user: DemoUser): Promise<void> {
  await db().user.update({
    where: { id: user.id },
    data: { createdAt: new Date(Date.now() - AGED_ACCOUNT_DAYS * DAY) },
  });
}

/** Özneye bağlı jurnal türleri + psp_clearing neti (Σ) ve tahsil tutarı. */
async function journalOf(paymentId: string) {
  const entries = await db().journalEntry.findMany({
    where: { paymentId },
    select: {
      kind: true,
      lines: { select: { side: true, amountMinor: true, account: { select: { kind: true } } } },
    },
  });
  let net = 0n;
  let captured = 0n;
  for (const l of entries.flatMap((e) => e.lines)) {
    if (l.account.kind !== "PSP_CLEARING") continue;
    net += l.side === "DEBIT" ? l.amountMinor : -l.amountMinor;
    if (l.side === "DEBIT") captured += l.amountMinor;
  }
  return { kinds: entries.map((e) => e.kind).sort(), net, captured };
}

async function soldHeld(roomTypeId: string, day: number) {
  return db().inventoryDay.findFirstOrThrow({
    where: { roomTypeId, date: utcDay(day) },
    select: { sold: true, held: true },
  });
}

function errorText(error: unknown): string {
  const e = error as { status?: number; code?: string; name?: string; message?: string };
  return e.code ? `${e.status ?? ""} ${e.code}`.trim() : `${e.name}: ${e.message}`;
}

// ---------------------------------------------------------------------------
// 15) RNPL: zamanında tahsilat + başarısız tahsilat → ek süre sonunda otomatik iptal
// ---------------------------------------------------------------------------

/** Kayıtlı kartı kaydeden ama vadede tahsil edemeyen PSP (Stripe 4000…0341 benzeri). */
class LateDeclinePsp extends MockPsp {
  override async chargeSaved(input: Parameters<MockPsp["chargeSaved"]>[0]) {
    return {
      status: "declined" as const,
      providerRef: `pi_declined_${input.idempotencyKey}`,
      declineCode: "insufficient_funds",
    };
  }
}

async function rnplBooking(guest: DemoUser, stay: DemoStay, ratePlanId: string, start: number) {
  const { booking } = await createBooking({
    userId: guest.id,
    propertyId: stay.propertyId,
    roomId: stay.roomIds[0]!,
    ratePlanId,
    checkIn: iso(utcDay(start)),
    checkOut: iso(utcDay(start + 2)),
    guestCount: 1,
  });
  const outcome = await reserveNowPayLater({
    bookingId: booking.id,
    userId: guest.id,
    cardToken: card(),
    idempotencyKey: `demo-v5-rnpl-${RUN}-${booking.id}`,
    context: ctx(),
  });
  check(outcome.status === "scheduled", `RNPL planlanmadı: ${outcome.status}`);
  check(outcome.amount === 0, `bugün tahsil edilen ${outcome.amount} (0 bekleniyordu)`);
  const schedule = await db().paymentSchedule.findUniqueOrThrow({
    where: { bookingId: booking.id },
  });
  const confirmed = await db().booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: { payment: true },
  });
  check(confirmed.status === "CONFIRMED", `rezervasyon ${confirmed.status}`);
  check(confirmed.payment?.status === "PENDING", `ödeme ${confirmed.payment?.status}`);
  check(
    (await journalOf(confirmed.payment.id)).kinds.length === 0,
    "RNPL'de bugün jurnal olmamalı"
  );
  return { booking, outcome, schedule, paymentId: confirmed.payment.id };
}

async function scenarioRnpl(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("rnpl", { units: 2 });
  const plan = await prisma.ratePlan.create({
    data: {
      roomTypeId: stay.roomIds[0]!,
      code: "PAY_LATER",
      name: "Esnek — şimdi rezerve et, sonra öde",
      refundable: true,
      priceModifierBps: PAY_LATER_BPS,
      cancellationPolicyId: PAY_LATER_POLICY,
    },
  });
  const guest = await demoUser("rnpl-misafir");
  await ageUser(guest);
  const onTimeStart = 20;
  const failStart = 25;
  const onTime = await rnplBooking(guest, stay, plan.id, onTimeStart);
  const failing = await rnplBooking(guest, stay, plan.id, failStart);
  t.payments.add(onTime.paymentId);
  t.payments.add(failing.paymentId);

  // (a) Zamanında: vadeden önce tahsilat yok, vadede PAID + booking-captured jurnali.
  const dueA = onTime.schedule.dueAt.getTime();
  const early = await chargeRnplSchedule(onTime.schedule.id, new Date(dueA - HOUR));
  check(early === "not_due", `vadeden önce ${early}`);
  const atDue = new Date(dueA + MINUTE);
  const captured = await chargeRnplSchedule(onTime.schedule.id, atDue);
  check(captured === "captured", `vadede ${captured}`);
  t.days.add(iso(atDue));
  const paidA = await prisma.payment.findUniqueOrThrow({ where: { id: onTime.paymentId } });
  check(paidA.status === "PAID", `vadeli ödeme ${paidA.status}`);
  const scheduleA = await prisma.paymentSchedule.findUniqueOrThrow({
    where: { id: onTime.schedule.id },
  });
  check(scheduleA.status === "CAPTURED", `plan ${scheduleA.status}`);
  const journalA = await journalOf(onTime.paymentId);
  check(
    journalA.kinds.includes(JournalKinds.BookingCaptured) &&
      journalA.captured === paidA.amountMinor,
    `booking-captured jurnali yok/eksik (${journalA.kinds.join(",")})`
  );
  const again = await chargeRnplSchedule(onTime.schedule.id, atDue);
  check(again === "noop", `ikinci çalıştırma ${again} (çift tahsilat olmamalı)`);

  // (b) Başarısız: ret → RETRYING + bildirim → ek süre dolunca iptal + envanter geri.
  const soldBefore = (await soldHeld(stay.roomIds[0]!, failStart)).sold;
  check(soldBefore >= 1, "RNPL rezervasyonu envanteri satmalıydı");
  setPaymentProviderForTests(new LateDeclinePsp());
  let firstTry: string;
  let retryTry: string;
  let final: string;
  try {
    const dueB = new Date(failing.schedule.dueAt.getTime() + MINUTE);
    firstTry = await chargeRnplSchedule(failing.schedule.id, dueB);
    check(firstTry === "retry_scheduled", `ilk ret sonrası ${firstTry}`);
    const retrying = await prisma.paymentSchedule.findUniqueOrThrow({
      where: { id: failing.schedule.id },
    });
    check(retrying.status === "RETRYING", `plan ${retrying.status}`);
    check(retrying.lastFailureCode === "insufficient_funds", `hata ${retrying.lastFailureCode}`);
    const notice = await prisma.outboxMessage.findFirst({
      where: { eventType: EventTypes.RnplChargeFailed, aggregateId: failing.schedule.id },
    });
    check(notice, "misafire başarısız tahsilat bildirimi (outbox) yazılmadı");
    retryTry = await chargeRnplSchedule(
      failing.schedule.id,
      new Date(retrying.nextAttemptAt!.getTime() + MINUTE)
    );
    // Süpürücü (sweepRnplCharges) tüm vadesi gelmiş planları reddeden PSP ile işlerdi →
    // yalnız bu plan doğrudan çalıştırılır.
    const graceEnd = new Date(
      retrying.firstFailedAt!.getTime() + getConfig().RNPL_GRACE_HOURS * HOUR + MINUTE
    );
    final = await chargeRnplSchedule(failing.schedule.id, graceEnd);
    check(final === "defaulted", `ek süre sonunda ${final}`);
  } finally {
    setPaymentProviderForTests(new MockPsp());
  }
  const after = await prisma.booking.findUniqueOrThrow({
    where: { id: failing.booking.id },
    include: { payment: true, paymentSchedule: true },
  });
  check(after.status === "CANCELLED", `rezervasyon ${after.status}`);
  check(after.paymentSchedule?.status === "DEFAULTED", `plan ${after.paymentSchedule?.status}`);
  check(after.payment?.status === "VOIDED", `ödeme ${after.payment?.status}`);
  check(after.payment.paidAt === null, "başarısız RNPL'de tahsilat olmamalı");
  const soldAfter = (await soldHeld(stay.roomIds[0]!, failStart)).sold;
  check(soldAfter === soldBefore - 1, `envanter geri bırakılmadı (${soldBefore} → ${soldAfter})`);
  const journalB = await journalOf(failing.paymentId);
  check(journalB.kinds.length === 0 && journalB.net === 0n, "başarısız RNPL'de jurnal olmamalı");
  return {
    ok: true,
    detail:
      `2 RNPL rezervasyonu (bugün 0, CONFIRMED, ödeme PENDING, jurnal yok); ` +
      `A: vadeden önce not_due → vadede captured, ödeme PAID + booking-captured ` +
      `${journalA.captured} minor, tekrar noop; B: ret → ${firstTry} (RETRYING + bildirim) → ` +
      `${retryTry} → ek süre sonunda ${final}: CANCELLED, ödeme VOIDED, envanter ` +
      `${soldBefore}→${soldAfter}, jurnal yok`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// 16) Sepet onay adımı hatası → telafi (iade) jurnali → mutabakat temiz
// ---------------------------------------------------------------------------

async function scenarioCartCompensation(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const start = 30;
  const stay = await demoStay("sepet-telafi", { rooms: 2, units: 1 });
  const user = await demoUser("sepet-telafi");
  await ageUser(user);
  for (const roomTypeId of stay.roomIds) {
    await addCartItem(user.id, {
      propertyId: stay.propertyId,
      roomTypeId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + 2)),
      adults: 1,
      children: 0,
      quantity: 1,
    });
  }
  const cart = await holdCart(user.id);
  check(cart.status === "HELD", `sepet HELD değil: ${cart.status}`);
  check(cart.items.length === stay.roomIds.length, `sepette ${cart.items.length} kalem`);

  // Onay (pivot) adımından önce hata: yetkilendirme + capture yapılmıştır → telafi iade eder.
  injectSagaFaultForTests(CART_PAYMENT_SAGA, "confirm");
  let failure = "";
  try {
    const out = await payCart({
      cartId: cart.id,
      userId: user.id,
      cardToken: card(),
      idempotencyKey: `demo-v5-cart-${RUN}-${++seq}`,
      context: ctx(),
    });
    if (out.status === "requires_action") {
      await confirmCartChallenge({ cartId: cart.id, userId: user.id, code: MOCK_3DS_CODE });
    }
  } catch (error) {
    failure = errorText(error);
  } finally {
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);
  }
  check(failure, "onay adımı hatasında ödeme başarısız olmalıydı");

  const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } });
  t.payments.add(cp.id);
  check(cp.status === "REFUNDED", `sepet ödemesi ${cp.status} (REFUNDED bekleniyordu)`);
  check(cp.refundedAmountMinor === cp.amountMinor, "telafi iadesi tam tutar olmalı");
  const journal = await journalOf(cp.id);
  check(
    journal.kinds.join(",") === [JournalKinds.BookingCaptured, JournalKinds.RefundIssued].join(","),
    `telafi jurnali ${journal.kinds.join(",") || "yok"}`
  );
  check(journal.captured === cp.amountMinor && journal.net === 0n, `psp_clearing Σ=${journal.net}`);

  const after = await prisma.cart.findUniqueOrThrow({
    where: { id: cart.id },
    include: { bookings: { select: { status: true } } },
  });
  check(after.status === "OPEN", `sepet ${after.status} (yeniden ödenebilir OPEN bekleniyordu)`);
  check(
    after.bookings.every((b) => b.status !== "CONFIRMED"),
    "telafide rezervasyon onaylanmamalı"
  );
  for (const roomTypeId of stay.roomIds) {
    const inv = await soldHeld(roomTypeId, start);
    check(
      inv.held === 0 && inv.sold === 0,
      `envanter bırakılmadı (held ${inv.held}, sold ${inv.sold})`
    );
  }
  return {
    ok: true,
    detail:
      `2 oda sepeti ${cp.amountMinor} ${cp.currency} minor; onay adımı hatası (${failure}) → ` +
      `telafi: iade ${cp.refundedAmountMinor}, sepet ödemesi REFUNDED, jurnal ` +
      `[${journal.kinds.join(" + ")}] Σ psp_clearing=0, tutmalar bırakıldı, sepet OPEN`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// 17) KYC'siz devir satıcısı: payout kimlik doğrulanana kadar bekler
// ---------------------------------------------------------------------------

async function scenarioTransferKyc(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("devir-kyc");
  const seller = await demoUser("devir-kyc-satici");
  const buyer = await demoUser("devir-kyc-alici");
  const { booking, payment } = await holdAndPay(seller.id, stay, 35);
  t.payments.add(payment.id);
  const ask = Math.floor((booking.totalMinor * ASK_NUMERATOR) / ASK_DENOMINATOR);

  const previousFlag = process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED;
  process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED = "true";
  resetConfigForTests();
  setPayoutProviderForTests(new MockPayoutProvider());
  setIdentityProviderForTests(new MockIdentityProvider());
  try {
    const listed = await listBookingForTransfer(booking.id, seller.id, ask);
    const done = await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer.id,
      cardToken: card(),
    });
    check(done.status === "COMPLETED", `devir ${done.status}`);
    t.transfers.add(listed.id);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { transferId: listed.id } });
    check(payout.status === "PENDING", `payout ${payout.status}`);
    check(payout.amountMinor === BigInt(ask), `payout ${payout.amountMinor} ≠ ask ${ask}`);
    const payable = account.hostPayable(seller.id);
    const before = (await getAccountBalance(prisma, payable, payout.currency)).balanceMinor;

    // (1) Ödeme hesabı yok → bekler.
    const r1 = await runPayoutEngine(new Date(), { userIds: [seller.id] });
    const noAccount = await payoutBlockReason(
      await prisma.hostAccount.findUnique({ where: { userId: seller.id } })
    );
    check(r1.paid === 0 && noAccount === "NO_ACCOUNT", `hesapsız: paid ${r1.paid}, ${noAccount}`);

    // (2) Hesap açıldı ama kimlik doğrulanmadı → yine bekler.
    const acc = await onboardHostAccount(seller.id);
    check(!(await isIdentityVerified(seller.id)), "satıcı henüz doğrulanmamış olmalı");
    const unverified = await payoutBlockReason(acc);
    const r2 = await runPayoutEngine(new Date(), { userIds: [seller.id] });
    check(
      r2.paid === 0 && unverified === "IDENTITY_UNVERIFIED",
      `KYC'siz: paid ${r2.paid}, ${unverified}`
    );
    const waiting = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    check(waiting.status === "PENDING" && waiting.paidAt === null, "KYC'siz payout gönderilmemeli");
    const mid = (await getAccountBalance(prisma, payable, payout.currency)).balanceMinor;
    check(mid === before, "bekleyen payout host_payable bakiyesini değiştirmemeli");

    // (3) Kimlik doğrulandı (mock belge "valid") → payout serbest.
    const kyc = await startIdentityVerification(seller.id, { testDocument: "valid" });
    check(kyc.status === "VERIFIED", `KYC ${kyc.status}`);
    const refreshed = await onboardHostAccount(seller.id);
    check((await payoutBlockReason(refreshed)) === null, "doğrulama sonrası kapı açılmalı");
    const r3 = await runPayoutEngine(new Date(), { userIds: [seller.id] });
    check(r3.paid === 1, `doğrulama sonrası paid ${r3.paid}`);
    const released = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    check(released.status === "PAID" && released.reference, `payout ${released.status}`);
    const after = (await getAccountBalance(prisma, payable, payout.currency)).balanceMinor;
    check(before - after === payout.amountMinor, `host_payable ${before} → ${after}`);
    const releasedJournal = await prisma.journalEntry.count({
      where: { idempotencyKey: `payout-released:${payout.id}` },
    });
    check(releasedJournal === 1, `payout-released jurnali ${releasedJournal}`);
    return {
      ok: true,
      detail:
        `devir ${ask} minor COMPLETED → payout PENDING; hesap yok → ${noAccount}, ` +
        `hesap var + KYC yok → ${unverified} (paid 0, bakiye değişmedi); mock KYC VERIFIED → ` +
        `payout PAID (${released.reference}), host_payable ${before}→${after}, ` +
        `payout-released jurnali ✓ (PAYOUT_REQUIRE_IDENTITY_VERIFIED=true, senaryo içinde)`,
      books: await assertBooks(t),
    };
  } finally {
    if (previousFlag === undefined) delete process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED;
    else process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED = previousFlag;
    resetConfigForTests();
    setPayoutProviderForTests(null);
    setIdentityProviderForTests(null);
  }
}

// ---------------------------------------------------------------------------
// 18) Destek ajanı: para talebi + insan isteği → talep, iade yok
// ---------------------------------------------------------------------------

async function scenarioSupportHandoff(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("destek");
  const guest = await demoUser("destek-misafir");
  const { booking, payment } = await holdAndPay(guest.id, stay, 40);
  t.payments.add(payment.id);

  const cases = [
    {
      message: "Rezervasyonum için iade yapın, paramı geri istiyorum.",
      reason: "MONEY_REQUEST",
    },
    { message: "Lütfen beni bir müşteri temsilcisine bağlayın.", reason: "USER_REQUEST" },
  ] as const;
  const notes: string[] = [];
  for (const c of cases) {
    const intent = classifyIntent(c.message);
    const out = await runSupportChat({
      userId: guest.id,
      message: c.message,
      bookingId: booking.id,
      locale: "tr",
    });
    check(out.handoff?.reason === c.reason, `"${c.message}" → devir ${out.handoff?.reason}`);
    check(out.llmMode === "demo", `devir LLM'e gitmemeli (${out.llmMode})`);
    check(out.toolsUsed.join(",") === "open_support_ticket", `araçlar: ${out.toolsUsed.join(",")}`);
    const ticket = await prisma.supportTicket.findUniqueOrThrow({
      where: { id: out.handoff.ticketId },
    });
    check(
      ticket.status === "OPEN" && ticket.reason === c.reason && ticket.userId === guest.id,
      `talep ${ticket.status}/${ticket.reason}`
    );
    notes.push(`${intent.intent} → ${ticket.reason} (${ticket.id.slice(-6)})`);
  }

  const after = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: { payment: true },
  });
  check(after.status === "CONFIRMED", `rezervasyon ${after.status} (değişmemeliydi)`);
  check(
    after.payment?.status === payment.status &&
      after.payment.refundedAmountMinor === payment.refundedAmountMinor &&
      after.payment.refundedAmountMinor === 0n,
    "destek ajanı iade yapmamalı"
  );
  const refundJournal = await prisma.journalEntry.count({
    where: { paymentId: payment.id, kind: JournalKinds.RefundIssued },
  });
  check(refundJournal === 0, `iade jurnali ${refundJournal}`);
  return {
    ok: true,
    detail:
      `${notes.join("; ")}; LLM'siz şablon yanıt, tek araç open_support_ticket; ` +
      `ödeme ${after.payment.status}, iade 0, rezervasyon CONFIRMED`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// 19) Üçüncü taraf mandate doğrulaması + OpenAPI/UCP keşfi
// ---------------------------------------------------------------------------

function tamperPayload(jws: string, patch: Record<string, unknown>): string {
  const [header, payload, signature] = jws.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as object;
  const forged = Buffer.from(JSON.stringify({ ...claims, ...patch })).toString("base64url");
  return `${header}.${forged}.${signature}`;
}

async function scenarioMandateDiscovery(): Promise<V4Outcome> {
  const t = touched();
  const user = await demoUser("mandate-3p");
  const profile = ucpProfile(DEMO_ORIGIN);
  const intent = profile.ap2.intent_mandate;
  check(intent.alg === VERIFIER_ALG, `UCP alg ${intent.alg} ≠ doğrulayıcı ${VERIFIER_ALG}`);

  // OpenAPI: keşif belgelerinin ve UCP'nin ilan ettiği uçların hepsi sözleşmede.
  const doc = buildOpenApiDocument();
  const paths = new Set(Object.keys(doc.paths));
  const advertised = [
    intent.jwks_uri,
    intent.issue_endpoint,
    profile.endpoints.checkout_sessions,
    profile.endpoints.checkout_session,
    profile.endpoints.complete,
    profile.endpoints.acp_checkout_sessions,
  ].map((u) => u.slice(DEMO_ORIGIN.length));
  const required = [
    ...advertised,
    "/.well-known/ucp",
    "/api/openapi.json",
    "/api/agentic/checkout_sessions/{id}/complete",
  ];
  const missing = required.filter((p) => !paths.has(p));
  check(missing.length === 0, `OpenAPI'de eksik yol: ${missing.join(", ")}`);

  // Üçüncü taraf: yalnız JWKS + mandate ile doğrular (platform sırrı/DB yok).
  const jwks = publicJwks();
  const { mandate, claims } = await signMandate(user.id, {
    maxAmountMinor: Number(PRICE_NOW),
    currency: "TRY",
  });
  const kid = decodeProtectedHeader(mandate).kid;
  check(
    jwks.keys.some((k) => k.kid === kid),
    `JWKS'te kid ${kid} yok`
  );
  const ok = await verifyMandate(mandate, { jwks, audience: intent.audience });
  check(ok.valid, `geçerli mandate reddedildi: ${ok.valid ? "" : ok.error}`);
  check(
    ok.claims.sub === user.id && ok.claims.maxAmountMinor === claims.maxAmountMinor,
    "doğrulanan claim'ler imzalananla aynı değil"
  );
  const platform = await verifyMandateToken(mandate);
  check(platform.nonce === claims.nonce, "platform doğrulaması farklı nonce döndü");

  // Kurcalanmış (limit ×10), yanlış hedef kitle ve HS256 sahtesi reddedilir.
  const tampered = await verifyMandate(
    tamperPayload(mandate, { maxAmountMinor: claims.maxAmountMinor * 10 }),
    { jwks, audience: intent.audience }
  );
  check(!tampered.valid, "kurcalanmış mandate kabul edildi");
  const wrongAud = await verifyMandate(mandate, { jwks, audience: "baska-platform" });
  check(!wrongAud.valid, "yanlış audience kabul edildi");
  const hs256 = await new SignJWT({ maxAmountMinor: claims.maxAmountMinor })
    .setProtectedHeader({ alg: "HS256", typ: intent.typ, kid })
    .setSubject(user.id)
    .setAudience(intent.audience)
    .setIssuer("booking-platform")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(`demo-sahte-sir-${RUN}-uzun-anahtar-degeri`));
  const forged = await verifyMandate(hs256, { jwks, audience: intent.audience });
  check(!forged.valid, "HS256 sahte mandate kabul edildi");
  return {
    ok: true,
    detail:
      `UCP → jwks_uri ${intent.jwks_uri.slice(DEMO_ORIGIN.length)}, alg ${intent.alg}; OpenAPI'de ` +
      `${required.length} keşif/ajan yolu ✓; JWKS ${jwks.keys.length} anahtar, kid ${kid}; ` +
      `geçerli mandate ✓ (üçüncü taraf + platform); kurcalanmış → ` +
      `${tampered.valid ? "?" : tampered.error}, yanlış aud → ${wrongAud.valid ? "?" : wrongAud.error}, ` +
      `HS256 → ${forged.valid ? "?" : forged.error}`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// 20) İndirim referans fiyatı: TR (10 gün) vs AB (30 gün)
// ---------------------------------------------------------------------------

async function priceHistoryStay(
  tag: string,
  location?: NonNullable<Parameters<typeof demoStay>[1]>["location"]
) {
  const stay = await demoStay(tag, { nightlyMinor: PRICE_NOW, location });
  const roomTypeId = stay.roomIds[0]!;
  const now = Date.now();
  // Geçmiş fiyat değişiklikleri (tetik yalnız bugünkü yazımı kaydeder → geriye tarihli satırlar).
  await db().inventoryPriceHistory.createMany({
    data: [STAY_START, STAY_START + 1].flatMap((d) => [
      {
        roomTypeId,
        date: utcDay(d),
        priceMinor: PRICE_25D_AGO,
        effectiveAt: new Date(now - DAYS_AGO_LOW * DAY),
      },
      {
        roomTypeId,
        date: utcDay(d),
        priceMinor: PRICE_15D_AGO,
        effectiveAt: new Date(now - DAYS_AGO_HIGH * DAY),
      },
    ]),
  });
  return stay;
}

const STAY_START = 45;

async function scenarioDiscountReference(): Promise<V4Outcome> {
  const t = touched();
  const trRules = marketRulesFor("Türkiye");
  const euRules = marketRulesFor("DE");
  check(
    trRules.market === "TR" && euRules.market === "EU",
    `pazar ${trRules.market}/${euRules.market}`
  );
  check(
    trRules.discountReferenceDays < DAYS_AGO_HIGH && euRules.discountReferenceDays > DAYS_AGO_LOW,
    `pencereler TR ${trRules.discountReferenceDays} / AB ${euRules.discountReferenceDays} gün`
  );

  const tr = await priceHistoryStay("indirim-tr");
  const eu = await priceHistoryStay("indirim-ab", {
    city: "Demo Senaryo AB",
    country: "DE",
    latitude: 52.52,
    longitude: 13.4,
  });
  const nights = [STAY_START, STAY_START + 1].map((d) => ({
    date: parseIsoDate(iso(utcDay(d))),
    baseMinor: Number(PRICE_NOW),
  }));
  const now = new Date();
  const trRef = await lowestNightInputs(
    tr.roomIds[0]!,
    nights,
    now,
    trRules.discountReferenceDays,
    trRules.previousPriceRule
  );
  const euRef = await lowestNightInputs(
    eu.roomIds[0]!,
    nights,
    now,
    euRules.discountReferenceDays,
    euRules.previousPriceRule
  );
  // TR: 10 günlük pencere başında 200.000 yürürlükteydi, bugün 150.000 → en düşük 150.000
  // (üstü çizili "önceki fiyat" gösterilemez). AB: 30 gün içinde 100.000 uygulandı → 100.000.
  check(
    trRef.every((n) => n.baseMinor === Number(PRICE_NOW)),
    `TR referans ${trRef.map((n) => n.baseMinor).join(",")}`
  );
  check(
    euRef.every((n) => n.baseMinor === Number(PRICE_25D_AGO)),
    `AB referans ${euRef.map((n) => n.baseMinor).join(",")}`
  );

  const quote = (stay: DemoStay) =>
    computeTotal({
      roomId: stay.roomIds[0]!,
      propertyId: stay.propertyId,
      checkIn: iso(utcDay(STAY_START)),
      checkOut: iso(utcDay(STAY_START + 2)),
      guests: 1,
    });
  const trQuote = await quote(tr);
  const euQuote = await quote(eu);
  check(
    trQuote.omnibusDays === trRules.discountReferenceDays,
    `TR teklif ${trQuote.omnibusDays} gün`
  );
  check(
    euQuote.omnibusDays === euRules.discountReferenceDays,
    `AB teklif ${euQuote.omnibusDays} gün`
  );
  check(
    trQuote.lowestPrice30dMinor >= trQuote.total,
    `TR referans ${trQuote.lowestPrice30dMinor} < toplam ${trQuote.total}`
  );
  check(
    euQuote.lowestPrice30dMinor < euQuote.total,
    `AB referans ${euQuote.lowestPrice30dMinor} ≥ toplam ${euQuote.total}`
  );
  return {
    ok: true,
    detail:
      `fiyat geçmişi: −${DAYS_AGO_LOW} gün ${PRICE_25D_AGO}, −${DAYS_AGO_HIGH} gün ` +
      `${PRICE_15D_AGO}, bugün ${PRICE_NOW}; TR (${trRules.discountReferenceDays} gün) gece ` +
      `referansı ${trRef[0]!.baseMinor}, teklif referansı ${trQuote.lowestPrice30dMinor} ≥ toplam ` +
      `${trQuote.total}; AB (${euRules.discountReferenceDays} gün) gece referansı ` +
      `${euRef[0]!.baseMinor}, teklif referansı ${euQuote.lowestPrice30dMinor} < toplam ${euQuote.total}`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------

/** v5 senaryoları "Demo v5 …" etiketiyle veri kurar; bitince v4 etiketine döner. */
const labelled = (run: () => Promise<V4Outcome>) => async (): Promise<V4Outcome> => {
  setDemoLabel("v5");
  try {
    return await run();
  } finally {
    setDemoLabel("v4");
  }
};

export const V5_SCENARIOS: V4Scenario[] = [
  {
    id: 15,
    key: "rnpl",
    title: "RNPL: zamanında tahsilat + başarısız tahsilat → ek süre sonunda iptal",
    run: labelled(scenarioRnpl),
  },
  {
    id: 16,
    key: "telafi",
    title: "Sepet onay hatası → telafi iadesi jurnalde → mutabakat temiz",
    run: labelled(scenarioCartCompensation),
  },
  {
    id: 17,
    key: "kyc",
    title: "KYC'siz devir satıcısı: payout doğrulamaya kadar bekler",
    run: labelled(scenarioTransferKyc),
  },
  {
    id: 18,
    key: "destek",
    title: "Destek ajanı: para talebi / insan isteği → talep, iade yok",
    run: labelled(scenarioSupportHandoff),
  },
  {
    id: 19,
    key: "mandate",
    title: "Üçüncü taraf mandate doğrulaması (JWKS) + OpenAPI/UCP keşfi",
    run: labelled(scenarioMandateDiscovery),
  },
  {
    id: 20,
    key: "omnibus",
    title: "İndirim referans fiyatı: TR 10 gün vs AB 30 gün",
    run: labelled(scenarioDiscountReference),
  },
];
