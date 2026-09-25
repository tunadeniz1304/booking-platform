import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "./config";
import { loadMessages } from "./messages";

/** Dil çerezden (NEXT_LOCALE) çözülür; URL yapısı değişmez. */
export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { locale, messages: await loadMessages(locale) };
});
