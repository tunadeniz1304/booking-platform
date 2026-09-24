import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "KVKK Aydınlatma Metni (demo) — booking-platform",
  description: "Kişisel verilerin işlenmesine ilişkin demo aydınlatma metni.",
};

const link =
  "font-semibold text-[#003580] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

/** KVKK aydınlatma metni (P2-5) — demo içerik, hukuki görüş değildir. */
export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <article className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 text-sm leading-6 text-gray-900 shadow-sm">
          <header>
            <h1 className="text-2xl font-bold">Kişisel Verilerin Korunması Aydınlatma Metni</h1>
            <p
              role="note"
              className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950"
            >
              Bu metin bir portföy/demo projesi içindir ve <strong>hukuki görüş değildir</strong>.
              Gerçek bir hizmette bir hukuk uzmanı tarafından hazırlanmalıdır.
            </p>
          </header>

          <section aria-labelledby="p-controller">
            <h2 id="p-controller" className="text-lg font-semibold">
              1. Veri sorumlusu
            </h2>
            <p>
              6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) uyarınca veri
              sorumlusu, bu demo platformun işletmecisidir. Demo ortamında gerçek ödeme alınmaz ve
              gerçek kişisel veri girilmemelidir.
            </p>
          </section>

          <section aria-labelledby="p-data">
            <h2 id="p-data" className="text-lg font-semibold">
              2. İşlenen kişisel veriler
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Kimlik ve iletişim: ad, soyad, e-posta adresi.</li>
              <li>Müşteri işlem: rezervasyonlar, favoriler, yorumlar, devir işlemleri.</li>
              <li>
                Finans: ödeme sağlayıcısından dönen token ve işlem referansları (kart numarası
                saklanmaz).
              </li>
              <li>
                İşlem güvenliği: oturum çerezleri, IP adresi, istek kayıtları, dolandırıcılık skoru.
              </li>
            </ul>
          </section>

          <section aria-labelledby="p-purpose">
            <h2 id="p-purpose" className="text-lg font-semibold">
              3. İşleme amaçları ve hukuki sebepler
            </h2>
            <p>
              Veriler; rezervasyon sözleşmesinin kurulması ve ifası (KVKK md. 5/2-c), hukuki
              yükümlülüklerin yerine getirilmesi (md. 5/2-ç), hizmet güvenliğinin sağlanması ve
              dolandırıcılığın önlenmesi için meşru menfaat (md. 5/2-f) ile analitik çerezler
              bakımından açık rızanız (md. 5/1) hukuki sebeplerine dayanılarak işlenir.
            </p>
          </section>

          <section aria-labelledby="p-transfer">
            <h2 id="p-transfer" className="text-lg font-semibold">
              4. Aktarım
            </h2>
            <p>
              Veriler yalnızca hizmetin gerektirdiği ölçüde konaklama tesisine (rezervasyon
              bilgileri), ödeme hizmet sağlayıcısına ve yasal olarak yetkili kurumlara
              aktarılabilir. Yapay zekâ özellikleri canlı modda çalışıyorsa, istem içeriği kişisel
              veri içermeyecek şekilde model sağlayıcısına gönderilir.
            </p>
          </section>

          <section aria-labelledby="p-retention">
            <h2 id="p-retention" className="text-lg font-semibold">
              5. Saklama süresi
            </h2>
            <p>
              Hesabınızı sildiğinizde kişisel alanlar silinir veya takma adla değiştirilir.
              Rezervasyon ve ödeme kayıtları, yasal saklama yükümlülükleri nedeniyle
              anonimleştirilmiş olarak tutulur.
            </p>
          </section>

          <section aria-labelledby="p-cookies">
            <h2 id="p-cookies" className="text-lg font-semibold">
              6. Çerezler
            </h2>
            <p>
              <strong>Zorunlu çerezler</strong> (oturum, güvenlik, dil tercihi) hizmetin çalışması
              için gereklidir ve onaya tabi değildir. <strong>Analitik çerezler</strong> yalnızca
              çerez bandında onay vermeniz hâlinde kullanılır. Tercihiniz{" "}
              <code>cookie_consent</code> çerezinde saklanır; çerezi silerek tercihinizi
              değiştirebilirsiniz.
            </p>
          </section>

          <section aria-labelledby="p-rights">
            <h2 id="p-rights" className="text-lg font-semibold">
              7. Haklarınız (KVKK md. 11)
            </h2>
            <p>
              Verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltme, silme ve
              itiraz haklarına sahipsiniz. Verilerinizi indirmek veya hesabınızı silmek için{" "}
              <Link href="/account/privacy" className={link}>
                Gizlilik ve verilerim
              </Link>{" "}
              sayfasını kullanabilirsiniz.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
