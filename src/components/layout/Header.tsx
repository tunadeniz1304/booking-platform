"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { fetchCurrentUser, logout, type SessionUser } from "@/lib/api-client";
import LocaleSwitcher from "./LocaleSwitcher";
import ThemeToggle from "./ThemeToggle";

type NavKey = "stays" | "plan" | "transfers" | "cart" | "support" | "host" | "admin" | "mailbox";

interface NavItem {
  key: NavKey;
  href: string;
  roles?: ReadonlyArray<SessionUser["role"]>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "stays", href: "/" },
  { key: "plan", href: "/plan" },
  { key: "transfers", href: "/transfers" },
  // P1-1 grup sepeti: yalnızca oturum açmış kullanıcıya.
  { key: "cart", href: "/cart", roles: ["USER", "HOST", "ADMIN"] },
  // v5 P2-1: AI destek asistanı oturum ister.
  { key: "support", href: "/support", roles: ["USER", "HOST", "ADMIN"] },
  { key: "host", href: "/host", roles: ["HOST", "ADMIN"] },
  { key: "admin", href: "/admin", roles: ["ADMIN"] },
  { key: "mailbox", href: "/dev/mailbox" },
];

export const headerFocusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#febb02] focus-visible:ring-offset-2 focus-visible:ring-offset-[#003580]";

const noopSubscribe = () => () => {};
const readLocationTail = () => `${window.location.search}${window.location.hash}`;

/** `/login` ya da `/register` bağlantısı, geçerli sayfaya dönüş adresiyle (ui.tsx `loginHref` ile aynı kural). */
function authHref(base: "/login" | "/register", returnTo: string): string {
  if (
    returnTo === "/" ||
    returnTo.startsWith("//") ||
    /^\/(login|register)(\/|\?|#|$)/.test(returnTo)
  )
    return base;
  return `${base}?redirect=${encodeURIComponent(returnTo)}`;
}

/** Posta kutusu bağlantısı yalnızca demo modunda (sunucu `<html data-demo>` yazar). */
function isDemoDocument(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.demo === "true";
}

export default function Header() {
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const demo = useSyncExternalStore(noopSubscribe, isDemoDocument, () => false);
  // Sorgu + hash yalnız istemcide okunur (useSearchParams Suspense sınırı gerektirmesin).
  const locationTail = useSyncExternalStore(noopSubscribe, readLocationTail, () => "");
  const returnTo = `${pathname}${locationTail}`;

  useEffect(() => {
    let active = true;
    fetchCurrentUser().then((u) => {
      if (active) setUser(u);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    router.push("/");
    router.refresh();
  };

  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
    : "";

  const items = NAV_ITEMS.filter(
    (item) =>
      (item.key !== "mailbox" || demo) && (!item.roles || (user && item.roles.includes(user.role)))
  );
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="bg-[#003580] text-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            className={`shrink-0 rounded-sm text-xl font-bold tracking-tight sm:text-2xl ${headerFocusRing}`}
          >
            booking<span className="text-[#febb02]">.com</span>
          </Link>
          <nav className="hidden items-center gap-1 xl:flex" aria-label={t("primary")}>
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
                className={`whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 aria-[current=page]:bg-white/15 ${headerFocusRing}`}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
          {/* 640 px altında tema/dil seçicileri mobil menüde (başlık taşmasın). */}
          <div className="hidden items-center gap-2 sm:flex">
            <ThemeToggle className={headerFocusRing} />
            <LocaleSwitcher className={headerFocusRing} />
          </div>
          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                aria-current={pathname.startsWith("/account") ? "page" : undefined}
                className={`flex min-h-[44px] items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-white transition hover:bg-white/10 sm:min-h-0 ${headerFocusRing}`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-[#003580]"
                >
                  {initials}
                </span>
                <span className="sr-only">{t("account")}: </span>
                <span className="sr-only sm:not-sr-only">{user.firstName}</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className={`hidden rounded-sm border border-white/60 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/10 sm:block ${headerFocusRing}`}
              >
                {t("logout")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href={authHref("/register", returnTo)}
                className={`hidden rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:block ${headerFocusRing}`}
              >
                {t("register")}
              </Link>
              {/* Giriş mobilde de başlıkta görünür (kayıt mobil menüde). */}
              <Link
                href={authHref("/login", returnTo)}
                className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-sm bg-white px-3 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:min-h-0 sm:px-4 ${headerFocusRing}`}
              >
                {t("login")}
              </Link>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`shrink-0 rounded-sm p-2.5 text-white transition hover:bg-white/10 xl:hidden ${headerFocusRing}`}
            aria-label={t("toggleMenu")}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              {isMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div
          id="mobile-menu"
          className="border-t border-white/20 bg-[#003580] px-4 pb-4 pt-2 xl:hidden"
        >
          <div className="mb-2 flex flex-col gap-2 border-b border-white/20 pb-3 sm:hidden">
            <ThemeToggle showLabel className={headerFocusRing} />
            <LocaleSwitcher showLabel className={headerFocusRing} />
          </div>
          <nav className="flex flex-col gap-1" aria-label={t("mobile")}>
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
                className={`flex min-h-[44px] items-center rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 ${headerFocusRing}`}
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-white/20 pt-2">
              {user ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${headerFocusRing}`}
                >
                  {t("logout")}
                </button>
              ) : (
                <>
                  <Link
                    href={authHref("/register", returnTo)}
                    className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${headerFocusRing}`}
                  >
                    {t("register")}
                  </Link>
                  <Link
                    href={authHref("/login", returnTo)}
                    className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${headerFocusRing}`}
                  >
                    {t("login")}
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
