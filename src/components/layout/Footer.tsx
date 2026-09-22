import Link from "next/link";

const footerColumns = [
  {
    title: "Destek",
    links: ["Yardım Merkezi", "COVID-19 ile ilgili bilgiler", "İade politikası", "Para iadesi", "Erişilebilirlik"],
  },
  {
    title: "Keşfet",
    links: ["Tüm konaklama seçenekleri", "Tatil kiralık evleri", "Tatil paketleri", "Şehir merkezindeki oteller", "Uygun oteller"],
  },
  {
    title: "Bizimle iletişime geçin",
    links: ["Otel sahibi misiniz?", "Ortaklık programı", "Kariyer", "Kurumsal iletişim"],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-gray-900">{column.title}</h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link}>
                    <Link href="/" className="text-sm text-gray-600 transition hover:text-[#003580] hover:underline">
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Bültenimize abone olun</h3>
            <p className="mt-4 text-sm text-gray-600">
              Size özel fırsatları ve indirimleri kaçırmayın.
            </p>
            <form className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                placeholder="E-posta adresiniz"
                className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
              />
              <button
                type="button"
                className="rounded-sm bg-[#003580] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#002b66]"
              >
                Abone Ol
              </button>
            </form>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-gray-200 pt-8 sm:flex-row">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} Booking.com. Tüm hakları saklıdır.
          </p>
          <div className="flex items-center gap-4">
            <button className="text-xs text-gray-500 transition hover:text-[#003580] hover:underline">
              Gizlilik Bildirimi
            </button>
            <button className="text-xs text-gray-500 transition hover:text-[#003580] hover:underline">
              Kullanım Koşulları
            </button>
            <button className="text-xs text-gray-500 transition hover:text-[#003580] hover:underline">
              Çerez Bildirimi
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
