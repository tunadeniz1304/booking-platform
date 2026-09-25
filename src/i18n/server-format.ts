import { getLocale } from "next-intl/server";
import { createFormatter, type Formatter } from "@/lib/i18n/format";

/** Sunucu bileşenlerinde etkin dile göre para/tarih biçimlendirici. */
export async function getFormat(): Promise<Formatter> {
  return createFormatter(await getLocale());
}
