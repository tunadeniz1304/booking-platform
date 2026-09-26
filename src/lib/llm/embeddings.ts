/**
 * Geriye dönük uyumluluk: uzak embedding fonksiyonu artık `client.ts` içinde
 * (`openai` SDK'sı yalnızca orada içe aktarılır — v4#3). Redaksiyon, bütçe ve
 * eşzamanlılık sınırı orada uygulanır.
 */
export { createRemoteEmbedFn, type EmbedFn } from "./client";
