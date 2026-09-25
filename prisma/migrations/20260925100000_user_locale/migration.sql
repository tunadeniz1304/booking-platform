-- P1-12: kullanıcının arayüz/e-posta dili (tr|en)
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'tr';
