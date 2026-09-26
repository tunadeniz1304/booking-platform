import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Sepete kalem: oda tipi × tarih × doluluk (yetişkin/çocuk) × oda adedi. */
export const cartItemSchema = z.object({
  propertyId: z.string().min(1).max(64),
  roomTypeId: z.string().min(1).max(64),
  ratePlanId: z.string().min(1).max(64).optional(),
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
  quantity: z.number().int().min(1).max(10).default(1),
  /** Yalnızca ilk kalemde: tahsilat birimi (izinliyse). */
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((c) => c.toUpperCase())
    .optional(),
});

export const cartItemPatchSchema = z
  .object({
    ratePlanId: z.string().min(1).max(64).optional(),
    checkIn: isoDate.optional(),
    checkOut: isoDate.optional(),
    adults: z.number().int().min(1).max(20).optional(),
    children: z.number().int().min(0).max(20).optional(),
    quantity: z.number().int().min(1).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "En az bir alan güncellenmeli");

export const cartPaySchema = z.object({
  /** PSP hosted-field token'ı (kart numarası sunucuya gelmez). */
  cardToken: z.string().min(8).max(200),
});

export const cartConfirmSchema = z.object({
  code: z
    .string()
    .regex(/^\d{4,8}$/)
    .optional(),
});
