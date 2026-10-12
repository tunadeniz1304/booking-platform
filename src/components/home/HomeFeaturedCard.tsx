"use client";

import PropertyCard, { type PropertyCardProps } from "@/components/property/PropertyCard";
import { draftDates, useSearchDraft } from "@/components/search/useSearchDraft";

/**
 * Ana sayfadaki öne çıkan ilan kartı: arama formunda seçili tarih ve kişi sayısı ilan
 * bağlantısına taşınır (F1282). Form ölçüt yayınlamadıysa kart tarihsiz bağlantı kullanır.
 */
export default function HomeFeaturedCard(props: Omit<PropertyCardProps, "searchContext">) {
  const draft = useSearchDraft();
  const dates = draftDates(draft);
  return (
    <PropertyCard
      {...props}
      searchContext={
        draft
          ? {
              checkIn: dates?.checkIn ?? null,
              checkOut: dates?.checkOut ?? null,
              guests: draft.adults + draft.children,
              adults: draft.adults,
              children: draft.children,
            }
          : undefined
      }
    />
  );
}
