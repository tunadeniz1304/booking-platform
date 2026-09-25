/**
 * Şehir adı eşleştirme anahtarı: büyük/küçük harf + Türkçe İ/ı duyarsız. "PARIS", "Paris",
 * "ISTANBUL" ve "İstanbul" doğru eşleşir (yalnızca tr-TR küçültme "PARIS"i "parıs" yapıp
 * eşleşmeyi bozuyordu).
 */
export function cityKey(s: string): string {
  return s.trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFC");
}
