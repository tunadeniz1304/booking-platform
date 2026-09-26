import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import {
  depositSettingSchema,
  listDepositSettings,
  setDepositSetting,
} from "@/lib/resolution/deposit";

/** Host: ilan geneli + oda tipi başına hasar depozitosu tutarları (P1-5). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(await listDepositSettings(actor, id));
  } catch (error) {
    return toErrorResponse(error, "host.deposit.list");
  }
}

/** Host: depozito tutarını ayarla (`amountMinor: null` → kaldır). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const parsed = depositSettingSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Geçersiz depozito", parsed.error.flatten());
    return NextResponse.json({ setting: await setDepositSetting(actor, id, parsed.data) });
  } catch (error) {
    return toErrorResponse(error, "host.deposit.set");
  }
}

export const dynamic = "force-dynamic";
