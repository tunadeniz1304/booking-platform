import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ValidationError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getPushSettings } from "@/lib/push/config";
import {
  countPushSubscriptions,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push/subscriptions";

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Geçersiz JSON gövdesi");
  }
}

/** Push durumu: sunucu açık mı (VAPID), açık anahtar ve kullanıcının abonelik sayısı. */
export const GET = observed("push.subscription.get", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const settings = getPushSettings();
    return NextResponse.json({
      enabled: settings.enabled,
      publicKey: settings.enabled ? settings.publicKey : null,
      reason: settings.enabled ? null : settings.reason,
      subscriptions: await countPushSubscriptions(userId),
    });
  } catch (error) {
    return toErrorResponse(error, "push.subscription.get");
  }
});

/** Abone ol (tarayıcı `PushSubscription.toJSON()` + dil). Oturumdaki kullanıcıya yazılır. */
export const POST = observed(
  "push.subscription.create",
  async function postHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      const saved = await savePushSubscription(
        userId,
        await readJson(req),
        req.headers.get("user-agent")
      );
      return NextResponse.json(saved, { status: 201 });
    } catch (error) {
      return toErrorResponse(error, "push.subscription.create");
    }
  }
);

/** Abonelikten çık: yalnızca kendi uç noktası (başkasınınki 404). */
export const DELETE = observed(
  "push.subscription.delete",
  async function deleteHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      await removePushSubscription(userId, await readJson(req));
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      return toErrorResponse(error, "push.subscription.delete");
    }
  }
);

export const dynamic = "force-dynamic";
