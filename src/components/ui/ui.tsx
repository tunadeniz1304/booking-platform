"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { refreshSessionUser, useSessionUserCache } from "@/components/layout/useSessionUserCache";
import { APP_RECONNECT_EVENT } from "@/components/pwa/NetworkStatusBanner";
import { ApiError, isNetworkError, logout, type SessionUser } from "@/lib/api-client";
import { focusRing } from "./focusRing";

export { focusRing };

/** iOS Safari 16px altı alanda odakta sayfayı büyütür; küçük ekranda `text-base`. */
export const inputClass = `mt-1 block w-full rounded-md border border-gray-500 bg-white px-3 py-2 text-base text-gray-900 sm:text-sm ${focusRing}`;

const buttonVariants = {
  primary: "bg-[#003580] text-white hover:bg-[#002b66]",
  secondary: "border border-[#003580] bg-white text-[#003580] hover:bg-blue-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
} as const;

const buttonSizes = {
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-base",
} as const;

type ButtonStyle = {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  fullWidth?: boolean;
};

/** Button ve ButtonLink'in ortak sınıfları: aynı köşe, dolgu ve odak halkası. */
export function buttonClass({
  variant = "primary",
  size = "md",
  fullWidth = false,
}: ButtonStyle = {}): string {
  return `inline-flex items-center justify-center rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${buttonSizes[size]}${fullWidth ? " w-full" : ""} ${buttonVariants[variant]} ${focusRing}`;
}

/**
 * `busy`: işlem sürerken düğme odakta kalır (`disabled` odağı <body>'ye düşürür);
 * `aria-disabled` + `aria-busy` verilir, tıklama ve form gönderimi yok sayılır (çift gönderim yok).
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  busy = false,
  onClick,
  ...props
}: React.ComponentPropsWithRef<"button"> & ButtonStyle & { busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-disabled={busy || props["aria-disabled"] || undefined}
      aria-busy={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={`${buttonClass({ variant, size, fullWidth })} ${className}`}
    />
  );
}

/** Düğme görünümlü bağlantı (gezinme için; eylem için `Button`). */
export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  ...props
}: React.ComponentPropsWithRef<typeof Link> & ButtonStyle) {
  return (
    <Link {...props} className={`${buttonClass({ variant, size, fullWidth })} ${className}`} />
  );
}

/** Hata/başarı metinlerinin önündeki simgeler (renge ek ipucu; ekran okuyucudan gizli). */
const ERROR_ICON = "\u26A0\uFE0E";
const SUCCESS_ICON = "\u2713";

/**
 * Etiketli form alanı. `hint` ve `error` tek alt öğeye (input/select/textarea)
 * `aria-describedby` ile bağlanır; hata varken `aria-invalid` (WCAG 3.3.1 / 1.3.1).
 * `required`: etikete görsel `*` eklenir ve alt öğeye `required` verilir (WCAG 3.3.2);
 * formda bir kez `RequiredLegend` gösterin.
 */
export function Field({
  label,
  id,
  hint,
  error,
  required = false,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control =
    isValidElement(children) && (describedBy || required)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
          ...(error ? { "aria-invalid": true } : {}),
          ...(required ? { required: true } : {}),
        })
      : children;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-gray-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-700">
          <span aria-hidden="true">{ERROR_ICON} </span>
          <span className="sr-only">{t("errorPrefix")} </span>
          {error}
        </p>
      )}
    </div>
  );
}

/** "* işaretli alanlar zorunludur" açıklaması; `required` Field içeren formun başında bir kez. */
export function RequiredLegend({ className = "" }: { className?: string }) {
  const t = useTranslations("common");
  return <p className={`text-xs text-gray-600 ${className}`}>{t("requiredLegend")}</p>;
}

/**
 * Gönderimde hata bulunan ilk alana (`aria-invalid="true"`) odak taşır (WCAG 3.3.1).
 * Hata durumunu ayarlayan setState ile aynı işleyicide çağrılabilir: odak, React yeni
 * `aria-invalid` değerini DOM'a yazdıktan sonraki karede verilir.
 */
export function focusFirstInvalid(form: HTMLFormElement | null | undefined): void {
  if (!form) return;
  const run = () => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/** `headingLevel={3}`: başka bir h2 bölümünün içindeki kartlar için (başlık sırası atlanmaz). */
export function Card({
  title,
  children,
  id,
  headingLevel = 2,
}: {
  title?: string;
  children: ReactNode;
  id?: string;
  headingLevel?: 2 | 3;
}) {
  const headingId = id ? `${id}-title` : undefined;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      {title && (
        <Heading id={headingId} className="mb-3 text-lg font-semibold text-gray-900">
          {title}
        </Heading>
      )}
      {children}
    </section>
  );
}

const MODE_KEYS = new Set(["live", "demo", "fallback"]);

/**
 * AI Act Md. 50 şeffaflık rozeti: her yapay zekâ çıktısının yanında "Yapay zekâ ile üretildi"
 * ve görünür "doğruluğunu kontrol edin" uyarısı (title ipucu dokunmatik/klavyede görünmez).
 * `audience="staff"` (yönetim/ev sahibi panelleri) üretim modunu (canlı / demo / yedek) da
 * gösterir; misafire yalnız yedek (basit) yanıt belirtilir, bilinmeyen mod basılmaz.
 */
export function LlmBadge({
  mode,
  audience = "guest",
}: {
  mode?: string | null;
  audience?: "guest" | "staff";
}) {
  const t = useTranslations("common");
  if (!mode) return null;
  const color =
    mode === "live"
      ? "bg-green-100 text-green-900"
      : mode === "fallback"
        ? "bg-amber-100 text-amber-900"
        : "bg-gray-200 text-gray-900";
  const modeLabel =
    audience === "staff"
      ? MODE_KEYS.has(mode)
        ? t(`ai.modes.${mode}`)
        : mode
      : mode === "fallback"
        ? t("ai.modes.fallback")
        : null;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 align-middle"
      data-ai-generated="true"
    >
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
      >
        {t("ai.generated")}
        {modeLabel && ` · ${modeLabel}`}
      </span>
      <span className="text-xs font-normal text-gray-700">{t("ai.hint")}</span>
    </span>
  );
}

/**
 * Asenkron sonuçlar için ekran okuyucu dostu durum alanı. Hata, eklendiğinde okunan ayrı bir
 * `role="alert"` öğesiyle; başarı, her zaman DOM'da duran `role="status"` bölgesiyle duyurulur
 * (iç içe canlı bölge yok, tek duyuru). Renge ek olarak simge ve gizli önek verilir.
 * `onRetry` (ör. useLoader `reload`): hata varken altında "Tekrar dene" düğmesi gösterilir.
 */
export function Status({
  error,
  message,
  onRetry,
}: {
  error?: string | null;
  message?: string | null;
  onRetry?: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div className="min-h-[1.25rem] text-sm">
      {error && (
        <p role="alert" className="text-red-700">
          <span aria-hidden="true">{ERROR_ICON} </span>
          <span className="sr-only">{t("errorPrefix")} </span>
          {error}
        </p>
      )}
      {error && onRetry && (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          {t("errorPage.retry")}
        </Button>
      )}
      <div role="status">
        {!error && message && (
          <p className="text-green-800">
            <span aria-hidden="true">{SUCCESS_ICON} </span>
            <span className="sr-only">{t("successPrefix")} </span>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

/** Son görülen sayfa yolu; tam sayfa yüklemesinde sıfırlanır (modül kapsamı). */
let lastHeadingFocusPath: string | null = null;

/** Yolu kaydeder; istemci tarafı gezinmeyle yeni bir yola gelindiyse `true`. */
function isClientNavigation(pathname: string): boolean {
  const previous = lastHeadingFocusPath;
  lastHeadingFocusPath = pathname;
  return previous !== null && previous !== pathname;
}

/**
 * İstemci tarafı rota değişiminde odağı sayfanın ana başlığına taşır (WCAG 2.4.3); ilk tam
 * yüklemede odak taşınmaz. Dönen ref'i `tabIndex={-1}` olan h1'e verin (kendi `main` öğesini
 * kuran sayfalar için de).
 */
export function usePageHeadingFocus<T extends HTMLElement = HTMLHeadingElement>() {
  const ref = useRef<T>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (isClientNavigation(pathname)) ref.current?.focus({ preventScroll: true });
  }, [pathname]);
  return ref;
}

/** PageShell içerik genişliği; `wide` (tablo ağırlıklı paneller) başlık/altbilgiyle aynı sütun. */
const shellWidths = {
  narrow: "max-w-5xl",
  wide: "max-w-7xl",
} as const;

/** Yatay dolgu başlık ve altbilgiyle aynı (`px-4 sm:px-6 lg:px-8`): sol kenarlar hizalı. */
const shellMainClass = "mx-auto w-full flex-1 space-y-6 px-4 py-8 sm:px-6 lg:px-8";

export type Breadcrumb = { label: string; href?: string };

/** Sayfanın konumu (ör. Yönetim › Talepler); son öğe geçerli sayfadır (`aria-current`). */
function Breadcrumbs({ items }: { items: ReadonlyArray<Breadcrumb> }) {
  const t = useTranslations("common");
  return (
    <nav aria-label={t("breadcrumb")} className="mb-1">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-700">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">›</span>}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className={`text-[#003580] underline underline-offset-2 ${focusRing}`}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Sayfa iskeleti (başlık, ana bölge, altbilgi). `breadcrumbs`: h1 üstünde konum gezinmesi
 * (alt sayfalardan üst/kardeş sayfaya tek tık). `backHref` + `backLabel`: h1 üstünde her alt
 * sayfada aynı yerde duran "← geri" bağlantısı. `width="wide"`: host/admin panelleri için
 * başlıkla aynı genişlik; yatay dolgu her iki genişlikte başlık/altbilgiyle aynıdır.
 */
export function PageShell({
  title,
  intro,
  children,
  breadcrumbs,
  backHref,
  backLabel,
  width = "narrow",
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  breadcrumbs?: ReadonlyArray<Breadcrumb>;
  backHref?: string;
  backLabel?: string;
  width?: keyof typeof shellWidths;
}) {
  const headingRef = usePageHeadingFocus();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className={`${shellMainClass} ${shellWidths[width]}`}>
        <div>
          {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
          {backHref && backLabel && (
            <Link
              href={backHref}
              className={`inline-flex items-center gap-1 py-2 text-sm font-semibold text-[#003580] underline-offset-2 hover:underline ${focusRing}`}
            >
              <span aria-hidden="true">←</span>
              {backLabel}
            </Link>
          )}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-gray-900 focus:outline-none"
          >
            {title}
          </h1>
          {intro && <div className="mt-1 text-sm text-gray-700">{intro}</div>}
        </div>
        {children}
      </main>
      <Footer />
    </div>
  );
}

type SessionState = { status: "loading" } | { status: "ready"; user: SessionUser | null };

/**
 * Oturumdaki kullanıcı. Başlıkla aynı önbelleği ve aynı `/api/user/me` isteğini paylaşır (çift
 * istek yok); bilinen kullanıcıyla hemen `ready` döner, korumalı içerik oturum yanıtını beklemeden
 * yüklenmeye başlar ve arka planda doğrulanır. Oturumsuz (`null`) önbellek, yeni girişten sonra
 * eskimiş olabileceği için yalnız bu bağlamadaki doğrulamadan sonra kabul edilir. Bağlantı
 * geri gelince oturum yeniden doğrulanır (çevrimdışıyken düşen ilk istek "giriş yapın"da kalmaz).
 */
export function useSession(): SessionState {
  const user = useSessionUserCache();
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    let active = true;
    void refreshSessionUser().then(() => {
      if (active) setVerified(true);
    });
    const onReconnect = () => void refreshSessionUser();
    window.addEventListener(APP_RECONNECT_EVENT, onReconnect);
    return () => {
      active = false;
      window.removeEventListener(APP_RECONNECT_EVENT, onReconnect);
    };
  }, []);
  if (user === undefined || (user === null && !verified)) return { status: "loading" };
  return { status: "ready", user };
}

/** Gizli değer taşıyan hash (`#token=` vb.) dönüş adresine yazılmaz; sorgu dizesi günlüğe düşer. */
const SECRET_HASH = /(^|[#&])(token|code|key)=/i;

function currentReturnPath(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${SECRET_HASH.test(hash) ? "" : hash}`;
}

/**
 * Giriş bağlantısı, dönüş adresiyle (`/login?redirect=...`). `returnTo` verilmezse
 * tarayıcıdaki geçerli yol + sorgu + hash kullanılır (gizli değer taşıyan hash hariç);
 * giriş/kayıt sayfalarının kendisi taşınmaz.
 */
export function loginHref(returnTo?: string, base: "/login" | "/register" = "/login"): string {
  const target = returnTo ?? (typeof window === "undefined" ? "/" : currentReturnPath());
  if (!target.startsWith("/") || target.startsWith("//") || target === "/") return base;
  if (/^\/(login|register)(\/|\?|#|$)/.test(target)) return base;
  return `${base}?redirect=${encodeURIComponent(target)}`;
}

/** Rol kapısı: oturum yoksa giriş bağlantısı, rol yetmiyorsa açık mesaj (API ayrıca yetkilendirir). */
export function RoleGate({
  roles,
  children,
}: {
  roles?: ReadonlyArray<SessionUser["role"]>;
  children: (user: SessionUser) => ReactNode;
}) {
  const t = useTranslations("common");
  const session = useSession();
  if (session.status === "loading") {
    return (
      <p aria-live="polite" className="text-sm text-gray-600">
        {t("loading")}
      </p>
    );
  }
  if (!session.user) {
    return (
      <p className="text-sm text-gray-800">
        {t.rich("loginRequired", {
          link: (chunks) => (
            <Link
              href={loginHref()}
              className={`font-semibold text-[#003580] underline ${focusRing}`}
            >
              {chunks}
            </Link>
          ),
          register: (chunks) => (
            <Link
              href={loginHref(undefined, "/register")}
              className={`font-semibold text-[#003580] underline ${focusRing}`}
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    );
  }
  if (roles && !roles.includes(session.user.role)) {
    return <AccessDenied roles={roles} userRole={session.user.role} />;
  }
  return <>{children(session.user)}</>;
}

/**
 * Rol yetmediğinde: gerekli rol insan diliyle (enum kodu değil) ve sonraki adımlar (ana sayfa,
 * hesap, farklı hesapla giriş). Ev sahibi sayfasına gelen misafire başvuru yolu gösterilir.
 * Sayfa açılışında görünen durum olduğu için `role="alert"` ile duyurulmaz.
 */
function AccessDenied({
  roles,
  userRole,
}: {
  roles: ReadonlyArray<SessionUser["role"]>;
  userRole: SessionUser["role"];
}) {
  const t = useTranslations("common");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const [switching, setSwitching] = useState(false);
  const roleNames = new Intl.ListFormat(locale, { type: "disjunction" }).format(
    roles.map((r) => t(`access.roles.${r}`))
  );
  const switchAccount = () => {
    setSwitching(true);
    void logout().finally(() => window.location.assign(loginHref()));
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-red-700">
        <span aria-hidden="true">{ERROR_ICON} </span>
        {t("forbidden", { roles: roleNames })}
      </p>
      {userRole === "USER" && roles.includes("HOST") && (
        <p className="text-gray-800">
          {t.rich("access.becomeHost", {
            link: (chunks) => (
              <Link
                href="/support"
                className={`font-semibold text-[#003580] underline ${focusRing}`}
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/" variant="secondary">
          {t("errorPage.home")}
        </ButtonLink>
        <ButtonLink href="/account" variant="secondary">
          {tNav("account")}
        </ButtonLink>
        <Button variant="secondary" busy={switching} onClick={switchAccount}>
          {t("access.switchAccount")}
        </Button>
      </div>
    </div>
  );
}

/** Bağımlılık dizilerini React gibi (`Object.is`, öğe öğe) karşılaştırır. */
function sameDeps(a: ReadonlyArray<unknown> | null, b: ReadonlyArray<unknown>): boolean {
  return a !== null && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Basit veri yükleyici: `fetcher` bir Promise döner; `reload()` yeniden çeker.
 * `loading`: güncel istek (ilk yükleme, deps değişimi ya da `reload`) sürerken `true`; veri
 * bölgesine `aria-busy={loading}` verip `RefreshStatus` gösterin, hata için `LoadError`.
 * `resetOnDepsChange`: deps (filtre, ilan vb.) değişince önceki sorgunun verisi ve hatası yeni
 * yanıt gelene kadar döndürülmez (eski satırlar güncelmiş gibi görünmez); `reload()` veriyi korur.
 * Bağlantı geri gelince (`APP_RECONNECT_EVENT`) `reload()` gibi yeniden çeker; veri sıfırlanmaz.
 * setState yalnızca Promise geri çağrısında yapılır (effect gövdesinde değil).
 */
export function useLoader<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  { resetOnDepsChange = false }: { resetOnDepsChange?: boolean } = {}
) {
  const errorText = useErrorText();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Son sonuçlanan isteğin anahtarı ([version, ...deps]) ve `data`nın ait olduğu deps.
  const [settledKey, setSettledKey] = useState<ReadonlyArray<unknown> | null>(null);
  const [dataDeps, setDataDeps] = useState<ReadonlyArray<unknown> | null>(null);
  useEffect(() => {
    let active = true;
    const key = [version, ...deps];
    fetcher()
      .then((d) => {
        if (!active) return;
        setData(d);
        setDataDeps(deps);
        setError(null);
        setSettledKey(key);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(errorText(e));
        setSettledKey(key);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps çağıran tarafından verilir
  }, [version, ...deps]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener(APP_RECONNECT_EVENT, reload);
    return () => window.removeEventListener(APP_RECONNECT_EVENT, reload);
  }, [reload]);
  const loading = !sameDeps(settledKey, [version, ...deps]);
  const staleData = resetOnDepsChange && !sameDeps(dataDeps, deps);
  const staleError =
    resetOnDepsChange && settledKey !== null && !sameDeps(settledKey.slice(1), deps);
  return {
    data: staleData ? null : data,
    error: staleError ? null : error,
    loading,
    reload,
  };
}

/**
 * Yükleme hatası ve "Tekrar dene" düğmesi (useLoader `reload`). `busy` (useLoader `loading`):
 * yeniden deneme sürerken düğme odakta kalır, tekrar tıklama yok sayılır. Erken dönüşte
 * bağlam kaybolmasın diye kartın başlığıyla birlikte (`<Card title>` içinde) gösterin.
 */
export function LoadError({
  error,
  onRetry,
  busy = false,
}: {
  error: string;
  onRetry: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("common");
  return (
    <div className="space-y-2 text-sm">
      <p role="alert" className="text-red-700">
        <span aria-hidden="true">{ERROR_ICON} </span>
        <span className="sr-only">{t("errorPrefix")} </span>
        {error}
      </p>
      <Button variant="secondary" busy={busy} onClick={onRetry}>
        {t("errorPage.retry")}
      </Button>
    </div>
  );
}

/**
 * Eldeki veri yenilenirken "Güncelleniyor…" bildirir (useLoader `loading && data`). Bölge hep
 * DOM'da durur; metin eklenince kibarca okunur. Veri kapsayıcısına ayrıca `aria-busy` verin.
 */
export function RefreshStatus({
  loading,
  className = "",
}: {
  loading: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  return (
    <p role="status" className={`min-h-[1rem] text-xs text-gray-600 ${className}`}>
      {loading ? t("refreshing") : null}
    </p>
  );
}

/**
 * Bileşen dışı (hook kullanılamayan) çağıranlar için; `fallback` arayüz dilinde verilmelidir.
 * Bileşenlerde `useErrorText()` kullanın (sunucu iletisini dil ve hata koduna göre seçer).
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Sunucu metni yerine arayüz dilinde gösterilen genel hata kodları. */
const GENERIC_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "EMAIL_NOT_VERIFIED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
  "INVALID_JSON",
  "TRANSACTION_CONFLICT",
  "TIMEOUT",
]);

/**
 * Hata nesnesini arayüz dilinde kullanıcı metnine çevirir: genel kodlar ve ağ hataları
 * `common.errors.*` ile, kodsuz/5xx hatalar çağıranın `fallback` metni (yoksa
 * `common.unexpectedError`) ile. Alana özgü sunucu iletileri (doğrulama, çakışma vb.) Türkçe
 * olduğu için yalnız Türkçe arayüzde gösterilir; diğer dillerde kodun çevirisi ya da
 * `fallback` kullanılır (F52).
 */
export function useErrorText(): (error: unknown, fallback?: string) => string {
  const t = useTranslations("common");
  const locale = useLocale();
  return useCallback(
    (error: unknown, fallback?: string): string => {
      const generic = fallback ?? t("unexpectedError");
      if (error instanceof ApiError) {
        if (error.code && GENERIC_ERROR_CODES.has(error.code)) return t(`errors.${error.code}`);
        if (!error.code || error.status >= 500) return generic;
        if (locale === "tr") return error.message;
        return t.has(`errors.${error.code}`) ? t(`errors.${error.code}`) : generic;
      }
      if (isNetworkError(error) || (error instanceof Error && error.name === "AbortError")) {
        return t("errors.network");
      }
      return error instanceof Error && error.message ? error.message : generic;
    },
    [locale, t]
  );
}
