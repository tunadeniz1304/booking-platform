-- v2-P0-1: bırakılan promosyon kullanımı silinmez, işaretlenir (geç ödeme başarısında yeniden talep).
ALTER TABLE "PromotionRedemption" ADD COLUMN "releasedAt" TIMESTAMP(3);
