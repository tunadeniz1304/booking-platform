"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ResendVerificationButton } from "@/components/auth/AuthCard";
import { focusRing } from "@/components/ui/ui";
import { logout, type SessionUser } from "@/lib/api-client";
import LocaleSwitcher from "./LocaleSwitcher";
import ThemeToggle from "./ThemeToggle";
import { useHeaderCartCount } from "./useHeaderCartCount";
import {
  refreshSessionUser,
  setSessionUserCache,
  useSessionUserCache,
} from "./useSessionUserCache";

type NavKey =
  "stays" | "plan" | "transfers" | "support" | "trips" | "cart" | "host" | "admin" | "mailbox";

interface NavItem {
  key: NavKey;
  href: string;
  roles?: ReadonlyArray<SessionUser["role"]>;
  /** Herkese görünür ama sayfa oturum ister: oturumsuzken giriş (dönüşlü) bağlantısı ve işaret. */
  requiresLogin?: true;
  /** Rol paneli ya da demo bağlantısı: menü kalabalıksa masaüstünde de menü düğmesinde. */
  extra?: true;
  /** Öğeyi geçerli sayan yollar (varsayılan: yalnız `href` ve alt yolları). */
  match?: readonly string[];
}

// Herkese açık öğeler önce: rol öğeleri oturum çözülünce sona eklenir, diğerleri kaymaz.
const NAV_ITEMS: readonly NavItem[] = [
  // Arama → ilan → karşılaştırma akışı da "Konaklama" bölümündedir.
  { key: "stays", href: "/", match: ["/", "/search", "/property", "/compare"] },
  { key: "plan", href: "/plan", requiresLogin: true },
  { key: "transfers", href: "/transfers" },
  // v5 P2-1: AI destek asistanı oturum ister.
  { key: "support", href: "/support", requiresLogin: true },
  { key: "trips", href: "/trips", roles: ["USER", "HOST", "ADMIN"] },
  // P1-1 grup sepeti: yalnızca oturum açmış kullanıcıya.
  { key: "cart", href: "/cart", roles: ["USER", "HOST", "ADMIN"] },
  { key: "host", href: "/host", roles: ["HOST", "ADMIN"], extra: true },
  { key: "admin", href: "/admin", roles: ["ADMIN"], extra: true },
  // Geliştirici aracı: birincil menüde yalnız yöneticiye (misafir doğrulama şeridinden ulaşır).
  { key: "mailbox", href: "/dev/mailbox", roles: ["ADMIN"], extra: true },
];

/** max-w-7xl başlıkta tek satıra sığan öğe sayısı; fazlasında ek bağlantılar menü düğmesinde. */
const MAX_BAR_ITEMS = 6;

const navCurrentClass =
  "aria-[current=page]:font-bold aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4";

export const headerFocusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#febb02] focus-visible:ring-offset-2 focus-visible:ring-offset-[#003580]";

const noopSubscribe = () => () => {};
/** Gizli değer taşıyan hash (`#token=` vb.) dönüş adresine yazılmaz; sorgu dizesi günlüğe düşer. */
const SECRET_HASH = /(^|[#&])(token|code|key)=/i;
const readLocationTail = () => {
  const { search, hash } = window.location;
  return SECRET_HASH.test(hash) ? search : `${search}${hash}`;
};

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

/** Doğrulama e-postası düğmesini kendisi gösteren sayfalar: doğrulama şeridi tekrar edilmez. */
const OWN_VERIFY_PATHS = ["/verify-email", "/register", "/account"];

/** Kişisel veri göstermeyen sayfalar: çıkışta kullanıcı burada kalır, bağlamını kaybetmez. */
const PUBLIC_PATH_PREFIXES = ["/search", "/property", "/compare", "/privacy", "/trust", "/ranking"];

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/transfers" ||
    PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

/** Son başlık render'ının yolu: ilk yüklemede odak taşınmaz, yalnız istemci gezinmesinde. */
let lastPathname: string | null = null;
let pageFocusTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Gezinmede eski sayfa (tıklanan bağlantıyla) kaldırılınca odak body'ye düşer. Yeni sayfanın h1'i
 * (geç yüklenirse kısa süre beklenir, yoksa main) odaklanır; ekran okuyucu yeni sayfayı duyurur.
 * Sayfa ya da kullanıcı odağı zaten taşıdıysa dokunulmaz.
 */
function focusNewPage(): void {
  clearTimeout(pageFocusTimer);
  let tries = 0;
  const attempt = () => {
    const active = document.activeElement;
    if (window.location.hash || (active && active !== document.body)) return;
    const main = document.getElementById("main");
    const target = main?.querySelector<HTMLElement>("h1") ?? (tries >= 10 ? main : null);
    if (!target) {
      tries += 1;
      if (tries <= 10) pageFocusTimer = setTimeout(attempt, 150);
      return;
    }
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    }
    target.focus({ preventScroll: true });
  };
  pageFocusTimer = setTimeout(attempt, 0);
}

function notePathname(pathname: string): void {
  if (lastPathname !== null && lastPathname !== pathname) focusNewPage();
  lastPathname = pathname;
}

export default function Header() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  // Menü açıldığı yolda açık kalır: gezinmede kendiliğinden kapanır.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const isMenuOpen = menuPath === pathname;
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const loginRef = useRef<HTMLAnchorElement>(null);
  /** Çıkıştan sonra aynı sayfada kalınırsa odak "Giriş yap"a verilir (body'ye düşmez). */
  const focusLoginAfterLogout = useRef(false);
  // undefined = oturum henüz bilinmiyor: ne giriş düğmeleri ne rol öğeleri gösterilir.
  const user = useSessionUserCache();
  const cartCount = useHeaderCartCount(Boolean(user), pathname);
  const demo = useSyncExternalStore(noopSubscribe, isDemoDocument, () => false);
  // Sorgu + hash yalnız istemcide okunur (useSearchParams Suspense sınırı gerektirmesin).
  const locationTail = useSyncExternalStore(noopSubscribe, readLocationTail, () => "");
  const returnTo = `${pathname}${locationTail}`;

  // Son bilinen kullanıcıyla render edilir; her gezinmede arka planda doğrulanır.
  useEffect(() => {
    void refreshSessionUser();
    notePathname(pathname);
  }, [pathname]);

  useEffect(() => {
    if (user === null && focusLoginAfterLogout.current) {
      focusLoginAfterLogout.current = false;
      loginRef.current?.focus();
    }
  }, [user]);

  // Açık menü Escape ya da başlık dışına dokunuşla kapanır; odak menüdeyse düğmeye döner.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      setMenuPath(null);
      if (!active || active === document.body || headerRef.current?.contains(active))
        menuButtonRef.current?.focus();
    };
    // `click`: dokunulan öğe önce etkinleşir, menü sonra kapanır (içerik parmağın altında kaymaz).
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && !headerRef.current?.contains(e.target)) setMenuPath(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, [isMenuOpen]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    // Herkese açık sayfada kalınır; kişisel veri gösteren sayfadan ana sayfaya gidilir.
    const stay = isPublicPath(pathname);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
    focusLoginAfterLogout.current = stay;
    setSessionUserCache(null);
    if (!stay) router.push("/");
    router.refresh();
  };

  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
    : "";

  const items = NAV_ITEMS.filter(
    (item) =>
      (item.key !== "mailbox" || demo) && (!item.roles || (user && item.roles.includes(user.role)))
  );
  // Tek satıra sığmayan menüde ek bağlantılar (rol panelleri, demo) masaüstünde de menü düğmesinde.
  const crowded = items.length > MAX_BAR_ITEMS && items.some((item) => item.extra);
  const barItems = crowded ? items.filter((item) => !item.extra) : items;
  const menuHidden = crowded ? "" : "xl:hidden";
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const isItemCurrent = (item: NavItem) => (item.match ?? [item.href]).some(isCurrent);
  /** Oturumsuz kullanıcı giriş isteyen sayfaya önce girişten geçer, sonra o sayfaya döner. */
  const gated = (item: NavItem) => Boolean(item.requiresLogin) && user === null;
  const itemHref = (item: NavItem) => (gated(item) ? authHref("/login", item.href) : item.href);
  const brand = tCommon("brand");
  // Logo vurgusu markanın ilk ayraçtan sonraki kısmında ("booking" + "-platform").
  const brandCut = brand.search(/[-.]/);
  const logoutLabel = loggingOut ? t("loggingOut") : t("logout");
  const needsVerify = user?.emailVerified === false && !OWN_VERIFY_PATHS.includes(pathname);

  /** Sepet bağlantısında kalem sayısı: görünür rozet + ekran okuyucu için "Sepetim, 3 kalem". */
  const cartBadge = (item: NavItem) =>
    item.key === "cart" && cartCount ? (
      <>
        <span
          aria-hidden="true"
          className="min-w-5 rounded-full bg-white px-1.5 text-center text-xs font-bold text-[#003580]"
        >
          {cartCount}
        </span>
        <span className="sr-only">, {t("cartItems", { count: cartCount })}</span>
      </>
    ) : null;

  return (
    <header ref={headerRef} className="bg-[#003580] text-white">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            aria-label={`${brand} — ${t("home")}`}
            className={`shrink-0 rounded-sm text-xl font-bold tracking-tight sm:text-2xl ${headerFocusRing}`}
          >
            {brandCut > 0 ? (
              <>
                {brand.slice(0, brandCut)}
                <span className="text-[#febb02]">{brand.slice(brandCut)}</span>
              </>
            ) : (
              brand
            )}
          </Link>
          <nav className="hidden items-center gap-1 xl:flex" aria-label={t("primary")}>
            {barItems.map((item) => (
              <Link
                key={item.key}
                href={itemHref(item)}
                aria-current={isItemCurrent(item) ? "page" : undefined}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 aria-[current=page]:bg-white/15 ${navCurrentClass} ${headerFocusRing}`}
              >
                {t(item.key)}
                {cartBadge(item)}
                {gated(item) && (
                  <>
                    {/* Dar çubukta kilit simgesi; metin mobil menüde görünür. */}
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <rect x="5" y="11" width="14" height="10" rx="2" strokeWidth={2} />
                      <path strokeLinecap="round" strokeWidth={2} d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    <span className="sr-only"> {t("requiresLogin")}</span>
                  </>
                )}
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
                <span className="sr-only sm:not-sr-only sm:max-w-24 sm:truncate">
                  {user.firstName}
                </span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                aria-disabled={loggingOut || undefined}
                className={`hidden whitespace-nowrap rounded-sm border border-white/60 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/10 aria-disabled:cursor-wait sm:block ${headerFocusRing}`}
              >
                {logoutLabel}
              </button>
            </div>
          ) : user === null ? (
            <div className="flex items-center gap-2">
              <Link
                href={authHref("/register", returnTo)}
                aria-current={isCurrent("/register") ? "page" : undefined}
                className={`hidden whitespace-nowrap rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:block ${headerFocusRing}`}
              >
                {t("register")}
              </Link>
              {/* Giriş mobilde de başlıkta görünür (kayıt mobil menüde). */}
              <Link
                ref={loginRef}
                href={authHref("/login", returnTo)}
                aria-current={isCurrent("/login") ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-sm bg-white px-3 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:min-h-0 sm:px-4 ${headerFocusRing}`}
              >
                {t("login")}
              </Link>
            </div>
          ) : (
            // Oturum çözülürken giriş/hesap alanının yerini tutar (yanlış "Giriş yap" görünmez).
            <div aria-hidden="true" className="h-11 w-16 sm:h-9 sm:w-44" />
          )}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuPath(isMenuOpen ? null : pathname)}
            className={`shrink-0 rounded-sm p-2.5 text-white transition hover:bg-white/10 ${menuHidden} ${headerFocusRing}`}
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

      {/* Kap her zaman DOM'da (aria-controls hedefi); içerik yalnız açıkken render edilir. */}
      <div
        id="mobile-menu"
        hidden={!isMenuOpen}
        className={`border-t border-white/20 bg-[#003580] px-4 pb-4 pt-2 ${menuHidden}`}
      >
        {isMenuOpen && (
          <>
            <div className="mb-2 flex flex-col gap-2 border-b border-white/20 pb-3 sm:hidden">
              <ThemeToggle showLabel className={headerFocusRing} />
              <LocaleSwitcher showLabel className={headerFocusRing} />
            </div>
            <nav className="flex flex-col gap-1" aria-label={t("mobile")}>
              {items.map((item) => (
                <Link
                  key={item.key}
                  href={itemHref(item)}
                  aria-current={isItemCurrent(item) ? "page" : undefined}
                  className={`flex min-h-[44px] items-center gap-1 rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 aria-[current=page]:bg-white/15 ${navCurrentClass} ${crowded && !item.extra ? "xl:hidden" : ""} ${headerFocusRing}`}
                >
                  {t(item.key)}
                  {cartBadge(item)}
                  {gated(item) && (
                    <span className="text-xs font-normal"> {t("requiresLogin")}</span>
                  )}
                </Link>
              ))}
              <div className="mt-2 flex flex-col gap-2 border-t border-white/20 pt-2 xl:hidden">
                {user ? (
                  <>
                    <Link
                      href="/account"
                      aria-current={pathname.startsWith("/account") ? "page" : undefined}
                      className={`flex min-h-[44px] items-center rounded-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 aria-[current=page]:bg-white/15 ${navCurrentClass} ${headerFocusRing}`}
                    >
                      {t("account")}
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-disabled={loggingOut || undefined}
                      className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] aria-disabled:cursor-wait ${headerFocusRing}`}
                    >
                      {logoutLabel}
                    </button>
                  </>
                ) : user === undefined ? null : (
                  <>
                    <Link
                      href={authHref("/register", returnTo)}
                      aria-current={isCurrent("/register") ? "page" : undefined}
                      className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${headerFocusRing}`}
                    >
                      {t("register")}
                    </Link>
                    <Link
                      href={authHref("/login", returnTo)}
                      aria-current={isCurrent("/login") ? "page" : undefined}
                      className={`rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580] ${headerFocusRing}`}
                    >
                      {t("login")}
                    </Link>
                  </>
                )}
              </div>
            </nav>
          </>
        )}
      </div>
      {needsVerify && (
        // Doğrulanmamış e-posta: rezervasyon için gerekli; yeniden gönderme her sayfada elde.
        <section
          aria-label={t("verifyStripLabel")}
          className="border-b border-amber-300 bg-amber-50 text-amber-900"
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p className="text-sm font-semibold">{t("verifyStrip")}</p>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
              {demo && (
                <Link
                  href="/dev/mailbox"
                  className={`inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium underline ${focusRing}`}
                >
                  {t("mailbox")}
                </Link>
              )}
              <ResendVerificationButton className="w-full sm:w-auto" />
            </div>
          </div>
        </section>
      )}
    </header>
  );
}
