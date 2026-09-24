import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { RANKING_WEIGHTS } from "@/lib/search/ranking";

export const metadata = { title: "Sıralama nasıl çalışır? — booking-platform" };

const LABELS: Record<keyof typeof RANKING_WEIGHTS, [string, string]> = {
  priceFit: [
    "Fiyat uyumu",
    "Seçtiğiniz tarihlerdeki vergi dahil toplamın, sonuçlar arasındaki göreli uygunluğu.",
  ],
  rating: [
    "Misafir puanı",
    "Az yorumlu ilanların aşırı öne çıkmaması için Bayes düzeltmeli ortalama puan.",
  ],
  popularity: [
    "Yorum sayısı",
    "Doğrulanmış konaklamalara bağlı yorum sayısının logaritmik ölçeği.",
  ],
  personal: [
    "Kişiselleştirme",
    "Giriş yaptıysanız geçmiş rezervasyon ve favorilerinizdeki şehir/tip benzerliği.",
  ],
  semantic: ["Arama metni benzerliği", "Arama metninizle ilan metni arasındaki benzerlik."],
};

/** DSA ve Omnibus şeffaflık yükümlülükleri: sıralamanın ana parametreleri ve ağırlıkları. */
export default function RankingExplainedPage() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold text-gray-900">Sıralama nasıl çalışır?</h1>
        <p className="mt-4 text-gray-700">
          &quot;Önerilen&quot; sıralamada her konaklamanın skoru aşağıdaki bileşenlerin ağırlıklı
          toplamıdır. Sonuç kartındaki &quot;Bu sıralama neden?&quot; bağlantısı her bileşenin
          katkısını gösterir. Ücretli yerleşim veya komisyon oranı sıralamayı etkilemez.
        </p>
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Bileşen</th>
              <th className="py-2">Ağırlık</th>
              <th className="py-2">Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(RANKING_WEIGHTS) as Array<keyof typeof RANKING_WEIGHTS>).map((k) => (
              <tr key={k} className="border-b align-top">
                <td className="py-2 font-medium">{LABELS[k][0]}</td>
                <td className="py-2">%{Math.round(RANKING_WEIGHTS[k] * 100)}</td>
                <td className="py-2 text-gray-600">{LABELS[k][1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-sm text-gray-500">
          Fiyat, puan veya en çok beğenilen sıralamalarını seçtiğinizde yalnızca o ölçüt kullanılır.
        </p>
      </main>
      <Footer />
    </div>
  );
}
