import { z } from "zod";

/**
 * Yalnızca `https:` şemalı mutlak URL'ler (ör. ilan görselleri).
 * `javascript:`, `data:`, `http:` gibi şemalar reddedilir (XSS / karışık içerik).
 */
export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Yalnızca https:// adresleri kabul edilir");
