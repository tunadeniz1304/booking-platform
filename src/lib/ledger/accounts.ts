import { type LedgerAccountKind, type Prisma } from "@prisma/client";

/**
 * Hesap planı (P0-3, ADR 0020). Varlık hesapları borç-doğal, yükümlülük/gelir hesapları
 * alacak-doğaldır; bakiye doğal yöne göre işaretlenir (pozitif = "normal").
 *
 * | kod               | tür        | anlamı                                                   |
 * |-------------------|------------|----------------------------------------------------------|
 * | psp_clearing      | varlık     | PSP'de tahsil edilmiş, henüz dağıtılmamış para           |
 * | guest_receivable  | varlık     | misafirden alacak (sonra-öde / kısmi tahsilat için ayrık) |
 * | escrow            | yükümlülük | konaklama tamamlanana kadar emanette tutulan tutar       |
 * | host_payable:<id> | yükümlülük | ev sahibine / devir satıcısına ödenecek                  |
 * | platform_revenue  | gelir      | platform komisyonu (kredi ikramı bu hesaptan düşer)      |
 * | tax_payable       | yükümlülük | tahsil edilen, devlete ödenecek vergi                    |
 * | guest_credit:<id> | yükümlülük | misafirin harcanabilir kredisi                           |
 */
export const DEBIT_NORMAL_KINDS: readonly LedgerAccountKind[] = [
  "PSP_CLEARING",
  "GUEST_RECEIVABLE",
];

export const ACCOUNT_NAMES: Record<LedgerAccountKind, string> = {
  GUEST_RECEIVABLE: "Misafir alacakları",
  PSP_CLEARING: "PSP takas hesabı",
  HOST_PAYABLE: "Ev sahibi / satıcı borçları",
  PLATFORM_REVENUE: "Platform geliri",
  TAX_PAYABLE: "Ödenecek vergiler",
  GUEST_CREDIT: "Misafir kredileri",
  ESCROW: "Emanet (escrow)",
};

/** Hesap başvurusu: sistem hesabı (`ownerId` yok) ya da kişi alt hesabı. */
export interface AccountRef {
  kind: LedgerAccountKind;
  ownerId?: string | null;
}

export const account = {
  pspClearing: (): AccountRef => ({ kind: "PSP_CLEARING" }),
  guestReceivable: (guestId?: string): AccountRef => ({
    kind: "GUEST_RECEIVABLE",
    ownerId: guestId,
  }),
  escrow: (): AccountRef => ({ kind: "ESCROW" }),
  hostPayable: (userId: string): AccountRef => ({ kind: "HOST_PAYABLE", ownerId: userId }),
  platformRevenue: (): AccountRef => ({ kind: "PLATFORM_REVENUE" }),
  taxPayable: (): AccountRef => ({ kind: "TAX_PAYABLE" }),
  guestCredit: (userId: string): AccountRef => ({ kind: "GUEST_CREDIT", ownerId: userId }),
};

/** Kanonik hesap kodu — DB'de `LedgerAccount_owner_code` CHECK'i ile aynı kural. */
export function accountCode(ref: AccountRef): string {
  const base = ref.kind.toLowerCase();
  return ref.ownerId ? `${base}:${ref.ownerId}` : base;
}

export function isDebitNormal(kind: LedgerAccountKind): boolean {
  return DEBIT_NORMAL_KINDS.includes(kind);
}

/**
 * Hesap kodlarını kimliğe çözer; eksik kişi alt hesaplarını açar. `createMany
 * skipDuplicates` (ON CONFLICT DO NOTHING) kullanılır: eşzamanlı açılış işlemi
 * düşürmez, SERIALIZABLE altında çakışma olursa `withSerializableRetry` yeniden dener.
 */
export async function resolveAccountIds(
  tx: Prisma.TransactionClient,
  refs: readonly AccountRef[]
): Promise<Map<string, string>> {
  const byCode = new Map<string, AccountRef>();
  for (const ref of refs) byCode.set(accountCode(ref), ref);
  const codes = [...byCode.keys()];
  const found = await tx.ledgerAccount.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const ids = new Map(found.map((a) => [a.code, a.id]));
  const missing = codes.filter((c) => !ids.has(c));
  if (missing.length > 0) {
    await tx.ledgerAccount.createMany({
      data: missing.map((code) => {
        const ref = byCode.get(code)!;
        return {
          code,
          kind: ref.kind,
          ownerId: ref.ownerId ?? null,
          name: ACCOUNT_NAMES[ref.kind],
        };
      }),
      skipDuplicates: true,
    });
    const created = await tx.ledgerAccount.findMany({
      where: { code: { in: missing } },
      select: { id: true, code: true },
    });
    for (const a of created) ids.set(a.code, a.id);
  }
  return ids;
}
