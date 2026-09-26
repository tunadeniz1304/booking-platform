-- v4 P0-2 (ADR 0019) CONTRACT: arada eski kodun yazdığı satırlar son kez doldurulur,
-- *Minor kolonlar NOT NULL olur ve eski Decimal(10,2) kolonlar kaldırılır.

-- Property.basePriceMinor
UPDATE "Property" t SET "basePriceMinor" = ROUND(t."basePrice" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."basePriceMinor" IS NULL AND t."basePrice" IS NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "basePriceMinor" SET NOT NULL;
ALTER TABLE "Property" DROP COLUMN "basePrice";

-- RoomType.priceModifierMinor
UPDATE "RoomType" t SET "priceModifierMinor" = ROUND(t."priceModifier" * (CASE WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."priceModifierMinor" IS NULL AND t."priceModifier" IS NOT NULL;
ALTER TABLE "RoomType" ALTER COLUMN "priceModifierMinor" SET DEFAULT 0;
ALTER TABLE "RoomType" ALTER COLUMN "priceModifierMinor" SET NOT NULL;
ALTER TABLE "RoomType" DROP COLUMN "priceModifier";

-- InventoryDay.priceMinor
UPDATE "InventoryDay" t SET "priceMinor" = ROUND(t."price" * (CASE WHEN (SELECT p."currency" FROM "RoomType" r JOIN "Property" p ON p."id" = r."propertyId" WHERE r."id" = t."roomTypeId") IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN (SELECT p."currency" FROM "RoomType" r JOIN "Property" p ON p."id" = r."propertyId" WHERE r."id" = t."roomTypeId") IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."priceMinor" IS NULL AND t."price" IS NOT NULL;
ALTER TABLE "InventoryDay" ALTER COLUMN "priceMinor" SET NOT NULL;
ALTER TABLE "InventoryDay" DROP COLUMN "price";

-- Booking.totalPriceMinor
UPDATE "Booking" t SET "totalPriceMinor" = ROUND(t."totalPrice" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."totalPriceMinor" IS NULL AND t."totalPrice" IS NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "totalPriceMinor" SET NOT NULL;
ALTER TABLE "Booking" DROP COLUMN "totalPrice";

-- Payment.amountMinor
UPDATE "Payment" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "amountMinor" SET NOT NULL;
ALTER TABLE "Payment" DROP COLUMN "amount";

-- Payment.refundedAmountMinor
UPDATE "Payment" t SET "refundedAmountMinor" = ROUND(t."refundedAmount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."refundedAmountMinor" IS NULL AND t."refundedAmount" IS NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "refundedAmountMinor" SET DEFAULT 0;
ALTER TABLE "Payment" ALTER COLUMN "refundedAmountMinor" SET NOT NULL;
ALTER TABLE "Payment" DROP COLUMN "refundedAmount";

-- LedgerEntry.amountMinor
UPDATE "LedgerEntry" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "amountMinor" SET NOT NULL;
ALTER TABLE "LedgerEntry" DROP COLUMN "amount";

-- PriceHistory.avgNightlyPriceMinor
UPDATE "PriceHistory" t SET "avgNightlyPriceMinor" = ROUND(t."avgNightlyPrice" * (CASE WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN (SELECT p."currency" FROM "Property" p WHERE p."id" = t."propertyId") IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."avgNightlyPriceMinor" IS NULL AND t."avgNightlyPrice" IS NOT NULL;
ALTER TABLE "PriceHistory" ALTER COLUMN "avgNightlyPriceMinor" SET NOT NULL;
ALTER TABLE "PriceHistory" DROP COLUMN "avgNightlyPrice";

-- BookingTransfer.askPriceMinor
UPDATE "BookingTransfer" t SET "askPriceMinor" = ROUND(t."askPrice" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."askPriceMinor" IS NULL AND t."askPrice" IS NOT NULL;
ALTER TABLE "BookingTransfer" ALTER COLUMN "askPriceMinor" SET NOT NULL;
ALTER TABLE "BookingTransfer" DROP COLUMN "askPrice";

-- Payout.amountMinor
UPDATE "Payout" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;
ALTER TABLE "Payout" ALTER COLUMN "amountMinor" SET NOT NULL;
ALTER TABLE "Payout" DROP COLUMN "amount";

-- Invoice.amountMinor
UPDATE "Invoice" t SET "amountMinor" = ROUND(t."amount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."amountMinor" IS NULL AND t."amount" IS NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "amountMinor" SET NOT NULL;
ALTER TABLE "Invoice" DROP COLUMN "amount";

-- Invoice.taxAmountMinor
UPDATE "Invoice" t SET "taxAmountMinor" = ROUND(t."taxAmount" * (CASE WHEN t."currency" IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 1 WHEN t."currency" IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 1000 ELSE 100 END))::BIGINT WHERE t."taxAmountMinor" IS NULL AND t."taxAmount" IS NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "taxAmountMinor" SET NOT NULL;
ALTER TABLE "Invoice" DROP COLUMN "taxAmount";
