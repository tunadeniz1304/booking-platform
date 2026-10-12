-- Yorum puanları 1–5 ölçeğindedir (yorum API'si de yalnız 1–5 kabul eder). Eski demo seed'i
-- 10'luk ölçekte (8–10) puan yazıyordu; kısıt eklenmeden önce aralık dışı kayıtlar düzeltilir.

-- 5'in üstü 10'luk ölçek kabul edilip 5'liğe çevrilir; 1'in altı 1 olur.
UPDATE "Review" SET "rating" = LEAST(5, GREATEST(1, ROUND("rating" / 2.0)::INTEGER)) WHERE "rating" > 5;
UPDATE "Review" SET "rating" = 1 WHERE "rating" < 1;

-- İsteğe bağlı alt puanlarda ölçek bilinmediğinden aralık dışı değer boşaltılır.
UPDATE "Review" SET "cleanliness" = NULL WHERE "cleanliness" NOT BETWEEN 1 AND 5;
UPDATE "Review" SET "location" = NULL WHERE "location" NOT BETWEEN 1 AND 5;
UPDATE "Review" SET "staff" = NULL WHERE "staff" NOT BETWEEN 1 AND 5;
UPDATE "Review" SET "value" = NULL WHERE "value" NOT BETWEEN 1 AND 5;

-- Tutarlılık kuralları
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT "Review_subscores_range"
  CHECK (("cleanliness" IS NULL OR "cleanliness" BETWEEN 1 AND 5)
         AND ("location" IS NULL OR "location" BETWEEN 1 AND 5)
         AND ("staff" IS NULL OR "staff" BETWEEN 1 AND 5)
         AND ("value" IS NULL OR "value" BETWEEN 1 AND 5));
