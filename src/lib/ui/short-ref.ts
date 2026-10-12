/**
 * Bilet/rezervasyon/talep kimliklerinin tek görünür kısa biçimi (F2-41):
 * son 8 karakter, büyük harf. Kullanıcı, ev sahibi ve yönetici aynı referansı görür.
 */
export function shortRef(id: string): string {
  return id.length > 8 ? id.slice(-8).toUpperCase() : id.toUpperCase();
}
