import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assertBalanced,
  bookingCaptured,
  creditIssued,
  creditSpent,
  escrowHeld,
  escrowReleased,
  LedgerError,
  linesHash,
  payoutReleased,
  refundIssued,
  transferSettled,
  type JournalInput,
  type JournalLineInput,
} from "@/lib/ledger";
import { accountCode, isDebitNormal } from "@/lib/ledger/accounts";
import { dayWindow } from "@/lib/ledger/reconcile";
import { toMinorBigint } from "@/lib/ledger/legacy";

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
const amount = fc.bigInt({ min: 1n, max: 10n ** 12n });
const currency = fc.constantFrom(...CURRENCIES);
const id = fc.stringMatching(/^[a-z0-9]{4,12}$/);

/** Toplamı ve toplamın altında kalan iki parçayı üretir (split ≤ total garantili). */
const split = amount.chain((total) =>
  fc.tuple(fc.bigInt({ min: 0n, max: total }), fc.bigInt({ min: 0n, max: total })).map(([a, b]) => {
    const first = a;
    const second = b > total - first ? total - first : b;
    return { total, first, second };
  })
);

function net(lines: readonly JournalLineInput[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const l of lines) {
    out.set(
      l.currency,
      (out.get(l.currency) ?? 0n) + (l.side === "DEBIT" ? l.amountMinor : -l.amountMinor)
    );
  }
  return out;
}

function expectBalanced(entry: JournalInput) {
  expect(() => assertBalanced(entry.lines)).not.toThrow();
  for (const v of net(entry.lines).values()) expect(v).toBe(0n);
  for (const l of entry.lines) expect(l.amountMinor > 0n).toBe(true);
}

/** Rastgele şablon üreteci — tüm şablonlar tek havuzda. */
const anyTemplate: fc.Arbitrary<JournalInput> = fc.oneof(
  fc.record({ s: split, c: currency, p: id, b: id }).map(({ s, c, p, b }) =>
    bookingCaptured({
      bookingId: b,
      paymentId: p,
      currency: c,
      grossMinor: s.total,
      taxMinor: s.first,
    })
  ),
  fc
    .record({ a: amount, c: currency, r: id })
    .map(({ a, c, r }) => escrowHeld({ reference: r, currency: c, amountMinor: a })),
  fc.record({ s: split, c: currency, b: id, h: id }).map(({ s, c, b, h }) =>
    escrowReleased({
      bookingId: b,
      hostId: h,
      currency: c,
      amountMinor: s.total,
      platformFeeMinor: s.first,
    })
  ),
  fc
    .record({
      s: split,
      c: currency,
      r: id,
      g: id,
      h: id,
      from: fc.constantFrom("escrow" as const, "released" as const),
      to: fc.constantFrom("psp" as const, "guest_credit" as const),
    })
    .map(({ s, c, r, g, h, from, to }) =>
      refundIssued({
        refundRef: r,
        bookingId: "b",
        guestId: g,
        hostId: h,
        currency: c,
        amountMinor: s.total,
        taxMinor: s.first,
        platformFeeMinor: from === "released" ? s.second : 0n,
        from,
        to,
      })
    ),
  fc
    .record({ a: amount, c: currency, p: id, u: id })
    .map(({ a, c, p, u }) =>
      payoutReleased({ payoutId: p, payeeId: u, currency: c, amountMinor: a })
    ),
  fc.record({ s: split, c: currency, t: id, u: id }).map(({ s, c, t, u }) =>
    transferSettled({
      transferId: t,
      bookingId: "b",
      sellerId: u,
      currency: c,
      askMinor: s.total,
      platformFeeMinor: s.first,
    })
  ),
  fc
    .record({
      a: amount,
      c: currency,
      r: id,
      g: id,
      f: fc.constantFrom("platform" as const, "escrow" as const),
    })
    .map(({ a, c, r, g, f }) =>
      creditIssued({ creditRef: r, guestId: g, currency: c, amountMinor: a, fundedBy: f })
    ),
  fc.record({ s: split, c: currency, r: id, g: id }).map(({ s, c, r, g }) =>
    creditSpent({
      spendRef: r,
      guestId: g,
      bookingId: "b",
      currency: c,
      amountMinor: s.total,
      taxMinor: s.first,
    })
  )
);

describe("P0-3 defter şablonları — Σborç = Σalacak (property)", () => {
  it("her şablon her rastgele girdide dengeli ve pozitif satırlı", () => {
    fc.assert(fc.property(anyTemplate, expectBalanced), { numRuns: 800 });
  });

  it("rastgele şablon kombinasyonu (çok para birimli) toplamda dengeli; mizan sıfırlanır", () => {
    fc.assert(
      fc.property(fc.array(anyTemplate, { minLength: 1, maxLength: 30 }), (entries) => {
        const all = entries.flatMap((e) => e.lines);
        expect(() => assertBalanced(all)).not.toThrow();
        // Hesap bazında doğal bakiyelerin işaretli toplamı da para birimi başına sıfır.
        const perAccount = new Map<string, bigint>();
        for (const l of all) {
          const k = `${accountCode(l.account)}|${l.currency}`;
          perAccount.set(
            k,
            (perAccount.get(k) ?? 0n) + (l.side === "DEBIT" ? l.amountMinor : -l.amountMinor)
          );
        }
        const byCurrency = new Map<string, bigint>();
        for (const [k, v] of perAccount) {
          const cur = k.split("|")[1];
          byCurrency.set(cur, (byCurrency.get(cur) ?? 0n) + v);
        }
        for (const v of byCurrency.values()) expect(v).toBe(0n);
      }),
      { numRuns: 300 }
    );
  });

  it("tam yaşam döngüsü: capture → release → payout sonrası emanet ve takas hesabı dengelenir", () => {
    fc.assert(
      fc.property(split, currency, (s, c) => {
        const gross = s.total;
        const tax = s.first;
        const fee = s.second;
        const flow = [
          bookingCaptured({
            bookingId: "b",
            paymentId: "p",
            currency: c,
            grossMinor: gross,
            taxMinor: tax,
          }),
        ];
        const held = gross - tax;
        if (held > 0n) {
          flow.push(
            escrowReleased({
              bookingId: "b",
              hostId: "h",
              currency: c,
              amountMinor: held,
              platformFeeMinor: fee > held ? held : fee,
            })
          );
          const hostNet = held - (fee > held ? held : fee);
          if (hostNet > 0n)
            flow.push(
              payoutReleased({ payoutId: "po", payeeId: "h", currency: c, amountMinor: hostNet })
            );
        }
        const bal = new Map<string, bigint>();
        for (const l of flow.flatMap((e) => e.lines)) {
          const code = accountCode(l.account);
          const sign = isDebitNormal(l.account.kind) === (l.side === "DEBIT") ? 1n : -1n;
          bal.set(code, (bal.get(code) ?? 0n) + sign * l.amountMinor);
        }
        expect(bal.get("escrow") ?? 0n).toBe(0n);
        expect(bal.get("host_payable:h") ?? 0n).toBe(0n);
        // Takas hesabında kalan = vergi + platform komisyonu (henüz dağıtılmamış).
        expect(bal.get("psp_clearing") ?? 0n).toBe(
          (bal.get("tax_payable") ?? 0n) + (bal.get("platform_revenue") ?? 0n)
        );
      }),
      { numRuns: 300 }
    );
  });
});

describe("assertBalanced / şablon doğrulaması", () => {
  const line = (side: "DEBIT" | "CREDIT", amountMinor: bigint, cur = "TRY"): JournalLineInput => ({
    account: { kind: "PSP_CLEARING" },
    side,
    amountMinor,
    currency: cur,
  });

  it("dengesiz, tek satırlı, sıfır/negatif tutarlı ve bilinmeyen para birimli jurnali reddeder", () => {
    expect(() => assertBalanced([line("DEBIT", 100n), line("CREDIT", 99n)])).toThrow(LedgerError);
    expect(() => assertBalanced([line("DEBIT", 100n)])).toThrow(/en az iki/);
    expect(() => assertBalanced([line("DEBIT", 0n), line("CREDIT", 0n)])).toThrow(/pozitif/);
    expect(() => assertBalanced([line("DEBIT", -5n), line("CREDIT", -5n)])).toThrow(/pozitif/);
    expect(() => assertBalanced([line("DEBIT", 5n, "XXX"), line("CREDIT", 5n, "XXX")])).toThrow(
      /para birimi/
    );
    // Para birimi başına denge: TRY borç ile USD alacak birbirini kapatmaz.
    expect(() => assertBalanced([line("DEBIT", 5n, "TRY"), line("CREDIT", 5n, "USD")])).toThrow(
      /dengesiz/
    );
    try {
      assertBalanced([line("DEBIT", 1n), line("CREDIT", 2n)]);
    } catch (e) {
      expect((e as LedgerError).code).toBe("LEDGER_UNBALANCED");
      expect((e as LedgerError).status).toBe(500);
    }
  });

  it("bölüşüm tutarı aşarsa veya tutar sıfır/negatifse 422", () => {
    const bad = [
      () =>
        bookingCaptured({
          bookingId: "b",
          paymentId: "p",
          currency: "TRY",
          grossMinor: 100n,
          taxMinor: 101n,
        }),
      () => bookingCaptured({ bookingId: "b", paymentId: "p", currency: "TRY", grossMinor: 0n }),
      () =>
        escrowReleased({
          bookingId: "b",
          hostId: "h",
          currency: "TRY",
          amountMinor: 10n,
          platformFeeMinor: -1n,
        }),
      () =>
        refundIssued({
          refundRef: "r",
          bookingId: "b",
          guestId: "g",
          currency: "TRY",
          amountMinor: 10n,
          from: "released",
        }),
      () => payoutReleased({ payoutId: "p", payeeId: "u", currency: "TRY", amountMinor: -1n }),
    ];
    for (const fn of bad) {
      try {
        fn();
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerError);
        expect((e as LedgerError).status).toBe(422);
      }
    }
  });

  it("sıfır vergi/komisyon satırları atlanır; idempotency anahtarları doğal anahtardan türer", () => {
    const e = bookingCaptured({
      bookingId: "b1",
      paymentId: "p1",
      currency: "TRY",
      grossMinor: 500n,
    });
    expect(e.lines).toHaveLength(2);
    expect(e.idempotencyKey).toBe("booking-captured:p1");
    expect(
      refundIssued({
        refundRef: "re_1",
        bookingId: "b",
        guestId: "g",
        currency: "TRY",
        amountMinor: 1n,
        from: "escrow",
        to: "guest_credit",
      }).lines.map((l) => accountCode(l.account))
    ).toEqual(["escrow", "guest_credit:g"]);
  });

  it("linesHash satır sırasından bağımsız, içerik değişince değişir", () => {
    const a = [line("DEBIT", 5n), { ...line("CREDIT", 5n), account: { kind: "ESCROW" as const } }];
    expect(linesHash("K", a)).toBe(linesHash("K", [...a].reverse()));
    expect(linesHash("K", a)).not.toBe(linesHash("K2", a));
    expect(linesHash("K", a)).not.toBe(
      linesHash("K", [line("DEBIT", 6n), { ...a[1], amountMinor: 6n }])
    );
  });

  it("dayWindow UTC gününü verir, geçersiz tarihi reddeder; toMinorBigint Decimal/bigint kabul eder", () => {
    const w = dayWindow("2031-02-28");
    expect(w.from.toISOString()).toBe("2031-02-28T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2031-03-01T00:00:00.000Z");
    expect(dayWindow(new Date("2031-02-28T13:00:00Z")).date).toBe("2031-02-28");
    expect(() => dayWindow("2031-02-30")).toThrow(RangeError);
    expect(() => dayWindow("dün")).toThrow(RangeError);
    expect(toMinorBigint("1234.56", "TRY")).toBe(123456n);
    expect(toMinorBigint(42n, "TRY")).toBe(42n);
  });
});
