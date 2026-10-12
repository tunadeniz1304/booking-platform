-- İlan fotoğrafı için ev sahibinin girdiği alternatif metin (WCAG 1.1.1); boşsa galeri varsayılanı.

-- AlterTable
ALTER TABLE "PropertyPhoto" ADD COLUMN     "altText" VARCHAR(250);
