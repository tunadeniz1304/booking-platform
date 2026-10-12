import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLlmClient } from "@/lib/llm/client";
import { demoListingCopy } from "@/lib/llm/demo";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { assertPropertyAccess } from "@/lib/host/host-service";
import type { AccessClaims } from "@/lib/auth";
import { bedTypeKey, type BedType } from "@/lib/i18n/bed-type";
import trCommon from "../../../messages/tr/common.json";

/** Yatak tipi kodunun okunur etiketi (F1306); taslak metne kod değil etiket girer. */
function bedTypeLabel(value: string): string {
  return bedTypeKey(value) ? trCommon.bedTypes[value as BedType] : value;
}

/** İlan açıklaması taslağı (P1-7): host düzenler/onaylar; otomatik yayınlanmaz. */
export async function draftListingCopy(actor: AccessClaims, propertyId: string) {
  await assertPropertyAccess(actor, propertyId);
  const p = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: {
      title: true,
      propertyType: true,
      location: { select: { city: true } },
      amenities: { select: { name: true } },
      rooms: { select: { name: true, maxOccupancy: true, bedType: true } },
    },
  });
  const facts = {
    title: p.title,
    city: p.location.city,
    propertyType: p.propertyType,
    amenities: p.amenities.map((a) => a.name),
    rooms: p.rooms.map((r) => ({
      name: r.name,
      capacity: r.maxOccupancy,
      bedType: bedTypeLabel(r.bedType),
    })),
  };
  const factSet = buildFactSet([JSON.stringify(facts), p.rooms.length]);
  const res = await getLlmClient().completeJson(
    "listing_copy",
    z.object({ tr: z.string().min(20).max(1500), en: z.string().min(20).max(1500) }),
    [
      {
        role: "system",
        content:
          "Verilen özelliklerden çekici ama DOĞRU bir ilan açıklaması yaz (Türkçe ve İngilizce). Olmayan özellik veya sayı ekleme. JSON: {tr, en}",
      },
      { role: "user", content: JSON.stringify(facts) },
    ],
    {
      demo: () => demoListingCopy(facts),
      validate: (d) => {
        assertNumbersGrounded(`${d.tr} ${d.en}`, factSet);
      },
    }
  );
  return { draft: res.data, llmMode: res.llmMode };
}
