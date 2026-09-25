import { Prisma } from "@prisma/client";
import { toDbDate, type IsoDate } from "@/lib/time/nights";

/**
 * Sayaçlı envanter (v3 P0-2, ADR 0010).
 *
 * `InventoryDay(roomTypeId, date)` satırında `total` (satılabilir oda), `held` (ödeme
 * bekleyen tutmalar) ve `sold` (onaylı + harici kanal) tutulur; veritabanı kısıtı
 * `sold + held <= total`'dır. Tüm hareketler KOŞULLU tek SQL ifadesidir ve etkilenen satır
 * sayısı gece sayısıyla karşılaştırılır: eksikse (bir gece dolu / satır yok) çağıran işlem
 * geri alınır. Hareketler rezervasyonun durum geçişiyle AYNI işlemde yapılır; durum geçişi
 * `status + version` koşullu olduğundan her hareket rezervasyon başına tam bir kez uygulanır.
 */

export interface StayRef {
  roomTypeId: string;
  checkIn: IsoDate | Date;
  checkOut: IsoDate | Date;
  units: number;
}

export class InventoryUnavailableError extends Error {
  constructor(
    readonly nightsUpdated: number,
    readonly nightsWanted: number
  ) {
    super(`Envanter yetersiz (${nightsUpdated}/${nightsWanted} gece)`);
    this.name = "InventoryUnavailableError";
  }
}

function range(stay: StayRef): { from: Date; to: Date } {
  const from = stay.checkIn instanceof Date ? stay.checkIn : toDbDate(stay.checkIn);
  const to = stay.checkOut instanceof Date ? stay.checkOut : toDbDate(stay.checkOut);
  return { from, to };
}

function nightCount(stay: StayRef): number {
  const { from, to } = range(stay);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function assertCount(updated: number, stay: StayRef): void {
  const wanted = nightCount(stay);
  if (updated !== wanted) throw new InventoryUnavailableError(updated, wanted);
}

/** Tutma: her gece için `held += units`, yalnızca yer varsa. */
export async function holdUnits(tx: Prisma.TransactionClient, stay: StayRef): Promise<void> {
  const { from, to } = range(stay);
  const updated = await tx.$executeRaw`
    UPDATE "InventoryDay" SET held = held + ${stay.units}
    WHERE "roomTypeId" = ${stay.roomTypeId} AND date >= ${from} AND date < ${to}
      AND sold + held + ${stay.units} <= total`;
  assertCount(updated, stay);
}

/** Onay: tutulan birimler satılana taşınır (`held −= u`, `sold += u`). */
export async function commitHeld(tx: Prisma.TransactionClient, stay: StayRef): Promise<void> {
  const { from, to } = range(stay);
  const updated = await tx.$executeRaw`
    UPDATE "InventoryDay" SET held = held - ${stay.units}, sold = sold + ${stay.units}
    WHERE "roomTypeId" = ${stay.roomTypeId} AND date >= ${from} AND date < ${to}
      AND held >= ${stay.units}`;
  assertCount(updated, stay);
}

/** Süresi dolan / iptal edilen tutmanın iadesi. */
export async function releaseHeld(tx: Prisma.TransactionClient, stay: StayRef): Promise<void> {
  const { from, to } = range(stay);
  const updated = await tx.$executeRaw`
    UPDATE "InventoryDay" SET held = held - ${stay.units}
    WHERE "roomTypeId" = ${stay.roomTypeId} AND date >= ${from} AND date < ${to}
      AND held >= ${stay.units}`;
  assertCount(updated, stay);
}

/** Onaylı rezervasyon iptalinde satılan birimlerin iadesi. */
export async function releaseSold(tx: Prisma.TransactionClient, stay: StayRef): Promise<void> {
  const { from, to } = range(stay);
  const updated = await tx.$executeRaw`
    UPDATE "InventoryDay" SET sold = sold - ${stay.units}
    WHERE "roomTypeId" = ${stay.roomTypeId} AND date >= ${from} AND date < ${to}
      AND sold >= ${stay.units}`;
  assertCount(updated, stay);
}

/**
 * Rezervasyonun ÖNCEKİ durumuna göre envanter iadesi: HELD/PENDING → held, CONFIRMED → sold.
 * Diğer durumlarda (zaten iade edilmiş) hiçbir şey yapmaz.
 */
export async function releaseForStatus(
  tx: Prisma.TransactionClient,
  status: string,
  stay: StayRef
): Promise<void> {
  if (status === "HELD" || status === "PENDING") return releaseHeld(tx, stay);
  if (status === "CONFIRMED") return releaseSold(tx, stay);
}

/** Bir gecede kalan satılabilir oda. */
export function remaining(row: { total: number; sold: number; held: number }): number {
  return Math.max(0, row.total - row.sold - row.held);
}
