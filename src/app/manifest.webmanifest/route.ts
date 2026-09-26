import { NextRequest, NextResponse } from "next/server";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { buildManifest } from "@/lib/pwa/manifest";

/** `/manifest.webmanifest` — dil çerezine göre TR/EN (P1-12). */
export function GET(req: NextRequest) {
  const locale = resolveLocale(req.cookies.get(LOCALE_COOKIE)?.value);
  return NextResponse.json(buildManifest(locale), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      Vary: "Cookie",
    },
  });
}

export const dynamic = "force-dynamic";
