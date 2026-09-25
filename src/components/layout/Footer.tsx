import Link from "next/link";
import { useTranslations } from "next-intl";

const footerColumns = [
  {
    key: "support",
    links: ["helpCenter", "covid", "refundPolicy", "refunds", "accessibility"],
  },
  {
    key: "discover",
    links: ["allStays", "holidayRentals", "packages", "cityCentre", "budget"],
  },
  {
    key: "contact",
    links: ["hosts", "partners", "careers", "corporate"],
  },
];

export default function Footer() {
  const t = useTranslations("footer");
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {footerColumns.map((column) => (
            <div key={column.key}>
              <h2 className="text-sm font-semibold text-gray-900">
                {t(`columns.${column.key}.title`)}
              </h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link}>
                    <Link
                      href="/"
                      className="text-sm text-gray-600 transition hover:text-[#003580] hover:underline"
                    >
                      {t(`columns.${column.key}.${link}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-gray-200 pt-8 sm:flex-row">
          <p className="text-xs text-gray-600">
            © {new Date().getFullYear()} booking-platform · {t("demo")}
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="text-xs text-gray-600 transition hover:text-[#003580] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
            >
              {t("privacyNotice")}
            </Link>
            <Link
              href="/account/privacy"
              className="text-xs text-gray-600 transition hover:text-[#003580] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
            >
              {t("myData")}
            </Link>
            <button className="text-xs text-gray-500 transition hover:text-[#003580] hover:underline">
              {t("terms")}
            </button>
            <Link
              href="/privacy#p-cookies"
              className="text-xs text-gray-600 transition hover:text-[#003580] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
            >
              {t("cookies")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
