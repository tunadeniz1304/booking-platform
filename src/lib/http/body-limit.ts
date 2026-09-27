import { HttpError, ValidationError } from "@/lib/http/errors";

/**
 * Multipart gövdesinde dosya dışı alanlar için pay (sınır dizgeleri + parça başlıkları).
 * Dosya sınırının üstüne eklenir; asıl dosya boyutu ayrıca `File.size` ile denetlenir.
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export class PayloadTooLargeError extends HttpError {
  constructor(message = "İstek gövdesi çok büyük") {
    super(413, "PAYLOAD_TOO_LARGE", message);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * İstek gövdesini akıştan SAYARAK okur (v5#11). `content-length` beyanına güvenilmez:
 * başlık sınırı aşıyorsa hiç okumadan, yoksa (chunked) okurken sınır aşıldığı anda akış
 * iptal edilir ve 413 döner. Bellekte en fazla `maxBytes` + bir parça tutulur.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new PayloadTooLargeError();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Sınırlı okunan multipart gövdeden tek dosya alanı (`field`). Dosya `maxFileBytes`'ı
 * aşıyorsa 413; alan yoksa/metinse ya da gövde multipart değilse 400.
 */
export async function readMultipartFile(
  req: Request,
  maxFileBytes: number,
  field = "file"
): Promise<File> {
  const buf = await readBodyLimited(req, maxFileBytes + MULTIPART_OVERHEAD_BYTES);
  let entry: FormDataEntryValue | null;
  try {
    const form = await new Response(new Uint8Array(buf), {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
    entry = form.get(field);
  } catch {
    throw new ValidationError("multipart/form-data gövdesi bekleniyor");
  }
  if (!entry || typeof entry === "string") throw new ValidationError(`\`${field}\` alanı gerekli`);
  if (entry.size > maxFileBytes) throw new PayloadTooLargeError("Dosya çok büyük");
  return entry;
}
