"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { fetchCurrentUser, logout, type SessionUser } from "@/lib/api-client";
import LocaleSwitcher from "./LocaleSwitcher";

type NavKey = "stays" | "plan" | "transfers" | "cart" | "host" | "admin" | "mailbox";

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
  { key: "host", href: "/host", roles: ["HOST", "ADMIN"] },
  { key: "admin", href: "/admin", roles: ["ADMIN"] },
  { key: "mailbox", href: "/dev/mailbox" },
];

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#febb02] focus-visible:ring-offset-2 focus-visible:ring-offset-[#003580]";

const noopSubscribe = () => () => {};

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
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-[#003580]"
      >
        {t("skipToContent")}
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className={`rounded-sm text-2xl font-bold tracking-tight ${focusRing}`}>
            booking<span className="text-[#febb02]">.com</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label={t("primary")}>
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
                className={`rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 aria-[current=page]:bg-white/15 ${focusRing}`}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-white transition hover:bg-white/10 ${focusRing}`}
                aria-label={t("account")}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-[#003580]">
                  {initials}
                </span>
                <span className="hidden sm:inline">{user.firstName}</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className={`hidden rounded-sm border border-white/60 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/10 sm:block ${focusRing}`}
              >
                {t("logout")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/register"
                className={`hidden rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:block ${focusRing}`}
              >
                {t("register")}
              </Link>
              <Link
                href="/login"
                className={`hidden rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:block ${focusRing}`}
              >
                {t("login")}
              </Link>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`rounded-sm p-2 text-white transition hover:bg-white/10 lg:hidden ${focusRing}`}
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
          className="border-t border-white/20 bg-[#003580] px-4 pb-4 pt-2 lg:hidden"
        >
          <nav className="flex flex-col gap-1" aria-label={t("mobile")}>
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
                className={`rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 ${focusRing}`}
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-white/20 pt-2">
              {user ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${focusRing}`}
                >
                  {t("logout")}
                </button>
              ) : (
                <>
                  <Link
                    href="/register"
                    className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${focusRing}`}
                  >
                    {t("register")}
                  </Link>
                  <Link
                    href="/login"
                    className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${focusRing}`}
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
