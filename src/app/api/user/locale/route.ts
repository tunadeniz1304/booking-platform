import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { LOCALES } from "@/i18n/config";

const bodySchema = z.object({ locale: z.enum(LOCALES) });

/**
 * Oturum açık kullanıcının dil tercihini saklar (P1-12): e-postalar bu dilde gönderilir.
 * Arayüz dili çerezden okunur; bu uç yalnızca kalıcı tercihi günceller.
 */
export const PUT = observed("user.locale", async function putHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { locale } = bodySchema.parse(await req.json());
    await prisma.user.update({ where: { id: userId }, data: { locale } });
    return NextResponse.json({ locale });
  } catch (error) {
    return toErrorResponse(error, "user.locale");
  }
});

export const dynamic = "force-dynamic";
