import { existsSync } from "node:fs";
import { resetConfigForTests } from "@/lib/config/app-config";
import { getImageEmbedder, modelDirectory, VISION_REASON_MESSAGES } from "@/lib/vision/clip";

/**
 * P1-10: CLIP modelini (`VISION_CLIP_MODEL`, varsayılan Xenova/clip-vit-base-patch32, q8)
 * `VISION_MODEL_DIR`'e indirir. Model repoya girmez (.gitignore). Paket kurulu değilse
 * veya ağ yoksa uyarı basıp 0 ile çıkar (CI/çevrimdışı kurulum kırılmaz).
 */
async function main(): Promise<void> {
  process.env.VISION_CLIP_ENABLED = "true";
  process.env.VISION_ALLOW_REMOTE_MODELS = "true";
  resetConfigForTests();
  const dirs = modelDirectory();
  console.log(`[vision] model dizini: ${dirs.root}`);
  const res = await getImageEmbedder();
  if (!res.embedder) {
    console.warn(
      `[vision] indirme atlandı: ${res.reason} — ${VISION_REASON_MESSAGES[res.reason]} ` +
        "(ağ yoksa veya @huggingface/transformers kurulu değilse beklenen durum)"
    );
    return;
  }
  console.log(
    existsSync(dirs.model)
      ? `[vision] hazır: ${res.embedder.modelId} → ${dirs.model}`
      : `[vision] model yüklendi ancak ${dirs.model} bulunamadı; VISION_MODEL_DIR'i kontrol edin`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.warn("[vision] indirme atlandı:", error instanceof Error ? error.message : error);
    process.exit(0);
  });
