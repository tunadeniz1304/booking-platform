import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveRequestLocale } from "./config";
import { loadMessages } from "./messages";

/**
 * Dil çerezden (NEXT_LOCALE) çözülür; çerez yoksa (ilk ziyaret) Accept-Language müzakere edilir.
 * URL yapısı değişmez.
 */
export default getRequestConfig(async () => {
  const locale = resolveRequestLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get("accept-language")
  );
  return { locale, messages: await loadMessages(locale) };
});
