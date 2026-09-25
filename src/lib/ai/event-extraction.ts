import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLlmClient } from "@/lib/llm/client";
import { demoEventExtraction, type EventExtraction } from "@/lib/llm/demo";
import { ValidationError } from "@/lib/http/errors";
import { proposeEvent } from "@/lib/pricing/event-signals";

/**
 * Haber/duyuru metninden olay ÖNERİSİ (LLM yalnızca önerir; fiyat etkisi admin onayı
 * ve deterministik fiyat motoruyla uygulanır).
 */
const schema = z.object({
  city: z.string().max(80).nullable(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  category: z.enum(["konser", "festival", "spor", "fuar", "kongre", "tatil", "diğer"]),
  expectedImpact: z.number().int().min(1).max(10),
  rationale: z.string().max(500),
});

async function extractEvent(
  text: string
): Promise<{ data: EventExtraction; llmMode: string }> {
  const cities = (
    await prisma.location.findMany({ select: { city: true }, distinct: ["city"] })
  ).map((l) => l.city);
  const res = await getLlmClient().completeJson(
    "event_extraction",
    schema,
    [
      {
        role: "system",
        content:
          `Metindeki etkinliği JSON olarak çıkar: {city, startDate, endDate (YYYY-MM-DD), category, expectedImpact (1-10), rationale}. ` +
          `Şehir yalnızca şunlardan biri olabilir: ${cities.join(", ")}. Emin değilsen null.`,
      },
      { role: "user", content: text },
    ],
    {
      demo: () => demoEventExtraction(text, cities),
      validate: (d) => ({ ...d, city: d.city && cities.includes(d.city) ? d.city : null }),
    }
  );
  return { data: res.data, llmMode: res.llmMode };
}

export async function proposeFromText(text: string, proposedBy: string) {
  const { data, llmMode } = await extractEvent(text);
  if (!data.city || !data.startDate || !data.endDate) {
    throw new ValidationError(
      "Metinden şehir ve tarih çıkarılamadı; lütfen yapılandırılmış öneri girin"
    );
  }
  const location = await prisma.location.findFirst({
    where: { city: data.city },
    select: { id: true },
  });
  if (!location) throw new ValidationError("Şehir bulunamadı");
  const event = await proposeEvent({
    locationId: location.id,
    title: text.slice(0, 120),
    startsOn: data.startDate,
    endsOn: data.endDate,
    impact: data.expectedImpact,
    category: data.category,
    rationale: data.rationale,
    source: `llm:${llmMode}`,
    proposedBy,
  });
  return { event, extraction: data, llmMode };
}
