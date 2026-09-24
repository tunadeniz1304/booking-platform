# ADR 0003 — Transactional outbox, SKIP LOCKED kiralama ve DEAD durumu

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

Rezervasyon onayı sonrası e-posta veya yeni mülk sonrası embedding gibi yan etkiler iş verisiyle tutarlı olmalı: transaction geri alınırsa olay yayınlanmamalı, commit edildiyse en az bir kez yayınlanmalı. Eski uygulamada başka bir worker'ın kiraladığı mesajlar yeniden yükleniyor (çift yayın), `PROCESSING` durumunda kalan mesajlar için süre aşımı yoktu ve `FAILED` mesajlar sonsuza dek deneniyordu (hata #9).

## Karar

- `appendOutbox(tx, event)` olayı iş verisiyle **aynı transaction'da** `OutboxMessage` tablosuna yazar (`src/lib/cqrs/outbox.ts`).
- Kiralama tek atomik ifadedir:

  ```sql
  UPDATE "OutboxMessage"
  SET status = 'PROCESSING', "lockedUntil" = <şimdi + lease>, attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM "OutboxMessage"
    WHERE (status IN ('PENDING', 'FAILED') AND "availableAfter" <= <şimdi>)
       OR (status = 'PROCESSING' AND "lockedUntil" < <şimdi>)
    ORDER BY "createdAt"
    LIMIT <n>
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, "eventType", "aggregateId", payload, attempts;
  ```

- Lease süresi (`OUTBOX_LEASE_SECONDS`, varsayılan 60) dolan mesaj başka bir worker tarafından geri alınır; çöken worker mesajı kaybettirmez.
- Hata → `FAILED` + üstel geri çekilme (`OUTBOX_BACKOFF_BASE_MS`); `OUTBOX_MAX_ATTEMPTS` (varsayılan 8) aşılınca `DEAD`. Admin `GET/POST /api/admin/outbox` ile DEAD mesajları görür ve yeniden kuyruğa alır (audit log'a yazılır).
- Tüketiciler idempotenttir (ör. aynı olay iki kez tüketilince tek e-posta).

## Sonuçlar

- Semantik "en az bir kez"; idempotent tüketicilerle etkili olarak "bir kez".
- Birden çok worker birbirini bloklamadan paralel çalışır.
- `tests/integration/outbox.test.ts` eşzamanlı kiralama, lease geri alma ve DEAD geçişini doğrular.
