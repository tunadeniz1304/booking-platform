-- P1-10 görsel zekâ & çok-modlu arama (ADR 0022)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "PropertyPhoto" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "blurVariance" DOUBLE PRECISION,
    "blurScore" DOUBLE PRECISION,
    "exposureScore" DOUBLE PRECISION,
    "qualityScore" DOUBLE PRECISION,
    "pHash" CHAR(16),
    "duplicateOfId" TEXT,
    "duplicateDistance" INTEGER,
    "embedding" vector(512),
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyPhoto_propertyId_createdAt_idx" ON "PropertyPhoto"("propertyId", "createdAt");
CREATE INDEX "PropertyPhoto_pHash_idx" ON "PropertyPhoto"("pHash");
CREATE INDEX "PropertyPhoto_duplicateOfId_idx" ON "PropertyPhoto"("duplicateOfId");
-- Kosinüs kNN ("bu fotoğraftaki gibi"); NULL embedding'ler indekse girmez.
CREATE INDEX "PropertyPhoto_embedding_hnsw_idx" ON "PropertyPhoto"
    USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "PropertyPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
