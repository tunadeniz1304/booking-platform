import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deletePasskey, listPasskeys } from "@/lib/auth/passkey";
import { NotFoundError, ValidationError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Kullanıcının kayıtlı passkey'leri. */
export const GET = observed("account.passkeys.list", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json({ passkeys: await listPasskeys(userId) });
  } catch (error) {
    return toErrorResponse(error, "account.passkeys.list");
  }
});

/** `?id=` ile passkey siler (yalnızca kendi passkey'i; başkasınınki 404). */
export const DELETE = observed(
  "account.passkeys.delete",
  async function deleteHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      const id = req.nextUrl.searchParams.get("id");
      if (!id || id.length > 1024) throw new ValidationError("Passkey kimliği gerekli");
      if (!(await deletePasskey(userId, id))) throw new NotFoundError("Passkey bulunamadı");
      return NextResponse.json({ deleted: true });
    } catch (error) {
      return toErrorResponse(error, "account.passkeys.delete");
    }
  }
);

export const dynamic = "force-dynamic";
