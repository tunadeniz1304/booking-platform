/**
 * Aramada seçilebilecek toplam misafir (yetişkin + çocuk) üst sınırı (F820). Sunucu şeması
 * (`SearchParamsSchema.guests`) ile arama formu aynı değeri kullanmalı; aksi halde form,
 * API'nin 400 ile reddettiği bir sayı gönderebilir.
 */
export const MAX_SEARCH_GUESTS = 30;
