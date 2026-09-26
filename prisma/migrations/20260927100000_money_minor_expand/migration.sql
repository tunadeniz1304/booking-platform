-- v4 P0-2 (ADR 0019) EXPAND: Decimal(10,2) para kolonlarının yanına BigInt minor-unit kolonlar.
-- Eski kolonlar NULL kabul eder hâle gelir (yeni kod yalnızca *Minor yazar); satırlar ISO 4217
-- üssüne göre half-up doldurulur. Aynı UPDATE `npm run money:backfill` ile idempotent tekrarlanır.

-- Property.basePrice -> basePriceMinor
ALTER TABLE "Property" ADD COLUMN "basePriceMinor" BIGINT;
ALTER TABLE "Property" ALTER COLUMN "basePrice" DROP NOT NULL;
UPDATE "Property" t SET "basePriceMinor" = ROUND(t."basePrice" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."basePriceMinor" IS NULL AND t."basePrice" IS NOT NULL;

-- RoomType.priceModifier -> priceModifierMinor
ALTER TABLE "RoomType" ADD COLUMN "priceModifierMinor" BIGINT;
ALTER TABLE "RoomType" ALTER COLUMN "priceModifier" DROP NOT NULL;
UPDATE "RoomType" t SET "priceModifierMinor" = ROUND(t."priceModifier" * (CASE WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."priceModifierMinor" IS NULL AND t."priceModifier" IS NOT NULL;

-- InventoryDay.price -> priceMinor
ALTER TABLE "InventoryDay" ADD COLUMN "priceMinor" BIGINT;
ALTER TABLE "InventoryDay" ALTER COLUMN "price" DROP NOT NULL;
UPDATE "InventoryDay" t SET "priceMinor" = ROUND(t."price" * (CASE WHEN (SELECT p."currency" FROM "RoomType" r JOIN "Property" p ON p."id" = r."propertyId" WHERE r."id" = t."roomTypeId") IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN (SELECT p."currency" FROM "RoomType" r JOIN "Property" p ON p."id" = r."propertyId" WHERE r."id" = t."roomTypeId") IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."priceMinor" IS NULL AND t."price" IS NOT NULL;

-- Booking.totalPrice -> totalPriceMinor
ALTER TABLE "Booking" ADD COLUMN "totalPriceMinor" BIGINT;
ALTER TABLE "Booking" ALTER COLUMN "totalPrice" DROP NOT NULL;
UPDATE "Booking" t SET "totalPriceMinor" = ROUND(t."totalPrice" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."totalPriceMinor" IS NULL AND t."totalPrice" IS NOT NULL;

-- Payment.amount -> amountMinor
ALTER TABLE "Payment" ADD COLUMN "amountMinor" BIGINT;
ALTER TABLE "Payment" ALTER COLUMN "amount" DROP NOT NULL;
UPDATE "Payment" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;

-- Payment.refundedAmount -> refundedAmountMinor
ALTER TABLE "Payment" ADD COLUMN "refundedAmountMinor" BIGINT;
ALTER TABLE "Payment" ALTER COLUMN "refundedAmount" DROP NOT NULL;
UPDATE "Payment" t SET "refundedAmountMinor" = ROUND(t."refundedAmount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."refundedAmountMinor" IS NULL AND t."refundedAmount" IS NOT NULL;

-- LedgerEntry.amount -> amountMinor
ALTER TABLE "LedgerEntry" ADD COLUMN "amountMinor" BIGINT;
ALTER TABLE "LedgerEntry" ALTER COLUMN "amount" DROP NOT NULL;
UPDATE "LedgerEntry" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;

-- PriceHistory.avgNightlyPrice -> avgNightlyPriceMinor
ALTER TABLE "PriceHistory" ADD COLUMN "avgNightlyPriceMinor" BIGINT;
ALTER TABLE "PriceHistory" ALTER COLUMN "avgNightlyPrice" DROP NOT NULL;
UPDATE "PriceHistory" t SET "avgNightlyPriceMinor" = ROUND(t."avgNightlyPrice" * (CASE WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."avgNightlyPriceMinor" IS NULL AND t."avgNightlyPrice" IS NOT NULL;

-- BookingTransfer.askPrice -> askPriceMinor
ALTER TABLE "BookingTransfer" ADD COLUMN "askPriceMinor" BIGINT;
ALTER TABLE "BookingTransfer" ALTER COLUMN "askPrice" DROP NOT NULL;
UPDATE "BookingTransfer" t SET "askPriceMinor" = ROUND(t."askPrice" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."askPriceMinor" IS NULL AND t."askPrice" IS NOT NULL;

-- Payout.amount -> amountMinor
ALTER TABLE "Payout" ADD COLUMN "amountMinor" BIGINT;
ALTER TABLE "Payout" ALTER COLUMN "amount" DROP NOT NULL;
UPDATE "Payout" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;

-- Invoice.amount -> amountMinor
ALTER TABLE "Invoice" ADD COLUMN "amountMinor" BIGINT;
ALTER TABLE "Invoice" ALTER COLUMN "amount" DROP NOT NULL;
UPDATE "Invoice" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;

-- Invoice.taxAmount -> taxAmountMinor
ALTER TABLE "Invoice" ADD COLUMN "taxAmountMinor" BIGINT;
ALTER TABLE "Invoice" ALTER COLUMN "taxAmount" DROP NOT NULL;
UPDATE "Invoice" t SET "taxAmountMinor" = ROUND(t."taxAmount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."taxAmountMinor" IS NULL AND t."taxAmount" IS NOT NULL;
