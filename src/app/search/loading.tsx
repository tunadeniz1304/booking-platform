import { getTranslations } from "next-intl/server";
import { SearchPageSkeleton } from "@/components/search/SearchPageSkeleton";

// F976: aramaya geçişte anında geri bildirim; sayfanın Suspense yedeğiyle aynı iskelet.
export default async function SearchLoading() {
  const t = await getTranslations("search");
  return <SearchPageSkeleton label={t("loading")} />;
}
