/**
 * LLM duman testi: `npm run llm:smoke`
 *
 * - Anahtar yoksa: "DEMO — smoke atlandı" + exit 0.
 * - Anahtar varsa: 1 JSON + 1 metin çağrısı; ikisi de canlı dönmezse exit 1.
 * Anahtar/URL değeri asla yazdırılmaz (yalnızca model ve host).
 */
import { z } from "zod";
import { loadEnv } from "../src/lib/config/load-env";
import { describeLlmMode, getLlmSettings } from "../src/lib/llm/settings";
import { createLlmClient } from "../src/lib/llm/client";
import { systemLlmSubject } from "../src/lib/llm/budget";
import { demoSmoke } from "../src/lib/llm/demo";

async function main(): Promise<void> {
  loadEnv();
  const settings = getLlmSettings();
  console.log(describeLlmMode(settings));

  if (settings.effectiveMode === "demo") {
    console.log("DEMO — smoke atlandı");
    return;
  }

  const client = createLlmClient({ settings });
  // Öznesiz canlı çağrı fail-closed; duman testi sistem bütçesine faturalanır.
  const subject = systemLlmSubject("smoke");
  const json = await client.completeJson(
    "smoke",
    z.object({ ok: z.boolean(), message: z.string() }),
    [
      {
        role: "system",
        content: 'Yalnızca JSON döndür: {"ok": true, "message": "<kısa Türkçe selam>"}',
      },
      { role: "user", content: "Bağlantı testi." },
    ],
    { demo: demoSmoke, subject }
  );
  console.log(
    `JSON  → mod=${json.llmMode} gecikme=${json.latencyMs}ms${json.reason ? ` neden=${json.reason}` : ""}`
  );

  const text = await client.completeText(
    "smoke",
    [{ role: "user", content: "Tek kelimeyle yanıt ver: merhaba" }],
    { demo: () => "demo", subject }
  );
  console.log(
    `METİN → mod=${text.llmMode} gecikme=${text.latencyMs}ms${text.reason ? ` neden=${text.reason}` : ""}`
  );

  if (json.llmMode !== "live" || text.llmMode !== "live") {
    console.error("Canlı LLM çağrısı başarısız.");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("llm:smoke hata:", (error as Error).message);
    process.exitCode = 1;
  })
  // Bütçe/limiter Redis bağlantısı açık kalır; CLI iş bitince beklemeden çıkar.
  .finally(() => process.exit(process.exitCode ?? 0));
