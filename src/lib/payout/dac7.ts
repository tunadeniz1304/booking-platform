import { createHash } from "crypto";
import { JournalKinds } from "@/lib/ledger";
import { minorToDecimalString } from "@/lib/money/currencies";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/http/errors";

/**
 * AB DAC7 (Konsey Direktifi 2021/514) benzeri platform operatörü raporu — EĞİTİM AMAÇLI,
 * resmî XML şeması değildir. Kaynak çift girişli defterdir: bir rezervasyonun ev sahibine
 * "ödenen veya alacaklandırılan" bedeli emanetin serbest bırakıldığı anda (`ESCROW_RELEASED`)
 * doğar; serbest bırakma sonrası iadeler aynı çeyrekte bedelden ve komisyondan düşülür.
 *
 * Alan adları DAC7 DPI XML'inden türetilmiştir: `Consideration`, `Fees`, `NumberOfActivities`
 * (çeyreklik), `NumberOfDaysRented` (taşınmaz kiralama), `CurrCode`.
 *
 * Kişisel veri minimizasyonu: yalnızca raporlama için gereken kimlik alanları (ad + iç
 * kullanıcı referansı) — e-posta, telefon, adres, doğum tarihi YOK; vergi no tutulmadığı için
 * `NOTIN`. `pseudonymize` → kullanıcı referansı tuzlu özetle değiştirilir ve ad çıkarılır.
 */

export interface Dac7Activity {
  hostId: string;
  bookingId: string;
  propertyId: string;
  currency: string;
  occurredAt: Date;
  /** Ev sahibine alacaklandırılan brüt bedel (vergi hariç, komisyon dahil); iade negatif. */
  considerationMinor: bigint;
  /** Platformun kestiği komisyon; iade düzeltmesi negatif. */
  feeMinor: bigint;
  /** Serbest bırakma satırı: 1 işlem + gece sayısı. İade düzeltmesinde 0. */
  activity: boolean;
  nights: number;
}

export interface Dac7Seller {
  name: string | null;
}

type Quarterly<T> = { q1: T; q2: T; q3: T; q4: T; total: T };

export interface Dac7ReportableSeller {
  sellerRef: string;
  identity: { name: string | null; tin: "NOTIN" };
  currCode: string;
  consideration: Quarterly<string>;
  fees: Quarterly<string>;
  numberOfActivities: Quarterly<number>;
  numberOfDaysRented: number;
  propertyCount: number;
}

export interface Dac7Report {
  messageSpec: {
    messageType: "DPI";
    messageRefId: string;
    reportingPeriod: string;
    timestamp: string;
    disclaimer: string;
  };
  reportableSellers: Dac7ReportableSeller[];
}

export function assertYear(value: string | number): number {
  const year = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError("Yıl 2000–2100 arasında bir tamsayı olmalı");
  }
  return year;
}

function quarterOf(d: Date): 0 | 1 | 2 | 3 {
  return Math.floor(d.getUTCMonth() / 3) as 0 | 1 | 2 | 3;
}

function pseudonym(hostId: string, salt: string): string {
  return `seller_${createHash("sha256").update(`${salt}:${hostId}`).digest("hex").slice(0, 16)}`;
}

/** Saf rapor üretici (DB'siz → snapshot testi). Satıcılar ve para birimleri sıralıdır. */
export function buildDac7Report(
  year: number,
  activities: readonly Dac7Activity[],
  sellers: ReadonlyMap<string, Dac7Seller>,
  opts: { timestamp: Date; pseudonymize?: boolean; salt?: string }
): Dac7Report {
  const salt = opts.salt ?? `dac7-${year}`;
  type Acc = {
    hostId: string;
    currency: string;
    cons: bigint[];
    fees: bigint[];
    acts: number[];
    days: number;
    props: Set<string>;
  };
  const groups = new Map<string, Acc>();
  for (const a of activities) {
    if (a.occurredAt.getUTCFullYear() !== year) continue;
    const key = `${a.hostId}\u0000${a.currency}`;
    const g = groups.get(key) ?? {
      hostId: a.hostId,
      currency: a.currency,
      cons: [0n, 0n, 0n, 0n],
      fees: [0n, 0n, 0n, 0n],
      acts: [0, 0, 0, 0],
      days: 0,
      props: new Set<string>(),
    };
    const q = quarterOf(a.occurredAt);
    g.cons[q] += a.considerationMinor;
    g.fees[q] += a.feeMinor;
    if (a.activity) {
      g.acts[q] += 1;
      g.days += a.nights;
      g.props.add(a.propertyId);
    }
    groups.set(key, g);
  }
  const money = (v: bigint[], c: string): Quarterly<string> => ({
    q1: minorToDecimalString(v[0], c),
    q2: minorToDecimalString(v[1], c),
    q3: minorToDecimalString(v[2], c),
    q4: minorToDecimalString(v[3], c),
    total: minorToDecimalString(
      v.reduce((s, x) => s + x, 0n),
      c
    ),
  });
  const reportableSellers = [...groups.values()]
    .map((g): Dac7ReportableSeller => {
      const sellerRef = opts.pseudonymize ? pseudonym(g.hostId, salt) : g.hostId;
      return {
        sellerRef,
        identity: {
          name: opts.pseudonymize ? null : (sellers.get(g.hostId)?.name ?? null),
          tin: "NOTIN",
        },
        currCode: g.currency,
        consideration: money(g.cons, g.currency),
        fees: money(g.fees, g.currency),
        numberOfActivities: {
          q1: g.acts[0],
          q2: g.acts[1],
          q3: g.acts[2],
          q4: g.acts[3],
          total: g.acts.reduce((s, x) => s + x, 0),
        },
        numberOfDaysRented: g.days,
        propertyCount: g.props.size,
      };
    })
    .sort((a, b) =>
      a.sellerRef === b.sellerRef
        ? a.currCode.localeCompare(b.currCode)
        : a.sellerRef.localeCompare(b.sellerRef)
    );
  const refHash = createHash("sha256")
    .update(JSON.stringify(reportableSellers))
    .digest("hex")
    .slice(0, 12);
  return {
    messageSpec: {
      messageType: "DPI",
      messageRefId: `DAC7-${year}-${refHash}`,
      reportingPeriod: `${year}-12-31`,
      timestamp: opts.timestamp.toISOString(),
      disclaimer:
        "Portföy projesi — eğitim amaçlı DAC7 benzeri çıktı; resmî beyan veya hukuki tavsiye değildir.",
    },
    reportableSellers,
  };
}

export const DAC7_CSV_HEADER = [
  "SellerRef",
  "Name",
  "TIN",
  "CurrCode",
  "ConsiderationQ1",
  "ConsiderationQ2",
  "ConsiderationQ3",
  "ConsiderationQ4",
  "ConsiderationTotal",
  "FeesQ1",
  "FeesQ2",
  "FeesQ3",
  "FeesQ4",
  "FeesTotal",
  "NumberOfActivitiesQ1",
  "NumberOfActivitiesQ2",
  "NumberOfActivitiesQ3",
  "NumberOfActivitiesQ4",
  "NumberOfActivitiesTotal",
  "NumberOfDaysRented",
  "PropertyCount",
] as const;

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  // CSV enjeksiyonu (=,+,-,@ ile başlayan metin) ve ayırıcılar kaçışlanır.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toDac7Csv(report: Dac7Report): string {
  const lines = [DAC7_CSV_HEADER.join(",")];
  for (const s of report.reportableSellers) {
    const q = (x: Quarterly<string | number>) => [x.q1, x.q2, x.q3, x.q4, x.total];
    lines.push(
      [
        s.sellerRef,
        s.identity.name,
        s.identity.tin,
        s.currCode,
        ...q(s.consideration),
        ...q(s.fees),
        ...q(s.numberOfActivities),
        s.numberOfDaysRented,
        s.propertyCount,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

const DAY_MS = 86_400_000;

/**
 * Yılın DAC7 hareketleri jurnalden: serbest bırakmalar (+ gece) ve serbest bırakılmış
 * rezervasyonların iadeleri (bedel ve komisyon düzeltmesi, negatif).
 */
export async function loadDac7Activities(
  year: number,
  opts: { hostIds?: string[] } = {}
): Promise<{ activities: Dac7Activity[]; sellers: Map<string, Dac7Seller> }> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const entries = await prisma.journalEntry.findMany({
    where: {
      occurredAt: { gte: from, lt: to },
      kind: { in: [JournalKinds.EscrowReleased, JournalKinds.RefundIssued] },
      bookingId: { not: null },
    },
    select: {
      kind: true,
      bookingId: true,
      occurredAt: true,
      lines: {
        select: {
          side: true,
          amountMinor: true,
          currency: true,
          account: { select: { kind: true, ownerId: true } },
        },
      },
    },
    orderBy: { occurredAt: "asc" },
  });
  const bookingIds = [...new Set(entries.map((e) => e.bookingId!))];
  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, propertyId: true, checkIn: true, checkOut: true },
  });
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const activities: Dac7Activity[] = [];
  for (const e of entries) {
    const b = byId.get(e.bookingId!);
    if (!b) continue;
    const hostLine = e.lines.find(
      (l) => l.account.kind === "HOST_PAYABLE" || l.account.kind === "HOST_RESERVE"
    );
    // Yalnızca ev sahibi bakiyesine dokunan kayıtlar (emanetten iade DAC7 bedeli değildir).
    if (!hostLine?.account.ownerId) continue;
    const fee = e.lines
      .filter((l) => l.account.kind === "PLATFORM_REVENUE")
      .reduce((s, l) => s + l.amountMinor, 0n);
    if (e.kind === JournalKinds.EscrowReleased) {
      const gross = e.lines
        .filter((l) => l.account.kind === "ESCROW" && l.side === "DEBIT")
        .reduce((s, l) => s + l.amountMinor, 0n);
      activities.push({
        hostId: hostLine.account.ownerId,
        bookingId: b.id,
        propertyId: b.propertyId,
        currency: hostLine.currency,
        occurredAt: e.occurredAt,
        considerationMinor: gross,
        feeMinor: fee,
        activity: true,
        nights: Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / DAY_MS),
      });
    } else {
      const hostPart = e.lines
        .filter((l) => l.account.kind === "HOST_PAYABLE" && l.side === "DEBIT")
        .reduce((s, l) => s + l.amountMinor, 0n);
      activities.push({
        hostId: hostLine.account.ownerId,
        bookingId: b.id,
        propertyId: b.propertyId,
        currency: hostLine.currency,
        occurredAt: e.occurredAt,
        considerationMinor: -(hostPart + fee),
        feeMinor: -fee,
        activity: false,
        nights: 0,
      });
    }
  }
  const filtered = opts.hostIds
    ? activities.filter((a) => opts.hostIds!.includes(a.hostId))
    : activities;
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(filtered.map((a) => a.hostId))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const sellers = new Map(
    users.map((u) => [u.id, { name: `${u.firstName} ${u.lastName}`.trim() || null }])
  );
  return { activities: filtered, sellers };
}
