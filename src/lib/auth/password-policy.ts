import { z } from "zod";

/** Kayıt ve şifre sıfırlamada ortak parola kuralı. */
export const passwordSchema = z
  .string()
  .min(8, "Parola en az 8 karakter olmalıdır")
  .max(200)
  .regex(/[0-9]/, "Parola en az bir rakam içermelidir");
