import Link from "next/link";
import { useTranslations } from "next-intl";

/** WCAG 2.5.8: bağlantı hedefi mobilde 44 px, geniş ekranda en az 24 px yükseklikte. */
const linkTarget = "inline-flex min-h-[44px] items-center sm:min-h-[24px]";
const focusClass = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]";

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
              <ul className="mt-3 space-y-1 sm:space-y-2">
                {column.links.map((link) => (
                  <li key={link}>
                    <Link
                      href="/"
                      className={`${linkTarget} text-sm text-gray-600 transition hover:text-[#003580] hover:underline ${focusClass}`}
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
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link
              href="/privacy"
              className={`${linkTarget} text-xs text-gray-600 transition hover:text-[#003580] hover:underline ${focusClass}`}
            >
              {t("privacyNotice")}
            </Link>
            <Link
              href="/trust"
              className={`${linkTarget} text-xs text-gray-600 transition hover:text-[#003580] hover:underline ${focusClass}`}
            >
              {t("trustCenter")}
            </Link>
            <Link
              href="/account/privacy"
              className={`${linkTarget} text-xs text-gray-600 transition hover:text-[#003580] hover:underline ${focusClass}`}
            >
              {t("myData")}
            </Link>
            <button
              type="button"
              className={`${linkTarget} text-xs text-gray-500 transition hover:text-[#003580] hover:underline ${focusClass}`}
            >
              {t("terms")}
            </button>
            <Link
              href="/privacy#p-cookies"
              className={`${linkTarget} text-xs text-gray-600 transition hover:text-[#003580] hover:underline ${focusClass}`}
            >
              {t("cookies")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
