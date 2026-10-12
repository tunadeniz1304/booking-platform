/**
 * Yer adı karşılaştırması için normalleştirme: Türkçe büyük/küçük harf kuralları (İ/I),
 * aksanlar (ç, ş, ğ, ü, ö, â…) ve noktasız ı yok sayılır; boşluklar tekilleştirilir.
 * Böylece "Cesme" ↔ "Çeşme", "istanbul" ↔ "İstanbul", "MUGLA" ↔ "Muğla" eşleşir.
 * İstemci (öneri listesi) ve sunucu (konum araması) aynı kuralı kullanır.
 */
export function normalizePlace(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");
}
