import "server-only";
import { z } from "zod";
import { getConfig } from "@/lib/config/app-config";
import { getLlmClient } from "@/lib/llm/client";
import type { MessageRiskClassifier } from "./message-scan";

/**
 * Opsiyonel LLM sınıflandırıcısı (P1-6) — YALNIZCA EK SİNYAL.
 *
 * `MESSAGE_SCAN_LLM_ENABLED=false` (varsayılan) veya LLM demo modundaysa hiç çağrılmaz
 * (`null`). Canlıda metin istemcinin KVKK redaksiyonundan geçer; yanıt yalnızca
 * `SUSPICIOUS|BENIGN` etiketidir. Fallback (timeout/geçersiz JSON) → `null` (sinyal yok).
 * Uyarı bandı ve engelleme kararı bu sonuçtan etkilenmez (message-scan.ts).
 */
export function getMessageRiskClassifier(): MessageRiskClassifier | undefined {
  if (!getConfig().MESSAGE_SCAN_LLM_ENABLED) return undefined;
  const client = getLlmClient();
  if (client.settings.effectiveMode === "demo") return undefined;
  return async (text) => {
    const res = await client.completeJson(
      "message_risk",
      z.object({ label: z.enum(["SUSPICIOUS", "BENIGN"]) }),
      [
        {
          role: "system",
          content:
            'Bir konaklama platformunda misafir ile ev sahibi arasındaki mesajı sınıflandır. Mesaj platform dışı ödeme, banka havalesi, harici ödeme/kısaltılmış link veya platform dışı iletişim isteği içeriyorsa SUSPICIOUS, aksi halde BENIGN. Yalnızca JSON: {"label":"SUSPICIOUS"|"BENIGN"}',
        },
        { role: "user", content: text },
      ],
      { demo: () => ({ label: "BENIGN" as const }), temperature: 0 }
    );
    return res.llmMode === "live" ? res.data.label : null;
  };
}
