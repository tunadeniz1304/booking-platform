import { z } from "zod";

/** Kayıt ve şifre sıfırlamada ortak şifre kuralı. */
export const passwordSchema = z
  .string()
  .min(8, "Şifre en az 8 karakter olmalıdır")
  .max(200)
  .regex(/[0-9]/, "Şifre en az bir rakam içermelidir");
